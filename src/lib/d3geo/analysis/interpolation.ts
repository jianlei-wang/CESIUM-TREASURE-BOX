import type { GeoPointBuffer } from '../core/buffer'
import type { Bounds, GridField } from './density'

export type IdwOptions = {
  width: number
  height: number
  bounds: Bounds
  /** 幂指数，越大越局部。 */
  power?: number
  /** 参与插值的最大控制点数（超采样以保证性能）。 */
  maxControlPoints?: number
  /** 搜索半径（度），0 表示全局。 */
  searchRadius?: number
}

/** 反距离加权插值（IDW）：离散采样点 → 连续数值场。 */
export function idwGrid(buffer: GeoPointBuffer, options: IdwOptions): GridField {
  const { width, height, bounds } = options
  const power = options.power ?? 2
  const searchRadius = options.searchRadius ?? 0
  const maxControl = options.maxControlPoints ?? 800

  // 控制点抽样
  const stride = Math.max(1, Math.ceil(buffer.length / maxControl))
  const controlLon: number[] = []
  const controlLat: number[] = []
  const controlValue: number[] = []
  for (let i = 0; i < buffer.length; i += stride) {
    controlLon.push(buffer.positions[i * 2])
    controlLat.push(buffer.positions[i * 2 + 1])
    controlValue.push(buffer.values[i])
  }
  const controls = controlLon.length

  const values = new Float32Array(width * height)
  const lonSpan = Math.max(1e-9, bounds.east - bounds.west)
  const latSpan = Math.max(1e-9, bounds.north - bounds.south)
  for (let gy = 0; gy < height; gy += 1) {
    const lat = bounds.south + (gy / Math.max(1, height - 1)) * latSpan
    for (let gx = 0; gx < width; gx += 1) {
      const lon = bounds.west + (gx / Math.max(1, width - 1)) * lonSpan
      let weightSum = 0
      let valueSum = 0
      for (let c = 0; c < controls; c += 1) {
        const dLon = lon - controlLon[c]
        const dLat = lat - controlLat[c]
        const dist = Math.sqrt(dLon * dLon + dLat * dLat)
        if (searchRadius > 0 && dist > searchRadius) continue
        if (dist < 1e-9) {
          weightSum = 1
          valueSum = controlValue[c]
          break
        }
        const weight = 1 / Math.pow(dist, power)
        weightSum += weight
        valueSum += weight * controlValue[c]
      }
      values[gy * width + gx] = weightSum > 0 ? valueSum / weightSum : 0
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
