import type { AnalysisResult, DemData } from './hydrology'

export type SurfaceMode =
  | 'elevation'
  | 'hillshade'
  | 'slope'
  | 'aspect'
  | 'focalMean'
  | 'difference'
  | 'terrainClass'
  | 'flowDir'
  | 'flowAcc'
  | 'flowAccZero'
  | 'neighborAcc'
  | 'inverseFlowDir'
  | 'inverseFlowAcc'
  | 'inverseAccZero'
  | 'inverseNeighborAcc'
  | 'ridgeMask'
  | 'valleyMask'
  | 'ridgeSkeleton'
  | 'valleySkeleton'
  | 'combined'

export type SurfaceModeGroup = {
  label: string
  modes: { id: SurfaceMode; label: string }[]
}

export const SURFACE_MODE_GROUPS: SurfaceModeGroup[] = [
  {
    label: '地形基础',
    modes: [
      { id: 'elevation', label: '高程着色' },
      { id: 'hillshade', label: '晕渲' },
      { id: 'slope', label: '坡度' },
      { id: 'aspect', label: '坡向' }
    ]
  },
  {
    label: '正负地形',
    modes: [
      { id: 'focalMean', label: '焦点均值' },
      { id: 'difference', label: '高程差值' },
      { id: 'terrainClass', label: '正负地形' }
    ]
  },
  {
    label: '山脊链',
    modes: [
      { id: 'flowDir', label: '流向(D8)' },
      { id: 'flowAcc', label: '汇流累积' },
      { id: 'flowAccZero', label: '零汇流候选' },
      { id: 'neighborAcc', label: '邻域统计' },
      { id: 'ridgeMask', label: '山脊栅格' },
      { id: 'ridgeSkeleton', label: '山脊骨架' }
    ]
  },
  {
    label: '山谷链',
    modes: [
      { id: 'inverseFlowDir', label: '反地形流向' },
      { id: 'inverseFlowAcc', label: '反地形汇流' },
      { id: 'inverseAccZero', label: '反地形零汇流' },
      { id: 'inverseNeighborAcc', label: '反地形邻域' },
      { id: 'valleyMask', label: '山谷栅格' },
      { id: 'valleySkeleton', label: '山谷骨架' }
    ]
  },
  {
    label: '综合',
    modes: [{ id: 'combined', label: '提取结果叠加' }]
  }
]

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
  ]
}

