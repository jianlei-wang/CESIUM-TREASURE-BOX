import type { GeoPointBuffer } from '../core/buffer'

export type LonLat = [number, number]

/** 通用聚合单元统计。 */
export type AggregateCell = {
  /** 稳定键（网格 / H3 / 坐标哈希）。 */
  key: string
  /** 单元中心经纬度。 */
  lon: number
  lat: number
  /** 单元边界（六边形 / 方格 / H3 边界）。 */
  polygon: LonLat[]
  count: number
  sum: number
  mean: number
  min: number
  max: number
}

type Accumulator = {
  cx: number
  cy: number
  count: number
  sum: number
  min: number
  max: number
}

function finalize(key: string, cx: number, cy: number, cos: number, polygon: LonLat[], acc: Accumulator): AggregateCell {
  return {
    key,
    lon: cx / cos,
    lat: cy,
    polygon,
    count: acc.count,
    sum: acc.sum,
    mean: acc.count > 0 ? acc.sum / acc.count : 0,
    min: acc.min,
    max: acc.max
  }
}

/**
 * 六边形格网聚合（data-space hexbin）。
 * 以 lat0 处经度缩放近似平面坐标，做最近中心分桶；聚合计数与数值统计。
 */
export function hexbinBuffer(buffer: GeoPointBuffer, radiusDeg: number, lat0 = 34): AggregateCell[] {
  const cos = Math.cos((lat0 * Math.PI) / 180) || 0.01
  const r = Math.max(0.0001, radiusDeg)
  const w = 2 * r
  const h = Math.sqrt(3) * r
  const buckets = new Map<string, Accumulator>()

  for (let index = 0; index < buffer.length; index += 1) {
    const x = buffer.positions[index * 2] * cos
    const y = buffer.positions[index * 2 + 1]
    const j0 = Math.round(y / h)
    let bestI = 0
    let bestJ = 0
    let bestCx = 0
    let bestCy = 0
    let bestDist = Number.POSITIVE_INFINITY
    for (let j = j0 - 1; j <= j0 + 1; j += 1) {
      const offset = (((j % 2) + 2) % 2) === 0 ? 0 : r
      const i0 = Math.round((x - offset) / w)
      for (let i = i0 - 1; i <= i0 + 1; i += 1) {
        const cx = i * w + offset
        const cy = j * h
        const dist = (cx - x) ** 2 + (cy - y) ** 2
        if (dist < bestDist) {
          bestDist = dist
          bestI = i
          bestJ = j
          bestCx = cx
          bestCy = cy
        }
      }
    }
    const key = `${bestI},${bestJ}`
    let acc = buckets.get(key)
    if (!acc) {
      acc = { cx: bestCx, cy: bestCy, count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
      buckets.set(key, acc)
    }
    const value = buffer.values[index]
    acc.count += 1
    acc.sum += value
    if (value < acc.min) acc.min = value
    if (value > acc.max) acc.max = value
  }

  const cells: AggregateCell[] = []
  for (const [key, acc] of buckets) {
    const polygon: LonLat[] = []
    for (let k = 0; k < 6; k += 1) {
      const angle = (Math.PI / 3) * k
      polygon.push([(acc.cx + r * Math.cos(angle)) / cos, acc.cy + r * Math.sin(angle)])
    }
    cells.push(finalize(key, acc.cx, acc.cy, cos, polygon, acc))
  }
  return cells
}

/**
 * 规则方格聚合。
 */
export function gridBuffer(buffer: GeoPointBuffer, cellSize: number): AggregateCell[] {
  const size = Math.max(0.0001, cellSize)
  const buckets = new Map<string, Accumulator>()
  for (let index = 0; index < buffer.length; index += 1) {
    const lon = buffer.positions[index * 2]
    const lat = buffer.positions[index * 2 + 1]
    const i = Math.floor(lon / size)
    const j = Math.floor(lat / size)
    const key = `${i},${j}`
    let acc = buckets.get(key)
    if (!acc) {
      acc = { cx: (i + 0.5) * size, cy: (j + 0.5) * size, count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
      buckets.set(key, acc)
    }
    const value = buffer.values[index]
    acc.count += 1
    acc.sum += value
    if (value < acc.min) acc.min = value
    if (value > acc.max) acc.max = value
  }
  const cells: AggregateCell[] = []
  for (const [key, acc] of buckets) {
    const west = acc.cx - size / 2
    const south = acc.cy - size / 2
    const polygon: LonLat[] = [
      [west, south],
      [west + size, south],
      [west + size, south + size],
      [west, south + size]
    ]
    cells.push(finalize(key, acc.cx, acc.cy, 1, polygon, acc))
  }
  return cells
}

/** 六边形周边顶点（供渲染层用中心 + 半径重建，无需传输多变长几何）。 */
export function hexRing(lon: number, lat: number, radiusDeg: number, lat0 = 34): LonLat[] {
  const cos = Math.cos((lat0 * Math.PI) / 180) || 0.01
  const ring: LonLat[] = []
  for (let k = 0; k < 6; k += 1) {
    const angle = (Math.PI / 3) * k
    ring.push([lon + (radiusDeg * Math.cos(angle)) / cos, lat + radiusDeg * Math.sin(angle)])
  }
  return ring
}
