import type { GeoJSONFeature } from './geo'

export type ShapeType = 'POINT' | 'POLYLINE' | 'POLYGON'

const SHAPE_TYPE_CODE: Record<ShapeType, number> = {
  POINT: 1,
  POLYLINE: 3,
  POLYGON: 5
}

export type ShapefileFiles = {
  shp: Blob
  shx: Blob
  dbf: Blob
  prj: Blob
}

const DBF_FIELD_NAMES = ['id', 'type', 'name']
const DBF_FIELD_TYPES = ['N', 'C', 'C']
const DBF_FIELD_LENGTHS = [10, 12, 32]

const DBF_EXTRA_LENGTH = 64

type DbfFieldDef = {
  name: string
  type: 'N' | 'C'
  length: number
  sourceKey?: string
}

function sanitizeFieldName(name: string): string {
  const cleaned = String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
  return cleaned.slice(0, 10) || 'FIELD'
}

function resolveDbfFields(extraFields: string[]): DbfFieldDef[] {
  const base: DbfFieldDef[] = DBF_FIELD_NAMES.map((name, index) => ({
    name,
    type: DBF_FIELD_TYPES[index] as 'N' | 'C',
    length: DBF_FIELD_LENGTHS[index]
  }))
  if (!extraFields || extraFields.length === 0) return base
  const seen = new Set(base.map((f) => f.name))
  const extras: DbfFieldDef[] = []
  for (const name of extraFields) {
    const safe = sanitizeFieldName(name)
    if (seen.has(safe)) continue
    seen.add(safe)
    extras.push({ name: safe, type: 'C' as const, length: DBF_EXTRA_LENGTH, sourceKey: name })
  }
  return [...base, ...extras]
}

type PartPoints = number[][]

function getPartPoints(feature: GeoJSONFeature): PartPoints[] {
  if (feature.geometry.type === 'Polygon') {
    return feature.geometry.coordinates.map((ring) => ring.map((c) => [c[0], c[1]]))
  }
  if (feature.geometry.type === 'LineString') {
    return [feature.geometry.coordinates.map((c) => [c[0], c[1]])]
  }
  return [[[feature.geometry.coordinates[0], feature.geometry.coordinates[1]]]]
}

function flattenParts(parts: PartPoints[]): number[][] {
  const out: number[][] = []
  for (const part of parts) out.push(...part)
  return out
}

function computeRecordLength(feature: GeoJSONFeature, shapeType: ShapeType): number {
  if (shapeType === 'POINT') return 20
  const parts = getPartPoints(feature)
  const numPoints = flattenParts(parts).length
  return 44 + parts.length * 4 + numPoints * 16
}

function computeExtent(features: GeoJSONFeature[]): number[] {
  let xmin = Number.POSITIVE_INFINITY
  let ymin = Number.POSITIVE_INFINITY
  let xmax = Number.NEGATIVE_INFINITY
  let ymax = Number.NEGATIVE_INFINITY
  for (const f of features) {
    const coords = flattenParts(getPartPoints(f))
    for (const c of coords) {
      xmin = Math.min(xmin, c[0])
      ymin = Math.min(ymin, c[1])
      xmax = Math.max(xmax, c[0])
      ymax = Math.max(ymax, c[1])
    }
  }
  if (!isFinite(xmin)) return [0, 0, 0, 0]
  return [xmin, ymin, xmax, ymax]
}

function writeHeader(
  view: DataView,
  shapeType: number,
  fileLengthWords: number,
  extent: number[]
): void {
  view.setInt32(0, 9994, false)
  view.setInt32(24, fileLengthWords, false)
  view.setInt32(28, 1000, true)
  view.setInt32(32, shapeType, true)
  for (let i = 0; i < 4; i++) {
    view.setFloat64(36 + i * 8, extent[i], true)
  }
}

function buildShp(features: GeoJSONFeature[], shapeType: ShapeType): Blob {
  const shapeCode = SHAPE_TYPE_CODE[shapeType]
  const recordLengths = features.map((f) => computeRecordLength(f, shapeType))
  const contentBytes = recordLengths.reduce((a, b) => a + b, 0)
  const totalBytes = 100 + features.length * 8 + contentBytes
  const buffer = new ArrayBuffer(totalBytes)
  const view = new DataView(buffer)

  const extent = computeExtent(features)
  writeHeader(view, shapeCode, totalBytes / 2, extent)

  let offset = 100
  features.forEach((feature, idx) => {
    view.setInt32(offset, idx + 1, false)
    view.setInt32(offset + 4, recordLengths[idx] / 2, false)
    offset += 8
    view.setInt32(offset, shapeCode, true)
    offset += 4

    if (shapeType === 'POINT') {
      const [x, y] = getPartPoints(feature)[0][0]
      view.setFloat64(offset, x, true)
      view.setFloat64(offset + 8, y, true)
      offset += 16
      return
    }

    const parts = getPartPoints(feature)
    const points = flattenParts(parts)
    let xmin = Number.POSITIVE_INFINITY
    let ymin = Number.POSITIVE_INFINITY
    let xmax = Number.NEGATIVE_INFINITY
    let ymax = Number.NEGATIVE_INFINITY
    for (const [x, y] of points) {
      xmin = Math.min(xmin, x)
      ymin = Math.min(ymin, y)
      xmax = Math.max(xmax, x)
      ymax = Math.max(ymax, y)
    }
    view.setFloat64(offset, xmin, true)
    view.setFloat64(offset + 8, ymin, true)
    view.setFloat64(offset + 16, xmax, true)
    view.setFloat64(offset + 24, ymax, true)
    offset += 32
    view.setInt32(offset, parts.length, true)
    offset += 4
    view.setInt32(offset, points.length, true)
    offset += 4
    let pointStart = 0
    for (const part of parts) {
      view.setInt32(offset, pointStart, true)
      offset += 4
      pointStart += part.length
    }
    for (const [x, y] of points) {
      view.setFloat64(offset, x, true)
      view.setFloat64(offset + 8, y, true)
      offset += 16
    }
  })

  return new Blob([buffer], { type: 'application/octet-stream' })
}

