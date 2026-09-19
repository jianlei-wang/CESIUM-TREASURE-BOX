/**
 * 通用地形分析工作台的类型契约。
 * 每个案例只需提供 CaseProfile（参数定义 + analyze 实现），
 * 由 AnalysisWorkbench.vue 统一完成交互、渲染、图例、报告与导出。
 */
import type { DemData, StatItem } from './types'
import type { RasterStyle } from './raster'

export type ParamValue = number | string | boolean

export type ParamDef = {
  key: string
  label: string
  kind: 'number' | 'slider' | 'select' | 'boolean'
  hint: string
  default: ParamValue
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: { label: string; value: ParamValue }[]
}

export type RasterLayer = {
  type: 'raster'
  id: string
  name: string
  values: Float32Array
  style: RasterStyle
  /** 连续色带为 [低值说明, 高值说明]；分级设色为各等级名称 */
  legendLabels: string[]
  description: string
}

export type VectorFeature = {
  path: { lon: number; lat: number }[]
  attrs: Record<string, string | number>
}

export type VectorLayer = {
  type: 'vector'
  id: string
  name: string
  geometry: 'line' | 'polygon' | 'point'
  color: string
  width?: number
  fillOpacity?: number
  features: VectorFeature[]
  legend: { color: string; label: string }[]
  description: string
}

export type AnalysisLayer = RasterLayer | VectorLayer

export type AnalysisOutput = {
  layers: AnalysisLayer[]
  defaultLayerId: string
  stats: StatItem[]
  timing: { label: string; value: number }[]
  summary: string
  conclusions: string[]
}

export type RenderStyle = {
  hillshade: number
  sunAzimuth: number
  sunAltitude: number
}

export type AnalyzeInput = {
  dem: DemData
  mask: Uint8Array
  params: Record<string, ParamValue>
  renderStyle: RenderStyle
}

export type CaseProfile = {
  id: string
  title: string
  reportTitle: string
  fileNamePrefix: string
  intro: string
  summaryTitle: string
  route: { title: string; intro: string; steps: { title: string; text: string }[] }
  params: ParamDef[]
  analyze: (input: AnalyzeInput) => AnalysisOutput
}

export function paramNumber(params: Record<string, ParamValue>, key: string, fallback: number): number {
  const v = params[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export function paramString(params: Record<string, ParamValue>, key: string, fallback: string): string {
  const v = params[key]
  return typeof v === 'string' ? v : fallback
}

export function paramBoolean(params: Record<string, ParamValue>, key: string, fallback: boolean): boolean {
  const v = params[key]
  return typeof v === 'boolean' ? v : fallback
}
