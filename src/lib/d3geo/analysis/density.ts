import type { GeoPointBuffer } from '../core/buffer'

export type Bounds = { west: number; south: number; east: number; north: number }

/** 规则网格数值场。 */
export type GridField = {
  width: number
  height: number
  bounds: Bounds
  values: Float32Array
  min: number
  max: number
}

export type KdeOptions = {
  width: number
  height: number
  bounds: Bounds
  /** 核半径（以网格单元为单位）。 */
  radius?: number
  /** 权重来源：count 或 value（默认 value）。 */
  weight?: 'count' | 'value'
}

/** 核密度估计（KDE）：散点 → 连续密度场。 */
export function kdeGrid(buffer: GeoPointBuffer, options: KdeOptions): GridField {
  const { width, height, bounds } = options
  const radius = Math.max(1, options.radius ?? 2)
  const useValue = options.weight !== 'count'
  const values = new Float32Array(width * height)
  const sigma = radius / 2
  const twoSigmaSq = 2 * sigma * sigma
  const lonSpan = Math.max(1e-9, bounds.east - bounds.west)
  const latSpan = Math.max(1e-9, bounds.north - bounds.south)

  for (let i = 0; i < buffer.length; i += 1) {
    const lon = buffer.positions[i * 2]
    const lat = buffer.positions[i * 2 + 1]
    if (lon < bounds.west || lon > bounds.east || lat < bounds.south || lat > bounds.north) continue
    const gx = ((lon - bounds.west) / lonSpan) * (width - 1)
    const gy = ((lat - bounds.south) / latSpan) * (height - 1)
    const x0 = Math.max(0, Math.floor(gx - radius))
    const x1 = Math.min(width - 1, Math.ceil(gx + radius))
    const y0 = Math.max(0, Math.floor(gy - radius))
    const y1 = Math.min(height - 1, Math.ceil(gy + radius))
    const weight = useValue ? buffer.values[i] : 1
    for (let y = y0; y <= y1; y += 1) {
      const dy = y - gy
      for (let x = x0; x <= x1; x += 1) {
        const dx = x - gx
        const kernel = Math.exp(-(dx * dx + dy * dy) / twoSigmaSq)
        values[y * width + x] += weight * kernel
      }
    }
  }

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] < min) min = values[i]
    if (values[i] > max) max = values[i]
  }
  if (!Number.isFinite(min)) {
    min = 0
    max = 1
  }
  return { width, height, bounds, values, min, max }
}

/** 网格场采样：以 (lon,lat) 取双线性值。 */
export function sampleField(field: GridField, lon: number, lat: number): number {
  const { width, height, bounds, values } = field
  const lonSpan = Math.max(1e-9, bounds.east - bounds.west)
  const latSpan = Math.max(1e-9, bounds.north - bounds.south)
  const gx = ((lon - bounds.west) / lonSpan) * (width - 1)
  const gy = ((lat - bounds.south) / latSpan) * (height - 1)
  const x = Math.max(0, Math.min(width - 1.001, gx))
  const y = Math.max(0, Math.min(height - 1.001, gy))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const v00 = values[y0 * width + x0]
  const v10 = values[y0 * width + x1]
  const v01 = values[y1 * width + x0]
  const v11 = values[y1 * width + x1]
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty
}
