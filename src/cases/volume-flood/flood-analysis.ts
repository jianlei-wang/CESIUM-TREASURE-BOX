/**
 * 洪水动力水深体分析封装 —— 把 Worker 的淹没统计 / 沿河道纵剖面分析包装成类型安全调用，
 * 并把沿程水面—地面—水深剖面绘制为 canvas 图表。
 */

import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'

export type FloodVec3 = [number, number, number]

export type FloodZoneInput = { id: string; x: number; y: number; r: number }

export type FloodZoneStat = { id: string; maxDepthM: number; arrivalStep: number; floodedFrac: number }

export type FloodStatsResult = {
  depthThreshold: number
  floodedAreaM2: number
  floodedVolumeM3: number
  maxDepthM: number
  meanDepthM: number
  maxSpeed: number
  meanSpeed: number
  floodedFraction: number
  maxPos: number[]
  zoneStats: FloodZoneStat[]
  sampleCount: number
}

export type FloodProfileResult = {
  steps: number
  x: Float32Array
  depth: Float32Array
  level: Float32Array
  terrain: Float32Array
  maxDepthM: number
  peakAt: number
}

export type IsoResult = { positions: Float32Array; normals: Float32Array; count: number; res: number; nz?: number }

export function runFloodStats(
  engine: VolumeEngine,
  options: { depthThreshold: number; timeSteps: number; volSize: FloodVec3; zones: FloodZoneInput[]; res?: number; vres?: number }
): Promise<FloodStatsResult> {
  return engine.analyze<FloodStatsResult>({
    mode: 'flood',
    depthThreshold: options.depthThreshold,
    timeSteps: options.timeSteps,
    volSize: options.volSize,
    zones: options.zones,
    res: options.res ?? 48,
    vres: options.vres ?? 24
  })
}

export function runFloodProfile(engine: VolumeEngine, steps = 160): Promise<FloodProfileResult> {
  return engine.analyze<FloodProfileResult>({ mode: 'floodProfile', steps })
}

export function runFloodIso(engine: VolumeEngine, iso: number, volSize: FloodVec3, res = 56): Promise<IsoResult> {
  return engine.analyze<IsoResult>({ mode: 'isosurface', channel: 'depth', iso, res, volSize })
}

/** 沿河道纵剖面：地面线、水面线、水深填充与淹没阈值 */
export function drawFloodProfile(canvas: HTMLCanvasElement, profile: FloodProfileResult, depthThreshold: number): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const pad = 8
  const maxLevel = Math.max(1, ...Array.from(profile.level), ...Array.from(profile.terrain))
  const xToPx = (x: number) => pad + (w - pad * 2) * x
  const vToPy = (v: number) => h - pad - (h - pad * 2) * Math.min(1, Math.max(0, v / maxLevel))

  ctx.fillStyle = 'rgba(90, 180, 255, 0.35)'
  ctx.beginPath()
  ctx.moveTo(xToPx(profile.x[0]), vToPy(profile.level[0]))
  for (let i = 1; i < profile.steps; i += 1) ctx.lineTo(xToPx(profile.x[i]), vToPy(profile.level[i]))
  for (let i = profile.steps - 1; i >= 0; i -= 1) ctx.lineTo(xToPx(profile.x[i]), vToPy(profile.terrain[i]))
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = '#7a5a3a'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  for (let i = 0; i < profile.steps; i += 1) {
    const px = xToPx(profile.x[i])
    const py = vToPy(profile.terrain[i])
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()

  ctx.strokeStyle = '#39a0ff'
  ctx.lineWidth = 1.8
  ctx.beginPath()
  for (let i = 0; i < profile.steps; i += 1) {
    const px = xToPx(profile.x[i])
    const py = vToPy(profile.level[i])
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()

  const peakX = xToPx(profile.x[Math.min(profile.steps - 1, Math.round(profile.peakAt * (profile.steps - 1)))])
  ctx.strokeStyle = 'rgba(235, 87, 87, 0.75)'
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(peakX, pad)
  ctx.lineTo(peakX, h - pad)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#eb5757'
  ctx.font = '9px sans-serif'
  ctx.fillText(`洪峰 ${profile.maxDepthM.toFixed(2)} m（阈值 ${depthThreshold} m）`, pad, pad + 8)
}
