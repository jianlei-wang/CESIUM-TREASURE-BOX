import type { D3CaseSpec } from '../types'
import { h3binBuffer } from '../spatial/h3'
import { aggregateFlows } from '../analysis/flow'
import { filterByTimeWindow } from '../analysis/temporal'
import { renderCellPolygons } from '../render/polygons'
import { renderFlowArcs } from '../render/lines'
import { renderPointBuffer } from '../render/points'
import { bufferTimeExtent } from '../core/buffer'
import { createGeoLOD, H3_LOD_LEVELS } from '../core/lod'
import { breaksFor, classifyValue } from '../analysis/statistics'
import { ramp } from '../palettes'
import { formatCount } from '../core/geo'
import { loadQuakes, loadRoutes } from './_data'
import { PALETTE_OPTIONS, rampLegend } from './_kit'

const spec: D3CaseSpec = {
  id: 'd3-geospatial-dashboard',
  meta: {
    title: 'D3 地理大数据综合指挥舱',
    subtitle: '点云 + H3 聚合 + OD 流 + 时间窗口 + 指标面板',
    description:
      '整合真实地震点云、H3 多尺度聚合与 OpenFlights 真实航线 OD 流，叠加数据统计面板与时间窗口，展示一个完整的地理大数据分析与可视化指挥舱。',
    tag: 'Dashboard · 综合 · 多图层',
    accent: '#818cf8',
    tips: [
      '多真实数据源协同：USGS 地震点 + OpenFlights 航线',
      '点云 / H3 聚合 / OD 流三层同时表达，尺度由 LOD 控制',
      '统计面板给出输入 / 处理 / 渲染对象的实时指标'
    ]
  },
  defaults: {
    region: 'china',
    windowHours: 480,
    offset: 80,
    layers: 'points+h3+flow',
    palette: 'turbo',
    topRoutes: 400
  },
  camera: { lon: 104, lat: 35, height: 6_500_000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'windowHours', label: '时间窗口(小时)', min: 6, max: 720, step: 6 },
    { kind: 'range', key: 'offset', label: '窗口位置(%)', min: 0, max: 100, step: 1 },
    {
      kind: 'select',
      key: 'layers',
      label: '图层组合',
      options: [
        { value: 'points+h3+flow', label: '点 + H3 + OD 流' },
        { value: 'points+h3', label: '点 + H3' },
        { value: 'h3+flow', label: 'H3 + OD 流' },
        { value: 'points', label: '仅点云' }
      ]
    },
    { kind: 'range', key: 'topRoutes', label: 'Top 航线', min: 100, max: 1200, step: 50 },
    { kind: 'select', key: 'palette', label: '色带', options: PALETTE_OPTIONS }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const palette = String(settings.palette)
    const layers = String(settings.layers)
    let disposed = false
    ctx.onCleanup(() => {
      disposed = true
    })
    ctx.status('加载真实地震与航线数据…')

    Promise.all([loadQuakes(), loadRoutes()])
      .then(([quakes, routes]) => {
        if (disposed) return
        const renderEnd = ctx.profiler.time('Render')
        const domain = bufferTimeExtent(quakes)
        const span = Math.max(1, domain[1] - domain[0])
        const windowSpan = Math.min(span, Number(settings.windowHours) * 3600_000)
        const start = domain[0] + (span - windowSpan) * (Number(settings.offset) / 100)
        const window: [number, number] = [start, start + windowSpan]
        const windowed = filterByTimeWindow(quakes, window[0], window[1])

        let pointCount = 0
        let cellCount = 0
        let arcCount = 0

        if (layers.includes('flow')) {
          const arcs = aggregateFlows(routes.flow, { cellSize: 1, top: Number(settings.topRoutes), minValue: 1 })
          arcCount = renderFlowArcs(ctx.dataSource, arcs, {
            palette: 'coolwarm',
            colorBy: 'value',
            heightBy: 'distance',
            arcHeight: 700_000,
            minWidth: 0.5,
            maxWidth: 5,
            alpha: 0.5
          })
        }

        if (layers.includes('h3')) {
          const lod = createGeoLOD(H3_LOD_LEVELS)
          const level = lod.resolve(ctx.viewer.camera.positionCartographic.height)
          const cells = h3binBuffer(windowed, level.resolution)
          const counts = cells.map((cell) => cell.count)
          const breaks = breaksFor('quantile', counts, 7)
          const primitive = renderCellPolygons(cells, {
            alpha: 0.72,
            colorOf: (cell) => ramp(palette, (classifyValue(cell.count, breaks) + 0.5) / 7)
          })
          if (primitive) ctx.addPrimitive(primitive)
          cellCount = cells.length
          ctx.profiler.set('H3 Res', String(level.resolution))
          ctx.profiler.set('LOD', level.label)
        }

        if (layers.includes('points')) {
          const collection = ctx.pointCollection()
          const result = renderPointBuffer(collection, windowed, {
            mode: 'value',
            palette,
            valueDomain: [0, 6],
            pixelSize: 4,
            maxPoints: 60_000,
            alpha: 0.85
          })
          pointCount = result.rendered
        }

        const renderMs = renderEnd()
        ctx.profiler.set('Events', formatCount(quakes.length))
        ctx.profiler.set('In Window', formatCount(windowed.length))
        ctx.profiler.set('Points', formatCount(pointCount))
        ctx.profiler.set('H3 Cells', formatCount(cellCount))
        ctx.profiler.set('Routes', formatCount(routes.routeCount))
        ctx.profiler.set('Arcs', formatCount(arcCount))
        ctx.profiler.set('Render', `${renderMs.toFixed(0)} ms`)

        ctx.overlay(statsPanel(quakes.length, windowed.length, cellCount, arcCount, pointCount, window))
        ctx.status(`指挥舱 · 事件 ${formatCount(quakes.length)} · 窗口 ${formatCount(windowed.length)} · H3 ${formatCount(cellCount)} · OD ${formatCount(arcCount)}`)
        ctx.legend([rampLegend(palette, '震级 / 密度')])
      })
      .catch((error: unknown) => {
        if (!disposed) ctx.status(`数据加载失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }
}

function statsPanel(
  events: number,
  windowed: number,
  cells: number,
  arcs: number,
  points: number,
  window: [number, number]
): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText =
    'position:absolute;right:332px;bottom:16px;padding:12px 14px;border-radius:12px;background:rgba(8,15,30,0.82);border:1px solid rgba(129,140,248,0.4);color:#e2e8f0;font-size:12px;line-height:1.7;min-width:210px;backdrop-filter:blur(10px)'
  const rows: Array<[string, string]> = [
    ['D3 GEOSPATIAL BIG DATA', ''],
    ['Events', formatCount(events)],
    ['In Window', formatCount(windowed)],
    ['H3 Cells', formatCount(cells)],
    ['OD Arcs', formatCount(arcs)],
    ['Rendered Points', formatCount(points)],
    ['Window', `${formatStamp(window[0])} → ${formatStamp(window[1])}`]
  ]
  el.innerHTML = rows
    .map(([key, value], index) =>
      index === 0
        ? `<div style="color:#818cf8;letter-spacing:.16em;font-size:10px;margin-bottom:4px">${key}</div>`
        : `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#94a3b8">${key}</span><span style="color:#a5b4fc">${value}</span></div>`
    )
    .join('')
  return el
}

function formatStamp(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export default spec
