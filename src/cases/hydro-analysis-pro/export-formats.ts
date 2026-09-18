export type HydFeatureKind = 'Line' | 'Polygon' | 'Point'

export type HydFeatureAttrs = Record<string, string | number>

export type HydFeature = {
  kind: HydFeatureKind
  // Line: 折线顶点 [lon,lat]; Polygon: 外环 [lon,lat](自动闭合); Point: 单点
  path: { lon: number; lat: number }[]
  attrs: HydFeatureAttrs
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

function be32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, false)
}

// ---- ZIP (STORE, no compression) ----
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function buildZip(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const dosTime = ((21 << 5) | 0) << 16
  const dosDate = ((((2026 - 1980) << 9) | (9 << 5) | 4) & 0xffff)
  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const crc = crc32(file.bytes)
    const size = file.bytes.length
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    be32(lv, 0, 0x04034b50)
    u16le(lv, 4, 20)
    u16le(lv, 6, 0)
    u16le(lv, 8, 0)
    u16le(lv, 10, dosTime)
    u16le(lv, 12, dosDate)
    u32le(lv, 14, crc)
    u32le(lv, 18, size)
    u32le(lv, 22, size)
    u16le(lv, 26, nameBytes.length)
    u16le(lv, 28, 0)
    local.set(nameBytes, 30)
    chunks.push(local, file.bytes)

    const cen = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cen.buffer)
    be32(cv, 0, 0x02014b50)
    u16le(cv, 4, 20)
    u16le(cv, 6, 20)
    u16le(cv, 8, 0)
    u16le(cv, 10, 0)
    u16le(cv, 12, dosTime)
    u16le(cv, 14, dosDate)
    u32le(cv, 16, crc)
    u32le(cv, 20, size)
    u32le(cv, 24, size)
    u16le(cv, 28, nameBytes.length)
    u32le(cv, 42, offset)
    cen.set(nameBytes, 46)
    central.push(cen)
    offset += local.length + size
  }
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  be32(ev, 0, 0x06054b50)
  u16le(ev, 8, files.length)
  u16le(ev, 10, files.length)
  u32le(ev, 12, centralSize)
  u32le(ev, 16, offset)
  const total = offset + centralSize + eocd.length
  const out = new Uint8Array(total)
  let cursor = 0
  for (const chunk of chunks) {
    out.set(chunk, cursor)
    cursor += chunk.length
  }
  for (const chunk of central) {
    out.set(chunk, cursor)
    cursor += chunk.length
  }
  out.set(eocd, cursor)
  return out
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/octet-stream'): void {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function downloadText(text: string, filename: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

// ---- GeoJSON ----
export function buildGeoJson(features: { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: 'LineString' | 'Polygon' | 'Point'; coordinates: number[][] } }[], name = 'hydro'): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    name,
    features
  })
}

// ---- DBF（属性表，字段按首次出现顺序，string=>C / number=>N）----
function dbfEncode(records: HydFeatureAttrs[]): Uint8Array {
  const keys: string[] = []
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!keys.includes(key)) keys.push(key)
    }
  }
  const fields = keys.map((key) => {
    const numeric = records.every((record) => typeof record[key] === 'number')
    const hasFloat = numeric && records.some((record) => !Number.isInteger(record[key] as number))
    return {
      name: key.slice(0, 10),
      numeric,
      len: numeric ? (hasFloat ? 20 : 12) : 254,
      decimals: hasFloat ? 6 : 0
    }
  })
  const recordSize = fields.reduce((sum, field) => sum + field.len, 0) + 1
  const headerSize = 32 + fields.length * 32 + 1
  const total = headerSize + recordSize * records.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  out[0] = 0x03
  out[1] = 26
  out[2] = 9
  out[3] = 4
  u32le(view, 4, records.length)
  u16le(view, 8, headerSize)
  u16le(view, 10, recordSize)
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i]
    const base = 32 + i * 32
    for (let c = 0; c < field.name.length; c += 1) out[base + c] = field.name.charCodeAt(c)
    out[base + 11] = field.numeric ? 0x4e : 0x43
    out[base + 16] = field.len
    out[base + 17] = field.decimals
  }
  out[headerSize - 1] = 0x0d
  let cursor = headerSize
  for (const record of records) {
    out[cursor] = 0x20
    cursor += 1
    for (const field of fields) {
      const value = record[field.name]
      let text: string
      if (typeof value === 'number') text = value.toFixed(field.decimals)
      else text = value === undefined ? '' : String(value)
      const padded = text.length >= field.len ? text.slice(0, field.len) : text.padEnd(field.len, ' ')
      for (let c = 0; c < field.len; c += 1) out[cursor + c] = padded.charCodeAt(c)
      cursor += field.len
    }
  }
  return out
}

