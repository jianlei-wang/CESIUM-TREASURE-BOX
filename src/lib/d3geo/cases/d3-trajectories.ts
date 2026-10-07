import {
  Cartesian2,
  Cartesian3,
  Color,
  PolylineCollection,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer
} from 'cesium'
import { max as d3max, scaleLinear, scaleTime, timeFormat } from 'd3'
import type { D3CaseSpec } from '../types'
import type { GeoPointBuffer, TrajectoryRecord } from '../core/buffer'
import { bufferFilter, bufferTimeExtent, trajectoryFromRecords } from '../core/buffer'
import type { Bounds } from '../analysis/density'
import { temporalBins, type TemporalBin } from '../analysis/temporal'
import { renderTrajectories } from '../render/lines'
import { formatCount, haversine, mean, normalize } from '../core/geo'
import { ramp } from '../palettes'
import { loadQuakes } from './_data'
import { PALETTE_OPTIONS, dockTimeline, formatHeight, rampLegend } from './_kit'

type RegionKey = 'global' | 'japan' | 'indonesia' | 'china' | 'americas'

const REGIONS: Record<RegionKey, { bounds: Bounds; camera: { lon: number; lat: number; height: number } }> = {
  global: { bounds: { west: -180, south: -60, east: 180, north: 72 }, camera: { lon: 20, lat: 20, height: 24_000_000 } },
  japan: { bounds: { west: 128, south: 30, east: 146, north: 46 }, camera: { lon: 138, lat: 37, height: 3_200_000 } },
  indonesia: { bounds: { west: 95, south: -11, east: 141, north: 8 }, camera: { lon: 118, lat: -2, height: 4_000_000 } },
  china: { bounds: { west: 73, south: 18, east: 135, north: 54 }, camera: { lon: 104, lat: 35, height: 5_500_000 } },
  americas: { bounds: { west: -130, south: 15, east: -60, north: 60 }, camera: { lon: -95, lat: 40, height: 8_000_000 } }
}

/** 迁移轨迹的时间分箱质心节点。 */
type TrackNode = { lon: number; lat: number; time: number; speed: number }

/** 一个区域在时间上的活动中心迁移轨迹及其统计量。 */
type RegionTrack = {
  nodes: TrackNode[]
  events: number
  magMax: number
  avgSpeed: number
  maxSpeed: number
  lengthKm: number
  durationH: number
}

/** 播放状态跨案例重建保留（重建只重绘几何，不打断动画开关）。 */
let playbackOn = true
const regionState = new WeakMap<Viewer, RegionKey>()

