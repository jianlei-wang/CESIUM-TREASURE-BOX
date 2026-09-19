/**
 * 配色、色彩查找表、晕渲、栅格统计与分级工具。
 */
import type { DemData, RGBA } from './types'

export type Stop = [number, number, number, number]

export const RAMPS: Record<string, Stop[]> = {
  terrain: [
    [0, 42, 78, 62],
    [0.15, 70, 112, 68],
    [0.32, 120, 146, 84],
    [0.48, 166, 164, 108],
    [0.64, 178, 142, 96],
    [0.8, 156, 120, 108],
    [0.92, 196, 190, 188],
    [1, 246, 246, 250]
  ],
  thermal: [
    [0, 12, 24, 62],
    [0.25, 32, 92, 178],
    [0.5, 42, 182, 158],
    [0.75, 240, 200, 62],
    [1, 220, 52, 40]
  ],
  diverging: [
    [0, 44, 123, 182],
    [0.5, 246, 246, 246],
    [1, 200, 40, 40]
  ],
  gray: [
    [0, 12, 16, 22],
    [1, 240, 244, 250]
  ],
  wetness: [
    [0, 214, 62, 40],
    [0.25, 240, 200, 62],
    [0.5, 90, 200, 90],
    [0.75, 60, 190, 210],
    [1, 30, 90, 200]
  ],
  twi: [
    [0, 120, 40, 140],
    [0.2, 180, 40, 120],
    [0.4, 240, 120, 60],
    [0.6, 250, 220, 60],
    [0.8, 60, 190, 200],
    [1, 20, 70, 190]
  ],
  viridis: [
    [0, 68, 1, 84],
    [0.25, 59, 82, 139],
    [0.5, 33, 145, 140],
    [0.75, 94, 201, 98],
    [1, 253, 231, 37]
  ],
  spectral: [
    [0, 158, 1, 66],
    [0.2, 213, 62, 79],
    [0.4, 244, 109, 67],
    [0.6, 254, 224, 139],
    [0.8, 102, 194, 165],
    [1, 26, 152, 80]
  ],
  rdYlGn: [
    [0, 165, 0, 38],
    [0.2, 215, 48, 39],
    [0.4, 253, 174, 97],
    [0.6, 166, 217, 106],
    [0.8, 26, 150, 65],
    [1, 0, 104, 55]
  ],
  blues: [
    [0, 247, 251, 255],
    [0.5, 107, 174, 214],
    [1, 8, 48, 107]
  ],
  greens: [
    [0, 247, 252, 245],
    [0.5, 116, 196, 118],
    [1, 0, 68, 27]
  ],
  reds: [
    [0, 255, 245, 240],
    [0.5, 251, 106, 74],
    [1, 103, 0, 13]
  ],
  risk: [
    [0, 0, 200, 0],
    [0.25, 100, 200, 50],
    [0.5, 220, 200, 0],
    [0.75, 240, 140, 30],
    [1, 220, 30, 30]
  ],
  suitability: [
    [0, 200, 50, 50],
    [0.35, 220, 150, 0],
    [0.65, 180, 200, 0],
    [1, 0, 180, 0]
  ],
  depth: [
    [0, 170, 220, 255],
    [0.35, 70, 150, 255],
    [0.7, 30, 90, 210],
    [1, 10, 40, 160]
  ],
  roughness: [
    [0, 20, 60, 140],
    [0.35, 60, 180, 190],
    [0.65, 250, 220, 60],
    [1, 210, 40, 30]
  ],
  classGreenRed: [
    [0, 0, 180, 0],
    [0.34, 180, 200, 0],
    [0.67, 220, 150, 0],
    [1, 200, 50, 50]
  ]
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function buildLut(stops: Stop[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255
    let a = stops[0]
    let b = stops[stops.length - 1]
    for (let s = 0; s < stops.length - 1; s += 1) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) {
        a = stops[s]
        b = stops[s + 1]
        break
      }
    }
    const span = b[0] - a[0]
    const f = span <= 0 ? 0 : (t - a[0]) / span
    lut[i * 3] = a[1] + (b[1] - a[1]) * f
    lut[i * 3 + 1] = a[2] + (b[2] - a[2]) * f
    lut[i * 3 + 2] = a[3] + (b[3] - a[3]) * f
  }
  return lut
}

const LUT_CACHE = new Map<string, Uint8ClampedArray>()

export function lutFor(ramp: string): Uint8ClampedArray {
  let lut = LUT_CACHE.get(ramp)
  if (!lut) {
    lut = buildLut(RAMPS[ramp] ?? RAMPS.thermal)
    LUT_CACHE.set(ramp, lut)
  }
  return lut
}

