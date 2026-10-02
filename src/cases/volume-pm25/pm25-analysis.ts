/**
 * PM2.5 分析封装与轻量图表 —— 把 Worker 的领域分析结果包装成类型安全的调用，
 * 并把趋势 / 廓线 / 散点等分析结果绘制为 canvas 图表，供工作台直接消费。
 */

import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'
import type {
  Pm25AnalysisResult,
  Pm25FootprintResult,
  Pm25HotspotResult,
  Pm25PointResult,
  Pm25ProfileResult,
  Pm25SourcesResult,
  Pm25StationsResult,
  Pm25TrendResult
} from './pm25-types'

export type Pm25Vec3 = [number, number, number]

export type Pm25AnalysisOptions = {
  threshold: number
  popDensity: number
  /** 体域物理尺寸（米），用于把体元素计数换算为 km² / km³ */
  volSize: Pm25Vec3
  res?: number
  channel?: string
}

export function runPm25Analysis(engine: VolumeEngine, options: Pm25AnalysisOptions): Promise<Pm25AnalysisResult> {
  return engine.analyze<Pm25AnalysisResult>({
    mode: 'pm25',
    channel: options.channel,
    res: options.res ?? 40,
    threshold: options.threshold,
    popDensity: options.popDensity,
    volSize: options.volSize
  })
}

export function runPm25Stations(engine: VolumeEngine, channel?: string): Promise<Pm25StationsResult> {
  return engine.analyze<Pm25StationsResult>({ mode: 'pm25Stations', channel })
}

export function runPm25Hotspots(engine: VolumeEngine, threshold: number, volSize: Pm25Vec3, channel?: string): Promise<Pm25HotspotResult> {
  return engine.analyze<Pm25HotspotResult>({ mode: 'pm25Hotspots', channel, threshold, volSize, res: 22, vertical: 10 })
}

export function runPm25Sources(engine: VolumeEngine, x: number, y: number, z: number, channel?: string): Promise<Pm25SourcesResult> {
  return engine.analyze<Pm25SourcesResult>({ mode: 'pm25Sources', channel, x, y, z })
}

export function runPm25Trend(engine: VolumeEngine, threshold: number, volSize: Pm25Vec3, steps = 24, channel?: string): Promise<Pm25TrendResult> {
  return engine.analyze<Pm25TrendResult>({ mode: 'pm25Trend', channel, threshold, volSize, steps, res: 18, vertical: 12 })
}

export function runPm25Footprint(engine: VolumeEngine, threshold: number, volSize: Pm25Vec3, grid = 96, channel?: string): Promise<Pm25FootprintResult> {
  return engine.analyze<Pm25FootprintResult>({ mode: 'pm25Footprint', channel, threshold, grid, vertical: 14, volSize })
}

export function runPm25Point(engine: VolumeEngine, x: number, y: number, z: number, threshold: number, channel?: string): Promise<Pm25PointResult> {
  return engine.analyze<Pm25PointResult>({ mode: 'pm25Point', channel, x, y, z, threshold })
}

/** 拾取射线步进采样：半透明体素无深度缓冲时定位首个可见采样点 */
export function runPm25Ray(
  engine: VolumeEngine,
  origin: Pm25Vec3,
  direction: Pm25Vec3,
  threshold: number,
  minValue: number,
  channel?: string
): Promise<Pm25PointResult> {
  return engine.analyze<Pm25PointResult>({ mode: 'pm25Ray', channel, origin, direction, threshold, minValue })
}

export function runPm25Profile(engine: VolumeEngine, x: number, y: number, levels = 56, channel?: string): Promise<Pm25ProfileResult> {
  return engine.analyze<Pm25ProfileResult>({ mode: 'profile', channel, x, y, levels })
}

/* ------------------------------ 图表绘制 ------------------------------ */

function chartContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext('2d')
}

