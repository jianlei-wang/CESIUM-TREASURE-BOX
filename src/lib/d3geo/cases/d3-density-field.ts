import type { D3CaseSpec } from '../types'
import type { GeoPointBuffer } from '../core/buffer'
import type { AggregateCell } from '../spatial/hexbin'
import { kdeGrid, type Bounds, type GridField } from '../analysis/density'
import { contourBands, contourThresholds } from '../analysis/contour'
import { renderCellPolygons } from '../render/polygons'
import { addLabel, addPoint, addPolyline } from '../render'
import { ramp } from '../palettes'
import { formatCount, normalize } from '../core/geo'
import { loadQuakes } from './_data'
import { PALETTE_OPTIONS, rampLegend } from './_kit'

type RegionKey = 'global' | 'china' | 'japan' | 'indonesia' | 'california'

const REGIONS: Record<RegionKey, Bounds> = {
  global: { west: -180, south: -60, east: 180, north: 72 },
  china: { west: 73, south: 18, east: 135, north: 54 },
  japan: { west: 128, south: 30, east: 146, north: 46 },
  indonesia: { west: 95, south: -11, east: 141, north: 8 },
  california: { west: -125, south: 32, east: -114, north: 42 }
}

const spec: D3CaseSpec = {
  id: 'd3-density-field',
  meta: {
    title: '动态热力场 · KDE 连续密度',
    subtitle: '真实地震点 → KDE 连续场 → 贴地面场 + 等值线 + 峰值',
    description:
      '以 USGS 近一月真实地震目录为输入，核密度估计生成连续数值场，d3.contours 提取等值线，场以贴地面块与三维峰值标记表达，而非叠加半透明圆。',
    tag: 'KDE · d3.contours · 连续场',
    accent: '#fb923c',
    tips: [
      '输入是真实 USGS 地震目录（时间 / 震级 / 经纬度），非随机数据',
      'KDE 在分析层生成连续场，d3.contours 承担等值线提取',
      '密度 → 颜色 / 高度，等值线 → 数值等级，视觉由数据决定'
    ]
  },
  defaults: {
    region: 'global',
    weight: 'count',
    radius: 2.4,
    palette: 'inferno',
    levels: 7,
    showField: true,
    showContour: true,
    showPeaks: true
  },
  camera: { lon: 20, lat: 20, height: 22_000_000, pitch: -90 },
  controls: [
    {
      kind: 'select',
      key: 'region',
      label: '分析区域',
      options: [
        { value: 'global', label: '全球' },
        { value: 'china', label: '中国及周边' },
        { value: 'japan', label: '日本' },
        { value: 'indonesia', label: '印尼' },
        { value: 'california', label: '加州' }
      ]
    },
    { kind: 'select', key: 'weight', label: '权重', options: [{ value: 'count', label: '事件计数' }, { value: 'value', label: '震级加权' }] },
    { kind: 'range', key: 'radius', label: '核半径', min: 0.6, max: 6, step: 0.2 },
    { kind: 'select', key: 'palette', label: '色带', options: PALETTE_OPTIONS },
    { kind: 'range', key: 'levels', label: '等值线层数', min: 3, max: 12, step: 1 },
    { kind: 'checkbox', key: 'showField', label: '贴地密度场' },
    { kind: 'checkbox', key: 'showContour', label: '等值线' },
    { kind: 'checkbox', key: 'showPeaks', label: '峰值标记' }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const bounds = REGIONS[String(settings.region) as RegionKey] ?? REGIONS.global
    const palette = String(settings.palette)
    const levels = Number(settings.levels)
    let disposed = false
    ctx.onCleanup(() => {
      disposed = true
    })
    ctx.status('加载真实地震数据（USGS 近一月）…')

    loadQuakes()
      .then((buffer) => {
        if (disposed) return
        render(buffer)
      })
      .catch((error: unknown) => {
        if (!disposed) ctx.status(`数据加载失败：${error instanceof Error ? error.message : String(error)}`)
      })

    function render(buffer: GeoPointBuffer): void {
      const aspect = (bounds.east - bounds.west) / Math.max(1e-6, bounds.north - bounds.south)
      const width = 160
      const height = Math.max(48, Math.round(width / Math.max(0.4, aspect)))
      const end = ctx.profiler.time('KDE')
      const field: GridField = kdeGrid(buffer, {
        width,
        height,
        bounds,
        radius: Number(settings.radius),
        weight: String(settings.weight) as 'count' | 'value'
      })
      const kdeMs = end()
      ctx.profiler.set('Input', formatCount(buffer.length))
      ctx.profiler.set('Grid', `${width}×${height}`)
      ctx.profiler.set('Peak', field.max.toFixed(1))
      ctx.profiler.set('KDE', `${kdeMs.toFixed(0)} ms`)

      if (Boolean(settings.showField)) {
        const endRender = ctx.profiler.time('Render')
        const cells = fieldToCells(field)
        const primitive = renderCellPolygons(cells, {
          alpha: 0.86,
          colorOf: (cell) => ramp(palette, normalize(cell.count, 0, field.max))
        })
        if (primitive) ctx.addPrimitive(primitive)
        ctx.profiler.set('Render', `${endRender().toFixed(0)} ms`)
        ctx.profiler.set('Cells', formatCount(cells.length))
      }

      if (Boolean(settings.showContour)) {
        const thresholds = contourThresholds(field.min, field.max, levels)
        const bands = contourBands(field, thresholds)
        let lines = 0
        bands.forEach((band, index) => {
          const color = ramp(palette, 0.35 + 0.65 * (index / Math.max(1, bands.length - 1)))
          for (const polygon of band.polygons) {
            for (const ring of polygon) {
              if (ring.length < 2) continue
              addPolyline(ctx.dataSource, ring, { width: 1.1, color, alpha: 0.75, height: 12_000 })
              lines += 1
            }
          }
        })
        ctx.profiler.set('Contours', formatCount(lines))
      }

      if (Boolean(settings.showPeaks)) {
        const peaks = topCells(field, 8)
        for (const peak of peaks) {
          addPoint(ctx.dataSource, peak.lon, peak.lat, { pixelSize: 9, color: '#fef08a', outlineColor: '#7c2d12', outlineWidth: 2, disableDepthTest: true })
          addLabel(ctx.dataSource, peak.lon, peak.lat, `σ=${peak.value.toFixed(1)}`, { color: '#fde68a', pixelOffsetY: -20 })
        }
        ctx.profiler.set('Peaks', formatCount(peaks.length))
      }

      ctx.status(`${formatCount(buffer.length)} 个真实地震事件 · 峰值密度 ${field.max.toFixed(1)} · ${width}×${height} 网格`)
      ctx.legend([rampLegend(palette, '密度 低→高')])
    }
  }
}

