/**
 * 海洋温盐深三维体分析封装 —— 把 Worker 的温盐深统计 / 等值面 / 垂向剖面包装成类型安全调用，
 * 并绘制垂向层结曲线与温盐（T-S）散点图。
 */

import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'

export type OceanVec3 = [number, number, number]
export type OceanChannel = 'temperature' | 'salinity' | 'density'

export type OceanStationInput = { id: string; x: number; y: number }

export type OceanStationResult = {
  id: string
  x: number
  y: number
  tSurface: number
  sSurface: number
  rhoSurface: number
  tDeep: number
  sDeep: number
  rhoDeep: number
}

export type OceanStatsResult = {
  channel: string
  minValue: number
  maxValue: number
  meanValue: number
  thermoclineDepthM: number
  profile: Float32Array
  stations: OceanStationResult[]
  sampleCount: number
}

export type OceanProfileResult = {
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

export function runOceanStats(
  engine: VolumeEngine,
  options: { channel: OceanChannel; volSize: OceanVec3; stations: OceanStationInput[]; res?: number; vres?: number }
): Promise<OceanStatsResult> {
  return engine.analyze<OceanStatsResult>({
    mode: 'ocean',
    channel: options.channel,
    volSize: options.volSize,
    stations: options.stations,
    res: options.res ?? 40,
    vres: options.vres ?? 40
  })
}

export function runOceanIso(engine: VolumeEngine, channel: OceanChannel, iso: number, volSize: OceanVec3, res = 56): Promise<IsoResult> {
  return engine.analyze<IsoResult>({ mode: 'isosurface', channel, iso, res, volSize })
}

export function runOceanProfile(engine: VolumeEngine, x: number, y: number, channel: OceanChannel, levels = 64): Promise<OceanProfileResult> {
  return engine.analyze<OceanProfileResult>({ mode: 'profile', channel, x, y, levels })
}

/** 站位垂向层结曲线：变量随深度的变化，标注温跃层深度 */
export function drawOceanProfile(
  canvas: HTMLCanvasElement,
  profile: OceanProfileResult,
  valueMin: number,
  valueMax: number,
  thermoclineDepthM: number,
  totalDepthM: number
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const pad = 8
  const zToY = (z: number) => pad + (h - pad * 2) * z
  const vToX = (v: number) => pad + (w - pad * 2) * Math.max(0, Math.min(1, (v - valueMin) / Math.max(1e-6, valueMax - valueMin)))
  ctx.strokeStyle = 'rgba(157,188,224,0.16)'
  for (let g = 0; g <= 3; g += 1) {
    const y = zToY(g / 3)
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(w - pad, y)
    ctx.stroke()
  }
  if (thermoclineDepthM > 0 && totalDepthM > 0) {
    const y = zToY(Math.max(0, Math.min(1, thermoclineDepthM / totalDepthM)))
    ctx.strokeStyle = 'rgba(57,160,255,0.7)'
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(w - pad, y)
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.strokeStyle = '#65d3eb'
  ctx.lineWidth = 1.8
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

/** 温盐散点图：站位表层 / 深层温盐点与水团范围框 */
export function drawTSDiagram(
  canvas: HTMLCanvasElement,
  stations: OceanStationResult[],
  waterMasses: { name: string; tRange: [number, number]; sRange: [number, number]; color: string }[]
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const pad = 16
  const sMin = 29
  const sMax = 36
  const tMin = -2
  const tMax = 32
  const xToPx = (s: number) => pad + (w - pad * 2) * ((s - sMin) / (sMax - sMin))
  const yToPx = (t: number) => h - pad - (h - pad * 2) * ((t - tMin) / (tMax - tMin))
  ctx.strokeStyle = 'rgba(157,188,224,0.16)'
  for (let g = 0; g <= 4; g += 1) {
    const y = pad + ((h - pad * 2) * g) / 4
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(w - pad, y)
    ctx.stroke()
    const x = pad + ((w - pad * 2) * g) / 4
    ctx.beginPath()
    ctx.moveTo(x, pad)
    ctx.lineTo(x, h - pad)
    ctx.stroke()
  }
  for (const wm of waterMasses) {
    ctx.fillStyle = wm.color + '33'
    const x0 = xToPx(wm.sRange[0])
    const x1 = xToPx(wm.sRange[1])
    const y0 = yToPx(wm.tRange[1])
    const y1 = yToPx(wm.tRange[0])
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  }
  for (const st of stations) {
    ctx.fillStyle = '#65d3eb'
    ctx.beginPath()
    ctx.arc(xToPx(st.sSurface), yToPx(st.tSurface), 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#1b3a6b'
    ctx.strokeStyle = '#9fd8ff'
    ctx.beginPath()
    ctx.arc(xToPx(st.sDeep), yToPx(st.tDeep), 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.fillStyle = '#7f96b3'
  ctx.font = '9px sans-serif'
  ctx.fillText('S (PSU) →', w - 58, h - 3)
  ctx.fillText('T (°C)', 2, 11)
  ctx.fillStyle = '#65d3eb'
  ctx.fillText('● 表层', pad + 2, 11)
  ctx.fillStyle = '#9fd8ff'
  ctx.fillText('○ 深层', pad + 40, 11)
}
