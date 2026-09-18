import type { CRSId } from '../draw-export-lib/geo'
import { exportGeojson, exportShp } from '../draw-export-lib/exporter'
import type { GeoJSONFeature, GeoJSONFeatureCollection } from '../draw-export-lib/geo'
import {
  buildFeature,
  fileTimestamp,
  type ExportObject
} from '../military-plotting-lib/plot-edit/exporter'
import type { AnnotationObject, AnnotationKind } from './annotation-types'

export const POINT_DBF_FIELDS = ['kind', 'content', 'source', 'size', 'scale', 'heading', 'height']

type StringNumber = string | number

function annotationProperties(annotation: AnnotationObject): Record<string, StringNumber> {
  const position = annotation.position
  const fields = annotation.fields as Record<string, unknown>
  const kind: AnnotationKind = annotation.kind
  const properties: Record<string, StringNumber> = {
    id: annotation.key,
    type: 'Point',
    name: annotation.name,
    annotationKind: kind,
    crs: 'EPSG:4326',
    lng: Number(position.lng.toFixed(8)),
    lat: Number(position.lat.toFixed(8)),
    alt: Number(position.alt.toFixed(2))
  }
  if (kind === 'text') {
    properties.content = String(fields.content ?? '')
    properties.size = Number(fields.fontSize ?? 18)
    properties.color = String(fields.color ?? '#ffffff')
    properties.background = String(fields.backgroundColor ?? '')
    properties.offsetX = Number(fields.pixelOffsetX ?? 0)
    properties.offsetY = Number(fields.pixelOffsetY ?? 0)
  } else if (kind === 'image') {
    properties.content = ''
    properties.source = String(fields.source ?? '')
    properties.scale = Number(fields.scale ?? 1)
    properties.rotation = Number(fields.rotation ?? 0)
    properties.opacity = Number(fields.opacity ?? 1)
  } else {
    properties.content = ''
    properties.source = String(fields.uri ?? '')
    properties.scale = Number(fields.scale ?? 1)
    properties.heading = Number(fields.heading ?? 0)
    properties.height = Number(fields.height ?? 0)
  }
  return properties
}

function dbfProperties(annotation: AnnotationObject): Record<string, StringNumber> {
  const base = annotationProperties(annotation)
  const out: Record<string, StringNumber> = {}
  for (const key of POINT_DBF_FIELDS) {
    const value = base[key]
    out[key] = value === undefined ? '' : value
  }
  return out
}

function annotationFeature(annotation: AnnotationObject): GeoJSONFeature {
  return {
    type: 'Feature',
    properties: dbfProperties(annotation),
    geometry: {
      type: 'Point',
      coordinates: [annotation.position.lng, annotation.position.lat]
    }
  }
}

export function buildSituationCollection(
  geometryObjects: ExportObject[],
  annotations: AnnotationObject[]
): GeoJSONFeatureCollection {
  const features: GeoJSONFeature[] = []
  for (const object of geometryObjects) {
    features.push(buildFeature(object) as unknown as GeoJSONFeature)
  }
  for (const annotation of annotations) {
    features.push(annotationFeature(annotation))
  }
  return { type: 'FeatureCollection', features }
}

export type SituationExportResult = {
  ok: boolean
  message: string
  filename?: string
  geometryCount?: number
  annotationCount?: number
}

function defaultBaseName(): string {
  return `综合态势标绘-${fileTimestamp()}`
}

export async function exportSituationGeojson(
  geometryObjects: ExportObject[],
  annotations: AnnotationObject[],
  crsId: CRSId
): Promise<SituationExportResult> {
  const geometryCount = geometryObjects.length
  const annotationCount = annotations.length
  if (geometryCount + annotationCount === 0) {
    return { ok: false, message: '当前场景没有可导出的几何与标注对象' }
  }
  const collection = buildSituationCollection(geometryObjects, annotations)
  const summary = await exportGeojson(collection, crsId, { baseName: defaultBaseName() })
  const detail =
    `几何 ${geometryCount} 个` +
    (annotationCount > 0 ? `、标注 ${annotationCount} 个` : '') +
    `，已导出 GeoJSON（${summary.filename}）`
  return { ok: true, message: detail, filename: summary.filename, geometryCount, annotationCount }
}

export async function exportSituationShp(
  geometryObjects: ExportObject[],
  annotations: AnnotationObject[],
  crsId: CRSId
): Promise<SituationExportResult> {
  const geometryCount = geometryObjects.length
  const annotationCount = annotations.length
  if (geometryCount + annotationCount === 0) {
    return { ok: false, message: '当前场景没有可导出的几何与标注对象' }
  }
  const collection = buildSituationCollection(geometryObjects, annotations)
  const summary = await exportShp(collection, crsId, {
    baseName: defaultBaseName(),
    pointExtraFields: annotationCount > 0 ? POINT_DBF_FIELDS : undefined
  })
  const detail =
    `几何 ${geometryCount} 个` +
    (annotationCount > 0 ? `、标注 ${annotationCount} 个（SHP 已写入标注属性字段）` : '') +
    `，已导出 SHP（${summary.filename}）`
  return { ok: true, message: detail, filename: summary.filename, geometryCount, annotationCount }
}

export function situationCounts(
  geometryObjects: ExportObject[],
  annotations: AnnotationObject[]
): { geometry: number; annotation: number; total: number } {
  const geometry = geometryObjects.length
  const annotation = annotations.length
  return { geometry, annotation, total: geometry + annotation }
}
