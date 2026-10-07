/**
 * 真实 Mapbox Vector Tile（MVT / PBF）编解码。
 *
 * 这是旗舰案例九的底座：彻底替代「随机 feature 冒充 MVT」的做法，
 * 提供完整 z/x/y 瓦片生命周期所需的 PBF 字节流解析与编码能力。
 *
 * 遵循 MVT 2.1 规范：
 * Tile.layers=3
 * Layer.version=15 / name=1 / features=2 / keys=3 / values=4 / extent=5
 * Feature.id=1 / tags=2 / type=3 / geometry=4
 * Value.string=1 / float=2 / double=3 / int=4 / uint=5 / sint=6 / bool=7
 */

export type MvtGeometryType = 'Point' | 'LineString' | 'Polygon'

export type MvtFeature = {
  id: number
  type: MvtGeometryType
  /** 反量化前的整数坐标序列（相对瓦片原点）。 */
  coordinates: number[][]
  properties: Record<string, string | number | boolean>
}

export type MvtLayer = {
  name: string
  version: number
  extent: number
  features: MvtFeature[]
}

export type MvtTile = {
  layers: MvtLayer[]
}

class ProtoReader {
  private offset = 0
  constructor(private readonly data: Uint8Array) {}

  get eof(): boolean {
    return this.offset >= this.data.length
  }

  varint(): number {
    let result = 0
    let shift = 0
    while (true) {
      const byte = this.data[this.offset++]
      result += (byte & 0x7f) * 2 ** shift
      if ((byte & 0x80) === 0) break
      shift += 7
    }
    return result
  }

  sint(): number {
    const value = this.varint()
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2
  }

  bytes(): Uint8Array {
    const length = this.varint()
    const slice = this.data.subarray(this.offset, this.offset + length)
    this.offset += length
    return slice
  }

  string(): string {
    return new TextDecoder().decode(this.bytes())
  }

  float(): number {
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 4)
    this.offset += 4
    return view.getFloat32(0, true)
  }

  double(): number {
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 8)
    this.offset += 8
    return view.getFloat64(0, true)
  }

  skip(wireType: number): void {
    if (wireType === 0) this.varint()
    else if (wireType === 1) this.offset += 8
    else if (wireType === 2) this.offset += this.varint()
    else if (wireType === 5) this.offset += 4
  }

  tag(): [number, number] {
    const value = this.varint()
    return [value >>> 3, value & 0x7]
  }
}

function decodeValue(reader: ProtoReader): string | number | boolean {
  let value: string | number | boolean = 0
  while (!reader.eof) {
    const [field, wire] = reader.tag()
    if (field === 1 && wire === 2) value = reader.string()
    else if (field === 2 && wire === 5) value = reader.float()
    else if (field === 3 && wire === 1) value = reader.double()
    else if (field === 4 && wire === 0) value = reader.varint()
    else if (field === 5 && wire === 0) value = reader.varint()
    else if (field === 6 && wire === 0) value = reader.sint()
    else if (field === 7 && wire === 0) value = reader.varint() !== 0
    else break
  }
  return value
}

function zigzagDecode(value: number): number {
  return (value >>> 1) ^ -(value & 1)
}

function decodeGeometry(commands: number[]): { type: MvtGeometryType; coordinates: number[][] } {
  const coordinates: number[][] = []
  let type: MvtGeometryType = 'Point'
  let x = 0
  let y = 0
  let index = 0
  while (index < commands.length) {
    const command = commands[index++]
    const id = command & 0x7
    const count = command >> 3
    if (id === 1 || id === 2) {
      for (let i = 0; i < count; i += 1) {
        x += zigzagDecode(commands[index++])
        y += zigzagDecode(commands[index++])
        coordinates.push([x, y])
      }
    } else if (id === 7) {
      type = 'Polygon'
    }
  }
  return { type, coordinates }
}

function decodeLayer(reader: ProtoReader): MvtLayer {
  const layer: MvtLayer = { name: '', version: 1, extent: 4096, features: [] }
  const keys: string[] = []
  const values: Array<string | number | boolean> = []
  const pending: Array<{ id: number; declared: MvtGeometryType; geometry: number[]; tags: number[] }> = []
  while (!reader.eof) {
    const [field, wire] = reader.tag()
    if (field === 1 && wire === 2) layer.name = reader.string()
    else if (field === 15 && wire === 0) layer.version = reader.varint()
    else if (field === 5 && wire === 0) layer.extent = reader.varint()
    else if (field === 3 && wire === 2) keys.push(reader.string())
    else if (field === 4 && wire === 2) values.push(decodeValue(new ProtoReader(reader.bytes())))
    else if (field === 2 && wire === 2) {
      const sub = new ProtoReader(reader.bytes())
      let declared: MvtGeometryType = 'Point'
      let geometry: number[] = []
      const tags: number[] = []
      let id = 0
      while (!sub.eof) {
        const [f, w] = sub.tag()
        if (f === 1 && w === 0) id = sub.varint()
        else if (f === 3 && w === 0) {
          const raw = sub.varint()
          declared = raw === 1 ? 'Point' : raw === 2 ? 'LineString' : 'Polygon'
        } else if (f === 4 && w === 2) {
          const packed = new ProtoReader(sub.bytes())
          while (!packed.eof) geometry.push(packed.varint())
        } else if (f === 2 && w === 2) {
          const packed = new ProtoReader(sub.bytes())
          while (!packed.eof) tags.push(packed.varint())
        } else sub.skip(w)
      }
      pending.push({ id, declared, geometry, tags })
    } else reader.skip(wire)
  }
  // keys/values 在 layer 末尾才出现，必须在整层解析完后再回填 feature 属性。
  for (const item of pending) {
    const properties: Record<string, string | number | boolean> = {}
    for (let i = 0; i + 1 < item.tags.length; i += 2) {
      const key = keys[item.tags[i]]
      if (key !== undefined) properties[key] = values[item.tags[i + 1]] ?? 0
    }
    const decoded = decodeGeometry(item.geometry)
    layer.features.push({
      id: item.id,
      type: item.declared === 'Point' ? (decoded.type === 'Polygon' ? 'Polygon' : 'Point') : item.declared,
      coordinates: decoded.coordinates,
      properties
    })
  }
  return layer
}

