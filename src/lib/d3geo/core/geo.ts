/** 地理距离与常用数学工具。 */

const EARTH_RADIUS = 6371008.8

export type LonLat = [number, number]

/** 大圆距离（米）。 */
export function haversine(a: LonLat, b: LonLat): number {
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const dLat = lat2 - lat1
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** 把值域映射到 [0,1]。 */
export function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0
  return clamp((value - min) / (max - min), 0, 1)
}

export function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  const upper = lower + 1
  if (upper >= sorted.length) return sorted[lower]
  return lerp(sorted[lower], sorted[upper], index - lower)
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

export function stdDev(values: number[]): number {
  if (values.length === 0) return 0
  const m = mean(values)
  let sum = 0
  for (const v of values) sum += (v - m) ** 2
  return Math.sqrt(sum / values.length)
}

/** 格式化为带千分位的整数。 */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

/** 自适应小数位。 */
export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1000) return formatCount(value)
  return value.toFixed(digits)
}
