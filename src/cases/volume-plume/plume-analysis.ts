/**
 * 地下水污染羽流分析封装 —— 把 Worker 的羽流统计 / 井孔剖面分析包装成类型安全调用，
 * 并把沿井孔的垂向浓度曲线绘制为带含水层背景与筛管区间的调查专用图表。
 */

import type { AnalyzeRequest, LineOverlayResult, VolumeEngine } from '../../lib/volume-engine/VolumeEngine'
import type { PlumeAquiferDef, PlumeConfig, PlumeWellDef } from '../../lib/volume-engine/scenes'

export type PlumeVec3 = [number, number, number]

export type PlumeAquiferStat = { code: number; above: number; volumeM3: number; fraction: number }

export type PlumeStatsResult = {
  threshold: number
  coreThreshold: number
  volumeM3: number
  coreVolumeM3: number
  areaM2: number
  frontDistanceM: number
  maxConc: number
  meanConc: number
  maxPos: number[]
  aquiferStats: PlumeAquiferStat[]
  captureRate: number
  captureCount: number
  sampleCount: number
  aboveCount: number
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
  options: { channel: string; threshold: number; coreThreshold?: number; volSize: PlumeVec3; res?: number; vres?: number }
): Promise<PlumeStatsResult> {
  return engine.analyze<PlumeStatsResult>({
    mode: 'plume',
    channel: options.channel,
    threshold: options.threshold,
    coreThreshold: options.coreThreshold,
    volSize: options.volSize,
    res: options.res ?? 40,
    vres: options.vres ?? 48
  })
}

export function runPlumeProfile(
  engine: VolumeEngine,
  x: number,
  y: number,
  channel: string,
  levels = 56,
  timeStep?: number
): Promise<PlumeProfileResult> {
  const request: AnalyzeRequest = { mode: 'profile', channel, x, y, levels }
  if (timeStep !== undefined) request.timeStep = timeStep
  return engine.analyze<PlumeProfileResult>(request)
}

export function runPlumeIso(engine: VolumeEngine, channel: string, iso: number, volSize: PlumeVec3, res = 56): Promise<IsoResult> {
  return engine.analyze<IsoResult>({ mode: 'isosurface', channel, iso, res, volSize })
}

/** 地下水流线：沿各含水层积分得到分层流线族（局部米坐标，交由引擎 setFlowBeads 以顶部点串渲染） */
export function runPlumeStreamlines(
  engine: VolumeEngine,
  timeStep: number,
  volSize: PlumeVec3,
  seeds = 150
): Promise<LineOverlayResult> {
  return engine.analyze<LineOverlayResult>({
    mode: 'streamlines',
    seeds,
    steps: 200,
    step: 0.006,
    levels: 3,
    bidirectional: false,
    timeStep,
    volMin: [-volSize[0] / 2, -volSize[1] / 2, -volSize[2]],
    volSize: [volSize[0], volSize[1], volSize[2]]
  })
}

export type WellProfileOptions = {
  config: PlumeConfig
  well: PlumeWellDef
  valueMax: number
  threshold: number
  coreThreshold?: number
  baseline?: PlumeProfileResult
  unit: string
}

