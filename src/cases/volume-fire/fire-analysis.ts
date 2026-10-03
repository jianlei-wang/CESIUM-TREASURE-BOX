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
  /** 风险分级体积（安全 / 关注 / 警戒 / 高危 / 极高危），单位 m³ */
  bandsM3: number[]
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
  options: {
    tempThreshold: number
    smokeThreshold: number
    volSize: FireVec3
    buildings: { id: string; x: number; y: number; height?: number }[]
    riskTemp?: number[]
    riskSmoke?: number[]
    res?: number
    vres?: number
  }
): Promise<FireStatsResult> {
  return engine.analyze<FireStatsResult>({
    mode: 'fire',
    tempThreshold: options.tempThreshold,
    smokeThreshold: options.smokeThreshold,
    volSize: options.volSize,
    buildings: options.buildings,
    riskTemp: options.riskTemp,
    riskSmoke: options.riskSmoke,
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

/** 风险分级体积横向条形图：直观展示安全→极高危的体积占比 */
export function drawRiskBars(
  canvas: HTMLCanvasElement,
  bands: number[],
  labels: { label: string; color: string }[]
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const pad = 8
  const rows = Math.max(1, bands.length)
  const rowH = (h - pad * 2) / rows
  const labelW = 38
  const valueW = 44
  const trackX = pad + labelW
  const trackW = w - trackX - valueW
  const barH = Math.min(rowH - 6, 13)
  const maxV = Math.max(1, ...bands)
  ctx.textBaseline = 'middle'
  ctx.font = '11px sans-serif'
  for (let i = 0; i < bands.length; i += 1) {
    const yMid = pad + i * rowH + rowH / 2
    const color = labels[i]?.color ?? '#888'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#cfe0f0'
    ctx.fillText(labels[i]?.label ?? '', pad, yMid)
    ctx.fillStyle = 'rgba(157,188,224,0.16)'
    ctx.fillRect(trackX, yMid - barH / 2, trackW, barH)
    const barW = trackW * (bands[i] / maxV)
    if (barW > 0) {
      ctx.fillStyle = color
      ctx.fillRect(trackX, yMid - barH / 2, Math.max(2, barW), barH)
    }
    ctx.textAlign = 'right'
    ctx.fillStyle = bands[i] > 0 ? '#ffd0a8' : '#7f96b3'
    ctx.fillText((bands[i] / 10000).toFixed(1), w - pad, yMid)
  }
}
