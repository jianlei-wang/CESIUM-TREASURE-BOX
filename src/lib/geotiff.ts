const encoder = new TextEncoder()

export type GeoTiffFloat32Options = {
  width: number
  height: number
  west: number
  north: number
  cellLon: number
  cellLat: number
  values: Float32Array
  description?: string
}

const TIFF_TYPE_BYTES: Record<number, number> = { 2: 1, 3: 2, 4: 4, 12: 8 }

function u16le(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}

function u32le(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true)
}

function shortBytes(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setUint16(index * 2, value, true))
  return bytes
}

function longBytes(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setUint32(index * 4, value >>> 0, true))
  return bytes
}

function doubleBytes(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 8)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setFloat64(index * 8, value, true))
  return bytes
}

type RasterEntry = { tag: number; type: number; count: number; data: Uint8Array }

/**
 * 生成带地理坐标的 GeoTIFF（Float32 单波段，WGS84 / EPSG:4326）。
 * 采用 PixelIsArea 约定：ModelPixelScale 为像元尺寸，ModelTiepoint 取左上角
 * （west, north），因此栅格范围恰好覆盖 [west, east] × [south, north]。
 */
export function writeGeoTiffFloat32(options: GeoTiffFloat32Options): Uint8Array {
  const { width, height, values, west, north, cellLon, cellLat, description } = options
  const pixelCount = width * height
  if (width <= 0 || height <= 0) throw new Error('栅格尺寸无效')
  if (values.length < pixelCount) throw new Error('栅格数值数量不足')

  const stripBytes = pixelCount * 4
  const geoKeys = shortBytes(
    1, 1, 0, 3,
    1024, 0, 1, 2,
    1025, 0, 1, 1,
    2048, 0, 1, 4326
  )
  const scaleData = doubleBytes(cellLon, -cellLat, 0)
  const tieData = doubleBytes(0, 0, 0, west, north, 0)

  const entries: RasterEntry[] = [
    { tag: 256, type: 3, count: 1, data: shortBytes(width) },
    { tag: 257, type: 3, count: 1, data: shortBytes(height) },
    { tag: 258, type: 3, count: 1, data: shortBytes(32) },
    { tag: 259, type: 3, count: 1, data: shortBytes(1) },
    { tag: 262, type: 3, count: 1, data: shortBytes(1) },
    { tag: 273, type: 4, count: 1, data: new Uint8Array(4) },
    { tag: 277, type: 3, count: 1, data: shortBytes(1) },
    { tag: 278, type: 4, count: 1, data: longBytes(height) },
    { tag: 279, type: 4, count: 1, data: longBytes(stripBytes) },
    { tag: 284, type: 3, count: 1, data: shortBytes(1) },
    { tag: 339, type: 3, count: 1, data: shortBytes(3) },
    { tag: 33550, type: 12, count: 3, data: scaleData },
    { tag: 33922, type: 12, count: 6, data: tieData },
    { tag: 34735, type: 3, count: geoKeys.length / 2, data: geoKeys }
  ]

  if (description) {
    const ascii = encoder.encode(`${description}\0`)
    const padded = ascii.length % 2 === 0 ? ascii : new Uint8Array([...ascii, 0])
    entries.push({ tag: 34737, type: 2, count: padded.length, data: padded })
  }

  entries.sort((a, b) => a.tag - b.tag)

  const IFD = 8
  const entrySize = 12
  let cursor = IFD + 2 + entries.length * entrySize + 4
  const externalOffset = new Map<number, number>()
  for (const entry of entries) {
    const size = entry.count * (TIFF_TYPE_BYTES[entry.type] ?? 1)
    if (size > 4) {
      if (cursor % 2 !== 0) cursor += 1
      externalOffset.set(entry.tag, cursor)
      cursor += entry.data.length
    }
  }
  if (cursor % 2 !== 0) cursor += 1
  const stripOffset = cursor
  cursor += stripBytes

  const stripEntry = entries.find((entry) => entry.tag === 273)
  if (stripEntry) stripEntry.data = longBytes(stripOffset)

  const out = new Uint8Array(cursor)
  const view = new DataView(out.buffer)
  out[0] = 0x49
  out[1] = 0x49
  u16le(view, 2, 42)
  u32le(view, 4, IFD)
  u16le(view, IFD, entries.length)
  let entryOffset = IFD + 2
  for (const entry of entries) {
    u16le(view, entryOffset, entry.tag)
    u16le(view, entryOffset + 2, entry.type)
    u32le(view, entryOffset + 4, entry.count)
    if (entry.data.length > 4) {
      u32le(view, entryOffset + 8, externalOffset.get(entry.tag) ?? 0)
    } else {
      out.set(entry.data, entryOffset + 8)
    }
    entryOffset += entrySize
  }
  u32le(view, IFD + 2 + entries.length * entrySize, 0)
  for (const entry of entries) {
    if (entry.data.length > 4) out.set(entry.data, externalOffset.get(entry.tag) ?? 0)
  }

  const raster = new Float32Array(values.buffer, values.byteOffset, pixelCount)
  out.set(new Uint8Array(raster.buffer, raster.byteOffset, pixelCount * 4), stripOffset)
  return out
}

export type WorldFileOptions = {
  west: number
  north: number
  cellLon: number
  cellLat: number
}

/** 生成 ESRI 世界文件（.pgw/.tfw）内容，与 PixelIsArea GeoTIFF 完全一致。 */
export function buildWorldFile(options: WorldFileOptions): string {
  const { west, north, cellLon, cellLat } = options
  const lines = [
    cellLon,
    0,
    0,
    -cellLat,
    west + cellLon / 2,
    north - cellLat / 2
  ]
  return `${lines.map((value) => value.toPrecision(15)).join('\n')}\n`
}
