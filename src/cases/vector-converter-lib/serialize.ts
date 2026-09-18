import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { forEachPosition, getCRS, transformModel } from './crs'
import { buildShapefile, type ShapeType } from '../draw-export-lib/shapefile'
import type { GeoJSONFeature } from '../draw-export-lib/geo'
import type {
  FeatureProps,
  FormatId,
  Position,
  SerializeOptions,
  SerializeResult,
  VectorFeature,
  VectorModel
} from './types'

function fmt(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return String(Number(value.toFixed(8)))
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function coordToText(pos: Position): string {
  const height = pos.length > 2 ? (pos[2] ?? 0) : 0
  return `${fmt(pos[0])},${fmt(pos[1])},${fmt(height)}`
}

function positionFrom(value: unknown): Position {
  const arr = value as number[]
  return arr.length >= 3 ? [arr[0], arr[1], arr[2]] : [arr[0], arr[1]]
}

function safeName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]/g, '_')
  return cleaned.length > 0 ? cleaned : 'vector-output'
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function featureName(feature: VectorFeature): string {
  const name = feature.properties.name
  return typeof name === 'string' && name.length > 0 ? name : ''
}

function serializeGeoJson(model: VectorModel): SerializeResult {
  const fc = {
    type: 'FeatureCollection',
    features: model.features.map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: { ...f.properties, ...(f.groupPath && f.groupPath.length > 0 ? { groupPath: f.groupPath.join('/') } : {}) }
    }))
  }
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' })
  return { blob, filename: '', warnings: [] }
}

function kmlCoordinateBlock(indent: string, coords: Position[]): string {
  const text = coords.map(coordToText).join(' ')
  return `${indent}<coordinates>${text}</coordinates>`
}

type SimpleGeometry = { type: 'Point' | 'LineString' | 'Polygon'; coordinates: unknown }

function expandSimple(feature: VectorFeature): SimpleGeometry[] {
  const g = feature.geometry
  switch (g.type) {
    case 'Point':
    case 'LineString':
    case 'Polygon':
      return [{ type: g.type, coordinates: g.coordinates }]
    case 'MultiPoint':
      return (g.coordinates as number[][]).map((p) => ({ type: 'Point' as const, coordinates: p }))
    case 'MultiLineString':
      return (g.coordinates as number[][][]).map((l) => ({ type: 'LineString' as const, coordinates: l }))
    case 'MultiPolygon':
      return (g.coordinates as number[][][][]).map((p) => ({ type: 'Polygon' as const, coordinates: p }))
    default:
      return []
  }
}

function kmlPlacemark(indent: string, feature: VectorFeature, geometry: SimpleGeometry): string {
  const name = featureName(feature)
  const lines: string[] = []
  lines.push(`${indent}<Placemark>`)
  if (name) lines.push(`${indent}  <name>${escapeXml(name)}</name>`)
  const description = feature.properties.description
  if (typeof description === 'string' && description) lines.push(`${indent}  <description>${escapeXml(description)}</description>`)
  const g = geometry
  if (g.type === 'Point') {
    lines.push(`${indent}  <Point>`)
    lines.push(kmlCoordinateBlock(`${indent}    `, [positionFrom(g.coordinates)]))
    lines.push(`${indent}  </Point>`)
  } else if (g.type === 'LineString') {
    lines.push(`${indent}  <LineString>`)
    lines.push(kmlCoordinateBlock(`${indent}    `, (g.coordinates as number[][]).map(positionFrom)))
    lines.push(`${indent}  </LineString>`)
  } else {
    const rings = g.coordinates as number[][][]
    lines.push(`${indent}  <Polygon>`)
    lines.push(`${indent}    <outerBoundaryIs><LinearRing>`)
    lines.push(kmlCoordinateBlock(`${indent}      `, (rings[0] ?? []).map(positionFrom)))
    lines.push(`${indent}    </LinearRing></outerBoundaryIs>`)
    for (const ring of rings.slice(1)) {
      lines.push(`${indent}    <innerBoundaryIs><LinearRing>`)
      lines.push(kmlCoordinateBlock(`${indent}      `, ring.map(positionFrom)))
      lines.push(`${indent}    </LinearRing></innerBoundaryIs>`)
    }
    lines.push(`${indent}  </Polygon>`)
  }
  lines.push(`${indent}</Placemark>`)
  return lines.join('\n')
}