export function lutColor(lut: Uint8ClampedArray, t: number): RGBA {
  const idx = Math.max(0, Math.min(255, Math.round(clamp01(t) * 255)))
  return [lut[idx * 3], lut[idx * 3 + 1], lut[idx * 3 + 2], 255]
}

export function rampRgb(ramp: string, t: number): RGBA {
  return lutColor(lutFor(ramp), t)
}

export function rampCss(ramp: string): string {
  const stops = RAMPS[ramp] ?? RAMPS.thermal
  const parts = stops.map(([p, r, g, b]) => `rgb(${r}, ${g}, ${b}) ${Math.round(p * 100)}%`)
  return `linear-gradient(90deg, ${parts.join(', ')})`
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  let r = 0
  let g = 0
  let b = 0
  switch (i % 6) {
    case 0:
      r = v
      g = t
      b = p
      break
    case 1:
      r = q
      g = v
      b = p
      break
    case 2:
      r = p
      g = v
      b = t
      break
    case 3:
      r = p
      g = q
      b = v
      break
    case 4:
      r = t
      g = p
      b = v
      break
    default:
      r = v
      g = p
      b = q
  }
  return [r * 255, g * 255, b * 255]
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const num = parseInt(full, 16)
  if (!Number.isFinite(num)) return [255, 80, 60]
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

/** 计算 DEM 的坡度与坡向（单位：度）。返回弧度正切 tanβ 供分析使用。 */
export function slopeAspectGrids(dem: DemData): { tan: Float32Array; slopeDeg: Float32Array; aspectDeg: Float32Array } {
  const { width, height, values } = dem
  const tan = new Float32Array(width * height)
  const slopeDeg = new Float32Array(width * height)
  const aspectDeg = new Float32Array(width * height)
  const latRad = ((dem.south + dem.north) * 0.5 * Math.PI) / 180
  const cellX = Math.max(1, ((((dem.east - dem.west) * Math.PI) / 180) * 6378137 * Math.cos(latRad)) / Math.max(1, width - 1))
  const cellY = Math.max(1, ((((dem.north - dem.south) * Math.PI) / 180) * 6378137) / Math.max(1, height - 1))
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const i = r * width + c
      const cL = c > 0 ? c - 1 : c
      const cR = c < width - 1 ? c + 1 : c
      const rU = r > 0 ? r - 1 : r
      const rD = r < height - 1 ? r + 1 : r
      const gx = (values[r * width + cR] - values[r * width + cL]) / (2 * cellX)
      const gy = (values[rU * width + c] - values[rD * width + c]) / (2 * cellY)
      const t = Math.hypot(gx, gy)
      tan[i] = t
      slopeDeg[i] = (Math.atan(t) * 180) / Math.PI
      let ang = (Math.atan2(-gx, -gy) * 180) / Math.PI
      if (ang < 0) ang += 360
      aspectDeg[i] = t < 1e-4 ? -1 : ang
    }
  }
  return { tan, slopeDeg, aspectDeg }
}

export function hillshadeGrid(dem: DemData, sunAzimuth: number, sunAltitude: number): Float32Array {
  const { width, height, values } = dem
  const out = new Float32Array(width * height)
  const latRad = ((dem.south + dem.north) * 0.5 * Math.PI) / 180
  const cellX = ((((dem.east - dem.west) * Math.PI) / 180) * 6378137 * Math.cos(latRad)) / Math.max(1, width - 1)
  const cellY = ((((dem.north - dem.south) * Math.PI) / 180) * 6378137) / Math.max(1, height - 1)
  const az = (sunAzimuth * Math.PI) / 180
  const alt = (sunAltitude * Math.PI) / 180
  const sunE = Math.sin(az) * Math.cos(alt)
  const sunN = Math.cos(az) * Math.cos(alt)
  const sunU = Math.sin(alt)
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const i = r * width + c
      const cL = c > 0 ? c - 1 : c
      const cR = c < width - 1 ? c + 1 : c
      const rU = r > 0 ? r - 1 : r
      const rD = r < height - 1 ? r + 1 : r
      const gx = (values[r * width + cR] - values[r * width + cL]) / (2 * cellX)
      const gy = (values[rU * width + c] - values[rD * width + c]) / (2 * cellY)
      const len = Math.hypot(gx, gy, 1)
      const dot = (-gx * sunE - gy * sunN + sunU) / len
      out[i] = clamp01(dot)
    }
  }
  return out
}

export function minOf(values: Float32Array, noData = NaN): number {
  let m = Number.POSITIVE_INFINITY
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]
    if (Number.isFinite(v) && !(Number.isFinite(noData) && v === noData) && v < m) m = v
  }
  return Number.isFinite(m) ? m : 0
}