function buildShx(features: GeoJSONFeature[], shapeType: ShapeType): Blob {
  const shapeCode = SHAPE_TYPE_CODE[shapeType]
  const recordLengths = features.map((f) => computeRecordLength(f, shapeType))
  const totalBytes = 100 + features.length * 8
  const buffer = new ArrayBuffer(totalBytes)
  const view = new DataView(buffer)
  const extent = computeExtent(features)
  writeHeader(view, shapeCode, totalBytes / 2, extent)

  let offset = 100
  let contentOffset = 100 + features.length * 8
  features.forEach((_feature, idx) => {
    view.setInt32(offset, contentOffset / 2, false)
    view.setInt32(offset + 4, recordLengths[idx] / 2, false)
    offset += 8
    contentOffset += 8 + recordLengths[idx]
  })

  return new Blob([buffer], { type: 'application/octet-stream' })
}

function fieldValueOf(feature: GeoJSONFeature, recIdx: number, field: DbfFieldDef): string {
  if (field.name === 'id') return String(recIdx + 1)
  if (field.name === 'type') return feature.geometry.type
  if (field.name === 'name') {
    const name = feature.properties.name
    return name === undefined || name === null ? '' : String(name)
  }
  const value = feature.properties[field.sourceKey ?? field.name]
  if (value === undefined || value === null) return ''
  return String(value)
}

function buildDbf(features: GeoJSONFeature[], fields: DbfFieldDef[]): Blob {
  const numFields = fields.length
  const headerLength = 32 + numFields * 32 + 1
  const recordLength = fields.reduce((a, b) => a + b.length, 0) + 1
  const buffer = new ArrayBuffer(headerLength + recordLength * features.length)
  const view = new DataView(buffer)
  const u8 = new Uint8Array(buffer)
  const textEncoder = new TextEncoder()

  view.setUint8(0, 0x03)
  const now = new Date()
  view.setUint8(1, now.getFullYear() - 1900)
  view.setUint8(2, now.getMonth() + 1)
  view.setUint8(3, now.getDate())
  view.setInt32(4, features.length, true)
  view.setInt16(8, headerLength, true)
  view.setInt16(10, recordLength, true)

  for (let f = 0; f < numFields; f++) {
    const fieldOffset = 32 + f * 32
    const nameBytes = textEncoder.encode(fields[f].name)
    for (let i = 0; i < Math.min(nameBytes.length, 11); i++) {
      view.setUint8(fieldOffset + i, nameBytes[i])
    }
    view.setUint8(fieldOffset + 11, textEncoder.encode(fields[f].type)[0])
    view.setUint8(fieldOffset + 16, fields[f].length)
    view.setUint8(fieldOffset + 17, 0)
  }
  view.setUint8(32 + numFields * 32, 0x0d)

  features.forEach((feature, recIdx) => {
    const base = headerLength + recIdx * recordLength
    let cursor = base
    for (let f = 0; f < numFields; f++) {
      const field = fields[f]
      const raw = fieldValueOf(feature, recIdx, field)
      const isNumeric = field.type === 'N'
      const value = isNumeric ? raw.padStart(field.length, ' ') : raw.slice(0, field.length).padEnd(field.length, ' ')
      for (let i = 0; i < field.length; i++) {
        u8[cursor + i] = value.charCodeAt(i)
      }
      cursor += field.length
    }
    u8[cursor] = 0x0a
  })

  return new Blob([buffer], { type: 'application/octet-stream' })
}

export function buildShapefile(
  features: GeoJSONFeature[],
  shapeType: ShapeType,
  prjWkt: string,
  extraFields: string[] = []
): ShapefileFiles {
  const fields = resolveDbfFields(extraFields)
  return {
    shp: buildShp(features, shapeType),
    shx: buildShx(features, shapeType),
    dbf: buildDbf(features, fields),
    prj: new Blob([prjWkt], { type: 'application/octet-stream' })
  }
}
