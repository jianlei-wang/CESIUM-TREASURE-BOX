import { PolylineCollection } from 'cesium'
import { scaleTime, timeFormat } from 'd3'
import type { D3CaseSpec } from '../types'
import type { GeoPointBuffer, TrajectoryBuffer, TrajectoryRecord } from '../core/buffer'
import { trajectoryFromRecords, bufferTimeExtent } from '../core/buffer'
import { renderTrajectories } from '../render/lines'
import { haversine } from '../core/geo'
import { formatCount } from '../core/geo'
import { temporalBins } from '../analysis/temporal'
import { loadQuakes } from './_data'
import { PALETTE_OPTIONS, rampLegend } from './_kit'

function stamp(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 把同一区域、按时间排序的真实地震事件连成时空迁移轨迹（速度 = 球面距离 / 时间）。 */
function quakesToTrajectories(buffer: GeoPointBuffer, cellDeg: number, maxTracks: number): TrajectoryBuffer {
  const groups = new Map<string, number[]>()
  for (let i = 0; i < buffer.length; i += 1) {
    const lon = buffer.positions[i * 2]
    const lat = buffer.positions[i * 2 + 1]
    const key = `${Math.floor(lon / cellDeg)},${Math.floor(lat / cellDeg)}`
    const list = groups.get(key)
    if (list) list.push(i)
    else groups.set(key, [i])
  }
  const records: TrajectoryRecord[] = []
  const sortedGroups = [...groups.values()].filter((indices) => indices.length >= 5).sort((a, b) => b.length - a.length)
  for (const indices of sortedGroups.slice(0, maxTracks)) {
    indices.sort((a, b) => buffer.timestamps[a] - buffer.timestamps[b])
    const points: TrajectoryRecord['points'] = []
    for (let k = 0; k < indices.length; k += 1) {
      const index = indices[k]
      const lon = buffer.positions[index * 2]
      const lat = buffer.positions[index * 2 + 1]
      const time = buffer.timestamps[index]
      let speed = 0
      if (k > 0) {
        const prev = indices[k - 1]
        const dt = Math.max(1, time - buffer.timestamps[prev])
        speed = haversine([buffer.positions[prev * 2], buffer.positions[prev * 2 + 1]], [lon, lat]) / (dt / 3600_000)
      }
      points.push({ lon, lat, time, speed })
    }
    records.push({ points, category: points.length % 6 })
  }
  return trajectoryFromRecords(records)
}

function timeAxisOverlay(domain: [number, number], window: [number, number]): HTMLElement {
  const width = 720
  const height = 54
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', `${height}`)
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  const pad = 44
  const scale = scaleTime().domain(domain).range([pad, width - pad])
  const [w0, w1] = window
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  rect.setAttribute('x', String(scale(w0)))
  rect.setAttribute('width', String(Math.max(2, scale(w1) - scale(w0))))
  rect.setAttribute('y', '8')
  rect.setAttribute('height', '18')
  rect.setAttribute('fill', 'rgba(251,146,60,0.35)')
  rect.setAttribute('stroke', '#fb923c')
  svg.appendChild(rect)
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  line.setAttribute('x1', String(pad))
  line.setAttribute('x2', String(width - pad))
  line.setAttribute('y1', '34')
  line.setAttribute('y2', '34')
  line.setAttribute('stroke', '#64748b')
  svg.appendChild(line)
  const format = timeFormat('%m-%d %H:%M')
  for (const tick of scale.ticks(8)) {
    const x = scale(tick)
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    mark.setAttribute('x1', String(x))
    mark.setAttribute('x2', String(x))
    mark.setAttribute('y1', '30')
    mark.setAttribute('y2', '38')
    mark.setAttribute('stroke', '#94a3b8')
    svg.appendChild(mark)
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('x', String(x))
    text.setAttribute('y', '50')
    text.setAttribute('fill', '#cbd5e1')
    text.setAttribute('font-size', '10')
    text.setAttribute('text-anchor', 'middle')
    text.textContent = format(tick as Date)
    svg.appendChild(text)
  }
  return svg as unknown as HTMLElement
}

const spec: D3CaseSpec = {
  id: 'd3-trajectories',
  meta: {
    title: '时空轨迹大数据 · 时间轴联动',
    subtitle: '真实事件序列 → 区域迁移轨迹 → 时间窗口',
    description:
      '将 USGS 真实地震事件按区域与时间排序，连接为时空迁移轨迹，计算方向与速度；d3.scaleTime 绘制时间轴，拖动时间窗口时三维场景同步过滤。',
    tag: 'Trajectory · d3.scaleTime · 时空',
    accent: '#fbbf24',
    tips: [
      '轨迹由真实事件的时间顺序与地理位置导出，时间戳真实',
      '速度由球面距离 / 时间差计算，用于异常事件识别',
      'd3.scaleTime + d3.timeFormat 负责时间轴刻度'
    ]
  },
  defaults: {
    cellDeg: 6,
    maxTracks: 260,
    windowHours: 240,
    offset: 60,
    width: 1.4,
    palette: 'turbo'
  },
  camera: { lon: 20, lat: 20, height: 24_000_000, pitch: -90 },
  controls: [
    { kind: 'select', key: 'cellDeg', label: '区域聚合(度)', options: [ { value: '3', label: '3°' }, { value: '6', label: '6°' }, { value: '10', label: '10°' } ] },
    { kind: 'range', key: 'maxTracks', label: '最大轨迹数', min: 40, max: 800, step: 20 },
    { kind: 'range', key: 'windowHours', label: '时间窗口(小时)', min: 6, max: 720, step: 6 },
    { kind: 'range', key: 'offset', label: '窗口位置(%)', min: 0, max: 100, step: 1 },
    { kind: 'range', key: 'width', label: '线宽', min: 0.5, max: 4, step: 0.1 },
    { kind: 'select', key: 'palette', label: '色带', options: PALETTE_OPTIONS }
  ],
  setup(ctx) {
    const settings = ctx.settings
    let disposed = false
    ctx.onCleanup(() => {
      disposed = true
    })
    ctx.status('加载真实地震事件序列…')

    loadQuakes()
      .then((buffer) => {
        if (disposed) return
        const buildEnd = ctx.profiler.time('Build')
        const trajectories = quakesToTrajectories(buffer, Number(settings.cellDeg), Number(settings.maxTracks))
        const buildMs = buildEnd()

        const domain = bufferTimeExtent(buffer)
        const span = Math.max(1, domain[1] - domain[0])
        const windowSpan = Math.min(span, Number(settings.windowHours) * 3600_000)
        const start = domain[0] + (span - windowSpan) * (Number(settings.offset) / 100)
        const window: [number, number] = [start, start + windowSpan]

        const collection = ctx.addPrimitive(new PolylineCollection())
        const renderEnd = ctx.profiler.time('Render')
        const rendered = renderTrajectories(collection, trajectories, {
          palette: String(settings.palette),
          maxTracks: Number(settings.maxTracks),
          width: Number(settings.width),
          alpha: 0.72,
          timeWindow: window
        })
        const renderMs = renderEnd()

        ctx.overlay(timeAxisOverlay(domain, window))
        const bins = temporalBins(buffer, 48, domain)
        const active = bins.filter((bin) => bin.t1 >= window[0] && bin.t0 <= window[1]).reduce((acc, bin) => acc + bin.count, 0)

        ctx.profiler.set('Events', formatCount(buffer.length))
        ctx.profiler.set('Tracks', formatCount(trajectories.count))
        ctx.profiler.set('Rendered', formatCount(rendered))
        ctx.profiler.set('In Window', formatCount(active))
        ctx.profiler.set('Window', `${stamp(window[0])} → ${stamp(window[1])}`)
        ctx.profiler.set('Build', `${buildMs.toFixed(0)} ms`)
        ctx.profiler.set('Render', `${renderMs.toFixed(0)} ms`)
        ctx.status(`${formatCount(buffer.length)} 个真实事件 → ${trajectories.count} 条轨迹 · 窗口 ${stamp(window[0])}–${stamp(window[1])} 命中 ${formatCount(active)}`)
        ctx.legend([rampLegend(String(settings.palette), '轨迹 时间→晚')])
      })
      .catch((error: unknown) => {
        if (!disposed) ctx.status(`数据加载失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }
}

export default spec
