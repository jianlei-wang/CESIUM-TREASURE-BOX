import { bin, brushX, scaleLinear, select } from 'd3'
import type { D3CaseSpec } from '../types'
import { mulberry32 } from '../data'
import { categorical } from '../palettes'
import { addToPointCollection } from '../render'

type EventItem = { t: number; lon: number; lat: number }
type BrushEvent = { selection: number[] | null }

const NS = 'http://www.w3.org/2000/svg'
const BOUNDS = { west: 100, south: 22, east: 124, north: 42 }

function buildEvents(count: number, spanHours: number, seed: number): EventItem[] {
  const rng = mulberry32(seed)
  const peaks = Array.from({ length: 6 }, () => rng() * spanHours)
  const events: EventItem[] = []
  for (let i = 0; i < count; i += 1) {
    const peak = peaks[Math.floor(rng() * peaks.length)]
    const t = Math.max(0, Math.min(spanHours, peak + (rng() - 0.5) * spanHours * 0.14))
    events.push({
      t,
      lon: BOUNDS.west + rng() * (BOUNDS.east - BOUNDS.west),
      lat: BOUNDS.south + rng() * (BOUNDS.north - BOUNDS.south)
    })
  }
  return events
}

const spec: D3CaseSpec = {
  id: 'd3-time-brush',
  meta: {
    title: '时间刷联动过滤',
    subtitle: 'd3.brushX 框选时间轴 → 实时过滤三维事件点',
    description: '在 SVG 时间轴上拖拽刷选时间区间，地图上只保留该时段发生的事件点并同步统计。',
    tag: 'D3 交互 · 时间刷选',
    accent: '#22d3ee',
    tips: [
      'd3.brushX 提供标准的区间拖拽交互，可拖拽移动、点击空白清除选择',
      '覆盖层容器默认 pointerEvents=none，SVG 单独设为 auto 使刷选可用且不遮挡地球操作',
      '筛选只切换 PointPrimitive.show，不重建图元，联动到三维大屏也保持流畅'
    ]
  },
  defaults: {
    eventCount: 2400,
    spanDays: 3,
    pointSize: 5,
    brushBins: 60,
    seed: 20261006
  },
  camera: { lon: 112, lat: 32, height: 4200000, pitch: -62 },
  controls: [
    { kind: 'range', key: 'eventCount', label: '事件数量', min: 400, max: 8000, step: 200, format: (v) => v.toLocaleString() },
    { kind: 'range', key: 'spanDays', label: '时间跨度(天)', min: 1, max: 14, step: 1 },
    { kind: 'range', key: 'pointSize', label: '点大小(px)', min: 2, max: 12, step: 1 },
    { kind: 'range', key: 'brushBins', label: '直方图分箱', min: 20, max: 120, step: 10 },
    { kind: 'range', key: 'seed', label: '随机种子', min: 1, max: 9999999, step: 1 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const eventCount = Number(settings.eventCount)
    const spanHours = Number(settings.spanDays) * 24
    const pointSize = Number(settings.pointSize)
    const brushBins = Number(settings.brushBins)

    const events = buildEvents(eventCount, spanHours, Number(settings.seed))
    const collection = ctx.pointCollection()
    const marks = events.map((event) => {
      const bucket = Math.min(11, Math.floor((event.t / spanHours) * 12))
      const primitive = addToPointCollection(collection, event.lon, event.lat, 0, categorical(bucket), pointSize)
      return { primitive, t: event.t }
    })

    const containerWidth = ctx.viewer.container.clientWidth || 960
    const width = Math.max(420, Math.min(860, containerWidth - 48))
    const height = 132
    const margin = { top: 14, right: 18, bottom: 30, left: 18 }

    const wrap = document.createElement('div')
    ctx.overlay(wrap)
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    svg.style.position = 'absolute'
    svg.style.left = '50%'
    svg.style.bottom = '76px'
    svg.style.transform = 'translateX(-50%)'
    svg.style.pointerEvents = 'auto'
    svg.style.touchAction = 'none'
    svg.style.background = 'rgba(15, 23, 42, 0.8)'
    svg.style.border = '1px solid rgba(148, 163, 184, 0.24)'
    svg.style.borderRadius = '10px'
    svg.style.backdropFilter = 'blur(8px)'
    wrap.appendChild(svg)

    const x = scaleLinear().domain([0, spanHours]).range([margin.left, width - margin.right])
    const histogram = bin()
      .value((d: EventItem) => d.t)
      .domain([0, spanHours])
      .thresholds(brushBins)(events) as Array<Array<EventItem> & { x0: number; x1: number }>
    const maxBin = histogram.reduce((acc, bucket) => Math.max(acc, bucket.length), 1)
    const plotBottom = height - margin.bottom
    const y = scaleLinear().domain([0, maxBin]).range([plotBottom, margin.top + 16])

    const svgRoot = select(svg)
    const bars: Array<{ el: SVGRectElement; x0: number; x1: number }> = []
    const barGroup = svgRoot.append('g')
    for (const bucket of histogram) {
      const bx = x(bucket.x0)
      const bw = Math.max(1, x(bucket.x1) - bx - 1)
      const el = barGroup
        .append('rect')
        .attr('x', bx)
        .attr('y', y(bucket.length))
        .attr('width', bw)
        .attr('height', Math.max(0, plotBottom - y(bucket.length)))
        .attr('rx', 1.5)
        .attr('fill', '#38bdf8')
        .node() as SVGRectElement
      bars.push({ el, x0: bucket.x0, x1: bucket.x1 })
    }

    const tickGroup = svgRoot.append('g')
    for (const tick of x.ticks(6) as number[]) {
      const tx = x(tick)
      tickGroup
        .append('line')
        .attr('x1', tx)
        .attr('x2', tx)
        .attr('y1', plotBottom)
        .attr('y2', plotBottom + 5)
        .attr('stroke', 'rgba(148, 163, 184, 0.6)')
      tickGroup
        .append('text')
        .attr('x', tx)
        .attr('y', plotBottom + 18)
        .attr('fill', '#94a3b8')
        .attr('font-size', 10)
        .attr('text-anchor', 'middle')
        .text(tick >= 24 ? `${(tick / 24).toFixed(0)}d` : `${String(Math.round(tick)).padStart(2, '0')}:00`)
    }

    const applyRange = (range: [number, number] | null): void => {
      let visible = 0
      for (const mark of marks) {
        const inside = range === null || (mark.t >= range[0] && mark.t <= range[1])
        mark.primitive.show = inside
        if (inside) visible += 1
      }
      for (const bar of bars) {
        const active = range === null || (bar.x1 >= range[0] && bar.x0 <= range[1])
        bar.el.setAttribute('fill', active ? '#22d3ee' : 'rgba(148, 163, 184, 0.28)')
      }
      if (range === null) {
        ctx.status(`时间轴未框选 · 显示全部 ${marks.length.toLocaleString()} 个事件`)
      } else {
        ctx.status(
          `框选 ${range[0].toFixed(1)} ~ ${range[1].toFixed(1)} h · 命中 ${visible.toLocaleString()} / ${marks.length.toLocaleString()}`
        )
      }
    }

    const brush = brushX()
      .extent([
        [margin.left, margin.top],
        [width - margin.right, plotBottom]
      ])
      .on('brush end', (event: BrushEvent) => {
        const selection = event.selection
        if (!selection || selection.length < 2) {
          applyRange(null)
          return
        }
        applyRange([x.invert(selection[0]), x.invert(selection[1])])
      })
    const brushGroup = svgRoot.append('g')
    brushGroup.call(brush)

    applyRange(null)
    ctx.legend([
      { label: '事件时间分桶（12 色）', color: '#22d3ee' },
      { label: `时间跨度 ${Number(settings.spanDays)} 天`, color: '#38bdf8' }
    ])

    ctx.onCleanup(() => {
      try {
        svgRoot.selectAll('*').on('.brush', null)
      } catch {
        /* element already detached */
      }
    })
  }
}

export default spec