/** 沿井孔的垂向浓度曲线：叠加含水层背景、筛管区间、风险阈值与核心阈值，标注调查语义 */
export function drawWellProfile(canvas: HTMLCanvasElement, profile: PlumeProfileResult, options: WellProfileOptions): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { config, well, valueMax, threshold, unit } = options
  const coreThreshold = options.coreThreshold ?? threshold * 2
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const padL = 30
  const padR = 10
  const padT = 12
  const padB = 16
  const plotW = w - padL - padR
  const plotH = h - padT - padB
  const totalDepth = config.aquifers[config.aquifers.length - 1]?.bottom || 120
  const depthToY = (m: number) => padT + (Math.min(totalDepth, Math.max(0, m)) / totalDepth) * plotH
  const vToX = (v: number) => padL + plotW * Math.min(1, v / Math.max(1, valueMax))

  // 含水层背景
  for (const a of config.aquifers) {
    const y0 = depthToY(a.top)
    const y1 = depthToY(a.bottom)
    ctx.fillStyle = a.type === 'aquifer' ? hexWithAlpha(a.color, 0.14) : hexWithAlpha(a.color, 0.3)
    ctx.fillRect(padL, y0, plotW, y1 - y0)
    if (a.type === 'aquitard') {
      ctx.strokeStyle = hexWithAlpha(a.color, 0.5)
      ctx.lineWidth = 1
      for (let x = padL - 6; x < padL + plotW + 6; x += 6) {
        ctx.beginPath()
        ctx.moveTo(x, y0)
        ctx.lineTo(x + (y1 - y0), y1)
        ctx.stroke()
      }
    }
    ctx.strokeStyle = 'rgba(157,188,224,0.18)'
    ctx.beginPath()
    ctx.moveTo(padL, y0)
    ctx.lineTo(padL + plotW, y0)
    ctx.stroke()
  }

  // 筛管区间
  const sy0 = depthToY(well.screenTop)
  const sy1 = depthToY(well.screenBottom)
  ctx.fillStyle = 'rgba(126,231,135,0.18)'
  ctx.fillRect(padL, sy0, plotW, sy1 - sy0)
  ctx.strokeStyle = 'rgba(126,231,135,0.75)'
  ctx.lineWidth = 1.4
  ctx.strokeRect(padL, sy0, plotW, sy1 - sy0)

  // 阈值参考线
  drawThresholdLine(ctx, vToX(threshold), padT, plotH, 'rgba(255,150,60,0.75)', '阈值')
  if (coreThreshold < valueMax) {
    drawThresholdLine(ctx, vToX(coreThreshold), padT, plotH, 'rgba(226,58,44,0.7)', '核心')
  }

  // 基线对照（抽采前）
  if (options.baseline) {
    ctx.strokeStyle = 'rgba(160,180,210,0.45)'
    ctx.lineWidth = 1
    ctx.setLineDash([2, 3])
    traceProfile(ctx, options.baseline, depthToY, vToX, totalDepth)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 当前浓度曲线：按阈值分段着色
  const levels = profile.levels
  ctx.lineWidth = 1.9
  for (let i = 0; i < levels - 1; i += 1) {
    if (!profile.valid[i] || !profile.valid[i + 1]) continue
    const v = (profile.values[i] + profile.values[i + 1]) * 0.5
    ctx.strokeStyle = v >= coreThreshold ? '#e23a2c' : v >= threshold ? '#f6a028' : '#ffd21e'
    ctx.beginPath()
    ctx.moveTo(vToX(profile.values[i]), depthToY(((i + 0.5) / levels) * totalDepth))
    ctx.lineTo(vToX(profile.values[i + 1]), depthToY(((i + 1.5) / levels) * totalDepth))
    ctx.stroke()
  }

  // 轴标注
  ctx.fillStyle = '#7f96b3'
  ctx.font = '9px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText('0', padL - 3, padT)
  ctx.fillText(`${Math.round(totalDepth / 2)}`, padL - 3, padT + plotH / 2)
  ctx.fillText(`${totalDepth}m`, padL - 3, padT + plotH)
  ctx.fillStyle = '#9fb8d4'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`0`, padL, h - padB + 2)
  ctx.textAlign = 'right'
  ctx.fillText(`${valueMax.toFixed(0)} ${unit}`, padL + plotW, h - padB + 2)
}

function drawThresholdLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  plotH: number,
  color: string,
  label: string
): void {
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(x, top)
  ctx.lineTo(x, top + plotH)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = color
  ctx.font = '8px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(label, x, top - 1)
}

function traceProfile(
  ctx: CanvasRenderingContext2D,
  profile: PlumeProfileResult,
  depthToY: (m: number) => number,
  vToX: (v: number) => number,
  totalDepth: number
): void {
  const levels = profile.levels
  let started = false
  for (let i = 0; i < levels; i += 1) {
    if (!profile.valid[i]) {
      started = false
      continue
    }
    const x = vToX(profile.values[i])
    const y = depthToY(((i + 0.5) / levels) * totalDepth)
    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else {
      ctx.lineTo(x, y)
    }
  }
}

function hexWithAlpha(hex: string, alpha: number): string {
  const c = hex.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/** 含水层类型便捷判断，供 UI 图例分组 */
export function isAquifer(a: PlumeAquiferDef): boolean {
  return a.type === 'aquifer'
}
