/**
 * 边坡 GNSS 位移预警与三级影响区系统 —— 类型与配置定义。
 * 该目录以 `-lib` 结尾，不参与案例自动扫描（仅被案例入口引用）。
 */

export const WarningLevel = {
  Normal: 0,
  Blue: 1,
  Yellow: 2,
  Orange: 3,
  Red: 4
} as const

export type WarningLevelValue = (typeof WarningLevel)[keyof typeof WarningLevel]

export const WARNING_LEVEL_TEXT: Record<number, string> = {
  0: '正常',
  1: '蓝色 · 注意级',
  2: '黄色 · 警示级',
  3: '橙色 · 警戒级',
  4: '红色 · 警报级'
}

export const WARNING_LEVEL_COLOR: Record<number, string> = {
  0: '#ffffff',
  1: '#3d8bff',
  2: '#ffd21e',
  3: '#ff7f00',
  4: '#ff2020'
}

export type FixType = 'fixed' | 'float' | 'single'

export interface StationDef {
  id: string
  name: string
  lon: number
  lat: number
  /** 变形响应增益（1 为基准，主滑区更大） */
  gain: number
  /** 相对主滑区加速的滞后小时数 */
  lagH: number
  /** 位移主方向（° 正北顺时针） */
  azimuth: number
  /** 是否位于红色核心区 */
  core?: boolean
}

export interface GnssObservation {
  time: number
  /** 累计位移（mm） */
  dE: number
  dN: number
  dU: number
  dH: number
  /** 合速率（mm/h） */
  v: number
  /** 加速度（mm/d²） */
  accel: number
  /** 位移方位角（°） */
  azimuth: number
  /** 改进切线角（°） */
  tangentAngle: number | null
  /** 反速率 1/v（h/mm） */
  invVelocity: number | null
  /** Fukuzono 预测破坏时刻（ms） */
  tfPredicted: number | null
  fixType: FixType
  sats: number
  pdop: number
  rmsH: number
  rmsV: number
  qualityOk: boolean
  /** 单站原始等级 */
  rawLevel: WarningLevelValue
  /** 经 FSM 确认/滞回后的等级 */
  level: WarningLevelValue
}

export interface RainObservation {
  time: number
  rain1h: number
  rain24h: number
  effectiveRain: number
}

export interface ThresholdConfig {
  /** 合速率阈值，mm/d（内部换算为 mm/h） */
  rateMmd: { blue: number; yellow: number; orange: number; red: number }
  /** 改进切线角阈值（°） */
  tangentAngle: { yellow: number; orange: number; red: number }
  /** 累计合位移阈值（mm） */
  cumulativeMm: { yellow: number; orange: number; red: number }
  qualityGate: { minSats: number; maxPdop: number; maxRmsH: number; maxRmsV: number }
  confirm: { upgradeEpochs: number; redUpgradeEpochs: number; downgradeEpochs: number }
  rainCoupling: { enabled: boolean; effectiveK: number; rain1hTrigger: number; rateFactor: number }
}

export interface FahrboschungConfig {
  vLt1e5: number
  v1e5_1e6: number
  v1e6_1e7: number
  vGt1e7: number
}

export interface ZoneConfig {
  grid: { targetResolutionM: number; maxCells: number }
  idw: { power: number; radiusM: number; anisotropyK: number }
  buffer: { coreStationM: number; keyM: number; influenceM: number }
  influence: {
    bufferFactor: number
    fahrboschung: FahrboschungConfig
    /** 能量线扇形半角（°），用于多路径推演 */
    fanHalfDeg: number
    /** 运动走廊扩散角 φs（°） */
    spreadAngleDeg: number
    /** 坡脚堆积扇角（°） */
    depositFanDeg: number
    /** 经验滑距 Corominas 系数 */
    empiricalC: number
    empiricalB: number
    /** 经验滑距上限（m），避免浅层降雨模型给出超远距离 */
    maxRunoutM: number
    useShallowRainModel: boolean
  }
}

export interface SlopeProfile {
  name: string
  code: string
  lon: number
  lat: number
  /** 滑坡类型（土质 / 岩质） */
  material: string
  /** 平均滑体厚度（m） */
  thickness: number
  /** 承灾体清单 */
  elementsAtRisk: { type: string; name: string }[]
}

export type Ring = [number, number][]

export interface ZoneGeometry {
  /** 经纬度多边形（外环 + 孔洞），局部米制坐标计算后回投影 */
  polygons: Ring[][]
}

