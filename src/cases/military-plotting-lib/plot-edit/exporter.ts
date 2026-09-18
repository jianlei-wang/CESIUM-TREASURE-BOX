import type { PlottingKind } from '../index'
import type { GPoint } from './types'
import { kindName } from './types'

export type ExportObject = {
  id: string
  kind: PlottingKind
  name: string
  geoType: string
  shape: 'polygon' | 'polyline'
  points: GPoint[]
}

export type GeoJSONFeature = {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: {
    type: 'Polygon' | 'LineString'
    coordinates: number[][][] | number[][]
  }
}

export type GeoJSONFeatureCollection = {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

function closeRing(points: GPoint[]): number[][] {
  const coords = points.map((p) => [p.lng, p.lat])
  if (coords.length === 0) return coords
  const first = coords[0]
  const last = coords[coords.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first)
  return coords
}

export function buildFeature(obj: ExportObject): GeoJSONFeature {
  const geometry: GeoJSONFeature['geometry'] =
    obj.shape === 'polygon'
      ? { type: 'Polygon', coordinates: [closeRing(obj.points)] }
      : { type: 'LineString', coordinates: obj.points.map((p) => [p.lng, p.lat]) }
  return {
    type: 'Feature',
    properties: {
      id: obj.id,
      kind: obj.kind,
      name: obj.name,
      title: kindName(obj.kind),
      geoType: obj.geoType,
      shape: obj.shape,
      vertexCount: obj.points.length,
      crs: 'EPSG:4326'
    },
    geometry
  }
}

export function buildCollection(objects: ExportObject[]): GeoJSONFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: objects.map(buildFeature)
  }
}

export function downloadGeoJSON(
  filename: string,
  collection: GeoJSONFeatureCollection | GeoJSONFeature
): void {
  const json = JSON.stringify(collection, null, 2)
  const blob = new Blob([json], { type: 'application/geo+json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.geojson') ? filename : `${filename}.geojson`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function fileTimestamp(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}
