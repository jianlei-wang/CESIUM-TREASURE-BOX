/**
 * 通用栅格着色渲染：连续色带 / 分级设色 / 掩膜透明 / 晕渲叠加。
 */
import type { DemData, RGBA } from './types'
import { clamp01, classBreaks, gridStats, hexToRgb, hillshadeGrid, lutFor, rampCss, rampRgb } from './palette'

export type RasterClassStyle = {
  count?: number
  method?: 'equal' | 'quantile' | 'jenks'
  breaks?: number[]
  colors?: string[]
}

export type RasterStyle = {
  ramp?: string
  vmin?: number
  vmax?: number
  logScale?: boolean
  classes?: RasterClassStyle
  hillshade?: number
  sunAzimuth?: number
  sunAltitude?: number
  mask?: Uint8Array
  outsideTransparent?: boolean
  transparentNoData?: boolean
}

function isNoData(v: number): boolean {
  return !Number.isFinite(v)
}

export function resolveBreaks(values: Float32Array, classes: RasterClassStyle | undefined, mask?: Uint8Array): number[] {
  if (!classes) return []
  if (classes.breaks && classes.breaks.length > 0) return classes.breaks
  const count = Math.max(2, classes.count ?? 5)
  let source = values
  if (mask) {
    const picked: number[] = []
    for (let i = 0; i < values.length; i += 1) {
      if (mask[i]) picked.push(values[i])
    }
    source = Float32Array.from(picked)
  }
  return classBreaks(source, classes.method ?? 'quantile', count)
}

const DEFAULT_CLASS_COLORS = ['#2c7bb6', '#abd9e9', '#ffffbf', '#fdae61', '#d7191c']

export function classColor(colors: string[] | undefined, index: number): RGBA {
  const palette = colors && colors.length > 0 ? colors : DEFAULT_CLASS_COLORS
  return hexToRgb(palette[Math.min(index, palette.length - 1)]).concat(255) as RGBA
}

export function valueToClassIndex(v: number, breaks: number[]): number {
  let index = 0
  while (index < breaks.length && v >= breaks[index]) index += 1
  return index
}

export type ColorizeContext = {
  style: RasterStyle
  breaks: number[]
  vmin: number
  vmax: number
}

export function createColorizeContext(values: Float32Array, style: RasterStyle): ColorizeContext {
  const breaks = resolveBreaks(values, style.classes, style.mask)
  const stats = gridStats(values)
  const vmin = style.vmin ?? stats.p2
  const vmax = style.vmax ?? stats.p98
  return { style, breaks, vmin, vmax }
}

export function colorizeValue(ctx: ColorizeContext, v: number): RGBA {
  const { style, breaks, vmin, vmax } = ctx
  if (isNoData(v)) return [0, 0, 0, 0]
  if (style.classes) {
    return classColor(style.classes.colors, valueToClassIndex(v, breaks))
  }
  const span = vmax - vmin
  let t: number
  if (style.logScale) {
    const lo = Math.log1p(Math.max(0, vmin))
    const hi = Math.log1p(Math.max(0, vmax))
    const cur = Math.log1p(Math.max(0, v))
    t = hi - lo <= 0 ? 0 : (cur - lo) / (hi - lo)
  } else {
    t = span <= 0 ? 0 : (v - vmin) / span
  }
  return rampRgb(style.ramp ?? 'thermal', t)
}

export function renderRasterCanvas(dem: DemData, values: Float32Array, style: RasterStyle): HTMLCanvasElement {
  const { width, height } = dem
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const image = ctx.createImageData(width, height)
  const data = image.data
  const shade =
    style.hillshade && style.hillshade > 0
      ? hillshadeGrid(dem, style.sunAzimuth ?? 315, style.sunAltitude ?? 45)
      : null
  const strength = clamp01(style.hillshade ?? 0)
  const colorCtx = createColorizeContext(values, style)

  for (let i = 0; i < width * height; i += 1) {
    const v = values[i]
    if (isNoData(v)) {
      if (style.transparentNoData !== false) continue
      const p = i * 4
      data[p] = 20
      data[p + 1] = 26
      data[p + 2] = 34
      data[p + 3] = 255
      continue
    }
    if (style.mask && !style.mask[i] && style.outsideTransparent !== false) continue
    let rgb = colorizeValue(colorCtx, v)
    if (shade) {
      const s = 1 - strength + strength * (0.35 + 0.65 * shade[i])
      rgb = [rgb[0] * s, rgb[1] * s, rgb[2] * s, 255]
    }
    const p = i * 4
    data[p] = rgb[0]
    data[p + 1] = rgb[1]
    data[p + 2] = rgb[2]
    data[p + 3] = rgb[3]
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

export type LegendDescriptor = {
  ramp?: string
  rampLabels?: string[]
  items?: { color: string; label: string }[]
}

export function legendFromStyle(style: RasterStyle, labels: string[]): LegendDescriptor {
  if (style.classes) {
    const breaks = style.classes.breaks ?? []
    const colors = style.classes.colors && style.classes.colors.length > 0 ? style.classes.colors : DEFAULT_CLASS_COLORS
    const items: { color: string; label: string }[] = []
    for (let i = 0; i < colors.length; i += 1) {
      items.push({ color: colors[i], label: labels[i] ?? `等级 ${i + 1}` })
    }
    return { items }
  }
  return { ramp: rampCss(style.ramp ?? 'thermal'), rampLabels: labels }
}

export function formatNumber(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1e6 || (Math.abs(v) > 0 && Math.abs(v) < 1e-3)) return v.toExponential(2)
  return v.toFixed(digits)
}
