type GeoTiffDepthRaster = {
  width: number
  height: number
  west: number
  south: number
  east: number
  north: number
  values: Float32Array
  description?: string
}

const encoder = new TextEncoder()

function u16le(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}

function u32le(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true)
}

function f64le(view: DataView, offset: number, value: number): void {
  view.setFloat64(offset, value, true)
}

function doubleBytes(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 8)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => f64le(view, index * 8, value))
  return bytes
}

export function writeDepthGeoTiffFloat32(raster: GeoTiffDepthRaster): Uint8Array {
  const { width, height, values, west, south, east, north } = raster
  const count = width * height
  if (values.length < count) throw new Error('水深栅格数值数量不足')
  const stripBytes = count * 4
  const cellLon = (east - west) / width
  const cellLat = (north - south) / height
  const meta = raster.description ?? 'water depth (m) EPSG:4326'
  const metaBytes = encoder.encode(meta)
  const asciiBytes = new Uint8Array(metaBytes.length + 1)
  asciiBytes.set(metaBytes, 0)
  const keysBytes = new Uint8Array([1, 1, 0, 6, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326])
  const tags: { tag: number; type: number; count: number; offset?: number; inline?: Uint8Array }[] = [
    { tag: 256, type: 3, count: 1, inline: new Uint8Array([width & 0xff, width >> 8]) },
    { tag: 257, type: 3, count: 1, inline: new Uint8Array([height & 0xff, height >> 8]) },
    { tag: 258, type: 3, count: 1, inline: new Uint8Array([32, 0]) },
    { tag: 259, type: 3, count: 1, inline: new Uint8Array([1, 0]) },
    { tag: 262, type: 3, count: 1, inline: new Uint8Array([1, 0]) },
    { tag: 273, type: 4, count: 1 },
    { tag: 277, type: 3, count: 1, inline: new Uint8Array([1, 0]) },
    { tag: 278, type: 4, count: 1, inline: new Uint8Array([height, 0, 0, 0]) },
    { tag: 279, type: 4, count: 1, inline: new Uint8Array([stripBytes, 0, 0, 0]) },
    { tag: 284, type: 3, count: 1, inline: new Uint8Array([1, 0]) },
    { tag: 339, type: 3, count: 1, inline: new Uint8Array([3, 0]) },
    { tag: 33550, type: 12, count: 3 },
    { tag: 33922, type: 12, count: 6 },
    { tag: 34735, type: 3, count: keysBytes.length / 2 }
  ]
  const IFD = 8
  const entrySize = 12
  let cursor = IFD + 2 + tags.length * entrySize + 4
  const scaleOffset = cursor
  cursor += 24
  const tieOffset = cursor
  cursor += 48
  const keysOffset = cursor
  cursor += keysBytes.length
  const stripOffset = cursor
  cursor += stripBytes
  const asciiOffset = cursor
  cursor += asciiBytes.length
  const total = cursor
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  out[0] = 0x49
  out[1] = 0x49
  u16le(view, 2, 42)
  u32le(view, 4, IFD)
  u16le(view, IFD, tags.length)
  let entry = IFD + 2
  for (const tag of tags) {
    u16le(view, entry, tag.tag)
    u16le(view, entry + 2, tag.type)
    u32le(view, entry + 4, tag.count)
    const hasOffset = (tag.count * (tag.type === 12 ? 8 : tag.type === 4 ? 4 : 2)) > 4
    if (hasOffset) {
      const off = tag.tag === 33550 ? scaleOffset : tag.tag === 33922 ? tieOffset : tag.tag === 34735 ? keysOffset : stripOffset
      u32le(view, entry + 8, off)
    } else if (tag.tag === 273) {
      u32le(view, entry + 8, stripOffset)
    } else if (tag.inline) {
      out.set(tag.inline, entry + 8)
    } else {
      u32le(view, entry + 8, 0)
    }
    entry += entrySize
  }
  u32le(view, IFD + 2 + tags.length * entrySize, 0)
  out.set(doubleBytes(cellLon, -cellLat, 0), scaleOffset)
  out.set(doubleBytes(0, 0, 0, west, north, 0), tieOffset)
  out.set(keysBytes, keysOffset)
  out.set(asciiBytes, asciiOffset)
  const data = new Float32Array(values.buffer, values.byteOffset, count)
  out.set(new Uint8Array(data.buffer, data.byteOffset, count * 4), stripOffset)
  return out
}
