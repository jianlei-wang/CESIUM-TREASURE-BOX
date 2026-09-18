import {
  createSampleGrid,
  fillGridStats,
  nodeLonLat,
  pointInRing,
  type Ring,
  type SampleGrid
} from '../polygon-depth-contour/depth-contour-lib'

export {
  createSampleGrid,
  fillGridStats,
  nodeLonLat,
  pointInRing,
  type Ring,
  type SampleGrid
}

export type RegionStats = {
  areaKm2: number
  sampleCount: number
  avgHeight: number
  minHeight: number
  maxHeight: number
}

export function computeRegionStats(grid: SampleGrid, ring: Ring): RegionStats {
  const count = ring.length
  const latCenter = count > 0
    ? (ring.reduce((sum, point) => Math.min(sum, point.lat), Number.POSITIVE_INFINITY) +
       ring.reduce((sum, point) => Math.max(sum, point.lat), Number.NEGATIVE_INFINITY)) / 2
    : 0
  const metersPerDegLon = 111320 * Math.cos((latCenter * Math.PI) / 180)
  let twiceAreaDeg = 0
  for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
    twiceAreaDeg += ring[j].lon * ring[i].lat - ring[i].lon * ring[j].lat
  }
  const areaKm2 = Math.abs(twiceAreaDeg) / 2 * metersPerDegLon * 111320 / 1e6
  let sampleCount = 0
  let sum = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let row = 0; row < grid.ny; row += 1) {
    for (let col = 0; col < grid.nx; col += 1) {
      const point = nodeLonLat(grid, row, col)
      if (!pointInRing(point.lon, point.lat, ring)) continue
      const height = grid.heights[row * grid.nx + col]
      if (!Number.isFinite(height)) continue
      sampleCount += 1
      sum += height
      if (height < min) min = height
      if (height > max) max = height
    }
  }
  return {
    areaKm2,
    sampleCount,
    avgHeight: sampleCount > 0 ? sum / sampleCount : 0,
    minHeight: sampleCount > 0 ? min : 0,
    maxHeight: sampleCount > 0 ? max : 0
  }
}

export type EarthworkStats = {
  fillM3: number
  cutM3: number
  fillCells: number
  cutCells: number
  fillAreaM2: number
  cutAreaM2: number
  fillMaxDepthM: number
  cutMaxDepthM: number
}

export function computeEarthworks(grid: SampleGrid, ring: Ring, targetHeight: number): EarthworkStats {
  let fillM3 = 0
  let cutM3 = 0
  let fillCells = 0
  let cutCells = 0
  let fillAreaM2 = 0
  let cutAreaM2 = 0
  let fillMaxDepthM = 0
  let cutMaxDepthM = 0
  for (let row = 0; row < grid.ny; row += 1) {
    for (let col = 0; col < grid.nx; col += 1) {
      const point = nodeLonLat(grid, row, col)
      if (!pointInRing(point.lon, point.lat, ring)) continue
      const height = grid.heights[row * grid.nx + col]
      if (!Number.isFinite(height)) continue
      const latRad = (point.lat * Math.PI) / 180
      const cellAreaM2 = Math.abs(grid.cellLon) * 111320 * Math.cos(latRad) * Math.abs(grid.cellLat) * 110540
      const diff = targetHeight - height
      if (diff > 0) {
        fillM3 += diff * cellAreaM2
        fillCells += 1
        fillAreaM2 += cellAreaM2
        if (diff > fillMaxDepthM) fillMaxDepthM = diff
      } else if (diff < 0) {
        cutM3 += -diff * cellAreaM2
        cutCells += 1
        cutAreaM2 += cellAreaM2
        if (-diff > cutMaxDepthM) cutMaxDepthM = -diff
      }
    }
  }
  return { fillM3, cutM3, fillCells, cutCells, fillAreaM2, cutAreaM2, fillMaxDepthM, cutMaxDepthM }
}
