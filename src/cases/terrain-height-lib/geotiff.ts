/**
 * 单波段 Float32 GeoTIFF 编码器。
 *
 * geotiff.js 2.x 的 writeArrayBuffer 仅支持 8 位整数（内部 `new Uint8Array(values)`
 * 会把浮点按元素截断），无法写出浮点地形。这里直接按 TIFF 6.0 / GeoTIFF 1.1 规范
 * 手工组帧：小端、单 IFD、单条带、Float32、North-up（row0 对应北边）。
 *
 * 采用的坐标系：EPSG:4326（WGS 84 经纬度，单位为度），像素中心在格心，
 * ModelTiepoint 把栅格 (0,0) 映射到左上角 (west, north)，ModelPixelScale 给出
 * 每像素的经纬度步长，因此影像范围正确为 [west, east] × [south, north]。
 */

export type GeoBoundsDegrees = {
  west: number
  south: number
  east: number
  north: number
}

const TYPE_ASCII = 2
const TYPE_SHORT = 3
const TYPE_LONG = 4
const TYPE_DOUBLE = 12

type TagEntry = {
  tag: number
  type: number
  count: number
  /** SHORT 单值内联时的值；其余情况为数据区偏移 */
  inline?: number
  /** ASCII 长度 ≤ 4 时按 TIFF 规范直接内联进值字段 */
  inlineAscii?: Uint8Array
  data?: number[]
  ascii?: string
}

export function encodeTerrainGeoTiff(
  heights: Float32Array,
  size: number,
  bounds: GeoBoundsDegrees
): ArrayBuffer {
  const pixelBytes = size * size * 4
  const citation = 'WGS 84\u0000'
  const nodata = 'nan\u0000'

  const dLon = (bounds.east - bounds.west) / size
  const dLat = (bounds.north - bounds.south) / size

  const geoKeyDirectory = [
    1, 1, 0, 5,
    1024, 0, 1, 2, // GTModelTypeGeoKey = Geographic
    1025, 0, 1, 1, // GTRasterTypeGeoKey = PixelIsArea
    2048, 0, 1, 4326, // GeographicTypeGeoKey = WGS 84
    2049, 34737, citation.length, 0, // GeogCitationGeoKey → GeoAsciiParamsTag
    2054, 0, 1, 9102 // GeogAngularUnitsGeoKey = degree
  ]

  const tags: TagEntry[] = [
    { tag: 256, type: TYPE_LONG, count: 1, inline: size },
    { tag: 257, type: TYPE_LONG, count: 1, inline: size },
    { tag: 258, type: TYPE_SHORT, count: 1, inline: 32 },
    { tag: 259, type: TYPE_SHORT, count: 1, inline: 1 },
    { tag: 262, type: TYPE_SHORT, count: 1, inline: 1 },
    { tag: 273, type: TYPE_LONG, count: 1, inline: 0 },
    { tag: 277, type: TYPE_SHORT, count: 1, inline: 1 },
    { tag: 278, type: TYPE_LONG, count: 1, inline: size },
    { tag: 279, type: TYPE_LONG, count: 1, inline: pixelBytes },
    { tag: 284, type: TYPE_SHORT, count: 1, inline: 1 },
    { tag: 339, type: TYPE_SHORT, count: 1, inline: 3 },
    { tag: 33550, type: TYPE_DOUBLE, count: 3, data: [dLon, dLat, 0] },
    { tag: 33922, type: TYPE_DOUBLE, count: 6, data: [0, 0, 0, bounds.west, bounds.north, 0] },
    { tag: 34735, type: TYPE_SHORT, count: geoKeyDirectory.length, data: geoKeyDirectory },
    { tag: 34737, type: TYPE_ASCII, count: citation.length, ascii: citation },
    { tag: 42113, type: TYPE_ASCII, count: nodata.length, ascii: nodata }
  ]

  const ifdOffset = 8
  const ifdSize = 2 + tags.length * 12 + 4
  let cursor = (ifdOffset + ifdSize + 7) & ~7

  const dataOffsets = new Map<number, number>()
  const byteArrays: Array<{ offset: number; bytes: Uint8Array }> = []
  for (const entry of tags) {
    let byteLength = 0
    if (entry.data) byteLength = entry.data.length * (entry.type === TYPE_DOUBLE ? 8 : 2)
    else if (entry.ascii) byteLength = entry.ascii.length
    if (byteLength === 0) continue
    if (entry.ascii) {
      const asciiBytes = new Uint8Array(byteLength)
      for (let i = 0; i < entry.ascii.length; i += 1) asciiBytes[i] = entry.ascii.charCodeAt(i)
      if (byteLength <= 4) {
        entry.inlineAscii = asciiBytes
        continue
      }
      dataOffsets.set(entry.tag, cursor)
      byteArrays.push({ offset: cursor, bytes: asciiBytes })
    } else {
      dataOffsets.set(entry.tag, cursor)
    }
    cursor += byteLength
  }
  cursor = (cursor + 3) & ~3
  const pixelOffset = cursor
  const total = pixelOffset + pixelBytes
  const stripOffsetsEntry = tags.find((entry) => entry.tag === 273)
  if (stripOffsetsEntry) stripOffsetsEntry.inline = pixelOffset

  const buffer = new ArrayBuffer(total)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  view.setUint16(0, 0x4949, true)
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)
  view.setUint16(ifdOffset, tags.length, true)

  let entryOffset = ifdOffset + 2
  for (const entry of tags) {
    view.setUint16(entryOffset, entry.tag, true)
    view.setUint16(entryOffset + 2, entry.type, true)
    view.setUint32(entryOffset + 4, entry.count, true)
    if (entry.inlineAscii) {
      for (let i = 0; i < entry.inlineAscii.length; i += 1) {
        view.setUint8(entryOffset + 8 + i, entry.inlineAscii[i])
      }
    } else if (entry.inline !== undefined && entry.type === TYPE_SHORT && entry.count === 1) {
      view.setUint16(entryOffset + 8, entry.inline, true)
      view.setUint16(entryOffset + 10, 0, true)
    } else {
      const offset = entry.inline !== undefined ? entry.inline : (dataOffsets.get(entry.tag) ?? 0)
      view.setUint32(entryOffset + 8, offset, true)
    }
    entryOffset += 12
  }
  view.setUint32(entryOffset, 0, true)

  for (const entry of tags) {
    if (!entry.data || entry.type !== TYPE_DOUBLE) continue
    const offset = dataOffsets.get(entry.tag) ?? 0
    for (let i = 0; i < entry.data.length; i += 1) view.setFloat64(offset + i * 8, entry.data[i], true)
  }
  const geoKeyOffset = dataOffsets.get(34735) ?? 0
  for (let i = 0; i < geoKeyDirectory.length; i += 1) view.setUint16(geoKeyOffset + i * 2, geoKeyDirectory[i], true)
  for (const item of byteArrays) bytes.set(item.bytes, item.offset)

  for (let i = 0; i < heights.length; i += 1) {
    view.setFloat32(pixelOffset + i * 4, heights[i], true)
  }

  return buffer
}
