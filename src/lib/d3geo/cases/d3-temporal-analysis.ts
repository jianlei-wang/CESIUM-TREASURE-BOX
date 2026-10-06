import { extent, max, mean, quantile, scaleLinear, scaleTime } from 'd3'
import type { D3CaseSpec } from '../types'
import type { GeoPointBuffer } from '../core/buffer'
import type { Bounds } from '../analysis/density'
import { bufferTimeExtent } from '../core/buffer'
import { temporalBins, filterByTimeWindow, type TemporalBin } from '../analysis/temporal'
import { movingAverage } from '../analysis/statistics'
import { renderPointBuffer } from '../render/points'
import { formatCount } from '../core/geo'
import { loadQuakes } from './_data'
import { PALETTE_OPTIONS, rampLegend } from './_kit'

type RegionKey = 'global' | 'japan' | 'indonesia' | 'china' | 'americas'

const REGIONS: Record<RegionKey, { bounds: Bounds; camera: { lon: number; lat: number; height: number } }> = {
  global: { bounds: { west: -180, south: -60, east: 180, north: 72 }, camera: { lon: 20, lat: 20, height: 24_000_000 } },
  japan: { bounds: { west: 128, south: 30, east: 146, north: 46 }, camera: { lon: 138, lat: 37, height: 3_200_000 } },
  indonesia: { bounds: { west: 95, south: -11, east: 141, north: 8 }, camera: { lon: 118, lat: -2, height: 4_000_000 } },
  china: { bounds: { west: 73, south: 18, east: 135, north: 54 }, camera: { lon: 104, lat: 35, height: 5_500_000 } },
  americas: { bounds: { west: -130, south: 15, east: -60, north: 60 }, camera: { lon: -95, lat: 40, height: 8_000_000 } }
}