function stamp(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function filterRegion(buffer: GeoPointBuffer, bounds: Bounds): GeoPointBuffer {
  return bufferFilter(buffer, (index, buf) => {
    const lon = buf.positions[index * 2]
    const lat = buf.positions[index * 2 + 1]
    return lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north
  })
}

/**
 * 把真实事件序列转化为区域迁移轨迹：按空间单元聚合出区域，再按固定时间分箱求
 * 活动中心（经纬度质心 + 平均时刻），连接相邻分箱质心得到平滑的迁移路径。
 * 速度 = 质心球面位移 / 时间差，用于识别「快速迁移」异常。
 */
function buildRegionTracks(buffer: GeoPointBuffer, cellDeg: number, stepHours: number, maxTracks: number): RegionTrack[] {
  if (buffer.length === 0) return []
  const step = Math.max(1, stepHours) * 3600_000
  const groups = new Map<string, number[]>()
  for (let i = 0; i < buffer.length; i += 1) {
    const lon = buffer.positions[i * 2]
    const lat = buffer.positions[i * 2 + 1]
    const key = `${Math.floor(lon / cellDeg)},${Math.floor(lat / cellDeg)}`
    const list = groups.get(key)
    if (list) list.push(i)
    else groups.set(key, [i])
  }

  const tracks: RegionTrack[] = []
  for (const indices of groups.values()) {
    if (indices.length < 4) continue
    const bins = new Map<number, { lonSum: number; latSum: number; tSum: number; count: number; magSum: number; magMax: number }>()
    for (const index of indices) {
      const time = buffer.timestamps[index]
      const binKey = Math.floor(time / step)
      let bin = bins.get(binKey)
      if (!bin) {
        bin = { lonSum: 0, latSum: 0, tSum: 0, count: 0, magSum: 0, magMax: 0 }
        bins.set(binKey, bin)
      }
      bin.lonSum += buffer.positions[index * 2]
      bin.latSum += buffer.positions[index * 2 + 1]
      bin.tSum += time
      bin.count += 1
      const mag = buffer.values[index]
      bin.magSum += mag
      if (mag > bin.magMax) bin.magMax = mag
    }
    const sorted = [...bins.entries()].sort((a, b) => a[0] - b[0])
    if (sorted.length < 2) continue

    const nodes: TrackNode[] = []
    let magMax = 0
    let magSum = 0
    let events = 0
    for (const [, bin] of sorted) {
      nodes.push({ lon: bin.lonSum / bin.count, lat: bin.latSum / bin.count, time: bin.tSum / bin.count, speed: 0 })
      magMax = Math.max(magMax, bin.magMax)
      magSum += bin.magSum
      events += bin.count
    }

    let lengthKm = 0
    const speeds: number[] = []
    for (let k = 1; k < nodes.length; k += 1) {
      const a = nodes[k - 1]
      const b = nodes[k]
      const dist = haversine([a.lon, a.lat], [b.lon, b.lat])
      lengthKm += dist / 1000
      const dtH = Math.max(0.25, (b.time - a.time) / 3600_000)
      b.speed = dist / 1000 / dtH
      speeds.push(b.speed)
    }

    tracks.push({
      nodes,
      events,
      magMax,
      avgSpeed: mean(speeds),
      maxSpeed: speeds.length ? Math.max(...speeds) : 0,
      lengthKm,
      durationH: Math.max(0, (nodes[nodes.length - 1].time - nodes[0].time) / 3600_000)
    })
  }

  tracks.sort((a, b) => b.events - a.events)
  return tracks.slice(0, maxTracks)
}

/** 在轨迹节点上按时间取样（线性插值），用于动画游标头。 */
function sampleTrack(nodes: TrackNode[], time: number): { lon: number; lat: number; time: number } | null {
  if (nodes.length === 0) return null
  if (time <= nodes[0].time) return nodes[0]
  const last = nodes[nodes.length - 1]
  if (time >= last.time) return last
  let lo = 0
  let hi = nodes.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (nodes[mid].time <= time) lo = mid
    else hi = mid
  }
  const a = nodes[lo]
  const b = nodes[hi]
  const k = (time - a.time) / Math.max(1, b.time - a.time)
  return { lon: a.lon + (b.lon - a.lon) * k, lat: a.lat + (b.lat - a.lat) * k, time }
}

type TimelineHandle = { el: HTMLElement; setCursor: (time: number) => void }

/** 底部时间轴：事件分箱柱 + 窗口高亮 + 随时间推进的游标。 */
function timelineOverlay(domain: [number, number], window: [number, number], bins: TemporalBin[], accent: string): TimelineHandle {
  const width = 760
  const height = 104
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', `${height}`)
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  const pad = 46
  const baseline = height - 30
  const scale = scaleTime().domain(domain).range([pad, width - pad])
  const maxCount = d3max(bins, (bin: TemporalBin) => bin.count) ?? 1
  const y = scaleLinear().domain([0, Math.max(1, maxCount)]).range([baseline, 14])

  const barWidth = Math.max(1, (width - pad * 2) / Math.max(1, bins.length) - 1)
  for (const bin of bins) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(scale(bin.t0)))
    rect.setAttribute('y', String(y(bin.count)))
    rect.setAttribute('width', String(barWidth))
    rect.setAttribute('height', String(Math.max(0, baseline - y(bin.count))))
    rect.setAttribute('fill', 'rgba(56,189,248,0.34)')
    svg.appendChild(rect)
  }

  const win = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  win.setAttribute('x', String(scale(Math.max(domain[0], window[0]))))
  win.setAttribute('width', String(Math.max(2, scale(Math.min(domain[1], window[1])) - scale(Math.max(domain[0], window[0])))))
  win.setAttribute('y', '12')
  win.setAttribute('height', String(baseline - 12))
  win.setAttribute('rx', '3')
  win.setAttribute('fill', 'rgba(251,146,60,0.14)')
  win.setAttribute('stroke', '#fb923c')
  svg.appendChild(win)

  const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  axis.setAttribute('x1', String(pad))
  axis.setAttribute('x2', String(width - pad))
  axis.setAttribute('y1', String(baseline))
  axis.setAttribute('y2', String(baseline))
  axis.setAttribute('stroke', '#64748b')
  svg.appendChild(axis)

  const format = timeFormat('%m-%d %H:%M')
  for (const tick of scale.ticks(8)) {
    const x = scale(tick)
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    mark.setAttribute('x1', String(x))
    mark.setAttribute('x2', String(x))
    mark.setAttribute('y1', String(baseline))
    mark.setAttribute('y2', String(baseline + 5))
    mark.setAttribute('stroke', '#94a3b8')
    svg.appendChild(mark)
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('x', String(x))
    text.setAttribute('y', String(height - 6))
    text.setAttribute('fill', '#cbd5e1')
    text.setAttribute('font-size', '10')
    text.setAttribute('text-anchor', 'middle')
    text.textContent = format(tick as Date)
    svg.appendChild(text)
  }

  const cursorLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  cursorLine.setAttribute('y1', '8')
  cursorLine.setAttribute('y2', String(baseline + 6))
  cursorLine.setAttribute('stroke', '#fde68a')
  cursorLine.setAttribute('stroke-width', '1.6')
  svg.appendChild(cursorLine)

  const cursorText = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  cursorText.setAttribute('y', '11')
  cursorText.setAttribute('fill', '#fde68a')
  cursorText.setAttribute('font-size', '10')
  cursorText.setAttribute('text-anchor', 'middle')
  svg.appendChild(cursorText)

  const cursorDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  cursorDot.setAttribute('r', '3')
  cursorDot.setAttribute('fill', accent)
  cursorDot.setAttribute('stroke', '#0b1727')
  svg.appendChild(cursorDot)

  function setCursor(time: number): void {
    const x = Math.min(width - pad, Math.max(pad, scale(time)))
    cursorLine.setAttribute('x1', String(x))
    cursorLine.setAttribute('x2', String(x))
    cursorDot.setAttribute('cx', String(x))
    cursorDot.setAttribute('cy', String(baseline))
    cursorText.setAttribute('x', String(x))
    cursorText.textContent = stamp(time)
  }
  setCursor(window[1])
  return { el: svg as unknown as HTMLElement, setCursor }
}

