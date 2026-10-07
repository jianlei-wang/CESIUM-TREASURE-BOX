import type { D3CaseSpec } from '../types'
import { aggregateFlows, flowHubsFromArcs } from '../analysis/flow'
import { renderFlowArcs } from '../render/lines'
import { addLabel, addPoint } from '../render'
import { formatCount } from '../core/geo'
import { loadRoutes } from './_data'
import { PALETTE_OPTIONS, rampLegend } from './_kit'

const spec: D3CaseSpec = {
  id: 'd3-od-flow',
  meta: {
    title: '全球 OD 流量网络 · 真实航线',
    subtitle: 'OpenFlights routes.dat → OD 聚合 → 抬升弧线',
    description:
      '解析 OpenFlights 真实航线数据（起降机场对）与真实机场坐标，按网格聚合 OD 流量，线宽映射流量、颜色映射数值、高度映射距离，并给出枢纽机场排行。',
    tag: 'OD · Flow Arc · 网络分析',
    accent: '#f472b6',
    tips: [
      'OD 来自真实 routes.dat（机场对），机场坐标为真实值',
      '同一个 OD 对被多家航司服务时流量累加，形成真实权重',
      '线宽 = 流量、高度 = 距离、颜色 = 区域，编码与数据一一对应'
    ]
  },
  defaults: {
    top: 600,
    minValue: 1,
    cellSize: 1,
    arcHeight: 900,
    heightBy: 'distance',
    colorBy: 'value',
    palette: 'coolwarm'
  },
  camera: { lon: 20, lat: 25, height: 24_000_000, pitch: -90 },
  controls: [
    { kind: 'range', key: 'top', label: 'Top N 弧线', min: 100, max: 3000, step: 100 },
    { kind: 'range', key: 'minValue', label: '最小流量', min: 1, max: 20, step: 1 },
    { kind: 'select', key: 'cellSize', label: 'OD 聚合网格(度)', options: [ { value: '0.5', label: '0.5°' }, { value: '1', label: '1°' }, { value: '2', label: '2°' }, { value: '4', label: '4°' } ] },
    {
      kind: 'select',
      key: 'heightBy',
      label: '高度映射',
      options: [
        { value: 'distance', label: '距离' },
        { value: 'value', label: '流量' },
        { value: 'flat', label: '平铺' }
      ]
    },
    {
      kind: 'select',
      key: 'colorBy',
      label: '颜色映射',
      options: [
        { value: 'value', label: '流量数值' },
        { value: 'category', label: '区域类别' }
      ]
    },
    { kind: 'select', key: 'palette', label: '色带', options: PALETTE_OPTIONS },
    { kind: 'range', key: 'arcHeight', label: '弧线基准高度(km)', min: 100, max: 3000, step: 100 }
  ],
  setup(ctx) {
    const settings = ctx.settings
    let disposed = false
    ctx.onCleanup(() => {
      disposed = true
    })
    ctx.status('加载 OpenFlights 真实航线数据…')

    loadRoutes()
      .then((data) => {
        if (disposed) return
        const cellSize = Number(settings.cellSize)
        const top = Number(settings.top)
        const end = ctx.profiler.time('Aggregate')
        const arcs = aggregateFlows(data.flow, { cellSize, top, minValue: Number(settings.minValue) })
        const aggregateMs = end()
        const renderEnd = ctx.profiler.time('Render')
        const rendered = renderFlowArcs(ctx.dataSource, arcs, {
          palette: String(settings.palette),
          colorBy: String(settings.colorBy) as 'value' | 'category',
          heightBy: String(settings.heightBy) as 'distance' | 'value' | 'flat',
          arcHeight: Number(settings.arcHeight) * 1000,
          minWidth: 0.6,
          maxWidth: 7,
          alpha: 0.62
        })
        const renderMs = renderEnd()

        const hubs = flowHubsFromArcs(arcs, 12)
        hubs.forEach((hub, index) => {
          addPoint(ctx.dataSource, hub.lon, hub.lat, { pixelSize: 8, color: '#fef08a', outlineColor: '#9a3412', outlineWidth: 2 })
          if (index < 8) addLabel(ctx.dataSource, hub.lon, hub.lat, formatCount(hub.value), { color: '#fde68a', pixelOffsetY: -18 })
        })

        ctx.profiler.set('Routes', formatCount(data.routeCount))
        ctx.profiler.set('OD Pairs', formatCount(data.flow.length))
        ctx.profiler.set('Arcs', formatCount(rendered))
        ctx.profiler.set('Airports', formatCount(data.nodes.length))
        ctx.profiler.set('Aggregate', `${aggregateMs.toFixed(0)} ms`)
        ctx.profiler.set('Render', `${renderMs.toFixed(0)} ms`)
        ctx.status(`${formatCount(data.routeCount)} 条真实航线 · ${formatCount(data.flow.length)} 个 OD 对 · 显示 Top ${rendered} 弧线`)
        ctx.legend([rampLegend(String(settings.palette), '流量 低→高')])
      })
      .catch((error: unknown) => {
        if (!disposed) ctx.status(`数据加载失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }
}

export default spec
