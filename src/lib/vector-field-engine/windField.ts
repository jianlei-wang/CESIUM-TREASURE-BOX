/**
 * Vector Field Engine —— 三维风场语义与数据构建
 *
 * 三维风场案例的单一数据源：主线程的 GPGPU 粒子层与 Worker 中的标量体、流线、
 * 廓线共享同一套参数化（基准风速 / 气象风向 / 涡旋 / 阵风）生成 u/v/w，
 * 避免「体渲染看一套、粒子跑另一套」的语义割裂。
 *
 * 坐标约定（ENU，单位 m/s）：
 *   u → 东向分量，v → 北向分量，w → 垂直分量。
 *
 * 风向约定（气象）：baseDir 表示风的「来向」（0° 正北，顺时针为正），
 *   因此水平流速矢量指向 baseDir + 180°，与风羽/风玫瑰的读法一致。
 *
 * 说明：本文件的解析式场函数与 volume-worker-source.ts 中的 windVector 保持一致，
 *   两侧参数与公式同步修改，保证体数据与粒子流表达同一片风场。
 */

import { computeSpeedFromComponents } from './utils'
import type { WindData3D } from './types'

export type WindFieldParams = {
  /** 基准风速（m/s） */
  baseSpeed: number
  /** 气象风向：风的来向（度，0 正北，顺时针） */
  baseDir: number
  /** 水平涡旋数量 */
  vortices: number
  /** 阵风强度（0~1 比例） */
  gust: number
  /** 涡旋分布的随机种子 */
  seed: number
}

export const DEFAULT_WIND_FIELD_PARAMS: WindFieldParams = {
  baseSpeed: 9,
  baseDir: 235,
  vortices: 3,
  gust: 0.25,
  seed: 20260928
}

export type WindVortex = {
  x: number
  y: number
  radius: number
  strength: number
}

export type WindSample = { u: number; v: number; w: number }

/** 与 Worker 一致的确定性伪随机数发生器 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 按参数生成水平涡旋。与 Worker prepare('wind') 使用相同种子与顺序，
 * 因此主线程 GPGPU 层与 Worker 场得到完全一致的涡旋分布。
 */
export function createWindVortices(params: Partial<WindFieldParams>): WindVortex[] {
  const p = { ...DEFAULT_WIND_FIELD_PARAMS, ...params }
  const rand = mulberry32(p.seed || 1)
  const count = Math.max(0, Math.round(p.vortices || 0))
  const vortices: WindVortex[] = []
  for (let i = 0; i < count; i += 1) {
    vortices.push({
      x: 0.2 + 0.6 * rand(),
      y: 0.2 + 0.6 * rand(),
      radius: 0.08 + 0.1 * rand(),
      strength: (rand() > 0.5 ? 1 : -1) * (0.5 + 0.8 * rand())
    })
  }
  return vortices
}

/**
 * 在归一化体域坐标 (0~1) 处采样风场。baseDir 为来向，水平流速指向下游。
 * 与 volume-worker-source.ts::windVector 保持逐式对应。
 */
export function sampleWindField(
  nx: number,
  ny: number,
  nz: number,
  params: Partial<WindFieldParams>,
  vortices: WindVortex[]
): WindSample {
  const p = { ...DEFAULT_WIND_FIELD_PARAMS, ...params }
  const sp = p.baseSpeed
  const flowDir = (p.baseDir * Math.PI) / 180 + Math.PI
  const shear = 0.4 + 0.6 * Math.pow(nz, 0.6)
  const meander = 0.14 * Math.sin(nx * 3.1 + nz * 2.0) + 0.1 * Math.cos(ny * 2.7)
  const dir = flowDir + meander

  let u = Math.cos(dir) * sp * shear
  let v = Math.sin(dir) * sp * shear
  let w = 0

  for (let i = 0; i < vortices.length; i += 1) {
    const vortex = vortices[i]
    const dx = nx - vortex.x
    const dy = ny - vortex.y
    const d2 = dx * dx + dy * dy
    const g = vortex.strength * Math.exp(-d2 / (2 * vortex.radius * vortex.radius)) * 8
    u += -dy * g
    v += dx * g
    w += vortex.strength * 0.8 * Math.sin((nx + ny) * 6.283) * nz
  }

  u += p.gust * sp * Math.sin(nx * 7.3 + nz * 5.1) * (0.4 + nz)
  v += p.gust * sp * Math.cos(ny * 6.7 + nz * 4.3) * (0.4 + nz)
  w += p.gust * sp * 0.35 * Math.sin((nx + ny) * 5.5) * (0.3 + nz)

  return { u, v, w }
}

export type BuildWindDataOptions = {
  params?: Partial<WindFieldParams>
  /** 体域中心经纬度；height 为 ENU 锚点海拔，缺省 0 */
  center: { lon: number; lat: number; height?: number }
  /** 体域尺寸（米）：base 为底面相对锚点高度，height 为垂向厚度 */
  volume: { width: number; depth: number; height: number; base: number }
  nx: number
  ny: number
  nz: number
  /** 垂向层高（米，绝对海拔）；缺省按 anchor+base..anchor+base+height 等距生成 */
  levels?: number[]
}

/** 由体域尺寸推算以中心点为准的经纬度范围（米→度，按中心纬度取经度尺度） */
export function volumeBounds(center: { lon: number; lat: number }, volume: { width: number; depth: number }): {
  west: number
  south: number
  east: number
  north: number
} {
  const latSpan = volume.depth / 111132
  const lonSpan = volume.width / (111412 * Math.cos((center.lat * Math.PI) / 180))
  return {
    west: center.lon - lonSpan / 2,
    east: center.lon + lonSpan / 2,
    south: center.lat - latSpan / 2,
    north: center.lat + latSpan / 2
  }
}

/**
 * 在与 Worker 标量体相同的体域上，构建供 GPGPU 粒子层使用的 WindData3D。
 * u/v/w 的网格布局为 x 最快、其次 y、最后 z，与 Texture3D 采样一致。
 */
export function buildWindData3D(options: BuildWindDataOptions): WindData3D {
  const { nx, ny, nz, center, volume } = options
  if (!(nx > 1 && ny > 1 && nz > 1)) throw new Error('风场网格维度需大于 1')

  const params = { ...DEFAULT_WIND_FIELD_PARAMS, ...options.params }
  const vortices = createWindVortices(params)

  const anchorZ = center.height ?? 0
  const levels =
    options.levels && options.levels.length === nz
      ? options.levels.slice()
      : Array.from({ length: nz }, (_, i) => anchorZ + volume.base + (volume.height * i) / (nz - 1))

  const total = nx * ny * nz
  const u = new Float32Array(total)
  const v = new Float32Array(total)
  const w = new Float32Array(total)

  for (let z = 0; z < nz; z += 1) {
    const zNorm = nz === 1 ? 0 : z / (nz - 1)
    for (let y = 0; y < ny; y += 1) {
      const yNorm = y / (ny - 1)
      for (let x = 0; x < nx; x += 1) {
        const xNorm = x / (nx - 1)
        const index = (z * ny + y) * nx + x
        const sample = sampleWindField(xNorm, yNorm, zNorm, params, vortices)
        u[index] = sample.u
        v[index] = sample.v
        w[index] = sample.w
      }
    }
  }

  const speed = computeSpeedFromComponents(u, v, w)

  return {
    u: { array: u },
    v: { array: v },
    w: { array: w },
    speed,
    nx,
    ny,
    nz,
    bounds: volumeBounds(center, volume),
    levels
  }
}
