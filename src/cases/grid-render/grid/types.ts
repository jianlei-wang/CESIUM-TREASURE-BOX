/**
 * 地理网格渲染系统：类型定义与默认样式表。
 *
 * 本案例为「系统DEMO」模块下的自包含案例，场景、网格引擎、渲染与 UI
 * 全部代码均位于本案例文件夹内，不复用项目其他部分。
 */

export type LonLat = { lon: number; lat: number }

export type AreaBounds = {
  west: number
  south: number
  east: number
  north: number
}

/** 四类网格：经纬网格 / 北斗网格 / 水文网格 / DGGS 网格。 */
export type GridType = 'graticule' | 'beidou' | 'hydro' | 'dggs'

export const GRID_TYPES: GridType[] = ['graticule', 'beidou', 'hydro', 'dggs']

/** 网格渲染模式：ground=二维贴地网格，solid=三维网格体（自地面拉伸）。 */
export type GridRenderMode = 'ground' | 'solid'

/** 统一样式 Schema：四类网格共享，保证 API 一致、UI 可统一配置。 */
export type GridStyle = {
  enabled: boolean
  renderMode: GridRenderMode
  strokeColor: string
  strokeWidth: number
  strokeAlpha: number
  fillColor: string
  fillAlpha: number
  labelVisible: boolean
  /** 三维网格体高度（米），仅 renderMode='solid' 时生效。 */
  solidHeight: number
}

export type GridStyles = Record<GridType, GridStyle>

/** 拾取结果：点击/悬浮单元时回显的元数据。 */
export type CellInfo = {
  gridType: GridType
  title: string
  subtitle: string
  rows: Array<{ label: string; value: string }>
}

export type GridLabel = { position: LonLat; text: string; emphasis?: boolean }

export type GridLine = { points: LonLat[]; width?: number }

export type GridPolygon = {
  ring: LonLat[]
  center: LonLat
  /** 单元编码 / 度数 / 行列号，用于标注与拾取回显。 */
  code: string
  label?: string
  /** 三维网格体的高度域分层（自地面向上）：存在时逐层拉伸为独立立体单元。 */
  solidLayers?: Array<{ base: number; top: number }>
}

export type GridBuild = {
  lines: GridLine[]
  polygons: GridPolygon[]
  labels: GridLabel[]
  /** 实际渲染的单元/网格数量。 */
  count: number
  /** 当前层级/间隔的文字描述。 */
  note: string
  /** 实际生效的数值参数：经纬=间隔(度)、北斗=层级、水文=步长(米)、DGGS=分辨率。 */
  levelValue: number
  /** 是否因性能上限而降级。 */
  downgraded: boolean
  /** 三维网格体高度域信息（仅北斗固体模式返回）。 */
  heightDomain?: { level: number; layers: number; thickness: number }
}

export const GRID_LABELS: Record<GridType, string> = {
  graticule: '经纬网格',
  beidou: '北斗网格',
  hydro: '水文网格',
  dggs: 'DGGS 网格'
}

export const GRID_EN_LABELS: Record<GridType, string> = {
  graticule: 'Graticule',
  beidou: 'BeiDou Grid',
  hydro: 'Hydro Grid',
  dggs: 'DGGS · H3'
}

export const DEFAULT_GRID_STYLES: GridStyles = {
  graticule: {
    enabled: false,
    renderMode: 'ground',
    strokeColor: '#4ade80',
    strokeWidth: 1,
    strokeAlpha: 0.55,
    fillColor: '#4ade80',
    fillAlpha: 0,
    labelVisible: true,
    solidHeight: 4000
  },
  beidou: {
    enabled: true,
    renderMode: 'ground',
    strokeColor: '#2dd4bf',
    strokeWidth: 1.2,
    strokeAlpha: 0.8,
    fillColor: '#2dd4bf',
    fillAlpha: 0.06,
    labelVisible: true,
    solidHeight: 3000
  },
  hydro: {
    enabled: false,
    renderMode: 'ground',
    strokeColor: '#fbbf24',
    strokeWidth: 1.4,
    strokeAlpha: 0.85,
    fillColor: '#fbbf24',
    fillAlpha: 0.14,
    labelVisible: true,
    solidHeight: 4000
  },
  dggs: {
    enabled: false,
    renderMode: 'ground',
    strokeColor: '#38bdf8',
    strokeWidth: 1.4,
    strokeAlpha: 0.85,
    fillColor: '#38bdf8',
    fillAlpha: 0.08,
    labelVisible: true,
    solidHeight: 4000
  }
}

/** 网格线抬升高度（米）：避免与底图/地表发生深度冲突。 */
export const GRID_LIFT_METERS = 120
