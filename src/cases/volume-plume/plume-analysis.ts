/**
 * 地下水污染羽流分析封装 —— 把 Worker 的羽流统计 / 井孔剖面分析包装成类型安全调用，
 * 并把沿井孔的垂向浓度曲线绘制为 canvas 图表。
 */

import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'

export type PlumeVec3 = [number, number, number]

export type PlumeAquiferStat = { code: number; above: number; fraction: number }

export type PlumeStatsResult = {
  threshold: number
  volumeM3: number
  areaM2: number
  frontDistanceM: number
  maxConc: number
  meanConc: number
  maxPos: number[]
  aquiferStats: PlumeAquiferStat[]
  sampleCount: number
}

export type PlumeProfileResult = {
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

export function runPlumeStats(
  engine: VolumeEngine,
  options: { channel: string; threshold: number; volSize: PlumeVec3; res?: number; vres?: number }
): Promise<PlumeStatsResult> {
  return engine.analyze<PlumeStatsResult>({
    mode: 'plume',
    channel: options.channel,
    threshold: options.threshold,
    volSize: options.volSize,
    res: options.res ?? 40,
    vres: options.vres ?? 48
  })
}

export function runPlumeProfile(engine: VolumeEngine, x: number, y: number, channel: string, levels = 56): Promise<PlumeProfileResult> {
  return engine.analyze<PlumeProfileResult>({ mode: 'profile', channel, x, y, levels })
}

export function runPlumeIso(engine: VolumeEngine, channel: string, iso: number, volSize: PlumeVec3, res = 56): Promise<IsoResult> {
  return engine.analyze<IsoResult>({ mode: 'isosurface', channel, iso, res, volSize })
}

/** 沿井孔的垂向浓度曲线：浓度随埋深（地表→孔底）变化，标注风险阈值 */
export function drawWellProfile(canvas: HTMLCanvasElement, profile: PlumeProfileResult, valueMax: number, threshold: number): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const pad = 8
  const levels = profile.levels
  const zToY = (z: number) => pad + (h - pad * 2) * z
  const vToX = (v: number) => pad + (w - pad * 2) * Math.min(1, v / Math.max(1, valueMax))
  ctx.strokeStyle = 'rgba(157,188,224,0.16)'
  ctx.lineWidth = 1
  for (let g = 0; g <= 3; g += 1) {
    const y = zToY(g / 3)
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(w - pad, y)
    ctx.stroke()
  }
  if (threshold > 0) {
    ctx.strokeStyle = 'rgba(255,90,60,0.55)'
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(vToX(threshold), pad)
    ctx.lineTo(vToX(threshold), h - pad)
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.strokeStyle = '#ffd21e'
  ctx.lineWidth = 1.8
  ctx.beginPath()
  let started = false
  for (let i = 0; i < levels; i += 1) {
    if (!profile.valid[i]) {
      started = false
      continue
    }
    const x = vToX(profile.values[i])
    const y = zToY((i + 0.5) / levels)
    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
}