function serializeKml(model: VectorModel, documentName: string): string {
  const parts: string[] = []
  parts.push('<?xml version="1.0" encoding="UTF-8"?>')
  parts.push('<kml xmlns="http://www.opengis.net/kml/2.2">')
  parts.push('  <Document>')
  parts.push(`    <name>${escapeXml(documentName)}</name>`)
  for (const feature of model.features) {
    for (const geometry of expandSimple(feature)) parts.push(kmlPlacemark('    ', feature, geometry))
  }
  parts.push('  </Document>')
  parts.push('</kml>')
  return parts.join('\n')
}

function serializeGpx(model: VectorModel): SerializeResult {
  const parts: string[] = []
  parts.push('<?xml version="1.0" encoding="UTF-8"?>')
  parts.push('<gpx version="1.1" creator="Cesium Toolbox" xmlns="http://www.topografix.com/GPX/1/1">')
  let ignored = 0
  for (const feature of model.features) {
    const g = feature.geometry
    const name = featureName(feature)
    if (g.type === 'Point' || g.type === 'MultiPoint') {
      const points = g.type === 'Point' ? [positionFrom(g.coordinates)] : (g.coordinates as number[][]).map(positionFrom)
      for (const p of points) {
        parts.push(`  <wpt lat="${fmt(p[1])}" lon="${fmt(p[0])}">`)
        if (p.length > 2) parts.push(`    <ele>${fmt(p[2] ?? 0)}</ele>`)
        if (name) parts.push(`    <name>${escapeXml(name)}</name>`)
        parts.push('  </wpt>')
      }
    } else if (g.type === 'LineString') {
      parts.push('  <trk>')
      if (name) parts.push(`    <name>${escapeXml(name)}</name>`)
      parts.push('    <trkseg>')
      for (const p of (g.coordinates as number[][]).map(positionFrom)) {
        parts.push(`      <trkpt lat="${fmt(p[1])}" lon="${fmt(p[0])}">${p.length > 2 ? `<ele>${fmt(p[2] ?? 0)}</ele>` : ''}</trkpt>`)
      }
      parts.push('    </trkseg>')
      parts.push('  </trk>')
    } else {
      ignored += 1
    }
  }
  parts.push('</gpx>')
  const warnings = ignored > 0 ? [`GPX 仅支持点与线，已忽略 ${ignored} 个面要素`] : []
  return { blob: new Blob([parts.join('\n')], { type: 'application/gpx+xml' }), filename: '', warnings }
}

function serializeWkt(model: VectorModel): SerializeResult {
  const statements: string[] = []
  for (const feature of model.features) {
    statements.push(geometryToWkt(feature.geometry.coordinates, feature.geometry.type))
  }
  if (statements.length === 0) throw new Error('没有可导出的几何')
  return { blob: new Blob([statements.join('\n')], { type: 'text/plain' }), filename: '', warnings: [] }
}

function tuple(pos: number[]): string {
  return pos.map((v) => fmt(Number(v))).join(' ')
}

function geometryToWkt(coords: unknown, type: string): string {
  if (type === 'Point') return `POINT(${tuple(coords as number[])})`
  if (type === 'MultiPoint') return `MULTIPOINT(${(coords as number[][]).map((p) => `(${tuple(p)})`).join(', ')})`
  if (type === 'LineString') return `LINESTRING(${(coords as number[][]).map(tuple).join(', ')})`
  if (type === 'MultiLineString') return `MULTILINESTRING(${(coords as number[][][]).map((l) => `(${l.map(tuple).join(', ')})`).join(', ')})`
  if (type === 'Polygon') return `POLYGON(${(coords as number[][][]).map((r) => `(${r.map(tuple).join(', ')})`).join(', ')})`
  if (type === 'MultiPolygon') {
    const polys = (coords as number[][][][]).map((p) => `(${p.map((r) => `(${r.map(tuple).join(', ')})`).join(', ')})`)
    return `MULTIPOLYGON(${polys.join(', ')})`
  }
  return ''
}

function ovGeometryProps(feature: VectorFeature, height = 0): Record<string, unknown> {
  const g = feature.geometry
  const name = featureName(feature)
  const base: Record<string, unknown> = { Name: name }
  if (g.type === 'Point') {
    const p = positionFrom(g.coordinates)
    base.ObjectDetail = { Lng: p[0], Lat: p[1], Alt: p.length > 2 ? (p[2] ?? height) : height }
  } else {
    const points: Array<{ Lng: number; Lat: number; Alt: number }> = []
    forEachPosition(g.coordinates, (p) => {
      points.push({ Lng: p[0], Lat: p[1], Alt: p.length > 2 ? (p[2] as number) : height })
    })
    base.ObjectDetail = { Points: points }
  }
  return base
}

