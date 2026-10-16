/**
 * 海洋分析-温盐深三维体 —— 数据、状态与分析结果类型定义
 *
 * 本文件是案例自有的坐标 / 单位 / 状态语义来源，不依赖通用 VolumeEngine 的场函数。
 * 关键约定：
 *   - 深度 depthM 一律为正、向下递增；渲染局部坐标 z 与深度反向（z = -depth）。
 *   - 缺测以 NaN 表达，任何统计、图表、导出都必须显式排除 NaN，禁止把缺测当作 0。
 */

/** 分析变量（对外可切换的物理量） */
export type OceanVariable = 'temperature' | 'salinity' | 'density' | 'currentSpeed'

/** 数据块中存储的原始变量（不含派生的密度 / 流速） */
export type OceanStoredVariable = 'temperature' | 'salinity' | 'u' | 'v'

/** 时间数据的类型，用于界面如实标注数据性质 */
export type OceanTimeKind = 'observation' | 'reanalysis' | 'monthly-climatology' | 'demo'

export interface OceanVariableManifest {
  sourceVariable: string
  label: string
  unit: string
  scale: number
  offset: number
  validMin: number
  validMax: number
  missingValue: number
}

export interface OceanDatasetManifest {
  id: string
  title: string
  source: string
  productId: string
  sourceUrl: string
  sourceVersion?: string
  citation: string
  license: string
  generatedAt: string
  timeKind: OceanTimeKind
  timeNote: string
  timeLabels: string[]
  regionName: string
  extent: { west: number; south: number; east: number; north: number }
  nativeResolution: { lonLat: string; verticalLevels: number; depthsM: number[] }
  grid: { nx: number; ny: number; nz: number; encoding: 'uint16' | 'float32' }
  verticalPositive: 'down'
  depthRangeM: [number, number]
  bathymetryRangeM: [number, number]
  densityMethod: string
  variables: Record<string, OceanVariableManifest>
  varOrder: OceanStoredVariable[]
  files: {
    coords: string
    bathymetry: string
    mask: string
    frames: string[]
  }
}

/** 单点采样结果：所有字段使用统一坐标与单位语义 */
export interface OceanSample {
  lon: number
  lat: number
  /** 正值向下，单位 m */
  depthM: number
  timeIndex: number
  temperatureC: number
  salinity: number
  densityKgM3: number
  uMs: number
  vMs: number
  currentSpeedMs: number
  /** 是否位于有效海水（掩膜内且各变量非缺测） */
  valid: boolean
  /** 该点的海底深度，单位 m */
  seabedM: number
}

/** 单点垂向剖面（各变量随深度的取值） */
export interface OceanColumn {
  lon: number
  lat: number
  seabedM: number
  maxLevelDepthM: number
  depthM: number[]
  temperature: number[]
  salinity: number[]
  density: number[]
  u: number[]
  v: number[]
  valid: boolean[]
}

export type OceanVariableOrAll = OceanVariable | 'all'

/** 层结分析结果：温跃层 / 盐跃层 / 密度跃层 / 混合层分别独立计算 */
export interface OceanStratification {
  variable: OceanVariable
  /** 跃层深度（梯度峰所在深度），无有效剖面时为 null */
  gradientPeakDepthM: number | null
  /** 梯度峰值大小（变量单位 / m） */
  gradientMax: number
  /** 混合层深度（温差 / 密度差阈值判据），按变量对应判据计算 */
  mixingLayerDepthM: number | null
  /** 垂向采样间距（m），随深度非均匀，此处给出平均间距 */
  meanSampleIntervalM: number
  /** 算法说明 */
  method: string
}

/** 区域或深度层统计（仅统计有效海水体素） */
export interface OceanStatistics {
  variable: OceanVariable
  unit: string
  min: number
  max: number
  mean: number
  median: number
  p10: number
  p90: number
  count: number
  invalidCount: number
  depthRangeM: [number, number]
}

/** A–B 断面采样结果：二维热图（距离 × 深度） */
export interface OceanSection {
  a: { lon: number; lat: number }
  b: { lon: number; lat: number }
  variable: OceanVariable
  /** 沿剖面的样点经度 / 纬度 */
  lons: number[]
  lats: number[]
  /** 沿剖面的距离，单位 km */
  distanceKm: number[]
  /** 各列的海底深度，单位 m */
  seabedM: number[]
  /** 深度层 */
  depthM: number[]
  /** values[sample][level]，NaN 表示缺测 */
  values: number[][]
}

/** T–S 散点样本点 */
export interface OceanTSPoint {
  temperatureC: number
  salinity: number
  densityKgM3: number
  depthM: number
  valid: boolean
}

/** 三维渲染质量控制档 */
export type OceanRenderQuality = 'performance' | 'balanced' | 'quality'

export interface OceanQualityPreset {
  key: OceanRenderQuality
  label: string
  /** 体光线步进步长（体素单位） */
  stepSize: number
  /** 屏幕空间误差，越大越省 */
  screenSpaceError: number
  /** 流场箭头抽稀步长 */
  currentStride: number
}

export type OceanAnalysisMode = 'none' | 'profile' | 'section' | 'ts' | 'compare' | 'statistics'

export interface OceanVisibleLayers {
  volume: boolean
  bathymetry: boolean
  horizontalSlice: boolean
  verticalSection: boolean
  isosurface: boolean
  currents: boolean
  samplePoints: boolean
}

/** 区域预设定义（对应 public/data/ocean-tsd/<id>） */
export interface OceanRegionPreset {
  id: string
  title: string
  shortName: string
  dataDir: string
  center: { lon: number; lat: number }
  /** 垂向夸张默认倍数（仅影响视觉，分析始终使用真实米制深度） */
  defaultVerticalExaggeration: number
}

/** UI / 交互统一状态 */
export interface OceanTsdUiState {
  datasetId: string
  timeIndex: number
  variable: OceanVariable
  depthM: number
  depthRangeM: [number, number]
  visibleLayers: OceanVisibleLayers
  analysisMode: OceanAnalysisMode
  renderQuality: OceanRenderQuality
  opacity: number
  autoColorRange: boolean
  fixedColorRange: [number, number]
  verticalExaggeration: number
  /** 体域整体抬升倍数（× 体高），1 表示块底贴地，>1 表示浮出地表 */
  liftFactor: number
  isosurfaceValue: number
  currentDepthM: number
}

/** 异步任务版本标记，用于丢弃过期结果 */
export interface TaskToken {
  generation: number
  controller: AbortController
}