const spec: D3CaseSpec = {
  id: 'd3-trajectories',
  meta: {
    title: '时空轨迹大数据 · 时间轴联动',
    subtitle: '真实事件区域质心 → 时空迁移轨迹 → 时间轴播放联动',
    description:
      '把 USGS 真实地震序列按空间单元聚合为区域，再按时间分箱求活动中心质心，连接质心得到时空迁移轨迹；速度由质心球面位移计算，超过阈值的段高亮为快速迁移异常。时间轴播放游标与三维轨迹实时联动。',
    tag: 'Trajectory · d3.scaleTime · 时空',
    accent: '#fbbf24',
    bottomDock: 178,
    tips: [
      '事件位置、时刻、震级均为真实数据，轨迹由区域活动中心导出',
      'd3.scaleTime + d3.timeFormat 驱动时间轴；三维弧线贴着球面按速度着色',
      '时间轴游标与轨迹动画头联动播放，快速迁移段（超过阈值）高亮',
      '点击任意迁移段可高亮并查看该区域轨迹统计'
    ]
  },
  defaults: {
    region: 'global',
    cellDeg: 10,
    stepHours: 24,
    maxTracks: 160,
    windowHours: 720,
    offset: 60,
    width: 1.6,
    heightKm: 300,
    fastThreshold: 20,
    cycle: 14,
    palette: 'turbo'
  },
  camera: { lon: 20, lat: 20, height: 24_000_000, pitch: -90 },
  controls: [
    {
      kind: 'select',
      key: 'region',
      label: '区域',
      options: [
        { value: 'global', label: '全球' },
        { value: 'japan', label: '日本' },
        { value: 'indonesia', label: '印尼' },
        { value: 'china', label: '中国及周边' },
        { value: 'americas', label: '美洲' }
      ]
    },
    { kind: 'select', key: 'cellDeg', label: '区域聚合(度)', options: [ { value: '6', label: '6°' }, { value: '10', label: '10°' }, { value: '15', label: '15°' }, { value: '20', label: '20°' } ] },
    { kind: 'range', key: 'stepHours', label: '时间分箱(小时)', min: 12, max: 96, step: 12 },
    { kind: 'range', key: 'maxTracks', label: '最大轨迹数', min: 40, max: 240, step: 20 },
    { kind: 'range', key: 'windowHours', label: '时间窗口(小时)', min: 24, max: 720, step: 24 },
    { kind: 'range', key: 'offset', label: '窗口位置(%)', min: 0, max: 100, step: 1 },
    { kind: 'range', key: 'width', label: '线宽', min: 0.6, max: 4, step: 0.1 },
    { kind: 'range', key: 'heightKm', label: '弧线高度(km)', min: 40, max: 600, step: 20 },
    { kind: 'range', key: 'fastThreshold', label: '快速迁移阈值(km/h)', min: 0, max: 80, step: 5 },
    { kind: 'range', key: 'cycle', label: '动画周期(s)', min: 6, max: 30, step: 2 },
    { kind: 'select', key: 'palette', label: '色带', options: PALETTE_OPTIONS },
    {
      kind: 'button',
      label: '播放 / 暂停',
      onClick: () => {
        playbackOn = !playbackOn
      }
    }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const regionKey = String(settings.region) as RegionKey
    const region = REGIONS[regionKey] ?? REGIONS.global
    const palette = String(settings.palette)
    const cellDeg = Number(settings.cellDeg)
    const stepHours = Number(settings.stepHours)
    const maxTracks = Number(settings.maxTracks)
    const width = Number(settings.width)
    const heightMax = Number(settings.heightKm) * 1000
    const fastThreshold = Number(settings.fastThreshold)
    const cycleMs = Math.max(4000, Number(settings.cycle) * 1000)
    let disposed = false
    ctx.onCleanup(() => {
      disposed = true
    })
    ctx.status('加载真实地震事件序列…')

    loadQuakes()
      .then((all) => {
        if (disposed) return
        const buffer = filterRegion(all, region.bounds)
        if (buffer.length === 0) {
          ctx.status('当前区域没有事件，请更换区域')
          return
        }

        const buildEnd = ctx.profiler.time('Build')
        const tracks = buildRegionTracks(buffer, cellDeg, stepHours, maxTracks)
        const buildMs = buildEnd()

        const trajectoryBuffer = trajectoryFromRecords(
          tracks.map<TrajectoryRecord>((track) => ({
            points: track.nodes.map((node) => ({ lon: node.lon, lat: node.lat, time: node.time, speed: node.speed }))
          }))
        )

        const domain = bufferTimeExtent(buffer)
        const span = Math.max(1, domain[1] - domain[0])
        const windowSpan = Math.min(span, Number(settings.windowHours) * 3600_000)
        const start = domain[0] + (span - windowSpan) * (Number(settings.offset) / 100)
        const window: [number, number] = [start, start + windowSpan]

        const collection = ctx.addPrimitive(new PolylineCollection())
        const renderEnd = ctx.profiler.time('Render')
        const result = renderTrajectories(collection, trajectoryBuffer, {
          palette,
          maxTracks,
          width,
          maxWidth: width * 2.8,
          alpha: 0.85,
          timeWindow: window,
          heightMin: 12_000,
          heightMax,
          densify: 12,
          fastThreshold,
          fastColor: '#f43f5e',
          fastWidthScale: 1.9,
          glowPower: 0.22
        })
        const renderMs = renderEnd()

        const [d0, d1] = result.speedDomain

        // 时间轴 + 播放游标
        const bins = temporalBins(buffer, 56, domain)
        const timeline = timelineOverlay(domain, window, bins, '#fde68a')

        // 轨迹动画头：沿区域质心轨迹移动
        const headCollection = ctx.pointCollection()
        const heads = tracks.map((track) => {
          const norm = normalize(track.avgSpeed, d0, d1)
          const color = Color.fromCssColorString(ramp(palette, norm))
          color.alpha = 0.96
          return {
            nodes: track.nodes,
            point: headCollection.add({
              position: Cartesian3.fromDegrees(track.nodes[0].lon, track.nodes[0].lat, 24_000),
              color,
              pixelSize: 5 + norm * 5,
              outlineColor: Color.fromCssColorString('#0b1727'),
              outlineWidth: 1.4
            })
          }
        })

        // 交互：点选轨迹段高亮
        let selected = -1
        let lastStatus = ''
        let dockStatus: ((text: string) => void) | undefined
        const statusLine = (): string => {
          const base = `${formatCount(buffer.length)} 个真实事件（区域）→ ${result.rendered} 条迁移轨迹 · ${formatCount(result.segments)} 段 · 快速迁移 ${formatCount(result.fastSegments)} 段 · 窗口 ${stamp(window[0])}–${stamp(window[1])} · ${playbackOn ? '▶ 播放中' : '⏸ 已暂停'}`
          if (selected >= 0 && tracks[selected]) {
            const track = tracks[selected]
            return `${base} · 已选 #${selected + 1}：${formatCount(track.events)} 事件 / 时长 ${track.durationH.toFixed(0)}h / 路径 ${track.lengthKm.toFixed(0)}km / 均速 ${track.avgSpeed.toFixed(1)} / 峰值 ${track.maxSpeed.toFixed(1)} km/h / M${track.magMax.toFixed(1)}`
          }
          return `${base} · 点击轨迹查看详情`
        }
        const pushStatus = (): void => {
          const line = statusLine()
          if (line === lastStatus) return
          lastStatus = line
          ctx.status(line)
          dockStatus?.(line)
        }
        const applySelection = (index: number): void => {
          if (index === selected) return
          if (selected >= 0) {
            const widths = result.trackWidths[selected] ?? []
            result.trackSegments[selected]?.forEach((polyline, i) => {
              polyline.width = widths[i] ?? polyline.width
            })
          }
          selected = index
          if (selected >= 0 && tracks[selected]) {
            const widths = result.trackWidths[selected] ?? []
            result.trackSegments[selected]?.forEach((polyline, i) => {
              polyline.width = (widths[i] ?? width) * 2.6 + 1.2
            })
          }
          pushStatus()
        }

        const handler = new ScreenSpaceEventHandler(ctx.viewer.scene.canvas)
        handler.setInputAction((movement: { position: Cartesian2 }) => {
          const picked = ctx.viewer.scene.pick(movement.position) as { id?: unknown } | undefined
          const index = picked && typeof picked.id === 'number' ? picked.id : -1
          if (index >= 0 && index < tracks.length) applySelection(index)
          else applySelection(-1)
        }, ScreenSpaceEventType.LEFT_CLICK)
        ctx.onCleanup(() => handler.destroy())

        const dock = dockTimeline({
          height: 178,
          title: '时间窗口 · 轨迹播放',
          status: statusLine(),
          legend: [
            rampLegend(palette, '迁移速度 慢→快'),
            { label: `快速迁移 ≥ ${fastThreshold} km/h`, color: '#f43f5e' },
            { label: '时间游标', color: '#fde68a' }
          ],
          chart: timeline.el
        })
        dockStatus = dock.setStatus
        lastStatus = statusLine()
        ctx.overlay(dock)

        // 每帧推进游标 & 轨迹头
        let progress = Number(settings.offset) / 100
        let cursorTime = window[0] + progress * (window[1] - window[0])
        ctx.onFrame((_time, delta) => {
          if (playbackOn) {
            progress += delta / cycleMs
            if (progress >= 1) progress -= Math.floor(progress)
            cursorTime = window[0] + progress * (window[1] - window[0])
          }
          timeline.setCursor(cursorTime)
          for (const head of heads) {
            const sample = sampleTrack(head.nodes, cursorTime)
            if (sample) head.point.position = Cartesian3.fromDegrees(sample.lon, sample.lat, 24_000)
          }
          pushStatus()
        })

        // 区域切换时飞向对应视角（不干扰参数微调）
        const previousRegion = regionState.get(ctx.viewer)
        if (previousRegion !== undefined && previousRegion !== regionKey) {
          ctx.viewer.camera.flyTo({
            destination: Cartesian3.fromDegrees(region.camera.lon, region.camera.lat, region.camera.height),
            duration: 1.2
          })
        }
        regionState.set(ctx.viewer, regionKey)

        ctx.profiler.set('Events', formatCount(all.length))
        ctx.profiler.set('Region', formatCount(buffer.length))
        ctx.profiler.set('Regions', formatCount(tracks.length))
        ctx.profiler.set('Segments', formatCount(result.segments))
        ctx.profiler.set('Fast', formatCount(result.fastSegments))
        ctx.profiler.set('Mean speed', `${mean(tracks.map((t) => t.avgSpeed)).toFixed(1)} km/h`)
        ctx.profiler.set('Peak speed', `${result.speedDomain[1].toFixed(1)} km/h`)
        ctx.profiler.set('Arc peak', formatHeight(heightMax))
        ctx.profiler.set('Build', `${buildMs.toFixed(0)} ms`)
        ctx.profiler.set('Render', `${renderMs.toFixed(0)} ms`)
        ctx.legend([
          rampLegend(palette, '迁移速度 慢→快'),
          { label: `快速迁移 ≥ ${fastThreshold} km/h`, color: '#f43f5e' },
          { label: '时间游标', color: '#fde68a' }
        ])
      })
      .catch((error: unknown) => {
        if (!disposed) ctx.status(`数据加载失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }
}

export default spec
