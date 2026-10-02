/**
 * PM2.5 案例领域类型 —— 与 Volume Worker 分析结果一一对应。
 *
 * 所有空间栅格使用归一化体域坐标（x/y 水平、z 垂直），物理量已换算为 μg/m³ / m / km²。
 */

export type Pm25ChannelKey = 'pm25' | 'pm10' | 'no2'

/** 污染源类型：工业烟囱 / 城区面源 / 道路线源 */
export type Pm25SourceType = 'stack' | 'area' | 'road'

/** PM2.5 主分析结果：浓度统计、分级、超标面积/体积、层顶高、人口暴露与站点误差 */
export type Pm25AnalysisResult = {
  count: number
  total: number
  min: number
  max: number
  mean: number
  p50: number
  p95: number
  threshold: number
  above: number
  exceedFraction: number
  exceedVolumeKm3: number
  exceedAreaKm2: number
  totalAreaKm2: number
  classHist: Float32Array
  grid: number
  surfaceGrid: Float32Array
  maxSurface: number
  meanSurface: number
  /** 近地层浓度 P95 */
  surfaceP95: number
  topHeightM: number
  meanTopM: number
  p95TopM: number
  volumeHeightM: number
  /** 分级阈值（按当前污染物值域折算，单位同通道） */
  tierThresholds: Float32Array
  /** 各分级阈值以上的体积（km³），与 tierThresholds 对应 */
  tierVolumesKm3: Float32Array
  exposed: number
  exposedFraction: number
  stationCount: number
  stationPos: Float32Array
  stationRaw: Float32Array
  stationObserved: Float32Array
  stationKind: Uint8Array
  stationRmse: number
  stationBias: number
  stationCorr: number
}

/** 站点专项结果：时间轴 / 通道切换时快速刷新 */
export type Pm25StationsResult = {
  count: number
  positions: Float32Array
  model: Float32Array
  observed: Float32Array
  bias: Float32Array
  kind: Uint8Array
}

/** 污染热点 */
export type Pm25HotspotResult = {
  count: number
  positions: Float32Array
  values: Float32Array
  threshold: number
}

/** 源贡献解析 */
export type Pm25SourcesResult = {
  count: number
  contributions: Float32Array
  total: number
  background: number
  x: number
  y: number
  z: number
}

/** 时间演变趋势 */
export type Pm25TrendResult = {
  steps: number
  maxSurface: Float32Array
  meanSurface: Float32Array
  exceedAreaKm2: Float32Array
  meanConcentration: Float32Array
  topHeightKm: Float32Array
}

/** 地面 footprint 高分辨率栅格 */
export type Pm25FootprintResult = {
  grid: number
  surface: Float32Array
  max: number
  /** 近地层浓度 P95 */
  p95: number
  threshold: number
}

/** 点位多污染物采样：拾取浮层显示 PM2.5 / PM10 / NO₂ 与阈值状态 */
export type Pm25PointResult = {
  x: number
  y: number
  z: number
  pm25: number
  pm10: number
  no2: number
  threshold: number
  /** 射线步进模式：是否命中可见采样点 */
  found?: boolean
}

/** 垂直廓线（复用引擎 profile 结果结构） */
export type Pm25ProfileResult = {
  x: number
  y: number
  levels: number
  values: Float32Array
  valid: Uint8Array
  u: Float32Array
  v: Float32Array
  w: Float32Array
}

/** 点选分析上下文：用于源贡献与廓线定位 */
export type Pm25FocusPoint = {
  x: number
  y: number
  z: number
  label: string
  value: number
  channel: string
}