/** 解码 MVT/PBF 字节流。 */
export function decodeMvt(buffer: ArrayBuffer | Uint8Array): MvtTile {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const reader = new ProtoReader(data)
  const tile: MvtTile = { layers: [] }
  while (!reader.eof) {
    const [field, wire] = reader.tag()
    if (field === 3 && wire === 2) tile.layers.push(decodeLayer(new ProtoReader(reader.bytes())))
    else reader.skip(wire)
  }
  return tile
}

class ProtoWriter {
  private chunks: number[] = []

  varint(value: number): void {
    let v = Math.max(0, Math.floor(value))
    while (v >= 0x80) {
      this.chunks.push((v & 0x7f) | 0x80)
      v = Math.floor(v / 128)
    }
    this.chunks.push(v)
  }

  tag(field: number, wire: number): void {
    this.varint((field << 3) | wire)
  }

  bytes(field: number, data: Uint8Array): void {
    this.tag(field, 2)
    this.varint(data.length)
    for (const byte of data) this.chunks.push(byte)
  }

  string(field: number, value: string): void {
    this.bytes(field, new TextEncoder().encode(value))
  }

  finish(): Uint8Array {
    return new Uint8Array(this.chunks)
  }
}

function zigzag(value: number): number {
  return value < 0 ? -value * 2 - 1 : value * 2
}

function encodeGeometry(type: MvtGeometryType, coordinates: number[][]): number[] {
  const commands: number[] = []
  if (type === 'Point' || coordinates.length === 1) {
    commands.push((coordinates.length << 3) | 1)
    let px = 0
    let py = 0
    for (const [x, y] of coordinates) {
      commands.push(zigzag(x - px), zigzag(y - py))
      px = x
      py = y
    }
    return commands
  }
  commands.push((1 << 3) | 1)
  commands.push(zigzag(coordinates[0][0]), zigzag(coordinates[0][1]))
  commands.push(((coordinates.length - 1) << 3) | 2)
  let px = coordinates[0][0]
  let py = coordinates[0][1]
  for (let i = 1; i < coordinates.length; i += 1) {
    commands.push(zigzag(coordinates[i][0] - px), zigzag(coordinates[i][1] - py))
    px = coordinates[i][0]
    py = coordinates[i][1]
  }
  if (type === 'Polygon') commands.push((1 << 3) | 7)
  return commands
}

export type MvtGeometryInput = {
  id?: number
  type: MvtGeometryType
  coordinates: number[][]
  properties?: Record<string, string | number | boolean>
}

function encodeValue(value: string | number | boolean): Uint8Array {
  const writer = new ProtoWriter()
  if (typeof value === 'string') writer.string(1, value)
  else if (typeof value === 'boolean') {
    writer.tag(7, 0)
    writer.varint(value ? 1 : 0)
  } else {
    const buffer = new ArrayBuffer(8)
    new DataView(buffer).setFloat64(0, value, true)
    writer.bytes(3, new Uint8Array(buffer))
  }
  return writer.finish()
}

/** 编码 MVT 字节流（本地瓦片 / 离线大数据的真实 PBF 生命周期）。 */
export function encodeMvt(tileName: string, extent: number, geometries: MvtGeometryInput[]): Uint8Array {
  const keys: string[] = []
  const keyIndex = new Map<string, number>()
  const values: Array<string | number | boolean> = []
  const valueIndex = new Map<string, number>()
  const keyOf = (key: string): number => {
    if (!keyIndex.has(key)) {
      keyIndex.set(key, keys.length)
      keys.push(key)
    }
    return keyIndex.get(key) as number
  }
  const valueOf = (value: string | number | boolean): number => {
    const token = `${typeof value}:${String(value)}`
    if (!valueIndex.has(token)) {
      valueIndex.set(token, values.length)
      values.push(value)
    }
    return valueIndex.get(token) as number
  }

  const layer = new ProtoWriter()
  layer.string(1, tileName)
  geometries.forEach((geometry, index) => {
    const feature = new ProtoWriter()
    feature.tag(1, 0)
    feature.varint(geometry.id ?? index + 1)
    const tags: number[] = []
    for (const [key, value] of Object.entries(geometry.properties ?? {})) tags.push(keyOf(key), valueOf(value))
    if (tags.length) {
      feature.tag(2, 2)
      feature.varint(tags.length)
      for (const tag of tags) feature.varint(tag)
    }
    feature.tag(3, 0)
    feature.varint(geometry.type === 'Point' ? 1 : geometry.type === 'LineString' ? 2 : 3)
    const commands = encodeGeometry(geometry.type, geometry.coordinates)
    feature.tag(4, 2)
    feature.varint(commands.length)
    for (const command of commands) feature.varint(command)
    layer.bytes(2, feature.finish())
  })
  for (const key of keys) layer.string(3, key)
  for (const value of values) layer.bytes(4, encodeValue(value))
  layer.tag(5, 0)
  layer.varint(extent)
  layer.tag(15, 0)
  layer.varint(2)

  const tile = new ProtoWriter()
  tile.bytes(3, layer.finish())
  return tile.finish()
}

/** 兼容别名。 */
export { decodeMvt as MapboxVectorTile }
