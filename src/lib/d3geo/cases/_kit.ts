import type { D3LegendItem } from '../types'
import { categorical, ramp, rampCss } from '../palettes'
import type { Bounds } from '../data/loaders'

/** 拼接 public 资源地址（兼容 base './'）。 */
export function asset(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/'
  return `${base}${path.replace(/^\//, '')}`
}

/** 真实地理数据资源。 */
export const DATA = {
  worldCountries: asset('geo/world-countries.json'),
  chinaProvinces: asset('geo/china-provinces.geojson'),
  worldCities: asset('geo/world-cities.geojson'),
  airportsCsv: asset('geo/airports.csv'),
  airlineRoutes: asset('geo/airline-routes.dat'),
  usgsQuakes: asset('geo/usgs-quakes-month.geojson')
}

export const CHINA_BOUNDS: Bounds = { west: 73, south: 18, east: 135, north: 54 }

/** 连续色带图例（ramp 字段交给外壳渲染渐变条）。 */
export function rampLegend(name: string, label?: string): D3LegendItem {
  return { label: label ?? name, color: ramp(name, 0.5), ramp: name }
}

/**
 * 底部时间窗：把时间轴、状态提示与图例融合进同一条整宽玻璃面板，停靠在页面底部。
 * 左侧不再单独浮出状态条、右侧不再单独浮出图例，避免与时间轴相互遮挡。
 */
export function dockTimeline(options: {
  height: number
  chart: HTMLElement
  title?: string
  status?: string
  legend?: D3LegendItem[]
}): HTMLElement {
  const bar = document.createElement('div')
  bar.style.cssText = [
    'position:absolute',
    'left:12px',
    'right:12px',
    'bottom:12px',
    `height:${options.height}px`,
    'display:flex',
    'flex-direction:column',
    'gap:7px',
    'padding:10px 14px',
    'box-sizing:border-box',
    'border:1px solid rgba(157,188,224,0.28)',
    'border-radius:9px',
    'background:rgba(10,26,52,0.88)',
    'backdrop-filter:blur(6px)',
    'color:#dce8f5',
    'font:11px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif',
    'pointer-events:none'
  ].join(';')

  const head = document.createElement('div')
  head.style.cssText = 'display:flex;align-items:center;gap:12px;flex:0 0 auto;min-width:0'
  const title = document.createElement('span')
  title.style.cssText = 'flex:0 0 auto;color:#7cb3ff;font-weight:600;letter-spacing:.08em'
  title.textContent = options.title ?? '时间窗口'
  head.appendChild(title)
  const status = document.createElement('span')
  status.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9fb8d4'
  status.textContent = options.status ?? ''
  head.appendChild(status)
  if (options.legend?.length) {
    const legend = document.createElement('div')
    legend.style.cssText = 'display:flex;align-items:center;gap:14px;flex:0 0 auto'
    for (const item of options.legend) {
      const wrap = document.createElement('div')
      wrap.style.cssText = 'display:flex;align-items:center;gap:6px'
      const swatch = document.createElement('span')
      if (item.ramp) {
        swatch.style.cssText = 'width:88px;height:9px;border-radius:3px;border:1px solid rgba(255,255,255,0.2)'
        swatch.style.background = rampCss(item.ramp)
      } else {
        swatch.style.cssText = 'width:12px;height:12px;border-radius:3px;border:1px solid rgba(255,255,255,0.3)'
        swatch.style.background = item.color
      }
      const label = document.createElement('span')
      label.style.cssText = 'color:#c3d5e8'
      label.textContent = item.label
      wrap.append(swatch, label)
      legend.appendChild(wrap)
    }
    head.appendChild(legend)
  }
  bar.appendChild(head)

  const chartBox = document.createElement('div')
  chartBox.style.cssText = 'flex:1;min-height:0;position:relative'
  options.chart.style.width = '100%'
  options.chart.style.height = '100%'
  options.chart.style.display = 'block'
  chartBox.appendChild(options.chart)
  bar.appendChild(chartBox)
  return bar
}

/** 分类图例。 */
export function categoryLegend(labels: string[]): D3LegendItem[] {
  return labels.map((label, index) => ({ label, color: categorical(index) }))
}

/** 将米制高度格式化为可读字符串。 */
export function formatHeight(meters: number): string {
  if (meters >= 1_000_000) return `${(meters / 1_000_000).toFixed(2)} Mm`
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`
  return `${Math.round(meters)} m`
}

/** 通用色板选项。 */
export const PALETTE_OPTIONS = [
  { value: 'viridis', label: 'viridis' },
  { value: 'inferno', label: 'inferno' },
  { value: 'turbo', label: 'turbo' },
  { value: 'plasma', label: 'plasma' },
  { value: 'blues', label: 'blues' },
  { value: 'greens', label: 'greens' },
  { value: 'reds', label: 'reds' },
  { value: 'spectral', label: 'spectral' },
  { value: 'coolwarm', label: 'coolwarm' }
]

export const CLASSIFICATION_OPTIONS = [
  { value: 'quantile', label: '分位数 Quantile' },
  { value: 'equal', label: '等间距 Equal Interval' },
  { value: 'natural', label: '自然间断 Natural Breaks' }
]
