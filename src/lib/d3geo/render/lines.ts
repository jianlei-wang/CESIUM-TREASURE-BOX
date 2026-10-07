import { Cartesian3, Color, Material, PolylineCollection, type CustomDataSource } from 'cesium'
import type { FlowArc } from '../analysis/flow'
import type { TrajectoryBuffer } from '../core/buffer'
import { categorical, ramp } from '../palettes'
import { normalize } from '../core/geo'
import { addPolyline, geodesicPoints } from '../render'

export type FlowArcOptions = {
  palette?: string
  valueDomain?: [number, number]
  colorBy?: 'value' | 'category' | 'single'
  color?: string
  minWidth?: number
  maxWidth?: number
  alpha?: number
  /** 最大弧线抬升高度（米）。 */
  arcHeight?: number
  heightBy?: 'distance' | 'value' | 'flat'
}

/** 渲染 OD 流量弧线：线宽映射流量，颜色映射来源/数值，高度映射距离/流量。 */
export function renderFlowArcs(dataSource: CustomDataSource, arcs: FlowArc[], options: FlowArcOptions = {}): number {
  const palette = options.palette ?? 'coolwarm'
  const minWidth = options.minWidth ?? 1
  const maxWidth = options.maxWidth ?? 8
  const alpha = options.alpha ?? 0.75
  const arcHeight = options.arcHeight ?? 500_000
  const heightBy = options.heightBy ?? 'distance'
  const domain = options.valueDomain ?? [arcs[arcs.length - 1]?.value ?? 0, arcs[0]?.value ?? 1]
  const colorBy = options.colorBy ?? 'value'

  arcs.forEach((arc, index) => {
    const t = normalize(arc.value, domain[0], domain[1])
    let color = options.color ?? '#38bdf8'
    if (colorBy === 'value') color = ramp(palette, t)
    else if (colorBy === 'category') color = categorical(arc.category)
    let height = arcHeight
    if (heightBy === 'value') height = arcHeight * (0.2 + 0.8 * t)
    else if (heightBy === 'distance') {
      const distance = Math.hypot(arc.destLon - arc.originLon, arc.destLat - arc.originLat)
      height = 200_000 + distance * 60_000
    }
    const points = geodesicPoints([arc.originLon, arc.originLat], [arc.destLon, arc.destLat], 48, (u) => Math.sin(Math.PI * u) * height)
    addPolyline(dataSource, points, {
      width: minWidth + (maxWidth - minWidth) * t,
      color,
      alpha: alpha - index * 0.0001,
      glow: t > 0.6
    })
  })
  return arcs.length
}

export type TrajectoryRenderOptions = {
  palette?: string
  maxTracks?: number
  width?: number
  /** 速度最快段的线宽上限。 */
  maxWidth?: number
  alpha?: number
  /** 只渲染时间窗口内的轨迹段。 */
  timeWindow?: [number, number]
  /** 速度值域（km/h），用于着色 / 高程 / 线宽归一化；缺省时按可见节点自动估算。 */
  speedDomain?: [number, number]
  /** 迁移段弧线最大抬升高度（米）。 */
  heightMax?: number
  /** 贴地最小抬升（米），避免与影像共面闪烁。 */
  heightMin?: number
  /** 每段大圆密化子段数（>=2 才能贴着球面，否则三维直线会切入地下）。 */
  densify?: number
  /** 快速迁移阈值（km/h）：达到阈值的段高亮为 fastColor。 */
  fastThreshold?: number
  fastColor?: string
  /** 高亮迁移段的额外线宽倍率。 */
  fastWidthScale?: number
  /** 启用发光材质（快速迁移段辉光更强），增强暗色地表上的可读性。 */
  glowPower?: number
}

export type TrajectoryRenderResult = {
  /** 成功绘制的轨迹条数。 */
  rendered: number
  /** 迁移段总数。 */
  segments: number
  /** 被判定为快速迁移的段数。 */
  fastSegments: number
  /** 实际采用的速度值域。 */
  speedDomain: [number, number]
  /** 每条轨迹的迁移段折线引用，供交互高亮使用。 */
  trackSegments: Array<Array<ReturnType<PolylineCollection['add']>>>
  /** 每条轨迹各迁移段的基础线宽，供交互高亮恢复。 */
  trackWidths: number[][]
}

const TRACK_LUT_SIZE = 128

function buildSpeedLut(palette: string, alpha: number): Color[] {
  const lut = new Array<Color>(TRACK_LUT_SIZE)
  for (let i = 0; i < TRACK_LUT_SIZE; i += 1) {
    const color = Color.fromCssColorString(ramp(palette, i / (TRACK_LUT_SIZE - 1)))
    color.alpha = alpha
    lut[i] = color
  }
  return lut
}

function lutColor(lut: Color[], t: number): Color {
  const idx = t <= 0 ? 0 : t >= 1 ? TRACK_LUT_SIZE - 1 : (t * (TRACK_LUT_SIZE - 1) + 0.5) | 0
  return lut[idx]
}