function ovTypeOf(feature: VectorFeature): number {
  const t = feature.geometry.type
  if (t === 'Point' || t === 'MultiPoint') return 7
  if (t === 'LineString' || t === 'MultiLineString') return 8
  return 9
}

function serializeOvJson(model: VectorModel): SerializeResult {
  const grouped = new Map<string, VectorFeature[]>()
  for (const feature of model.features) {
    const key = feature.groupPath && feature.groupPath.length > 0 ? feature.groupPath[0] : ''
    const list = grouped.get(key) ?? []
    list.push(feature)
    grouped.set(key, list)
  }
  const toItem = (feature: VectorFeature): Record<string, unknown> => ({
    Type: ovTypeOf(feature),
    Object: ovGeometryProps(feature)
  })
  const objItems: unknown[] = []
  for (const [key, list] of grouped) {
    const children = list.map(toItem)
    if (!key) {
      objItems.push(...children)
      continue
    }
    objItems.push({ Type: 30, Object: { Name: key, ObjectDetail: { ObjChildren: children } } })
  }
  const data = { Version: 'V10.1.6', Type: 1, ObjItems: objItems }
  return { blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename: '', warnings: [] }
}

type PointRow = { name: string; lon: number; lat: number; height: number; props: FeatureProps }

function collectPointRows(model: VectorModel): { rows: PointRow[]; ignored: number } {
  const rows: PointRow[] = []
  let ignored = 0
  for (const feature of model.features) {
    const g = feature.geometry
    if (g.type === 'Point' || g.type === 'MultiPoint') {
      const points = g.type === 'Point' ? [positionFrom(g.coordinates)] : (g.coordinates as number[][]).map(positionFrom)
      for (const p of points) {
        rows.push({ name: featureName(feature), lon: p[0], lat: p[1], height: p.length > 2 ? (p[2] ?? 0) : 0, props: feature.properties })
      }
    } else {
      ignored += 1
    }
  }
  return { rows, ignored }
}

function buildPointTable(model: VectorModel): { header: string[]; matrix: (string | number)[][]; warnings: string[] } {
  const { rows, ignored } = collectPointRows(model)
  if (rows.length === 0) throw new Error('当前数据不包含点位要素，无法导出为表格')
  const extraKeys: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row.props)) {
      if (['name', 'description'].includes(key)) continue
      if (!extraKeys.includes(key)) extraKeys.push(key)
    }
  }
  const header = ['名称', '经度', '纬度', '高程', ...extraKeys]
  const matrix = rows.map((row) => [
    row.name,
    Number(row.lon.toFixed(8)),
    Number(row.lat.toFixed(8)),
    Number(row.height.toFixed(3)),
    ...extraKeys.map((key) => {
      const value = row.props[key]
      return typeof value === 'number' ? value : String(value ?? '')
    })
  ])
  const warnings = ignored > 0 ? [`表格导出仅包含点位要素，已忽略 ${ignored} 个非点要素`] : []
  return { header, matrix, warnings }
}

function serializeXlsx(model: VectorModel, baseName: string): SerializeResult {
  const { header, matrix, warnings } = buildPointTable(model)
  const sheet = XLSX.utils.aoa_to_sheet([header, ...matrix])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, '点位数据')
  const array = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return { blob: new Blob([array], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename: `${baseName}.xlsx`, warnings }
}

function serializeCsv(model: VectorModel, baseName: string): SerializeResult {
  const { header, matrix, warnings } = buildPointTable(model)
  const sheet = XLSX.utils.aoa_to_sheet([header, ...matrix])
  const csv = XLSX.utils.sheet_to_csv(sheet)
  return { blob: new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), filename: `${baseName}.csv`, warnings }
}

