import { cellToBoundary, cellToLatLng, latLngToCell } from 'h3-js'
import type { GeoPointBuffer } from '../core/buffer'
import type { AggregateCell, LonLat } from './hexbin'

type Accumulator = { count: number; sum: number; min: number; max: number }

/** H3 单元聚合：把海量点压减到指定分辨率的六边形单元。 */
export function h3binBuffer(buffer: GeoPointBuffer, resolution: number): AggregateCell[] {
  const buckets = new Map<string, Accumulator>()
  for (let index = 0; index < buffer.length; index += 1) {
    const lat = buffer.positions[index * 2 + 1]
    const lon = buffer.positions[index * 2]
    const cell = latLngToCell(lat, lon, resolution)
    const value = buffer.values[index]
    let acc = buckets.get(cell)
    if (!acc) {
      acc = { count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
      buckets.set(cell, acc)
    }
    acc.count += 1
    acc.sum += value
    if (value < acc.min) acc.min = value
    if (value > acc.max) acc.max = value
  }
  const cells: AggregateCell[] = []
  for (const [key, acc] of buckets) {
    const [lat, lon] = cellToLatLng(key)
    cells.push({
      key,
      lon,
      lat,
      polygon: h3CellPolygon(key),
      count: acc.count,
      sum: acc.sum,
      mean: acc.count > 0 ? acc.sum / acc.count : 0,
      min: acc.min,
      max: acc.max
    })
  }
  return cells
}

/** H3 单元边界（经纬度环）。 */
export function h3CellPolygon(cell: string): LonLat[] {
  const boundary = cellToBoundary(cell)
  return boundary.map(([lat, lon]) => [lon, lat] as LonLat)
}

/** 估算 H3 单元平均边长（米），用于配色 / 尺寸表达。 */
export function h3CellSpan(resolution: number): number {
  return 1_281_000 * Math.pow(7, -resolution / 2)
}

export { latLngToCell, cellToLatLng, cellToBoundary }
