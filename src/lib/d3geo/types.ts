import type { Viewer } from 'cesium'
import type { Component } from 'vue'
import type { GeoProfiler } from './performance/profiler'

/** 单个案例可调参数值。 */
export type D3SettingValue = string | number | boolean
export type D3Settings = Record<string, D3SettingValue>

/** 配置面板控件描述。 */
export type D3Control =
  | {
      kind: 'range'
      key: string
      label: string
      min: number
      max: number
      step?: number
      format?: (value: number) => string
    }
  | { kind: 'select'; key: string; label: string; options: Array<{ value: string; label: string }> }
  | { kind: 'checkbox'; key: string; label: string }
  | { kind: 'color'; key: string; label: string }
  | { kind: 'button'; label: string; onClick: (ctx: D3CaseContext) => void }

export type D3LegendItem = { label: string; color: string; ramp?: string }

export type D3Camera = {
  lon: number
  lat: number
  height: number
  heading?: number
  pitch?: number
  roll?: number
}

export type D3CaseMeta = {
  /** 顶栏主标题。 */
  title: string
  /** 顶栏副标题（英文 / 技术说明）。 */
  subtitle: string
  /** 一句话能力说明。 */
  description: string
  /** 技术标签。 */
  tag: string
  /** 主题强调色，用于图例与面板装饰。 */
  accent: string
  /** 侧栏「实现要点」列表。 */
  tips?: string[]
}

/** 渲染上下文，供案例渲染函数使用。 */
export type D3CaseContext = {
  viewer: Viewer
  /** 案例专属数据源，所有实体应添加到这里；重建时自动清空。 */
  dataSource: import('cesium').CustomDataSource
  settings: D3Settings
  status: (text: string) => void
  legend: (items: D3LegendItem[]) => void
  /** 性能基准：上报数据 / 耗时 / LOD 指标。 */
  profiler: GeoProfiler
  /** 注册每帧回调，返回取消函数。 */
  onFrame: (cb: (time: number, delta: number) => void) => () => void
  /** 注册清理函数，案例重建时自动调用。 */
  onCleanup: (fn: () => void) => void
  /** 追加一个覆盖在画布上的 HTML/SVG 元素，重建时自动移除。 */
  overlay: (el: HTMLElement, interactive?: boolean) => void
  /** 创建一个批量点图元集合并纳入自动清理。 */
  pointCollection: () => import('cesium').PointPrimitiveCollection
  /** 创建一个 CPU 图元（Primitive/自定义）并纳入自动清理。 */
  addPrimitive: <T extends object>(primitive: T) => T
  /** 清空当前案例添加的所有实体与图层。 */
  clear: () => void
}

/** 一个完整案例的能力描述。 */
export type D3CaseSpec = {
  /** 与目录名保持一致。 */
  id: string
  meta: D3CaseMeta
  /** 默认参数。 */
  defaults: D3Settings
  controls?: D3Control[]
  /** 初始相机（不填则使用默认全局视角）。 */
  camera?: D3Camera
  /** 首屏渲染（返回可选清理函数）。 */
  setup: (ctx: D3CaseContext) => void
  /** 参数变化时的增量更新；缺省时外壳会清空后重新执行 setup。 */
  update?: (ctx: D3CaseContext) => void
}

export type D3CaseComponentFactory = (spec: D3CaseSpec) => Component
