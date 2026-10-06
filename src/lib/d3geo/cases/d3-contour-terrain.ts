import type { D3CaseSpec } from '../types'
import type { Bounds, GridField } from '../analysis/density'
import { idwGrid } from '../analysis/interpolation'
import { kdeGrid } from '../analysis/density'
import { contourBands, contourThresholds } from '../analysis/contour'
import { renderContourBands } from '../render/polygons'
import { renderPointBuffer } from '../render/points'
import { loadQuakes } from './_data'
import { PALETTE_OPTIONS, formatHeight, rampLegend } from './_kit'

type RegionKey = 'japan' | 'california' | 'indonesia' | 'china' | 'global'

const REGIONS: Record<RegionKey, { bounds: Bounds; camera: { lon: number; lat: number; height: number } }> = {
  japan: { bounds: { west: 128, south: 30, east: 146, north: 46 }, camera: { lon: 138, lat: 37, height: 2_800_000 } },
  california: { bounds: { west: -125, south: 32, east: -114, north: 42 }, camera: { lon: -119.5, lat: 37, height: 2_000_000 } },
  indonesia: { bounds: { west: 95, south: -11, east: 141, north: 8 }, camera: { lon: 118, lat: -2, height: 3_500_000 } },
  china: { bounds: { west: 73, south: 18, east: 135, north: 54 }, camera: { lon: 104, lat: 35, height: 4_800_000 } },
  global: { bounds: { west: -180, south: -60, east: 180, north: 72 }, camera: { lon: 20, lat: 15, height: 20_000_000 } }
}

const spec: D3CaseSpec = {
  id: 'd3-contour-terrain',
  meta: {
    title: '等值线地形场 · IDW → d3.contours → 三维抬升',
    subtitle: '真实震级采样 → 连续场 → 等值面 → Cesium 拉伸地形',
    description:
      '对 USGS 真实地震震级做反距离加权插值得到连续数值场，d3.contours 提取等值面，再按数值等级在三维地球上拉伸为地形，展示从离散采样到连续分析场的完整链路。',
    tag: 'IDW · d3.contours · 三维地形',
    accent: '#a78bfa',
    tips: [
      '输入为真实地震目录的震级采样，非噪声数据',
      'IDW 插值 + d3.contours 等值面，是典型 D3 分析职责',
      '等值面的数值等级 → 颜色 + 拉伸高度，形成可读的地形场'
    ]
  },
  defaults: {
    region: 'japan',
    method: 'idw',
    gridWidth: 96,
    power: 2,
    levels: 9,
    extrude: 600,
    palette: 'spectral',
    showPoints: true
  },
  camera: { lon: 138, lat: 37, height: 2_800_000, pitch: -55 },
  controls: [
    {
      kind: 'select',
      key: 'region',
      label: '分析区域',
      options: [
        { value: 'japan', label: '日本' },
        { value: 'california', label: '加州' },
        { value: 'indonesia', label: '印尼' },
        { value: 'china', label: '中国及周边' },
        { value: 'global', label: '全球' }
      ]
    },
    { kind: 'select', key: 'method', label: '插值方法', options: [{ value: 'idw', label: 'IDW 反距离加权' }, { value: 'kde', label: 'KDE 核密度' }] },
    { kind: 'range', key: 'gridWidth', label: '网格宽度', min: 48, max: 160, step: 8 },
    { kind: 'range', key: 'power', label: 'IDW 幂指数', min: 1, max: 5, step: 0.5 },
    { kind: 'range', key: 'levels', label: '等值面层数', min: 4, max: 14, step: 1 },
    { kind: 'range', key: 'extrude', label: '最大抬升(km)', min: 50, max: 1500, step: 50 },
    { kind: 'select', key: 'palette', label: '色带', options: PALETTE_OPTIONS },
    { kind: 'checkbox', key: 'showPoints', label: '显示采样点' }
  ],
  setup(ctx) {
    const settings = ctx.settings
    const region = REGIONS[String(settings.region) as RegionKey] ?? REGIONS.japan
    const bounds = region.bounds
    const palette = String(settings.palette)
    const levels = Number(settings.levels)
    const extrude = Number(settings.extrude) * 1000
    let disposed = false
    ctx.onCleanup(() => {
      disposed = true
    })
    ctx.status('加载真实地震数据（USGS 近一月）…')

    loadQuakes()
      .then((buffer) => {
        if (disposed) return
        const aspect = (bounds.east - bounds.west) / Math.max(1e-6, bounds.north - bounds.south)
        const width = Number(settings.gridWidth)
        const height = Math.max(40, Math.round(width / Math.max(0.4, aspect)))
        const end = ctx.profiler.time('Field')
        const field: GridField =
          String(settings.method) === 'kde'
            ? kdeGrid(buffer, { width, height, bounds, radius: 2, weight: 'value' })
            : idwGrid(buffer, { width, height, bounds, power: Number(settings.power), maxControlPoints: 700 })
        const fieldMs = end()

        const thresholds = contourThresholds(field.min, field.max, levels)
        const bandEnd = ctx.profiler.time('Contours')
        const bands = contourBands(field, thresholds)
        ctx.profiler.set('Contours', `${bandEnd().toFixed(0)} ms`)

        const renderEnd = ctx.profiler.time('Render')
        const primitive = renderContourBands(bands, {
          palette,
          extrude,
          base: 0,
          alpha: 0.82,
          heightByValue: true
        })
        if (primitive) ctx.addPrimitive(primitive)
        ctx.profiler.set('Render', `${renderEnd().toFixed(0)} ms`)

        if (Boolean(settings.showPoints)) {
          const collection = ctx.pointCollection()
          renderPointBuffer(collection, buffer, {
            mode: 'value',
            palette: 'coolwarm',
            valueDomain: [Math.max(0, field.min), field.max],
            pixelSize: 4,
            maxPoints: 12_000,
            alpha: 0.9
          })
        }

        ctx.profiler.set('Input', buffer.length.toLocaleString('en-US'))
        ctx.profiler.set('Grid', `${width}×${height}`)
        ctx.profiler.set('Bands', String(bands.length))
        ctx.profiler.set('Field', `${fieldMs.toFixed(0)} ms`)
        ctx.profiler.set('Extrude', formatHeight(extrude))
        ctx.status(`${buffer.length.toLocaleString('en-US')} 个真实地震采样 · ${bands.length} 层等值面 · 抬升 ${formatHeight(extrude)}`)
        ctx.legend([rampLegend(palette, '场值 低→高')])
      })
      .catch((error: unknown) => {
        if (!disposed) ctx.status(`数据加载失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }
}

export default spec