function stamp(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function chartOverlay(bins: TemporalBin[], smooth: number[], anomaly: boolean[], domain: [number, number], window: [number, number]): HTMLElement {
  const width = 760
  const height = 150
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', `${height}`)
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  const padX = 46
  const padTop = 18
  const padBottom = 34
  const xScale = scaleTime().domain(domain).range([padX, width - padX])
  const maxCount = max(bins, (b: TemporalBin) => b.count) ?? 1
  const yScale = scaleLinear().domain([0, Math.max(1, maxCount)]).range([height - padBottom, padTop])
  const barWidth = Math.max(1, (width - padX * 2) / bins.length - 1)
  for (const item of bins) {
    const x = xScale(item.t0)
    const y = yScale(item.count)
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(x))
    rect.setAttribute('y', String(y))
    rect.setAttribute('width', String(barWidth))
    rect.setAttribute('height', String(Math.max(0, height - padBottom - y)))
    rect.setAttribute('fill', 'rgba(56,189,248,0.5)')
    svg.appendChild(rect)
  }
  const smoothPath = smooth
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${xScale(bins[index].t0).toFixed(1)},${yScale(value).toFixed(1)}`)
    .join(' ')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', smoothPath)
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', '#fbbf24')
  path.setAttribute('stroke-width', '2')
  svg.appendChild(path)
  bins.forEach((item, index) => {
    if (!anomaly[index]) return
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    mark.setAttribute('cx', String(xScale(item.t0)))
    mark.setAttribute('cy', String(yScale(item.count)))
    mark.setAttribute('r', '3')
    mark.setAttribute('fill', '#f87171')
    svg.appendChild(mark)
  })
  const w0 = Math.max(domain[0], window[0])
  const w1 = Math.min(domain[1], window[1])
  const win = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  win.setAttribute('x', String(xScale(w0)))
  win.setAttribute('width', String(Math.max(1, xScale(w1) - xScale(w0))))
  win.setAttribute('y', String(padTop))
  win.setAttribute('height', String(height - padTop - padBottom))
  win.setAttribute('fill', 'none')
  win.setAttribute('stroke', '#fb923c')
  win.setAttribute('stroke-width', '1.5')
  svg.appendChild(win)
  for (const tick of xScale.ticks(6)) {
    const x = xScale(tick)
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('x', String(x))
    label.setAttribute('y', String(height - 12))
    label.setAttribute('fill', '#cbd5e1')
    label.setAttribute('font-size', '10')
    label.setAttribute('text-anchor', 'middle')
    label.textContent = stamp(tick.getTime())
    svg.appendChild(label)
  }
  return svg as unknown as HTMLElement
}

const spec: D3CaseSpec = {
  id: 'd3-temporal-analysis',
  meta: {
    title: '时空统计分析 · 时间轴 + 异常',
    subtitle: '真实地震序列 → 时间分箱 → 移动平均 / 分位数 / 异常',
    description:
      '对真实地震时间序列做 D3 时间分箱、移动平均、分位数与异常检测，二维统计图与三维地球点云通过时间窗口联动，展示时间-空间-数值三者的联合分析。',
    tag: 'Temporal · d3.bin · 异常检测',
    accent: '#f59e0b',
    tips: [
      '时间、位置、震级均为真实数据',
      'd3.bin / d3.quantile / d3.max 承担统计职责，移动平均与 Z 分数识别异常',
      '二维统计图与三维点云共享时间窗口，实现联动分析'
    ]
  },
  defaults: {
    region: 'global',
    windowHours: 336,
    offset: 70,
    bins: 60,
    palette: 'turbo',
    anomalyZ: 2
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
    { kind: 'range', key: 'windowHours', label: '时间窗口(小时)', min: 12, max: 720, step: 12 },
    { kind: 'range', key: 'offset', label: '窗口位置(%)', min: 0, max: 100, step: 1 },
    { kind: 'range', key: 'bins', label: '分箱数', min: 20, max: 120, step: 4 },
    { kind: 'range', key: 'anomalyZ', label: '异常阈值(Z)', min: 1, max: 4, step: 0.25 },
    { kind: 'select', key: 'palette', label: '色带', options: PALETTE_OPTIONS }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const region = REGIONS[String(settings.region) as RegionKey] ?? REGIONS.global
    const palette = String(settings.palette)
    let disposed = false
    ctx.onCleanup(() => {
      disposed = true
    })
    ctx.status('加载真实地震时间序列…')

    loadQuakes()
      .then((all) => {
        if (disposed) return
        const [west, south, east, north] = [region.bounds.west, region.bounds.south, region.bounds.east, region.bounds.north]
        const filteredIndices: number[] = []
        for (let i = 0; i < all.length; i += 1) {
          const lon = all.positions[i * 2]
          const lat = all.positions[i * 2 + 1]
          if (lon >= west && lon <= east && lat >= south && lat <= north) filteredIndices.push(i)
        }
        const buffer = subset(all, filteredIndices)
        const domain = bufferTimeExtent(buffer)
        const span = Math.max(1, domain[1] - domain[0])
        const windowSpan = Math.min(span, Number(settings.windowHours) * 3600_000)
        const start = domain[0] + (span - windowSpan) * (Number(settings.offset) / 100)
        const window: [number, number] = [start, start + windowSpan]

        const bins = temporalBins(buffer, Number(settings.bins), domain)
        const counts = bins.map((item) => item.count)
        const smooth = movingAverage(counts, 5)
        const threshold = quantile(counts as unknown as number[], 0.75) ?? 0
        const anomaly = counts.map((count, index) => count > (smooth[index] ?? 0) + Number(settings.anomalyZ) * stdDev(counts))
        void threshold

        const collection = ctx.pointCollection()
        const inWindow = filterByTimeWindow(buffer, window[0], window[1])
        const renderEnd = ctx.profiler.time('Render')
        renderPointBuffer(collection, inWindow, {
          mode: 'value',
          palette,
          valueDomain: [0, Math.max(3, extent(buffer.values as unknown as number[])[1] ?? 5)],
          pixelSize: 4.5,
          maxPoints: 40_000,
          alpha: 0.9
        })
        ctx.profiler.set('Render', `${renderEnd().toFixed(0)} ms`)

        ctx.overlay(chartOverlay(bins, smooth, anomaly, domain, window))

        const anomalies = anomaly.filter(Boolean).length
        ctx.profiler.set('Events', formatCount(all.length))
        ctx.profiler.set('Region', formatCount(buffer.length))
        ctx.profiler.set('In Window', formatCount(inWindow.length))
        ctx.profiler.set('Bins', String(bins.length))
        ctx.profiler.set('Anomalies', String(anomalies))
        ctx.profiler.set('Mean/Bin', (mean(counts as unknown as number[]) ?? 0).toFixed(1))
        ctx.status(`${formatCount(buffer.length)} 个真实事件（区域）· 窗口命中 ${formatCount(inWindow.length)} · 异常分箱 ${anomalies}`)
        ctx.legend([rampLegend(palette, '震级 低→高')])
      })
      .catch((error: unknown) => {
        if (!disposed) ctx.status(`数据加载失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0
  const m = values.reduce((acc, value) => acc + value, 0) / values.length
  return Math.sqrt(values.reduce((acc, value) => acc + (value - m) ** 2, 0) / values.length)
}

function subset(buffer: GeoPointBuffer, indices: number[]): GeoPointBuffer {
  const positions = new Float32Array(indices.length * 2)
  const values = new Float32Array(indices.length)
  const categories = new Uint16Array(indices.length)
  const timestamps = new Float64Array(indices.length)
  indices.forEach((source, target) => {
    positions[target * 2] = buffer.positions[source * 2]
    positions[target * 2 + 1] = buffer.positions[source * 2 + 1]
    values[target] = buffer.values[source]
    categories[target] = buffer.categories[source]
    timestamps[target] = buffer.timestamps[source]
  })
  return { length: indices.length, positions, values, categories, timestamps }
}

export default spec
