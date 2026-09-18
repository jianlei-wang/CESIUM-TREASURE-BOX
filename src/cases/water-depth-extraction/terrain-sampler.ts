import { Cartographic, sampleTerrainMostDetailed, type TerrainProvider } from 'cesium'

export type SourceExtent = { west: number; south: number; east: number; north: number }

export type DepthGrid = {
  cols: number
  rows: number
  pixels: Float32Array
  min: number
  max: number
}

export function extentFromDegrees(west: number, south: number, east: number, north: number): SourceExtent {
  return { west, south, east, north }
}

export function aspectRows(cols: number, extent: SourceExtent): number {
  const lat = (extent.south + extent.north) / 2
  const cos = Math.max(0.001, Math.cos((lat * Math.PI) / 180))
  const mPerLon = 111320 * cos
  const mPerLat = 111320
  const lonM = (extent.east - extent.west) * mPerLon
  const latM = (extent.north - extent.south) * mPerLat
  return Math.max(4, Math.min(1024, Math.round(cols * (latM / Math.max(lonM, 1e-6)))))
}

export async function sampleTerrainHeights(
  provider: TerrainProvider,
  extent: SourceExtent,
  cols: number,
  rows: number
): Promise<DepthGrid> {
  const pixels = new Float32Array(cols * rows)
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  const rowsPerBatch = Math.max(1, Math.floor(8192 / cols))
  for (let startRow = 0; startRow < rows; startRow += rowsPerBatch) {
    const endRow = Math.min(rows, startRow + rowsPerBatch)
    const samples: Cartographic[] = []
    for (let r = startRow; r < endRow; r += 1) {
      const v = (r + 0.5) / rows
      const lat = extent.south + (extent.north - extent.south) * v
      for (let c = 0; c < cols; c += 1) {
        const u = (c + 0.5) / cols
        const lon = extent.west + (extent.east - extent.west) * u
        samples.push(Cartographic.fromDegrees(lon, lat, 0))
      }
    }
    await sampleTerrainMostDetailed(provider, samples)
    for (let r = startRow; r < endRow; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const sample = samples[(r - startRow) * cols + c]
        const h = sample.height
        const value = Number.isFinite(h) ? h : 0
        const dstRow = rows - 1 - r
        pixels[dstRow * cols + c] = value
        if (value < min) min = value
        if (value > max) max = value
      }
    }
  }
  if (!Number.isFinite(min)) min = 0
  if (!Number.isFinite(max)) max = min + 1
  return { cols, rows, pixels, min, max }
}
