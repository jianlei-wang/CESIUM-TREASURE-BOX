import type { DemData } from './hydrology'

export type TerrainPresetId = 'ridgeFold' | 'dendritic' | 'volcano' | 'plateau'

export type TerrainPreset = {
  id: TerrainPresetId
  label: string
  description: string
  west: number
  east: number
  south: number
  north: number
  baseHeight: number
  relief: number
  seed: number
}

export const TERRAIN_PRESETS: TerrainPreset[] = [
  {
    id: 'ridgeFold',
    label: '褶皱山脊',
    description: '强褶皱造山带，山脊连续、谷地平行，适合检验分水线提取',
    west: 100.1,
    east: 100.42,
    south: 27.58,
    north: 27.9,
    baseHeight: 2400,
    relief: 2200,
    seed: 20260918
  },
  {
    id: 'dendritic',
    label: '丘陵沟谷',
    description: '树枝状水系发育的缓丘，谷网细密、山脊短促',
    west: 103.2,
    east: 103.56,
    south: 30.88,
    north: 31.2,
    baseHeight: 900,
    relief: 900,
    seed: 77123
  },
  {
    id: 'volcano',
    label: '火山锥体',
    description: '中心火山锥加放射状冲沟，环形山脊围绕火山口',
    west: 99.06,
    east: 99.46,
    south: 25.18,
    north: 25.58,
    baseHeight: 1600,
    relief: 1400,
    seed: 42317
  },
  {
    id: 'plateau',
    label: '高原沟壑',
    description: '平坦高原面被深切成峡谷，谷线平直、脊线稀少',
    west: 98.48,
    east: 98.92,
    south: 30.48,
    north: 30.86,
    baseHeight: 1800,
    relief: 1200,
    seed: 90211
  }
]

export const DEM_RESOLUTIONS = [96, 128, 160, 192, 256]

function fade(t: number): number {
  return t * t * (3 - 2 * t)
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function makeRandom(seed: number): (x: number, y: number) => number {
  return (x: number, y: number): number => {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 362437)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h ^= h >>> 16
    return ((h >>> 0) / 4294967295) * 2 - 1
  }
}

function makeNoise(seed: number): (x: number, y: number) => number {
  const rand = makeRandom(seed)
  return (x: number, y: number): number => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = fade(x - x0)
    const fy = fade(y - y0)
    const n00 = rand(x0, y0)
    const n10 = rand(x0 + 1, y0)
    const n01 = rand(x0, y0 + 1)
    const n11 = rand(x0 + 1, y0 + 1)
    const nx0 = n00 + (n10 - n00) * fx
    const nx1 = n01 + (n11 - n01) * fx
    return nx0 + (nx1 - nx0) * fy
  }
}

function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves: number): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let freq = 1
  for (let o = 0; o < octaves; o += 1) {
    sum += noise(x * freq, y * freq) * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

function ridged(noise: (x: number, y: number) => number, x: number, y: number, octaves: number): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let freq = 1
  let weight = 1
  for (let o = 0; o < octaves; o += 1) {
    let n = 1 - Math.abs(noise(x * freq, y * freq))
    n *= n
    n *= weight
    weight = clamp01(n * 2)
    sum += n * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

function terrainHeight(preset: TerrainPresetId, seed: number, x: number, y: number): number {
  const noise = makeNoise(seed)
  if (preset === 'ridgeFold') {
    const base = fbm(noise, x * 2.2, y * 2.2, 5)
    const r = ridged(noise, x * 2.6 + 11.3, y * 2.6 - 7.1, 5)
    return clamp01(0.32 * (base * 0.5 + 0.5) + 0.78 * r)
  }
  if (preset === 'dendritic') {
    const base = fbm(noise, x * 1.7, y * 1.7, 5)
    const fine = ridged(noise, x * 4.5 + 3.7, y * 4.5 + 9.2, 3)
    return clamp01(0.5 + 0.42 * base - 0.28 * fine)
  }
  if (preset === 'volcano') {
    const dx = x - 0.5
    const dy = y - 0.5
    const r = Math.hypot(dx, dy)
    const cone = clamp01(1 - Math.pow(r * 2.05, 1.15))
    const crater = Math.exp(-Math.pow((r - 0.16) * 16, 2)) * 0.42
    const flank = ridged(noise, x * 5.5 + 5.1, y * 5.5 + 2.9, 4) * (0.34 * clamp01(1 - r * 1.6))
    return clamp01(cone + flank - crater)
  }
  const dx = x - 0.5
  const dy = y - 0.5
  const r = Math.hypot(dx, dy)
  const plateau = 0.72 * (1 - fade(clamp01((r - 0.28) / 0.24)))
  const base = fbm(noise, x * 2.4, y * 2.4, 4)
  const canyon = ridged(noise, x * 3.6 + 17.2, y * 3.6 + 4.8, 4)
  const carve = Math.pow(canyon, 2.4) * (1 - clamp01((r - 0.34) / 0.2))
  return clamp01(0.28 + plateau + 0.12 * base - 0.55 * carve)
}

export function generateDem(preset: TerrainPreset, resolution: number): DemData {
  const width = resolution
  const height = resolution
  const values = new Float32Array(width * height)
  const spanX = preset.east - preset.west
  const spanY = preset.north - preset.south
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const x = c / (width - 1)
      const y = r / (height - 1)
      const n = terrainHeight(preset.id, preset.seed, x, y)
      values[r * width + c] = preset.baseHeight + n * preset.relief
    }
  }
  void spanX
  void spanY
  return finalizeDem(values, width, height, preset.west, preset.east, preset.south, preset.north, preset.label)
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
  if (count === 0) {
    minHeight = 0
    maxHeight = 0
  }
  return {
    width,
    height,
    values,
    west,
    east,
    south,
    north,
    minHeight,
    maxHeight,
    meanHeight: count > 0 ? sum / count : 0,
    source
  }
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
  return finalizeDem(values, targetWidth, targetHeight, 100.1, 100.42, 27.58, 27.9, source)
}

export function extentCenter(dem: DemData): { lon: number; lat: number } {
  return { lon: (dem.west + dem.east) / 2, lat: (dem.south + dem.north) / 2 }
}
