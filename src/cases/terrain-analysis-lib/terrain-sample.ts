/**
 * 真实地形采样：按多边形范围与米级间距调用 Cesium 世界地形生成 DEM。
 */
import { Cartographic, sampleTerrainMostDetailed, type TerrainProvider } from 'cesium'
import { demFromHeights } from './dem'
import type { DemData, LonLat, TerrainBounds } from './types'

export type SampleProgress = (done: number, total: number) => void

export type SampleOptions = {
  cellMeters: number
}

export type GridSpec = {
  width: number
  height: number
  points: number
  cellMeters: number
  cellLon: number
  cellLat: number
}

const SAMPLE_BATCH = 2048
const METERS_PER_DEG_LAT = 111320
const MIN_CELL_METERS = 5

export const RECOMMENDED_MAX_POINTS = 100000

export function boundsFromPolygon(points: LonLat[]): TerrainBounds | null {
  if (points.length < 3) return null
  let west = Number.POSITIVE_INFINITY
  let east = Number.NEGATIVE_INFINITY
  let south = Number.POSITIVE_INFINITY
  let north = Number.NEGATIVE_INFINITY
  for (const point of points) {
    if (!Number.isFinite(point.lon) || !Number.isFinite(point.lat)) continue
    if (point.lon < west) west = point.lon
    if (point.lon > east) east = point.lon
    if (point.lat < south) south = point.lat
    if (point.lat > north) north = point.lat
  }
  if (!Number.isFinite(west) || !Number.isFinite(east) || east - west <= 0) return null
  if (!Number.isFinite(south) || !Number.isFinite(north) || north - south <= 0) return null
  return { west, east, south, north }
}

export function gridFromBoundsMeters(bounds: TerrainBounds, cellMeters: number): GridSpec {
  const centerLat = (bounds.south + bounds.north) / 2
  const mPerDegLat = METERS_PER_DEG_LAT
  const mPerDegLon = Math.max(1000, METERS_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180))
  const spanLon = Math.max(1e-9, bounds.east - bounds.west)
  const spanLat = Math.max(1e-9, bounds.north - bounds.south)

  const cell = Math.max(MIN_CELL_METERS, cellMeters)
  const cellLon = cell / mPerDegLon
  const cellLat = cell / mPerDegLat
  const width = Math.max(2, Math.floor(spanLon / cellLon) + 1)
  const height = Math.max(2, Math.floor(spanLat / cellLat) + 1)
  const points = width * height
  return { width, height, points, cellMeters: cell, cellLon, cellLat }
}

export function fillInvalidHeights(values: Float32Array, width: number, height: number): number {
  const total = width * height
  let validCount = 0
  let sum = 0
  for (let i = 0; i < total; i += 1) {
    const v = values[i]
    if (Number.isFinite(v)) {
      validCount += 1
      sum += v
    }
  }
  if (validCount === 0) {
    values.fill(0)
    return total
  }
  const fallback = sum / validCount
  if (validCount === total) return 0

  let filled = 0
  const maxIterations = Math.max(width, height)
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const pending: number[] = []
    for (let r = 0; r < height; r += 1) {
      for (let c = 0; c < width; c += 1) {
        const i = r * width + c
        if (Number.isFinite(values[i])) continue
        let neighborSum = 0
        let neighborCount = 0
        for (let dr = -1; dr <= 1; dr += 1) {
          const rr = r + dr
          if (rr < 0 || rr >= height) continue
          for (let dc = -1; dc <= 1; dc += 1) {
            if (dr === 0 && dc === 0) continue
            const cc = c + dc
            if (cc < 0 || cc >= width) continue
            const nv = values[rr * width + cc]
            if (Number.isFinite(nv)) {
              neighborSum += nv
              neighborCount += 1
            }
          }
        }
        if (neighborCount > 0) pending.push(i, neighborSum / neighborCount)
      }
    }
    if (pending.length === 0) break
    for (let k = 0; k < pending.length; k += 2) {
      values[pending[k]] = pending[k + 1]
      filled += 1
    }
  }

  for (let i = 0; i < total; i += 1) {
    if (!Number.isFinite(values[i])) {
      values[i] = fallback
      filled += 1
    }
  }
  return filled
}

export async function sampleTerrainDem(
  provider: TerrainProvider,
  bounds: TerrainBounds,
  options: SampleOptions,
  onProgress?: SampleProgress
): Promise<DemData> {
  const spec = gridFromBoundsMeters(bounds, options.cellMeters)
  const west = bounds.west
  const south = bounds.south
  const east = west + (spec.width - 1) * spec.cellLon
  const north = south + (spec.height - 1) * spec.cellLat
  const total = spec.width * spec.height
  const heights = new Float32Array(total)
  const cartographics: Cartographic[] = new Array(total)

  let index = 0
  for (let r = 0; r < spec.height; r += 1) {
    const lat = north - r * spec.cellLat
    for (let c = 0; c < spec.width; c += 1) {
      const lon = west + c * spec.cellLon
      cartographics[index] = Cartographic.fromDegrees(lon, lat)
      index += 1
    }
  }

  let done = 0
  for (let start = 0; start < total; start += SAMPLE_BATCH) {
    const end = Math.min(total, start + SAMPLE_BATCH)
    const batch = cartographics.slice(start, end)
    await sampleTerrainMostDetailed(provider, batch)
    for (let i = 0; i < batch.length; i += 1) {
      const h = batch[i].height
      heights[start + i] = Number.isFinite(h) ? (h as number) : Number.NaN
    }
    done = end
    onProgress?.(done, total)
  }

  const filled = fillInvalidHeights(heights, spec.width, spec.height)
  const spacing = Math.round(spec.cellMeters)
  const source = `真实地形采样 ${spec.width}x${spec.height} · 间距约 ${spacing}m · 填充 ${filled} 个无效点`
  return demFromHeights(heights, spec.width, spec.height, west, east, south, north, source)
}
