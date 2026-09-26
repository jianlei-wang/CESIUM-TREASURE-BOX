import type { AreaBounds, ElevationModel, LonLat, Waypoint } from './types'

/** 确定性伪随机数发生器（mulberry32），保证每次进入案例数据一致。 */
export function createPrng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function pad(value: number, size = 3): string {
  return String(Math.floor(value)).padStart(size, '0')
}

const EARTH_RADIUS = 6371008.8

/** 两点大圆距离（米）。 */
export function haversine(a: LonLat, b: LonLat): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 折线总长度（米）。 */
export function pathLength(points: LonLat[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i += 1) sum += haversine(points[i - 1], points[i])
  return sum
}

/** 三维折线长度（含高度差，米）。 */
export function pathLength3d(points: Waypoint[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    sum += Math.hypot(haversine(a, b), b.alt - a.alt)
  }
  return sum
}

export function bearing(a: LonLat, b: LonLat): number {
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

/** 是否点在一个（经纬度）多边形内，射线法。 */
export function pointInRing(point: LonLat, ring: LonLat[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i].lon
    const yi = ring[i].lat
    const xj = ring[j].lon
    const yj = ring[j].lat
    const intersect = yi > point.lat !== yj > point.lat
    if (intersect && point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

export function boundsCenter(bounds: AreaBounds): LonLat {
  return { lon: (bounds.west + bounds.east) / 2, lat: (bounds.south + bounds.north) / 2 }
}

export function boundsSpanMeters(bounds: AreaBounds): { width: number; height: number } {
  const center = boundsCenter(bounds)
  return {
    width: haversine({ lon: bounds.west, lat: center.lat }, { lon: bounds.east, lat: center.lat }),
    height: haversine({ lon: center.lon, lat: bounds.south }, { lon: center.lon, lat: bounds.north })
  }
}

/** 由高程模型双线性插值获取某点地表高程（米）；无模型时返回 0。 */
export function elevationAt(model: ElevationModel | undefined, lon: number, lat: number): number {
  if (!model || !model.heights.length) return 0
  const { west, south, east, north, nx, ny, heights } = model
  const gx = ((lon - west) / Math.max(1e-9, east - west)) * (nx - 1)
  const gy = ((lat - south) / Math.max(1e-9, north - south)) * (ny - 1)
  const x0 = clamp(Math.floor(gx), 0, nx - 1)
  const y0 = clamp(Math.floor(gy), 0, ny - 1)
  const x1 = Math.min(nx - 1, x0 + 1)
  const y1 = Math.min(ny - 1, y0 + 1)
  const tx = clamp(gx - x0, 0, 1)
  const ty = clamp(gy - y0, 0, 1)
  const h00 = heights[y0 * nx + x0] ?? 0
  const h10 = heights[y0 * nx + x1] ?? 0
  const h01 = heights[y1 * nx + x0] ?? 0
  const h11 = heights[y1 * nx + x1] ?? 0
  const h0 = h00 + (h10 - h00) * tx
  const h1 = h01 + (h11 - h01) * tx
  return h0 + (h1 - h0) * ty
}

/** 由中心点与跨度（米）生成四至。 */
export function boundsFromCenter(center: LonLat, widthMeters: number, heightMeters: number): AreaBounds {
  const dLat = (heightMeters / 2 / EARTH_RADIUS) * (180 / Math.PI)
  const dLon = (widthMeters / 2 / (EARTH_RADIUS * Math.cos((center.lat * Math.PI) / 180))) * (180 / Math.PI)
  return {
    west: center.lon - dLon,
    east: center.lon + dLon,
    south: center.lat - dLat,
    north: center.lat + dLat
  }
}

/** 生成圆的经纬度环。 */
export function circleRing(center: LonLat, radiusMeters: number, segments = 48): LonLat[] {
  const ring: LonLat[] = []
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    const dLat = (radiusMeters / EARTH_RADIUS) * Math.cos(angle) * (180 / Math.PI)
    const dLon =
      (radiusMeters / (EARTH_RADIUS * Math.cos((center.lat * Math.PI) / 180))) *
      Math.sin(angle) *
      (180 / Math.PI)
    ring.push({ lon: center.lon + dLon, lat: center.lat + dLat })
  }
  return ring
}

export function formatClock(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
}

export function formatDateTime(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(
    date.getMinutes()
  )}:${p(date.getSeconds())}`
}

export function formatMeters(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`
  return `${value.toFixed(0)} m`
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m} 分 ${String(s).padStart(2, '0')} 秒`
}