function shapeContentOf(feature: HydFeature): { content: Uint8Array; points: number; bbox: [number, number, number, number] } {
  if (feature.kind === 'Point') {
    const point = feature.path[0]
    const bytes = new Uint8Array(20)
    const view = new DataView(bytes.buffer)
    u32le(view, 0, 1)
    f64le(view, 4, point.lon)
    f64le(view, 12, point.lat)
    return { content: bytes, points: 1, bbox: [point.lon, point.lat, point.lon, point.lat] }
  }
  const isPolygon = feature.kind === 'Polygon'
  const raw: { lon: number; lat: number }[] = feature.path
  const closed = isPolygon && raw.length > 0 && raw[0].lon === raw[raw.length - 1].lon && raw[0].lat === raw[raw.length - 1].lat
  const pts = isPolygon && !closed ? [...raw, raw[0]] : raw.slice()
  const n = pts.length
  const bytes = new Uint8Array(4 + 32 + 4 + 4 + 4 + 16 * n)
  const view = new DataView(bytes.buffer)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of pts) {
    minX = Math.min(minX, point.lon)
    minY = Math.min(minY, point.lat)
    maxX = Math.max(maxX, point.lon)
    maxY = Math.max(maxY, point.lat)
  }
  u32le(view, 0, isPolygon ? 5 : 3)
  f64le(view, 4, minX)
  f64le(view, 12, minY)
  f64le(view, 20, maxX)
  f64le(view, 28, maxY)
  u32le(view, 36, 1)
  u32le(view, 40, n)
  u32le(view, 44, 0)
  let cursor = 48
  for (const point of pts) {
    f64le(view, cursor, point.lon)
    f64le(view, cursor + 8, point.lat)
    cursor += 16
  }
  return { content: bytes, points: n, bbox: [minX, minY, maxX, maxY] }
}

function shapeTypeOf(kind: HydFeatureKind): number {
  if (kind === 'Point') return 1
  if (kind === 'Polygon') return 5
  return 3
}

export function buildShapefileBytes(kind: HydFeatureKind, features: HydFeature[]): Uint8Array {
  if (features.length === 0) return new Uint8Array(0)
  const contents = features.map((feature) => shapeContentOf(feature))
  const contentBytes = contents.reduce((sum, item) => sum + item.content.length, 0)
  const total = 100 + 8 * features.length + contentBytes
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const item of contents) {
    minX = Math.min(minX, item.bbox[0])
    minY = Math.min(minY, item.bbox[1])
    maxX = Math.max(maxX, item.bbox[2])
    maxY = Math.max(maxY, item.bbox[3])
  }
  be32(view, 0, 9994)
  be32(view, 24, total / 2)
  u32le(view, 28, 1000)
  u32le(view, 32, shapeTypeOf(kind))
  f64le(view, 36, minX)
  f64le(view, 44, minY)
  f64le(view, 52, maxX)
  f64le(view, 60, maxY)
  let cursor = 100
  features.forEach((feature, index) => {
    const item = contents[index]
    u32le(view, cursor, index + 1)
    u32le(view, cursor + 4, item.content.length / 2)
    cursor += 8
    out.set(item.content, cursor)
    cursor += item.content.length
  })
  return out
}

export function buildShpZip(name: string, features: HydFeature[]): Uint8Array {
  if (features.length === 0) return new Uint8Array(0)
  const kind = features[0].kind
  const shp = buildShapefileBytes(kind, features)
  const dbf = dbfEncode(features.map((feature) => feature.attrs))
  return buildZip([
    { name: `${name}.shp`, bytes: shp },
    { name: `${name}.dbf`, bytes: dbf }
  ])
}

// ---- GeoTIFF（Float32 单波段，地理坐标，EPSG:4326）----
export type GeoTiffRaster = {
  width: number
  height: number
  west: number
  north: number
  cellLon: number
  cellLat: number
  values: Float32Array
  description?: string
}

function doubleBytes(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 8)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => f64le(view, index * 8, value))
  return bytes
}

export function writeGeoTiffFloat32(raster: GeoTiffRaster): Uint8Array {
  const { width, height, values } = raster
  const count = width * height
  if (values.length < count) throw new Error('栅格数值数量不足')
  const stripBytes = count * 4
  const meta = raster.description ?? ''
  const metaBytes = encoder.encode(meta)
  const asciiBytes = new Uint8Array(metaBytes.length + 1)
  asciiBytes.set(metaBytes, 0)
  const keysBytes = new Uint8Array([1, 1, 0, 6, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326])
  const tags: { tag: number; type: number; count: number; offset?: number; inline?: Uint8Array }[] = [
    { tag: 256, type: 3, count: 1, inline: new Uint8Array([width & 0xff, width >> 8]) }, // SHORT
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
  out.set(doubleBytes(raster.cellLon, -raster.cellLat, 0), scaleOffset)
  out.set(doubleBytes(0, 0, 0, raster.west, raster.north, 0), tieOffset)
  out.set(keysBytes, keysOffset)
  out.set(asciiBytes, asciiOffset)
  const data = new Float32Array(values.buffer, values.byteOffset, count)
  out.set(new Uint8Array(data.buffer, data.byteOffset, count * 4), stripOffset)
  return out
}

export function bboxText(features: HydFeature[]): string {
  if (features.length === 0) return ''
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const feature of features) {
    for (const point of feature.path) {
      minX = Math.min(minX, point.lon)
      minY = Math.min(minY, point.lat)
      maxX = Math.max(maxX, point.lon)
      maxY = Math.max(maxY, point.lat)
    }
  }
  return `${minX.toFixed(5)},${minY.toFixed(5)},${maxX.toFixed(5)},${maxY.toFixed(5)}`
}