export function maxOf(values: Float32Array, noData = NaN): number {
  let m = Number.NEGATIVE_INFINITY
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]
    if (Number.isFinite(v) && !(Number.isFinite(noData) && v === noData) && v > m) m = v
  }
  return Number.isFinite(m) ? m : 1
}

export function maxAbs(values: Float32Array): number {
  let m = 0
  for (let i = 0; i < values.length; i += 1) {
    const v = Math.abs(values[i])
    if (Number.isFinite(v) && v > m) m = v
  }
  return m
}

export type GridStats = {
  count: number
  min: number
  max: number
  mean: number
  median: number
  std: number
  p2: number
  p90: number
  p98: number
}

export function gridStats(values: Float32Array, noData = NaN): GridStats {
  const valid: number[] = []
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]
    if (Number.isFinite(v) && !(Number.isFinite(noData) && v === noData)) valid.push(v)
  }
  if (valid.length === 0) return { count: 0, min: 0, max: 0, mean: 0, median: 0, std: 0, p2: 0, p90: 0, p98: 0 }
  valid.sort((a, b) => a - b)
  const n = valid.length
  const mean = valid.reduce((sum, v) => sum + v, 0) / n
  let varSum = 0
  for (const v of valid) varSum += (v - mean) * (v - mean)
  const quantile = (p: number): number => valid[Math.max(0, Math.min(n - 1, Math.floor(p * (n - 1))))]
  return {
    count: n,
    min: valid[0],
    max: valid[n - 1],
    mean,
    median: quantile(0.5),
    std: Math.sqrt(varSum / n),
    p2: quantile(0.02),
    p90: quantile(0.9),
    p98: quantile(0.98)
  }
}

/** 计算分级断点（不含首尾），返回长度 count-1 的升序数组 */
export function classBreaks(values: Float32Array, method: 'equal' | 'quantile' | 'jenks', count: number, noData = NaN): number[] {
  const valid: number[] = []
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]
    if (Number.isFinite(v) && !(Number.isFinite(noData) && v === noData)) valid.push(v)
  }
  if (valid.length === 0 || count <= 1) return []
  valid.sort((a, b) => a - b)
  const n = valid.length
  const min = valid[0]
  const max = valid[n - 1]
  const breaks: number[] = []
  if (method === 'equal') {
    for (let k = 1; k < count; k += 1) breaks.push(min + (k * (max - min)) / count)
    return breaks
  }
  if (method === 'quantile') {
    for (let k = 1; k < count; k += 1) {
      const idx = Math.min(n - 1, Math.floor((k / count) * n))
      breaks.push(valid[idx])
    }
    return breaks
  }
  // Jenks 自然断点（经典一维动态规划）
  const classes = Math.min(count, n)
  if (classes <= 2) return [valid[Math.floor(n / 2)]]
  const lower = Array.from({ length: n + 1 }, () => new Array<number>(classes + 1).fill(0))
  const variance = Array.from({ length: n + 1 }, () => new Array<number>(classes + 1).fill(0))
  for (let i = 1; i <= classes; i += 1) {
    lower[1][i] = 1
    variance[1][i] = 0
    for (let j = 2; j <= n; j += 1) variance[j][i] = Number.POSITIVE_INFINITY
  }
  let v = 0
  for (let l = 1; l <= n; l += 1) {
    let s1 = 0
    let s2 = 0
    let w = 0
    for (let m = 1; m <= l; m += 1) {
      const i3 = l - m + 1
      const val = valid[i3 - 1]
      w += 1
      s2 += val * val
      s1 += val
      v = s2 - (s1 * s1) / w
      const i4 = i3 - 1
      if (i4 !== 0) {
        for (let j = 2; j <= classes; j += 1) {
          if (variance[l][j] >= v + variance[i4][j - 1]) {
            lower[l][j] = i3
            variance[l][j] = v + variance[i4][j - 1]
          }
        }
      }
    }
    lower[l][1] = 1
    variance[l][1] = v
  }
  const kclass = new Array<number>(classes + 1).fill(0)
  kclass[classes] = valid[n - 1]
  kclass[0] = valid[0]
  let k = classes
  let kTemp = n
  while (k > 1) {
    const idx = lower[kTemp][k] - 2
    kclass[k - 1] = valid[Math.max(0, idx)]
    kTemp = lower[kTemp][k] - 1
    k -= 1
  }
  for (let i = 1; i < classes; i += 1) breaks.push(kclass[i])
  return breaks
}

export function rgbCss(rgb: [number, number, number]): string {
  return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`
}