/**
 * 用 PolylineCollection 批量渲染时空迁移轨迹。
 *
 * 每个「相邻事件 → 下一事件」的迁移段被渲染为一条贴着球面的大圆弧线，
 * 弧高 / 颜色 / 线宽均按迁移速度归一化；超过 fastThreshold 的段以 fastColor
 * 高亮，用于识别快速迁移异常。相较旧实现（未限高 + 三维直线）不会出现轨迹
 * 冲出地表的「放射状」伪影。
 */
export function renderTrajectories(
  collection: PolylineCollection,
  buffer: TrajectoryBuffer,
  options: TrajectoryRenderOptions = {}
): TrajectoryRenderResult {
  const maxTracks = options.maxTracks ?? buffer.count
  const tracks = Math.min(maxTracks, buffer.count)
  const width = options.width ?? 1.5
  const maxWidth = Math.max(width, options.maxWidth ?? width)
  const alpha = options.alpha ?? 0.8
  const palette = options.palette ?? 'viridis'
  const densify = Math.max(2, Math.floor(options.densify ?? 10))
  const heightMin = options.heightMin ?? 6000
  const heightMax = options.heightMax ?? 220_000
  const fastThreshold = options.fastThreshold ?? Number.POSITIVE_INFINITY
  const fastColor = options.fastColor ?? '#f87171'
  const fastWidthScale = options.fastWidthScale ?? 1.9
  const window = options.timeWindow

  const visible = (time: number): boolean => !window || (time >= window[0] && time <= window[1])

  let domain = options.speedDomain
  if (!domain) {
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (let t = 0; t < tracks; t += 1) {
      const start = buffer.offsets[t]
      const end = buffer.offsets[t + 1]
      for (let i = start; i < end; i += 1) {
        if (!visible(buffer.timestamps[i])) continue
        const speed = buffer.speeds[i]
        if (!Number.isFinite(speed)) continue
        if (speed < lo) lo = speed
        if (speed > hi) hi = speed
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) domain = [0, Math.max(1, hi)]
    else domain = [lo, hi]
  }
  const [d0, d1] = domain
  const span = d1 - d0
  const lut = buildSpeedLut(palette, alpha)
  const fast = Color.fromCssColorString(fastColor)
  fast.alpha = Math.min(1, alpha + 0.18)
  const glowPower = options.glowPower

  let rendered = 0
  let segments = 0
  let fastSegments = 0
  const trackSegments: Array<Array<ReturnType<PolylineCollection['add']>>> = []
  const trackWidths: number[][] = []

  for (let t = 0; t < tracks; t += 1) {
    const start = buffer.offsets[t]
    const end = buffer.offsets[t + 1]
    const refs: Array<ReturnType<PolylineCollection['add']>> = []
    const widths: number[] = []
    if (end - start < 2) {
      trackSegments.push(refs)
      trackWidths.push(widths)
      continue
    }
    let prevIndex = -1
    let trackRendered = false
    for (let i = start; i < end; i += 1) {
      if (!visible(buffer.timestamps[i])) continue
      if (prevIndex === -1) {
        prevIndex = i
        continue
      }
      const from: [number, number] = [buffer.positions[prevIndex * 2], buffer.positions[prevIndex * 2 + 1]]
      const to: [number, number] = [buffer.positions[i * 2], buffer.positions[i * 2 + 1]]
      const rawSpeed = buffer.speeds[i]
      const norm = span > 0 ? Math.min(1, Math.max(0, (rawSpeed - d0) / span)) : 0.4
      const peak = heightMin + norm * Math.max(0, heightMax - heightMin)
      const points = geodesicPoints(from, to, densify, (u) => Math.sin(Math.PI * u) * peak)
      const isFast = rawSpeed >= fastThreshold
      const segmentColor = isFast ? fast : lutColor(lut, norm)
      const material = glowPower
        ? Material.fromType('PolylineGlow', { glowPower: isFast ? Math.min(0.4, glowPower + 0.12) : glowPower, color: segmentColor })
        : Material.fromType('Color', { color: segmentColor })
      const segmentWidth = isFast
        ? Math.min(maxWidth * fastWidthScale, width + (maxWidth - width) * norm)
        : width + (maxWidth - width) * norm
      const polyline = collection.add({
        positions: points.map((p) => Cartesian3.fromDegrees(p[0], p[1], p[2])),
        width: segmentWidth,
        material,
        id: t
      })
      refs.push(polyline)
      widths.push(segmentWidth)
      segments += 1
      if (isFast) fastSegments += 1
      trackRendered = true
      prevIndex = i
    }
    if (trackRendered) rendered += 1
    trackSegments.push(refs)
    trackWidths.push(widths)
  }

  return { rendered, segments, fastSegments, speedDomain: domain as [number, number], trackSegments, trackWidths }
}
