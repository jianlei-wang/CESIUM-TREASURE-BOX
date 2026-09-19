/**
 * DEM 封装与高程/Heightmap 转换工具。
 * 真实地形通过 terrain-sample.ts 采样，DEM 文件通过 io.ts 导入。
 */
import type { DemData } from './types'

export function demStats(values: Float32Array): { minHeight: number; maxHeight: number; meanHeight: number } {
  let minHeight = Number.POSITIVE_INFINITY
  let maxHeight = Number.NEGATIVE_INFINITY
  let sum = 0
  let count = 0
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]
    if (!Number.isFinite(v)) continue
    if (v < minHeight) minHeight = v
    if (v > maxHeight) maxHeight = v
    sum += v
    count += 1
  }
  if (count === 0) return { minHeight: 0, maxHeight: 0, meanHeight: 0 }
  return { minHeight, maxHeight, meanHeight: sum / count }
}

export function finalizeDem(
  values: Float32Array,
  width: number,
  height: number,
  west: number,
  east: number,
  south: number,
  north: number,
  source: string
): DemData {
  const stats = demStats(values)
  return { width, height, values, west, east, south, north, ...stats, source }
}

export function demFromHeights(
  heights: Float32Array,
  width: number,
  height: number,
  west: number,
  east: number,
  south: number,
  north: number,
  source: string
): DemData {
  return finalizeDem(heights, width, height, west, east, south, north, source)
}

export function demFromHeightmap(
  pixels: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  targetWidth: number,
  targetHeight: number,
  minHeight: number,
  maxHeight: number,
  west: number,
  east: number,
  south: number,
  north: number,
  source: string
): DemData {
  const values = new Float32Array(targetWidth * targetHeight)
  for (let r = 0; r < targetHeight; r += 1) {
    const sy = targetHeight > 1 ? (r / (targetHeight - 1)) * (imageHeight - 1) : 0
    const y0 = Math.floor(sy)
    const y1 = Math.min(imageHeight - 1, y0 + 1)
    const fy = sy - y0
    for (let c = 0; c < targetWidth; c += 1) {
      const sx = targetWidth > 1 ? (c / (targetWidth - 1)) * (imageWidth - 1) : 0
      const x0 = Math.floor(sx)
      const x1 = Math.min(imageWidth - 1, x0 + 1)
      const fx = sx - x0
      const i00 = (y0 * imageWidth + x0) * 4
      const i10 = (y0 * imageWidth + x1) * 4
      const i01 = (y1 * imageWidth + x0) * 4
      const i11 = (y1 * imageWidth + x1) * 4
      const v00 = (pixels[i00] + pixels[i00 + 1] + pixels[i00 + 2]) / 765
      const v10 = (pixels[i10] + pixels[i10 + 1] + pixels[i10 + 2]) / 765
      const v01 = (pixels[i01] + pixels[i01 + 1] + pixels[i01 + 2]) / 765
      const v11 = (pixels[i11] + pixels[i11 + 1] + pixels[i11 + 2]) / 765
      const top = v00 + (v10 - v00) * fx
      const bottom = v01 + (v11 - v01) * fx
      const norm = top + (bottom - top) * fy
      values[r * targetWidth + c] = minHeight + norm * (maxHeight - minHeight)
    }
  }
  return finalizeDem(values, targetWidth, targetHeight, west, east, south, north, source)
}