export interface ZoneSnapshot {
  index: number
  time: number
  networkLevel: WarningLevelValue
  core: Ring[][] | null
  key: Ring[][] | null
  influence: Ring[][] | null
  stats: {
    coreAreaM2: number
    keyAreaM2: number
    influenceAreaM2: number
    runoutLengthM: number | null
    volumeM3: number
    frictionF: number
    confidence: number
  }
  triggeredStationIds: string[]
  levelCounts: { normal: number; blue: number; yellow: number; orange: number; red: number }
}

export interface DemGrid {
  /** 网格范围（经纬度） */
  west: number
  south: number
  east: number
  north: number
  nx: number
  ny: number
  /** 分辨率（米，近似） */
  dx: number
  dy: number
  /** 高程序列，行优先（j 从南到北，i 从西到东），NaN 表示无数据 */
  z: number[]
  /** 是否使用了合成地形回退 */
  synthetic: boolean
}

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  rateMmd: { blue: 10, yellow: 20, orange: 50, red: 100 },
  tangentAngle: { yellow: 45, orange: 80, red: 85 },
  cumulativeMm: { yellow: 50, orange: 150, red: 300 },
  qualityGate: { minSats: 6, maxPdop: 5, maxRmsH: 3, maxRmsV: 5 },
  confirm: { upgradeEpochs: 3, redUpgradeEpochs: 2, downgradeEpochs: 6 },
  rainCoupling: { enabled: true, effectiveK: 0.84, rain1hTrigger: 20, rateFactor: 0.5 }
}

export const DEFAULT_ZONE_CONFIG: ZoneConfig = {
  grid: { targetResolutionM: 22, maxCells: 4200 },
  idw: { power: 2, radiusM: 230, anisotropyK: 2 },
  buffer: { coreStationM: 15, keyM: 30, influenceM: 60 },
  influence: {
    bufferFactor: 0.2,
    fahrboschung: { vLt1e5: 0.6, v1e5_1e6: 0.4, v1e6_1e7: 0.25, vGt1e7: 0.15 },
    fanHalfDeg: 15,
    spreadAngleDeg: 12,
    depositFanDeg: 40,
    empiricalC: 1.6,
    empiricalB: 0.28,
    maxRunoutM: 1200,
    useShallowRainModel: true
  }
}

export const DEFAULT_SLOPE_PROFILE: SlopeProfile = {
  name: '沙镇溪边坡',
  code: 'SLP-2026-001',
  lon: 110.523,
  lat: 30.965,
  material: '土质滑坡',
  thickness: 14,
  elementsAtRisk: [
    { type: '村庄', name: '沿江居民点' },
    { type: '道路', name: '省道 S334' },
    { type: '水体', name: '长江航道' }
  ]
}

export interface ScenarioPreset {
  id: string
  label: string
  lon: number
  lat: number
  profile: SlopeProfile
}

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: 'sanzhenxi',
    label: '三峡库区 · 沙镇溪',
    lon: 110.523,
    lat: 30.965,
    profile: {
      name: '沙镇溪边坡',
      code: 'SLP-2026-001',
      lon: 110.523,
      lat: 30.965,
      material: '土质滑坡',
      thickness: 14,
      elementsAtRisk: [
        { type: '村庄', name: '沿江居民点' },
        { type: '道路', name: '省道 S334' },
        { type: '水体', name: '长江航道' }
      ]
    }
  },
  {
    id: 'zhouqu',
    label: '甘肃舟曲 · 三眼峪',
    lon: 104.372,
    lat: 33.788,
    profile: {
      name: '三眼峪边坡',
      code: 'SLP-2026-002',
      lon: 104.372,
      lat: 33.788,
      material: '沟道型滑坡',
      thickness: 18,
      elementsAtRisk: [
        { type: '村庄', name: '沟口居民区' },
        { type: '道路', name: 'G345 国道' },
        { type: '水体', name: '白龙江' }
      ]
    }
  },
  {
    id: 'wenchuan',
    label: '四川汶川 · 岷江右岸',
    lon: 103.601,
    lat: 31.454,
    profile: {
      name: '岷江右岸边坡',
      code: 'SLP-2026-003',
      lon: 103.601,
      lat: 31.454,
      material: '岩质边坡',
      thickness: 10,
      elementsAtRisk: [
        { type: '道路', name: 'G213 国道' },
        { type: '设施', name: '水电站厂房' },
        { type: '水体', name: '岷江' }
      ]
    }
  }
]
