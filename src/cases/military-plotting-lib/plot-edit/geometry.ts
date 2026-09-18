import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  PolygonHierarchy,
  type Viewer
} from 'cesium'
import type { GPoint } from './types'

export type EntityLike = {
  id?: string
  name?: string
  GeoType?: string
  polygon?: {
    hierarchy?: { getValue(time?: unknown): unknown } | PolygonHierarchy | Cartesian3[]
  }
  polyline?: {
    positions?: { getValue(time?: unknown): unknown } | Cartesian3[]
  }
}

const TWO_PI = Math.PI * 2

function cartesianToDeg(c: Cartesian3): GPoint {
  const carto = Cartographic.fromCartesian(c)
  return {
    lng: CesiumMath.toDegrees(carto.longitude),
    lat: CesiumMath.toDegrees(carto.latitude),
    alt: carto.height
  }
}

export function cartesianToDegArray(list: Cartesian3[]): GPoint[] {
  return list.map(cartesianToDeg)
}

function unwrap(time: unknown, value: unknown, depth = 0): unknown {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { getValue?: unknown }).getValue === 'function' &&
    depth < 8
  ) {
    return unwrap(time, (value as { getValue(t: unknown): unknown }).getValue(time), depth + 1)
  }
  return value
}

export function readEntityPositions(viewer: Viewer, entity: EntityLike): GPoint[] {
  const time = viewer.clock.currentTime
  const polygon = entity.polygon
  if (polygon && polygon.hierarchy) {
    const resolved = unwrap(time, polygon.hierarchy)
    const container = resolved as { positions?: unknown } | null
    const positions =
      Array.isArray(resolved) && resolved.length > 0
        ? (resolved as Cartesian3[])
        : Array.isArray(container?.positions) && (container.positions as Cartesian3[]).length > 0
          ? (container.positions as Cartesian3[])
          : null
    if (positions && positions.length > 0) return cartesianToDegArray(positions)
  }
  const polyline = entity.polyline
  if (polyline && polyline.positions) {
    const resolved = unwrap(time, polyline.positions)
    if (Array.isArray(resolved) && (resolved as Cartesian3[]).length > 0) {
      return cartesianToDegArray(resolved as Cartesian3[])
    }
  }
  return []
}

export function toFlatHeights(points: GPoint[]): number[] {
  const out: number[] = []
  for (const p of points) {
    out.push(p.lng, p.lat, Number.isFinite(p.alt) ? p.alt : 0)
  }
  return out
}

export function toCartesian(points: GPoint[]): Cartesian3[] {
  return Cartesian3.fromDegreesArrayHeights(toFlatHeights(points))
}

export function writeEntityGeometry(
  viewer: Viewer,
  entity: EntityLike,
  points: GPoint[]
): void {
  void viewer
  const hasPolygon = !!entity.polygon
  const cart3 = toCartesian(points)
  if (hasPolygon) {
    entity.polygon!.hierarchy = new PolygonHierarchy(cart3)
  } else if (entity.polyline) {
    entity.polyline.positions = cart3
  }
}

export function centroid(points: GPoint[]): GPoint {
  if (points.length === 0) return { lng: 0, lat: 0, alt: 0 }
  let lng = 0
  let lat = 0
  let alt = 0
  for (const p of points) {
    lng += p.lng
    lat += p.lat
    alt += p.alt
  }
  const n = points.length
  return { lng: lng / n, lat: lat / n, alt: alt / n }
}

function wrapAngle(rad: number): number {
  let v = rad % TWO_PI
  if (v < 0) v += TWO_PI
  return v
}

export function degDistance(a: GPoint, b: GPoint): number {
  const dx = b.lng - a.lng
  const dy = b.lat - a.lat
  return Math.sqrt(dx * dx + dy * dy)
}

export function degAngle(c: GPoint, p: GPoint): number {
  return wrapAngle(Math.atan2(p.lat - c.lat, p.lng - c.lng))
}

export function translatePoints(points: GPoint[], dlng: number, dlat: number): GPoint[] {
  return points.map((p) => ({ lng: p.lng + dlng, lat: p.lat + dlat, alt: p.alt }))
}

export function rotatePoints(points: GPoint[], c: GPoint, radians: number): GPoint[] {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return points.map((p) => {
    const dx = p.lng - c.lng
    const dy = p.lat - c.lat
    return {
      lng: c.lng + dx * cos - dy * sin,
      lat: c.lat + dx * sin + dy * cos,
      alt: p.alt
    }
  })
}

export function scalePoints(points: GPoint[], c: GPoint, factor: number): GPoint[] {
  return points.map((p) => ({
    lng: c.lng + (p.lng - c.lng) * factor,
    lat: c.lat + (p.lat - c.lat) * factor,
    alt: p.alt
  }))
}

export function insertPointAt(points: GPoint[], index: number, p: GPoint): GPoint[] {
  const out = points.slice()
  const idx = Math.max(0, Math.min(index, out.length))
  out.splice(idx, 0, p)
  return out
}

export function removePointAt(points: GPoint[], index: number): GPoint[] {
  if (points.length <= 1) return points
  const out = points.slice()
  out.splice(index, 1)
  return out
}

export function closestPointIndex(points: GPoint[], target: GPoint): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < points.length; i++) {
    const d = degDistance(points[i], target)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

export function pickSceneDeg(viewer: Viewer, px: Cartesian2): GPoint | null {
  const ray = viewer.camera.getPickRay(px)
  if (!ray) return null
  let cartesian = viewer.scene.globe.pick(ray, viewer.scene)
  if (!cartesian) {
    cartesian = viewer.camera.pickEllipsoid(px, viewer.scene.globe.ellipsoid)
  }
  if (!cartesian) return null
  const carto = Cartographic.fromCartesian(cartesian)
  return {
    lng: CesiumMath.toDegrees(carto.longitude),
    lat: CesiumMath.toDegrees(carto.latitude),
    alt: carto.height
  }
}
