import * as THREE from 'three'
import { geoMercator } from 'd3-geo'

export type LonLat = [number, number]

export interface GeoPolygon {
  name: string
  center: LonLat
  centroid: LonLat
  rings: LonLat[][]
}

export interface GeoData {
  polygons: GeoPolygon[]
}

interface GeoFeature {
  properties: { name: string; center: LonLat; centroid?: LonLat }
  geometry: { type: string; coordinates: unknown }
}

/**
 * 对齐参考工程：geoMercator().center(centroid).translate([0,0])，可选 scale。
 * d3 墨卡托 y 朝南，调用处再 Vector2(x, -y) 翻回北朝上。
 */
export function makeProjector(center: LonLat, scale?: number) {
  let projection = geoMercator().center(center).translate([0, 0])
  if (scale !== undefined) projection = projection.scale(scale)
  return (lonLat: LonLat): [number, number] => {
    const p = projection(lonLat)
    return p ?? [0, 0]
  }
}

export function projectV2(project: (ll: LonLat) => [number, number], lonLat: LonLat): THREE.Vector2 {
  const [x, y] = project(lonLat)
  return new THREE.Vector2(x, -y)
}

export function parseGeo(json: unknown): GeoData {
  const fc = json as { features: GeoFeature[] }
  const polygons: GeoPolygon[] = []
  for (const f of fc.features) {
    const raw = f.geometry.coordinates
    const rings = (
      f.geometry.type === 'Polygon' ? (raw as LonLat[][]) : (raw as LonLat[][][]).flat(1)
    ) as LonLat[][]
    if (!rings.length) continue
    polygons.push({
      name: f.properties.name,
      center: f.properties.center,
      centroid: f.properties.centroid ?? f.properties.center,
      rings,
    })
  }
  return { polygons }
}

/** MultiPolygon 的 coordinates[0] 主环（对齐 outline / geoTrail）。 */
export function firstPolygonRings(json: unknown): LonLat[][] {
  const fc = json as { features: GeoFeature[] }
  const rings: LonLat[][] = []
  for (const f of fc.features) {
    const raw = f.geometry.coordinates
    const firstPoly = f.geometry.type === 'Polygon' ? (raw as LonLat[][]) : (raw as LonLat[][][])[0]
    if (firstPoly?.length) rings.push(...firstPoly)
  }
  return rings
}

export function loadTexture(url: string, prepare?: (t: THREE.Texture) => void): Promise<THREE.Texture> {
  const loader = new THREE.TextureLoader()
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (t) => {
        prepare?.(t)
        resolve(t)
      },
      undefined,
      (err) => reject(err)
    )
  })
}

export function applyBboxUv(geometry: THREE.BufferGeometry, bbox: THREE.Box2): void {
  const pos = geometry.attributes.position
  const bw = bbox.max.x - bbox.min.x || 1
  const bh = bbox.max.y - bbox.min.y || 1
  const uv: number[] = []
  for (let i = 0; i < pos.count; i++) {
    uv.push((pos.getX(i) - bbox.min.x) / bw, (pos.getY(i) - bbox.min.y) / bh)
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
}
