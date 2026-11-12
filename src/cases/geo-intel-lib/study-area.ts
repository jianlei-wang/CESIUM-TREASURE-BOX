export type LonLat = [number, number]

export type StudyFeature = {
  id: number
  lon: number
  lat: number
  category: string
  weight: number
}

export function signedDistanceToRing(lon: number, lat: number, ring: LonLat[]): number {
  let minDist = Infinity
  let inside = false
  const cosLat = Math.cos((lat * Math.PI) / 180) * 111320
  const mPerDegLat = 111320
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const px = (lon - xi) * cosLat
    const py = (lat - yi) * mPerDegLat
    const ax = 0
    const ay = 0
    const bx = (xj - xi) * cosLat
    const by = (yj - yi) * mPerDegLat
    const vx = bx - ax
    const vy = by - ay
    const wx = px - ax
    const wy = py - ay
    const len2 = vx * vx + vy * vy || 1
    const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2))
    const dx = wx - vx * t
    const dy = wy - vy * t
    minDist = Math.min(minDist, Math.hypot(dx, dy))
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside ? minDist : -minDist
}

export type AreaStats = {
  insideCount: number
  totalCount: number
  areaKm2: number
  density: number
  byCategory: Record<string, number>
  coveredWeight: number
  totalWeight: number
}

export function polygonAreaKm2(ring: LonLat[]): number {
  if (ring.length < 3) return 0
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111.32
  const ky = 111.32
  let sum = 0
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    sum += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky)
  }
  return Math.abs(sum) / 2
}

export function analyzeStudyArea(
  features: StudyFeature[],
  ring: LonLat[],
  enabled: boolean
): AreaStats {
  const byCategory: Record<string, number> = {}
  let insideCount = 0
  let coveredWeight = 0
  let totalWeight = 0
  for (const f of features) {
    totalWeight += f.weight
    const inside = !enabled || signedDistanceToRing(f.lon, f.lat, ring) > 0
    if (!enabled) {
      insideCount += 1
      coveredWeight += f.weight
      byCategory[f.category] = (byCategory[f.category] ?? 0) + 1
      continue
    }
    if (inside) {
      insideCount += 1
      coveredWeight += f.weight
      byCategory[f.category] = (byCategory[f.category] ?? 0) + 1
    }
  }
  const areaKm2 = enabled ? polygonAreaKm2(ring) : 0
  return {
    insideCount,
    totalCount: features.length,
    areaKm2,
    density: areaKm2 > 0 ? insideCount / areaKm2 : 0,
    byCategory,
    coveredWeight,
    totalWeight
  }
}

export function nearestFeatureDistanceM(features: StudyFeature[], lon: number, lat: number): number {
  let best = Infinity
  const kx = Math.cos((lat * Math.PI) / 180) * 111320
  for (const f of features) {
    const d = Math.hypot((f.lon - lon) * kx, (f.lat - lat) * 111320)
    if (d < best) best = d
  }
  return best
}