function buildLut(stops: Stop[]): Uint8ClampedArray {
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

function lutColor(lut: Uint8ClampedArray, t: number): [number, number, number] {
  let idx = Math.round(clamp01(t) * 255)
  if (idx < 0) idx = 0
  if (idx > 255) idx = 255
  return [lut[idx * 3], lut[idx * 3 + 1], lut[idx * 3 + 2]]
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
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

export type RasterRenderOptions = {
  mode: SurfaceMode
  hillshadeStrength: number
  sunAzimuth: number
  sunAltitude: number
  ridgeColor: string
  valleyColor: string
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const num = parseInt(full, 16)
  if (!Number.isFinite(num)) return [255, 80, 60]
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

function hillshadeGrid(dem: DemData, sunAzimuth: number, sunAltitude: number): Float32Array {
  const { width, height, values } = dem
  const out = new Float32Array(width * height)
  const latRad = ((dem.south + dem.north) * 0.5 * Math.PI) / 180
  const cellX = (((dem.east - dem.west) * Math.PI) / 180) * 6378137 * Math.cos(latRad) / Math.max(1, width - 1)
  const cellY = (((dem.north - dem.south) * Math.PI) / 180) * 6378137 / Math.max(1, height - 1)
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

export function renderRasterCanvas(dem: DemData, result: AnalysisResult, options: RasterRenderOptions): HTMLCanvasElement {
  const { width, height } = dem
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const image = ctx.createImageData(width, height)
  const data = image.data
  const shade = hillshadeGrid(dem, options.sunAzimuth, options.sunAltitude)
  const strength = clamp01(options.hillshadeStrength)
  const luts = {
    terrain: buildLut(RAMPS.terrain),
    thermal: buildLut(RAMPS.thermal),
    diverging: buildLut(RAMPS.diverging),
    gray: buildLut(RAMPS.gray)
  }
  const ridgeRgb = hexToRgb(options.ridgeColor)
  const valleyRgb = hexToRgb(options.valleyColor)

  const mode = options.mode
  const maxAcc = maxOf(result.flowAcc)
  const maxInvAcc = maxOf(result.inverseFlowAcc)
  const logMax = Math.log1p(maxAcc)
  const logMaxInv = Math.log1p(maxInvAcc)
  const elevSpan = Math.max(1e-6, dem.maxHeight - dem.minHeight)
  const focalMin = minOf(result.focalMean)
  const focalSpan = Math.max(1e-6, maxOf(result.focalMean) - focalMin)
  const diffAbs = Math.max(1e-6, maxAbs(result.diff))

  for (let i = 0; i < width * height; i += 1) {
    const h = dem.values[i]
    let rgb: [number, number, number]
    switch (mode) {
      case 'elevation':
        rgb = lutColor(luts.terrain, (h - dem.minHeight) / elevSpan)
        break
      case 'hillshade':
        rgb = lutColor(luts.gray, shade[i])
        break
      case 'slope':
        rgb = lutColor(luts.thermal, slopeAt(dem, i, width, height) / 60)
        break
      case 'aspect':
        rgb = aspectColor(dem, i, width, height)
        break
      case 'focalMean':
        rgb = lutColor(luts.terrain, (result.focalMean[i] - focalMin) / focalSpan)
        break
      case 'difference':
        rgb = lutColor(luts.diverging, 0.5 + (0.5 * result.diff[i]) / diffAbs)
        break
      case 'terrainClass':
        rgb = result.zdx[i] ? [46, 160, 90] : result.fdx[i] ? [58, 120, 220] : [30, 38, 48]
        break
      case 'flowDir':
        rgb = result.flowDir[i] === 0 ? [26, 30, 38] : hsvToRgb(dirHue(result.flowDir[i]), 0.85, 0.85 + 0.15 * shade[i])
        break
      case 'inverseFlowDir':
        rgb = result.inverseFlowDir[i] === 0 ? [26, 30, 38] : hsvToRgb(dirHue(result.inverseFlowDir[i]), 0.85, 0.85 + 0.15 * shade[i])
        break
      case 'flowAcc':
        rgb = lutColor(luts.thermal, Math.log1p(result.flowAcc[i]) / logMax)
        break
      case 'inverseFlowAcc':
        rgb = lutColor(luts.thermal, Math.log1p(result.inverseFlowAcc[i]) / logMaxInv)
        break
      case 'flowAccZero':
        rgb = result.flowAccZero[i] ? [250, 210, 70] : [22, 28, 38]
        break
      case 'inverseAccZero':
        rgb = result.inverseAccZero[i] ? [120, 220, 250] : [22, 28, 38]
        break
      case 'neighborAcc':
        rgb = lutColor(luts.thermal, result.neighborAcc[i])
        break
      case 'inverseNeighborAcc':
        rgb = lutColor(luts.thermal, result.inverseNeighborAcc[i])
        break
      case 'ridgeMask':
        rgb = result.ridgeMask[i] ? ridgeRgb : [22, 28, 38]
        break
      case 'valleyMask':
        rgb = result.valleyMask[i] ? valleyRgb : [22, 28, 38]
        break
      case 'ridgeSkeleton':
        rgb = result.ridgeSkeleton[i] ? ridgeRgb : [22, 28, 38]
        break
      case 'valleySkeleton':
        rgb = result.valleySkeleton[i] ? valleyRgb : [22, 28, 38]
        break
      default: {
        const base = 46 + 190 * Math.pow(shade[i], 0.85)
        let r = base
        let g = base
        let b = base
        if (result.ridgeMask[i]) {
          r = ridgeRgb[0]
          g = ridgeRgb[1]
          b = ridgeRgb[2]
        } else if (result.valleyMask[i]) {
          r = valleyRgb[0]
          g = valleyRgb[1]
          b = valleyRgb[2]
        }
        rgb = [r, g, b]
      }
    }
    if (mode !== 'combined' && mode !== 'terrainClass' && mode !== 'ridgeMask' && mode !== 'valleyMask' && mode !== 'ridgeSkeleton' && mode !== 'valleySkeleton' && mode !== 'flowAccZero' && mode !== 'inverseAccZero') {
      const s = 1 - strength + strength * (0.35 + 0.65 * shade[i])
      rgb = [rgb[0] * s, rgb[1] * s, rgb[2] * s]
    }
    const p = i * 4
    data[p] = rgb[0]
    data[p + 1] = rgb[1]
    data[p + 2] = rgb[2]
    data[p + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

function dirHue(code: number): number {
  const index = [1, 2, 4, 8, 16, 32, 64, 128].indexOf(code)
  if (index < 0) return 0
  return index / 8
}

function slopeAt(dem: DemData, i: number, width: number, height: number): number {
  const r = (i / width) | 0
  const c = i - r * width
  const latRad = ((dem.south + dem.north) * 0.5 * Math.PI) / 180
  const cellX = (((dem.east - dem.west) * Math.PI) / 180) * 6378137 * Math.cos(latRad) / Math.max(1, width - 1)
  const cellY = (((dem.north - dem.south) * Math.PI) / 180) * 6378137 / Math.max(1, height - 1)
  const cL = c > 0 ? c - 1 : c
  const cR = c < width - 1 ? c + 1 : c
  const rU = r > 0 ? r - 1 : r
  const rD = r < height - 1 ? r + 1 : r
  const gx = (dem.values[r * width + cR] - dem.values[r * width + cL]) / (2 * cellX)
  const gy = (dem.values[rU * width + c] - dem.values[rD * width + c]) / (2 * cellY)
  return (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI
}

function aspectColor(dem: DemData, i: number, width: number, height: number): [number, number, number] {
  const r = (i / width) | 0
  const c = i - r * width
  const latRad = ((dem.south + dem.north) * 0.5 * Math.PI) / 180
  const cellX = (((dem.east - dem.west) * Math.PI) / 180) * 6378137 * Math.cos(latRad) / Math.max(1, width - 1)
  const cellY = (((dem.north - dem.south) * Math.PI) / 180) * 6378137 / Math.max(1, height - 1)
  const cL = c > 0 ? c - 1 : c
  const cR = c < width - 1 ? c + 1 : c
  const rU = r > 0 ? r - 1 : r
  const rD = r < height - 1 ? r + 1 : r
  const gx = (dem.values[r * width + cR] - dem.values[r * width + cL]) / (2 * cellX)
  const gy = (dem.values[rU * width + c] - dem.values[rD * width + c]) / (2 * cellY)
  let ang = Math.atan2(-gx, -gy)
  if (ang < 0) ang += Math.PI * 2
  return hsvToRgb(ang / (Math.PI * 2), 0.72, 0.92)
}

function minOf(values: Float32Array): number {
  let m = Number.POSITIVE_INFINITY
  for (let i = 0; i < values.length; i += 1) if (Number.isFinite(values[i]) && values[i] < m) m = values[i]
  return Number.isFinite(m) ? m : 0
}

function maxOf(values: Float32Array): number {
  let m = Number.NEGATIVE_INFINITY
  for (let i = 0; i < values.length; i += 1) if (Number.isFinite(values[i]) && values[i] > m) m = values[i]
  return Number.isFinite(m) ? m : 1
}

function maxAbs(values: Float32Array): number {
  let m = 0
  for (let i = 0; i < values.length; i += 1) {
    const v = Math.abs(values[i])
    if (Number.isFinite(v) && v > m) m = v
  }
  return m
}