/** 时间演变趋势：地面峰值 / 地面均值 / 超标面积 / 污染层顶高（各自归一化） */
export function drawTrendChart(canvas: HTMLCanvasElement, trend: Pm25TrendResult, color = '#65d3eb'): void {
  const ctx = chartContext(canvas)
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const pad = 6
  ctx.strokeStyle = 'rgba(157,188,224,0.16)'
  ctx.lineWidth = 1
  for (let g = 0; g <= 3; g += 1) {
    const y = pad + ((h - pad * 2) * g) / 3
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(w - pad, y)
    ctx.stroke()
  }
  const series = [
    { data: trend.maxSurface, color: '#ff5a3c' },
    { data: trend.meanSurface, color },
    { data: trend.exceedAreaKm2, color: '#ffd21e' },
    { data: trend.topHeightKm, color: '#8f9bff' }
  ]
  const n = trend.steps
  for (const s of series) {
    let max = 1e-6
    for (let i = 0; i < n; i += 1) if (s.data[i] > max) max = s.data[i]
    ctx.strokeStyle = s.color
    ctx.lineWidth = 1.6
    ctx.beginPath()
    for (let i = 0; i < n; i += 1) {
      const x = pad + ((w - pad * 2) * i) / Math.max(1, n - 1)
      const y = h - pad - (h - pad * 2) * Math.min(1, s.data[i] / max)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}

/** 垂直廓线：浓度随高度的变化，标注污染层顶高与阈值参考线 */
export function drawProfileChart(canvas: HTMLCanvasElement, profile: Pm25ProfileResult, valueMax: number, threshold: number, refTopNorm?: number): void {
  const ctx = chartContext(canvas)
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const pad = 6
  const levels = profile.levels
  const zToY = (z: number) => h - pad - (h - pad * 2) * z
  const vToX = (v: number) => pad + (w - pad * 2) * Math.min(1, v / Math.max(1, valueMax))
  // 水平网格
  ctx.strokeStyle = 'rgba(157,188,224,0.16)'
  ctx.lineWidth = 1
  for (let g = 0; g <= 3; g += 1) {
    const y = zToY(g / 3)
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(w - pad, y)
    ctx.stroke()
  }
  // 阈值参考线
  if (threshold > 0) {
    ctx.strokeStyle = 'rgba(255,90,60,0.5)'
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(vToX(threshold), pad)
    ctx.lineTo(vToX(threshold), h - pad)
    ctx.stroke()
    ctx.setLineDash([])
  }
  // 污染层顶高参考线
  if (refTopNorm !== undefined) {
    ctx.strokeStyle = 'rgba(143,155,255,0.5)'
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(pad, zToY(refTopNorm))
    ctx.lineTo(w - pad, zToY(refTopNorm))
    ctx.stroke()
    ctx.setLineDash([])
  }
  // 廓线
  ctx.strokeStyle = '#65d3eb'
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

/** 监测站模型 vs 观测散点：带 1:1 参考线与浓度等级分色 */
export function drawScatterChart(canvas: HTMLCanvasElement, stations: Pm25StationsResult, valueMax: number): void {
  const ctx = chartContext(canvas)
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const pad = 8
  const mapX = (v: number) => pad + (w - pad * 2) * Math.min(1, v / Math.max(1, valueMax))
  const mapY = (v: number) => h - pad - (h - pad * 2) * Math.min(1, v / Math.max(1, valueMax))
  // 1:1 参考线
  ctx.strokeStyle = 'rgba(157,188,224,0.4)'
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.moveTo(mapX(0), mapY(0))
  ctx.lineTo(mapX(valueMax), mapY(valueMax))
  ctx.stroke()
  ctx.setLineDash([])
  const colors = ['#65d3eb', '#ffd21e', '#ff7e4d', '#9fb8d4']
  for (let i = 0; i < stations.count; i += 1) {
    ctx.fillStyle = colors[stations.kind[i]] ?? '#65d3eb'
    ctx.beginPath()
    ctx.arc(mapX(stations.model[i]), mapY(stations.observed[i]), 2.4, 0, Math.PI * 2)
    ctx.fill()
  }
}
