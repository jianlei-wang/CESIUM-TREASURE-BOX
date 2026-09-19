/**
 * 通用地形分析基础类型。
 *
 * 所有栅格统一以一维 Float32Array 存储，索引遵循 row-major：
 *   index = row * width + col
 * 无效值以 NaN 表示（NoData）。
 */

export type DemData = {
  width: number
  height: number
  values: Float32Array
  west: number
  east: number
  south: number
  north: number
  minHeight: number
  maxHeight: number
  meanHeight: number
  source: string
}

export type LonLat = { lon: number; lat: number }

export type TerrainBounds = {
  west: number
  east: number
  south: number
  north: number
}

/** 以栅格列/行表示的像素坐标 */
export type PixelPoint = [number, number]

export type RGBA = [number, number, number, number]

export type RasterLayerKind = 'raster' | 'vector' | 'both'

export type LayerLegend = {
  title: string
  description: string
  /** CSS 渐变条（连续色带） */
  ramp?: string
  rampLabels?: string[]
  /** 离散色块图例 */
  items?: { color: string; label: string }[]
}

export type StatItem = { label: string; value: string }

export type CaseResultBase = {
  /** 结果图层与图例映射 */
  legends: Record<string, LayerLegend>
  /** 结果统计条目 */
  stats: StatItem[]
  /** 耗时统计（毫秒） */
  timing: { label: string; value: number }[]
  /** 默认展示图层 */
  defaultLayer: string
}
