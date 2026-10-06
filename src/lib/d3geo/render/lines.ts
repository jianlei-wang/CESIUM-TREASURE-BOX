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
  alpha?: number
  /** 只渲染时间窗口内的轨迹段。 */
  timeWindow?: [number, number]
}

/** 用 PolylineCollection 批量渲染轨迹。 */
export function renderTrajectories(collection: PolylineCollection, buffer: TrajectoryBuffer, options: TrajectoryRenderOptions = {}): number {
  const maxTracks = options.maxTracks ?? buffer.count
  const tracks = Math.min(maxTracks, buffer.count)
  const width = options.width ?? 1.5
  const alpha = options.alpha ?? 0.8
  const palette = options.palette ?? 'viridis'
  let rendered = 0
  for (let t = 0; t < tracks; t += 1) {
    const start = buffer.offsets[t]
    const end = buffer.offsets[t + 1]
    if (end - start < 2) continue
    const positions: Cartesian3[] = []
    for (let i = start; i < end; i += 1) {
      if (options.timeWindow) {
        const time = buffer.timestamps[i]
        if (time < options.timeWindow[0] || time > options.timeWindow[1]) continue
      }
      const height = 2000 + buffer.speeds[i] * 30
      positions.push(Cartesian3.fromDegrees(buffer.positions[i * 2], buffer.positions[i * 2 + 1], height))
    }
    if (positions.length < 2) continue
    const color = Color.fromCssColorString(ramp(palette, t / Math.max(1, tracks)))
    color.alpha = alpha
    collection.add({
      positions,
      width,
      material: Material.fromType('Color', { color })
    })
    rendered += 1
  }
  return rendered
}