function to2d(feature: VectorFeature): GeoJSONFeature[] {
  const props: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(feature.properties)) {
    if (typeof value === 'number' || typeof value === 'string') props[key] = value
  }
  const g = feature.geometry
  const as2 = (p: unknown): [number, number] => {
    const arr = p as number[]
    return [arr[0], arr[1]]
  }
  const out: GeoJSONFeature[] = []
  if (g.type === 'Point') {
    out.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: as2(g.coordinates) } })
  } else if (g.type === 'MultiPoint') {
    for (const p of g.coordinates as number[][]) out.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: as2(p) } })
  } else if (g.type === 'LineString') {
    out.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: (g.coordinates as number[][]).map(as2) } })
  } else if (g.type === 'MultiLineString') {
    for (const l of g.coordinates as number[][][]) out.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: l.map(as2) } })
  } else if (g.type === 'Polygon') {
    out.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: (g.coordinates as number[][][]).map((r) => r.map(as2)) } })
  } else if (g.type === 'MultiPolygon') {
    for (const p of g.coordinates as number[][][][]) out.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: p.map((r) => r.map(as2)) } })
  }
  return out
}

async function serializeShp(model: VectorModel, baseName: string, targetCrs: SerializeOptions['targetCrs']): Promise<SerializeResult> {
  const prjWkt = getCRS(targetCrs).prjWkt
  const groups: Array<{ type: ShapeType; features: GeoJSONFeature[]; name: string }> = [
    { type: 'POINT', features: [], name: 'point' },
    { type: 'POLYLINE', features: [], name: 'line' },
    { type: 'POLYGON', features: [], name: 'polygon' }
  ]
  for (const feature of model.features) {
    for (const flat of to2d(feature)) {
      if (flat.geometry.type === 'Point') groups[0].features.push(flat)
      else if (flat.geometry.type === 'LineString') groups[1].features.push(flat)
      else groups[2].features.push(flat)
    }
  }
  const zip = new JSZip()
  const folder = zip.folder('shp')!
  let exported = 0
  for (const group of groups) {
    if (group.features.length === 0) continue
    exported += group.features.length
    const extraFields = group.type === 'POINT' ? ['name'] : []
    const files = buildShapefile(group.features, group.type, prjWkt, extraFields)
    folder.file(`${baseName}-${group.name}.shp`, files.shp)
    folder.file(`${baseName}-${group.name}.shx`, files.shx)
    folder.file(`${baseName}-${group.name}.dbf`, files.dbf)
    folder.file(`${baseName}-${group.name}.prj`, files.prj)
  }
  if (exported === 0) throw new Error('没有可导出的几何')
  folder.file('说明.txt', `坐标系: ${getCRS(targetCrs).label}\nSHP 包含 .shp/.shx/.dbf/.prj 伴生文件。`)
  const blob = await zip.generateAsync({ type: 'blob' })
  return { blob, filename: `${baseName}_shp.zip`, warnings: [] }
}

export async function serializeModel(
  model: VectorModel,
  format: FormatId,
  options: SerializeOptions
): Promise<SerializeResult> {
  const baseName = safeName(options.baseName)
  const converted = transformModel(model, 'wgs84', options.targetCrs)
  let result: SerializeResult
  switch (format) {
    case 'geojson':
      result = serializeGeoJson(converted)
      result.filename = `${baseName}.geojson`
      break
    case 'kml':
      result = { blob: new Blob([serializeKml(converted, baseName)], { type: 'application/vnd.google-earth.kml+xml' }), filename: `${baseName}.kml`, warnings: [] }
      break
    case 'ovkml':
      result = { blob: new Blob([serializeKml(converted, baseName)], { type: 'application/vnd.google-earth.kml+xml' }), filename: `${baseName}.ovkml`, warnings: [] }
      break
    case 'kmz':
    case 'ovkmz': {
      const zip = new JSZip()
      zip.file('doc.kml', serializeKml(converted, baseName))
      const blob = await zip.generateAsync({ type: 'blob' })
      result = { blob, filename: `${baseName}.${format === 'kmz' ? 'kmz' : 'ovkmz'}`, warnings: [] }
      break
    }
    case 'gpx':
      result = serializeGpx(converted)
      result.filename = `${baseName}.gpx`
      break
    case 'wkt':
      result = serializeWkt(converted)
      result.filename = `${baseName}.wkt`
      break
    case 'ovjsn':
    case 'ovobj':
      result = serializeOvJson(converted)
      result.filename = `${baseName}.ovjsn`
      break
    case 'csv':
      result = serializeCsv(converted, baseName)
      break
    case 'shp':
      result = await serializeShp(converted, baseName, options.targetCrs)
      break
    default:
      throw new Error(`暂不支持导出格式：${format}`)
  }
  return result
}

export async function serializePointTable(model: VectorModel, baseName: string): Promise<SerializeResult> {
  return serializeXlsx(transformModel(model, 'wgs84', 'wgs84'), safeName(baseName))
}