function fieldToCells(field: GridField): AggregateCell[] {
  const { width, height, bounds, values } = field
  const lonSpan = (bounds.east - bounds.west) / width
  const latSpan = (bounds.north - bounds.south) / height
  const cells: AggregateCell[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = values[y * width + x]
      if (value <= 0) continue
      const west = bounds.west + x * lonSpan
      const south = bounds.south + y * latSpan
      cells.push({
        key: `${x},${y}`,
        lon: west + lonSpan / 2,
        lat: south + latSpan / 2,
        polygon: [
          [west, south],
          [west + lonSpan, south],
          [west + lonSpan, south + latSpan],
          [west, south + latSpan]
        ] as Array<[number, number]>,
        count: value,
        sum: value,
        mean: value,
        min: value,
        max: value
      })
    }
  }
  return cells
}

function topCells(field: GridField, top: number): Array<{ lon: number; lat: number; value: number }> {
  const { width, height, bounds, values } = field
  const lonSpan = (bounds.east - bounds.west) / width
  const latSpan = (bounds.north - bounds.south) / height
  const cells: Array<{ lon: number; lat: number; value: number }> = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cells.push({ lon: bounds.west + (x + 0.5) * lonSpan, lat: bounds.south + (y + 0.5) * latSpan, value: values[y * width + x] })
    }
  }
  return cells.sort((a, b) => b.value - a.value).slice(0, top)
}

export default spec
