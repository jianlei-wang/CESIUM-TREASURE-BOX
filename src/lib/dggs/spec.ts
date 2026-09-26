import type { Feature, FeatureCollection, Polygon } from 'geojson'

/** 视域四至（度），east 可小于 west 以表示跨 180° 经线。 */
export type DggsBounds = { west: number; south: number; east: number; north: number }

/** 网格系统配置：通用字段 + 各网格自定义字段。 */
export type DggsSettings = {
  autoResolution: boolean
  resolution: number
  fillColor: string
  fillOpacity: number
  lineColor: string
  lineWidth: number
  showLabels: boolean
  includeNeighbors: boolean
  includeParents: boolean
  [key: string]: unknown
}

/** 配置面板中系统专属的下拉/勾选控件。 */
export type PanelField =
  | {
      kind: 'select'
      label: string
      key: string
      options: Array<{ value: string; label: string }>
      /** 仅当 settings[disabledKey] !== disabledWhen 时禁用该控件（如非六边形时锁定孔径）。 */
      disabledWhen?: unknown
      disabledKey?: string
    }
  | { kind: 'checkbox'; label: string; key: string }

export type IdentifyRow = { label: string; value: string }

/** 单个离散全球网格系统的完整能力描述，供通用案例外壳驱动。 */
export type DggsSystem = {
  id: string
  /** 案例内标题（中文）。 */
  title: string
  /** 英文名称。 */
  english: string
  /** 顶栏副标题。 */
  subtitle: string
  /** 案例卡片描述。 */
  description: string
  tag: string
  /** 网格线颜色默认（用于状态/图例）。 */
  accentColor: string

  defaults: DggsSettings
  normalize: (value: unknown) => DggsSettings

  minResolution: number
  maxResolution: number
  /** 层级参数名：分辨率 / 层级 / 编码长度 / 精度 / 瓦片层级。 */
  resolutionName: string
  resolutionStep?: number
  /** 存在时面板用下拉框列出有效取值（如 OLC 合法码长）。 */
  resolutionOptions?: number[]

  /** 面板顶部系统专属控件。 */
  extraFields?: PanelField[]

  resolutionForZoom: (zoom: number, settings: DggsSettings) => number
  labelMinZoom: (resolution: number) => number

  /** 异步初始化（WASM 引擎）。 */
  load?: () => Promise<void>
  requiresLoad?: boolean

  /** 点击点的单元编码。 */
  cellAt: (lon: number, lat: number, resolution: number, settings: DggsSettings) => string
  /** 按视域铺满网格。 */
  buildGrid: (
    bounds: DggsBounds,
    resolution: number,
    settings: DggsSettings
  ) => FeatureCollection<Polygon>
  cellFeature: (id: string, settings: DggsSettings) => Feature<Polygon>
  parentIds: (id: string, settings: DggsSettings) => string[]
  neighborIds: (id: string, settings: DggsSettings) => string[]
  childCount: (id: string, settings: DggsSettings) => number
  identify: (id: string, settings: DggsSettings, feature: Feature<Polygon>) => IdentifyRow[]
  /** 父级字段名，默认「父级」。 */
  parentLabel?: string

  exportName: string
  csvColumns: string[]
  csvRow: (feature: Feature<Polygon>, settings: DggsSettings) => Array<string | number | boolean>

  /** 可选附加叠加层（如 H3 二十面体投影）。 */
  overlay?: (settings: DggsSettings) => FeatureCollection<Polygon> | null

  /** 状态栏补充说明。 */
  statusNote?: (settings: DggsSettings, resolution: number) => string
}

/** 网格单元视域上限，超出则暂停渲染。 */
export const VIEWPORT_CELL_LIMIT = 20_000

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

export function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
}

export function normalizeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
