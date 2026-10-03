/**
 * 火灾烟气与温度三维体分析封装 —— 把 Worker 的危险区统计 / 阈值等值面 / 垂向剖面
 * 包装成类型安全调用，并绘制火源垂向温度—烟气曲线。
 */

import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'

export type FireVec3 = [number, number, number]
export type FireChannel = 'temp' | 'smoke' | 'visibility'

export type FireImpact = { id: string; temp: number; smoke: number }

export type FireStatsResult = {
  tempThreshold: number
  smokeThreshold: number
  dangerVolumeM3: number
  smokeVolumeM3: number
  maxTemp: number
  plumeTopM: number
  downwindM: number
  maxPos: number[]
  impacts: FireImpact[]
  sampleCount: number
}

export type FireProfileResult = {
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

export function runFireStats(
  engine: VolumeEngine,
  options: { tempThreshold: number; smokeThreshold: number; volSize: FireVec3; buildings: { id: string; x: number; y: number }[]; res?: number; vres?: number }
): Promise<FireStatsResult> {
  return engine.analyze<FireStatsResult>({
    mode: 'fire',
    tempThreshold: options.tempThreshold,
    smokeThreshold: options.smokeThreshold,
    volSize: options.volSize,
    buildings: options.buildings,
    res: options.res ?? 44,
    vres: options.vres ?? 40
  })
}

export function runFireIso(engine: VolumeEngine, channel: FireChannel, iso: number, volSize: FireVec3, res = 56): Promise<IsoResult> {
  return engine.analyze<IsoResult>({ mode: 'isosurface', channel, iso, res, volSize })
}

export function runFireProfile(engine: VolumeEngine, x: number, y: number, channel: FireChannel, levels = 60): Promise<FireProfileResult> {
  return engine.analyze<FireProfileResult>({ mode: 'profile', channel, x, y, levels })
}

/** 火源垂向剖面：温度 / 烟气浓度随高度的变化，标注危险阈值 */
export function drawFireProfile(canvas: HTMLCanvasElement, profile: FireProfileResult, valueMax: number, threshold: number, channelLabel: string): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const pad = 8
  const hToY = (z: number) => h - pad - (h - pad * 2) * z
  const vToX = (v: number) => pad + (w - pad * 2) * Math.min(1, Math.max(0, v / Math.max(1e-6, valueMax)))
  ctx.strokeStyle = 'rgba(157,188,224,0.16)'
  for (let g = 0; g <= 3; g += 1) {
    const y = hToY(g / 3)
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(w - pad, y)
    ctx.stroke()
  }
  if (threshold > 0) {
    ctx.strokeStyle = 'rgba(255,90,60,0.6)'
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(vToX(threshold), pad)
    ctx.lineTo(vToX(threshold), h - pad)
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.strokeStyle = channelLabel.includes('烟气') ? '#b9b2a6' : '#ff8a3c'
  ctx.lineWidth = 1.8
  ctx.beginPath()
  let started = false
  for (let i = 0; i < profile.levels; i += 1) {
    if (!profile.valid[i]) {
      started = false
      continue
    }
    const x = vToX(profile.values[i])
    const y = hToY((i + 0.5) / profile.levels)
    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
}
