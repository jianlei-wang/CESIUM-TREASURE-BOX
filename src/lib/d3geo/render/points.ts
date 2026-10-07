import { Cartesian3, Color, PointPrimitiveCollection } from 'cesium'
import type { GeoPointBuffer } from '../core/buffer'
import { categorical, ramp } from '../palettes'

export type PointColorMode = 'value' | 'category' | 'single'

export type RenderPointsOptions = {
  mode?: PointColorMode
  palette?: string
  color?: string
  valueDomain?: [number, number]
  pixelSize?: number
  alpha?: number
  /** 最多渲染多少点（超出按 stride 抽稀）。 */
  maxPoints?: number
  /** 高度（米）。 */
  height?: number
  /** 按像素距离缩放 [near, nearScale, far, farScale]。 */
  scaleByDistance?: [number, number, number, number] | null
}

export type RenderPointsResult = {
  rendered: number
  stride: number
}

const colorCache = new Map<string, Color>()

/** 色带采样档数：预生成调色表，避免逐点做 ramp + 颜色解析。 */
const LUT_SIZE = 256

function cssColor(css: string, alpha: number): Color {
  const key = `${css}|${alpha}`
  let color = colorCache.get(key)
  if (!color) {
    color = Color.fromCssColorString(css)
    color.alpha = alpha
    colorCache.set(key, color)
  }
  return color
}

function buildRampLut(palette: string, alpha: number): Color[] {
  const lut = new Array<Color>(LUT_SIZE)
  for (let i = 0; i < LUT_SIZE; i += 1) lut[i] = cssColor(ramp(palette, i / (LUT_SIZE - 1)), alpha)
  return lut
}

function buildCategoryLut(categoryCount: number, alpha: number): Color[] {
  const count = Math.max(1, categoryCount)
  const lut = new Array<Color>(count)
  for (let i = 0; i < count; i += 1) lut[i] = cssColor(categorical(i), alpha)
  return lut
}

/**
 * 用 PointPrimitiveCollection 批量渲染海量点（GPU 点图元，非逐条 Entity）。
 * 超过 maxPoints 时按 stride 抽稀，保证视域内抽稀均匀。
 */
export function renderPointBuffer(
  collection: PointPrimitiveCollection,
  buffer: GeoPointBuffer,
  options: RenderPointsOptions = {}
): RenderPointsResult {
  const mode = options.mode ?? 'value'
  const maxPoints = options.maxPoints ?? 150_000
  const stride = buffer.length > maxPoints ? Math.ceil(buffer.length / maxPoints) : 1
  const alpha = options.alpha ?? 1
  const pixelSize = options.pixelSize ?? 5
  const height = options.height ?? 0
  const domain = options.valueDomain
  const palette = options.palette ?? 'viridis'
  const single = cssColor(options.color ?? '#38bdf8', alpha)
  const rampLut = mode === 'value' && domain ? buildRampLut(palette, alpha) : undefined
  let categoryLut: Color[] | undefined
  if (mode === 'category') {
    let maxCategory = 0
    for (let i = 0; i < buffer.length; i += 1) if (buffer.categories[i] > maxCategory) maxCategory = buffer.categories[i]
    categoryLut = buildCategoryLut(maxCategory + 1, alpha)
  }
  const span = domain ? domain[1] - domain[0] : 0
  let rendered = 0

  for (let i = 0; i < buffer.length; i += stride) {
    let color = single
    if (rampLut && domain) {
      const t = span > 0 ? (buffer.values[i] - domain[0]) / span : 0.5
      const idx = t <= 0 ? 0 : t >= 1 ? LUT_SIZE - 1 : (t * (LUT_SIZE - 1) + 0.5) | 0
      color = rampLut[idx]
    } else if (categoryLut) {
      const category = buffer.categories[i]
      color = categoryLut[category < categoryLut.length ? category : categoryLut.length - 1]
    }
    collection.add({
      position: Cartesian3.fromDegrees(buffer.positions[i * 2], buffer.positions[i * 2 + 1], height),
      color,
      pixelSize
    })
    rendered += 1
  }
  return { rendered, stride }
}

/** 估算点渲染的对象数（用于性能面板）。 */
export function pointObjectCount(buffer: GeoPointBuffer, maxPoints = 150_000): number {
  return Math.min(buffer.length, maxPoints)
}
