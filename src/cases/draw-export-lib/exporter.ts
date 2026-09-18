import JSZip from 'jszip'
import {
  featuresByType,
  getCRS,
  getPresentTypes,
  makeConverter,
  transformCoordinates,
  type CRSId,
  type GeoJSONFeature,
  type GeoJSONFeatureCollection
} from './geo'
import { buildShapefile, type ShapeType } from './shapefile'

export type ExportFormat = 'geojson' | 'shp'

export type ExportOptions = {
  baseName?: string
  pointExtraFields?: string[]
}

function resolveBaseName(baseName?: string): string | null {
  const cleaned = String(baseName || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
  return cleaned.length > 0 ? cleaned : null
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

function applyCrs(fc: GeoJSONFeatureCollection, crsId: CRSId): GeoJSONFeatureCollection {
  const crs = getCRS(crsId)
  const convert = makeConverter(crs)
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f): GeoJSONFeature => {
      const coords = transformCoordinates(f.geometry.coordinates, convert)
      if (f.geometry.type === 'Point') {
        return { ...f, geometry: { type: 'Point', coordinates: coords as [number, number] } }
      }
      if (f.geometry.type === 'LineString') {
        return { ...f, geometry: { type: 'LineString', coordinates: coords as [number, number][] } }
      }
      return { ...f, geometry: { type: 'Polygon', coordinates: coords as [number, number][][] } }
    })
  }
}

function typeToShapeType(geoType: GeoJSONFeature['geometry']['type']): ShapeType {
  if (geoType === 'Point') return 'POINT'
  if (geoType === 'LineString') return 'POLYLINE'
  return 'POLYGON'
}

export type ExportSummary = {
  filename: string
  typeCount: number
  featureCount: number
}

export async function exportGeojson(
  fc: GeoJSONFeatureCollection,
  crsId: CRSId,
  options?: ExportOptions
): Promise<ExportSummary> {
  const converted = applyCrs(fc, crsId)
  const types = getPresentTypes(converted)
  const crsLabel = getCRS(crsId).label
  const customName = resolveBaseName(options?.baseName)
  const baseName = customName ?? 'drawing'

  if (types.length <= 1) {
    const json = JSON.stringify(converted, null, 2)
    downloadBlob(new Blob([json], { type: 'application/geo+json' }), `${baseName}.geojson`)
    return { filename: `${baseName}.geojson`, typeCount: types.length, featureCount: converted.features.length }
  }

  const zip = new JSZip()
  const byType = featuresByType(converted)
  const fileNames: Record<string, string> = {
    point: customName ? `${customName}-points.geojson` : 'points.geojson',
    line: customName ? `${customName}-lines.geojson` : 'lines.geojson',
    polygon: customName ? `${customName}-polygons.geojson` : 'polygons.geojson'
  }
  ;(Object.keys(fileNames) as Array<'point' | 'line' | 'polygon'>).forEach((key) => {
    const features = byType[key]
    if (features.length > 0) {
      zip.file(fileNames[key], JSON.stringify({ type: 'FeatureCollection', features }, null, 2))
    }
  })
  zip.file('crs.txt', `坐标系: ${crsLabel}\n点线面共存时按类型拆分导出。`)
  const blob = await zip.generateAsync({ type: 'blob' })
  const zipName = `${baseName}_geojson.zip`
  downloadBlob(blob, zipName)
  return { filename: zipName, typeCount: types.length, featureCount: converted.features.length }
}

export async function exportShp(
  fc: GeoJSONFeatureCollection,
  crsId: CRSId,
  options?: ExportOptions
): Promise<ExportSummary> {
  const converted = applyCrs(fc, crsId)
  const byType = featuresByType(converted)
  const types = getPresentTypes(converted)
  const crs = getCRS(crsId)
  const prjWkt = crs.prjWkt
  const customName = resolveBaseName(options?.baseName)
  const baseName = customName ?? 'drawing'

  const zip = new JSZip()
  const folder = zip.folder('shp')!

  const groups: Array<{ key: ShapeType; features: GeoJSONFeature[]; name: string }> = [
    { key: 'POINT', features: byType.point, name: 'point' },
    { key: 'POLYLINE', features: byType.line, name: 'line' },
    { key: 'POLYGON', features: byType.polygon, name: 'polygon' }
  ]

  for (const group of groups) {
    if (group.features.length === 0) continue
    const extraFields = group.key === 'POINT' ? options?.pointExtraFields : undefined
    const files = buildShapefile(group.features, group.key, prjWkt, extraFields)
    const stem = customName ? `${customName}-${group.name}` : group.name
    folder.file(`${stem}.shp`, files.shp)
    folder.file(`${stem}.shx`, files.shx)
    folder.file(`${stem}.dbf`, files.dbf)
    folder.file(`${stem}.prj`, files.prj)
  }

  folder.file('说明.txt', `坐标系: ${crs.label}\nSHP 包含 .shp/.shx/.dbf/.prj 伴生文件。`)
  const blob = await zip.generateAsync({ type: 'blob' })
  const zipName = `${baseName}_shp.zip`
  downloadBlob(blob, zipName)
  return { filename: zipName, typeCount: types.length, featureCount: converted.features.length }
}
