import { Cartesian3, Color, PointPrimitiveCollection } from 'cesium'
import type { GeoPointBuffer } from '../core/buffer'
import { categorical, ramp } from '../palettes'
import { normalize } from '../core/geo'

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
  let rendered = 0

  for (let i = 0; i < buffer.length; i += stride) {
    let color = single
    if (mode === 'value' && domain) {
      color = cssColor(ramp(palette, normalize(buffer.values[i], domain[0], domain[1])), alpha)
    } else if (mode === 'category') {
      color = cssColor(categorical(buffer.categories[i]), alpha)
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
