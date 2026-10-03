/**
 * 三维矿体品位分析封装 —— 把 Worker 的块体模型统计 / 品位等值面 / 勘探线剖面
 * 包装成类型安全调用，并绘制品位直方图与沿孔品位曲线。
 */

import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'

export type MiningVec3 = [number, number, number]
export type MiningElement = 'cu' | 'au' | 'fe'

export type MiningStatsResult = {
  channel: string
  cutoff: number
  density: number
  oreVolumeM3: number
  tonnage: number
  avgGrade: number
  maxGrade: number
  meanGrade: number
  metalAmount: number
  metalUnit: string
  oreFraction: number
  maxPos: number[]
  bins: Float64Array
  sampleCount: number
}

export type MiningProfileResult = {
  x: number
  y: number
  levels: number
  values: Float32Array
  valid: Uint8Array
  u: Float32Array
  v: Float32Array
  w: Float32Array
}

export type IsoResult = { positions: Float32Array; normals: Float32Array; count: number; res: number; nz?: number }

export function runMiningStats(
  engine: VolumeEngine,
  options: { channel: MiningElement; cutoff: number; density: number; volSize: MiningVec3; res?: number; vres?: number }
): Promise<MiningStatsResult> {
  return engine.analyze<MiningStatsResult>({
    mode: 'mining',
    channel: options.channel,
    cutoff: options.cutoff,
    density: options.density,
    volSize: options.volSize,
    res: options.res ?? 44,
    vres: options.vres ?? 44
  })
}

export function runMiningIso(engine: VolumeEngine, channel: MiningElement, iso: number, volSize: MiningVec3, res = 56): Promise<IsoResult> {
  return engine.analyze<IsoResult>({ mode: 'isosurface', channel, iso, res, volSize })
}

export function runMiningProfile(engine: VolumeEngine, x: number, y: number, channel: MiningElement, levels = 64): Promise<MiningProfileResult> {
  return engine.analyze<MiningProfileResult>({ mode: 'profile', channel, x, y, levels })
}

/** 沿勘探线的品位—标高曲线：`valueMax` 对应当前元素满量程 */
export function drawGradeProfile(canvas: HTMLCanvasElement, profile: MiningProfileResult, valueMax: number, cutoff: number): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const pad = 8
  const zToY = (z: number) => pad + (h - pad * 2) * z
  const vToX = (v: number) => pad + (w - pad * 2) * Math.min(1, Math.max(0, v / Math.max(1e-6, valueMax)))
  ctx.strokeStyle = 'rgba(157,188,224,0.16)'
  for (let g = 0; g <= 3; g += 1) {
    const y = zToY(g / 3)
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(w - pad, y)
    ctx.stroke()
  }
  if (cutoff > 0) {
    ctx.strokeStyle = 'rgba(126,231,135,0.6)'
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(vToX(cutoff), pad)
    ctx.lineTo(vToX(cutoff), h - pad)
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.fillStyle = 'rgba(212,169,74,0.28)'
  const barW = Math.max(1, (w - pad * 2) / profile.levels)
  for (let i = 0; i < profile.levels; i += 1) {
    if (!profile.valid[i]) continue
    const x = vToX(profile.values[i])
    const y = zToY((i + 0.5) / profile.levels)
    ctx.fillRect(pad, y - barW / 2, x - pad, barW * 0.8)
  }
  ctx.strokeStyle = '#ffd21e'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  let started = false
  for (let i = 0; i < profile.levels; i += 1) {
    if (!profile.valid[i]) {
      started = false
      continue
    }
    const x = vToX(profile.values[i])
    const y = zToY((i + 0.5) / profile.levels)
    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
}

/** 品位分布直方图：6 个品位区间内体元占比，绿色标注边界品位所在区间 */
export function drawGradeHistogram(canvas: HTMLCanvasElement, bins: Float64Array, maxVal: number, cutoff: number): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const pad = 8
  let total = 0
  for (let i = 0; i < bins.length; i += 1) total += bins[i]
  const maxBin = Math.max(1, ...Array.from(bins))
  const bw = (w - pad * 2) / bins.length
  for (let i = 0; i < bins.length; i += 1) {
    const frac = bins[i] / maxBin
    const bh = (h - pad * 2 - 10) * frac
    const x = pad + i * bw
    const y = h - pad - bh
    const lo = (i / bins.length) * maxVal
    ctx.fillStyle = lo + 1e-6 >= cutoff ? 'rgba(212,169,74,0.9)' : 'rgba(120,144,176,0.55)'
    ctx.fillRect(x + 1, y, bw - 2, bh)
    if (total > 0 && bins[i] / total > 0.02) {
      ctx.fillStyle = '#c3d5e8'
      ctx.font = '8px sans-serif'
      ctx.fillText(`${Math.round((bins[i] / total) * 100)}%`, x + 1, y - 2)
    }
    ctx.fillStyle = '#7f96b3'
    ctx.font = '8px sans-serif'
    ctx.fillText(lo.toFixed(maxVal > 10 ? 0 : 1), x + 1, h - 2)
  }
}
