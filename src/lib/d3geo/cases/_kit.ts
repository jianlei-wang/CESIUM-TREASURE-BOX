import type { D3LegendItem } from '../types'
import { categorical, ramp } from '../palettes'
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
 * 把覆盖层（时间轴等）停靠为底部玻璃面板，避开右上参数面板与右下图例，
 * 避免裸 SVG 被 overlay 拉伸到整屏 inset:0 后与面板叠在一起。
 */
export function dockBottom(
  el: HTMLElement,
  height: number,
  options: { left?: number; right?: number; bottom?: number } = {}
): HTMLElement {
  const box = document.createElement('div')
  box.style.cssText = [
    'position:absolute',
    `left:${options.left ?? 12}px`,
    `right:${options.right ?? 300}px`,
    `bottom:${options.bottom ?? 56}px`,
    `height:${height}px`,
    'padding:8px 12px',
    'box-sizing:border-box',
    'border:1px solid rgba(157,188,224,0.28)',
    'border-radius:9px',
    'background:rgba(10,26,52,0.86)',
    'backdrop-filter:blur(6px)',
    'pointer-events:none'
  ].join(';')
  el.style.width = '100%'
  el.style.height = '100%'
  el.style.display = 'block'
  box.appendChild(el)
  return box
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
