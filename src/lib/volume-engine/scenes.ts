/**
 * Volume Engine —— 场景描述表
 *
 * 每个体渲染案例对应一个 SceneSpec：声明体域范围、变量通道、色带、默认渲染参数与
 * 场景生成参数。主线程控制器（VolumeEngine）与 Worker 都以此为准，
 * 案例组件只负责选择场景 + 组装附加交互。
 */

export type SceneKind = 'radar' | 'pm25' | 'wind' | 'geology' | 'cfd' | 'plume' | 'mining' | 'flood' | 'fire' | 'ocean'

export type ValueMode = 'scalar' | 'categorical'

export type ChannelSpec = {
  key: string
  label: string
  unit: string
  min: number
  max: number
  palette: string
  mode: ValueMode
  /** 预设阈值（数据单位），用于一键切换分析区间 */
  thresholds?: number[]
  decimals?: number
  /** 对数映射：孔隙率线性、渗透率跨数量级用对数 */
  logScale?: boolean
  /** 双向发散量：以 0 为中心，中值透明、正负两端增强 */
  diverging?: boolean
}

export type CategorySpec = {
  code: number
  label: string
  color: [number, number, number]
}

export type VectorSpec = {
  label: string
  unit: string
  min: number
  max: number
  palette: string
  defaultCount: number
  defaultSize: number
}

export type SceneSpec = {
  kind: SceneKind
  title: string
  tag: string
  description: string
  center: { lon: number; lat: number; height: number }
  /** 体域尺寸（米）：base 为体域底面相对 ENU 锚点的高度，height 为垂向厚度 */
  volume: { width: number; depth: number; height: number; base: number }
  channels: ChannelSpec[]
  defaultChannel: string
  /** 时间步数量，1 表示静态体 */
  timeSteps: number
  timeStepUnit: string
  categories?: CategorySpec[]
  vector?: VectorSpec
  defaults: {
    tileSize: number
    levels: number
    sse: number
    stepSize: number
    nearest: boolean
    opacity: number
    alphaFloor: number
  }
  /** 场景特有生成参数默认值（下发给 Worker） */
  params: Record<string, number>
}

export type RadarThresholds = {
  weak: number
  moderate: number
  strong: number
  extreme: number
}

export type RadarCameraPreset = 'overview' | 'storm' | 'top' | 'station'

/**
 * 雷达专属配置：把散落的魔法数字（阈值、分析阈值、距离圈、相机预设、雷达站元数据）
 * 集中管理，业务组件只引用本对象，不再硬编码。
 */
export type RadarConfig = {
  /** 业务分级阈值（dBZ） */
  thresholds: RadarThresholds
  /** 分析阈值：回波顶高统计阈值与强对流核心阈值相互独立 */
  analysis: {
    topThreshold: number
    coreThreshold: number
    /** 顶高统计中视为“有回波”的最低高度占比 */
    minTopFraction: number
  }
  /** 回波顶高分档（km），用于顶高层着色与等高参考 */
  echoTopBands: number[]
  /** 地面回波覆盖统计阈值的键名 */
  footprintKeys: ('weak' | 'moderate' | 'strong')[]
  /** 距离圈（km） */
  ringsKm: number[]
  /** 雷达站高度（米） */
  stationHeightM: number
  /** 相机预设 */
  camera: Record<RadarCameraPreset, { label: string; heading: number; pitch: number; rangeFactor: number }>
  /** 视线主方位（度），用于 RHI 默认剖面与扫描扇面 */
  defaultAzimuth: number
  /** 单次时间回放总时长（min），用于 T+n 展示 */
  totalMinutes: number
}

export const RADAR_CONFIG: RadarConfig = {
  thresholds: { weak: 20, moderate: 35, strong: 45, extreme: 55 },
  analysis: { topThreshold: 20, coreThreshold: 45, minTopFraction: 0.05 },
  echoTopBands: [5, 8, 10, 12, 15],
  footprintKeys: ['weak', 'moderate', 'strong'],
  ringsKm: [10, 20, 30, 40],
  stationHeightM: 40,
  camera: {
    overview: { label: '全局', heading: 35, pitch: -32, rangeFactor: 1.05 },
    storm: { label: '风暴主体', heading: 210, pitch: -18, rangeFactor: 0.5 },
    top: { label: '回波顶高', heading: 0, pitch: -78, rangeFactor: 0.92 },
    station: { label: '雷达站', heading: 55, pitch: -14, rangeFactor: 0.42 }
  },
  defaultAzimuth: 45,
  totalMinutes: 55
}

export type GeologyCameraPreset = 'overview' | 'structure' | 'top' | 'section'

/** 单个地层的业务定义：颜色、参考厚度、物性概括与储层角色 */
export type GeologyLayerDef = {
  code: number
  name: string
  color: [number, number, number]
  thicknessM: number
  porosity: string
  permeability: string
  role: string
}

/** 钻孔定义（归一化平面位置），分层由前端依据构造起伏实时推算 */
export type GeologyBoreholeDef = {
  id: string
  name: string
  x: number
  y: number
}

/** 属性通道业务定义 */
export type GeologyPropertyDef = {
  key: string
  name: string
  unit: string
  palette: string
  min: number
  max: number
  log?: boolean
  decimals: number
  hint: string
}

export type GeologyConfig = {
  layers: GeologyLayerDef[]
  boreholes: GeologyBoreholeDef[]
  /** 断层走向（度，与构造场一致） */
  faultDir: number
  /** 深度标尺刻度（米，自地表向下） */
  depthMarks: number[]
  properties: GeologyPropertyDef[]
  camera: Record<GeologyCameraPreset, { label: string; heading: number; pitch: number; rangeFactor: number }>
  /** 属性异常区阈值（归一化，0~1） */
  anomalyThresholds: number[]
}

/**
 * 地质专属配置：集中管理地层色板、钻孔、断层、属性阈值与相机预设，
 * 业务组件只引用本对象，不再散落魔法数字。
 */
export const GEOLOGY_CONFIG: GeologyConfig = {
  layers: [
    { code: 1, name: '表土层', color: [193, 154, 107], thicknessM: 290, porosity: '高', permeability: '中', role: '表层覆盖' },
    { code: 2, name: '砂岩', color: [233, 196, 106], thicknessM: 420, porosity: '较高', permeability: '高', role: '主力储层' },
    { code: 3, name: '页岩', color: [112, 128, 144], thicknessM: 580, porosity: '低', permeability: '极低', role: '盖层' },
    { code: 4, name: '石灰岩', color: [160, 190, 190], thicknessM: 640, porosity: '中', permeability: '中', role: '次要储层' },
    { code: 5, name: '花岗岩', color: [214, 120, 120], thicknessM: 640, porosity: '极低', permeability: '极低', role: '侵入体' },
    { code: 6, name: '基岩', color: [92, 84, 112], thicknessM: 430, porosity: '极低', permeability: '极低', role: '基底' }
  ],
  boreholes: [
    { id: 'ZK-01', name: '勘探井 ZK-01', x: 0.2, y: 0.62 },
    { id: 'ZK-02', name: '勘探井 ZK-02', x: 0.5, y: 0.42 },
    { id: 'ZK-03', name: '勘探井 ZK-03', x: 0.78, y: 0.58 }
  ],
  faultDir: 118,
  depthMarks: [500, 1000, 1500, 2000, 2500, 3000],
  properties: [
    {
      key: 'porosity',
      name: '孔隙率',
      unit: '%',
      palette: 'porosity',
      min: 0,
      max: 35,
      decimals: 1,
      hint: '砂岩储层与侵入体接触带孔隙率差异，反映储集空间分布'
    },
    {
      key: 'permeability',
      name: '渗透率',
      unit: 'mD',
      palette: 'permeability',
      min: 0.1,
      max: 1000,
      log: true,
      decimals: 2,
      hint: '跨数量级属性，采用对数色标，突出高渗通道与甜点区'
    },
    {
      key: 'saturation',
      name: '含水饱和度',
      unit: '%',
      palette: 'saturation',
      min: 0,
      max: 100,
      decimals: 0,
      hint: '深部油水界面以下含水饱和度升高，用于识别含油层段'
    }
  ],
  camera: {
    overview: { label: '全局', heading: 28, pitch: -30, rangeFactor: 1.05 },
    structure: { label: '构造', heading: 62, pitch: -16, rangeFactor: 0.72 },
    top: { label: '俯视', heading: 0, pitch: -78, rangeFactor: 0.95 },
    section: { label: '剖面', heading: 118, pitch: -6, rangeFactor: 0.82 }
  },
  anomalyThresholds: [0.5, 0.65, 0.8, 0.9]
}

export type Pm25SourceType = 'stack' | 'area' | 'road'

/** PM2.5 污染源业务定义（位置与类型与 Worker 内的固定源清单保持一致） */
export type Pm25SourceDef = {
  id: string
  name: string
  type: Pm25SourceType
  code: string
  /** 归一化平面位置（相对体域中心，0~1） */
  x: number
  y: number
  /** 道路源走向（度） */
  heading?: number
  /** 道路源长度（归一化） */
  length?: number
}

export type Pm25CameraPreset = 'overview' | 'plume' | 'top' | 'ground' | 'station' | 'core' | 'vertical' | 'source'

export type Pm25Config = {
  /** 固定污染源清单，可启用前 N 个 */
  sources: Pm25SourceDef[]
  /** 浓度分级断点（μg/m³），与 palette 的 PM25_CLASSES 一致 */
  classBreaks: number[]
  /** 关键等值面浓度（μg/m³） */
  isoLevels: number[]
  /** 分析默认参数 */
  analysis: {
    defaultThreshold: number
    defaultPopDensity: number
    footprintGrid: number
    trendSteps: number
    stationCount: number
  }
  camera: Record<Pm25CameraPreset, { label: string; heading: number; pitch: number; rangeFactor: number }>
  /** 单个时间步代表的小时数，用于时间轴小时标签 */
  timeStepHours: number
  /** 污染层顶高参考（m），用于剖面参考与默认边界层高度展示 */
  refTopM: number
}

/**
 * PM2.5 专属配置：集中管理固定污染源清单、浓度分级、等值面浓度、分析默认值与相机预设，
 * 业务组件只引用本对象，不再散落魔法数字。
 */
export const PM25_CONFIG: Pm25Config = {
  sources: [
    { id: 'S01', name: '东部电厂烟囱', type: 'stack', code: 'IND', x: 0.30, y: 0.34 },
    { id: 'S02', name: '化工园区烟囱', type: 'stack', code: 'IND', x: 0.25, y: 0.47 },
    { id: 'S03', name: '钢铁厂烟囱', type: 'stack', code: 'IND', x: 0.37, y: 0.24 },
    { id: 'S04', name: '中心城区面源', type: 'area', code: 'URB', x: 0.52, y: 0.50 },
    { id: 'S05', name: '老城面源', type: 'area', code: 'URB', x: 0.44, y: 0.58 },
    { id: 'S06', name: '城北面源', type: 'area', code: 'URB', x: 0.57, y: 0.63 },
    { id: 'S07', name: '绕城高速', type: 'road', code: 'TRA', x: 0.42, y: 0.44, heading: 30, length: 0.52 },
    { id: 'S08', name: '东西主干道', type: 'road', code: 'TRA', x: 0.55, y: 0.40, heading: 115, length: 0.42 },
    { id: 'S09', name: '港口物流通道', type: 'road', code: 'TRA', x: 0.30, y: 0.66, heading: 70, length: 0.36 },
    { id: 'S10', name: '远郊面源', type: 'area', code: 'BGD', x: 0.67, y: 0.30 }
  ],
  classBreaks: [35, 75, 115, 150, 250],
  isoLevels: [35, 75, 150, 250],
  analysis: {
    defaultThreshold: 75,
    defaultPopDensity: 1600,
    footprintGrid: 96,
    trendSteps: 24,
    stationCount: 36
  },
  camera: {
    overview: { label: '全局', heading: 30, pitch: -28, rangeFactor: 1.05 },
    plume: { label: '下风向羽流', heading: 235, pitch: -20, rangeFactor: 0.72 },
    top: { label: '俯视', heading: 0, pitch: -80, rangeFactor: 0.95 },
    ground: { label: '近地', heading: 40, pitch: -10, rangeFactor: 0.6 },
    station: { label: '监测站', heading: 60, pitch: -14, rangeFactor: 0.52 },
    core: { label: '污染核心', heading: 25, pitch: -24, rangeFactor: 0.44 },
    vertical: { label: '垂直结构', heading: 90, pitch: -6, rangeFactor: 0.8 },
    source: { label: '源区', heading: 300, pitch: -16, rangeFactor: 0.5 }
  },
  timeStepHours: 1,
  refTopM: 875
}

/* ------------------------------------------------------------------ *
 * 第二批行业应用矩阵 —— 案例专属配置
 * ------------------------------------------------------------------ */

/** 地下水污染羽流 —— 污染物类型 */
export type PlumeContaminantKind = 'tce' | 'cr6' | 'tds'

export type PlumeAquiferDef = {
  code: number
  name: string
  /** 顶界埋深（m，地表为 0，向下为正） */
  top: number
  /** 底界埋深（m） */
  bottom: number
  porosity: string
  permeability: string
  role: string
}

export type PlumeWellDef = {
  id: string
  name: string
  kind: 'source' | 'monitor' | 'extract'
  x: number
  y: number
  /** 采样 / 滤水管深度（m） */
  depth: number
}

export type PlumeCameraPreset = 'overview' | 'plume' | 'source' | 'section' | 'wells' | 'top'

export type PlumeConfig = {
  siteName: string
  aquifers: PlumeAquiferDef[]
  wells: PlumeWellDef[]
  /** 地下水流向（度） */
  flowDir: number
  depthMarks: number[]
  /** 风险分级浓度阈值（按当前污染物单位，运行时按通道换算） */
  riskThresholds: number[]
  contaminants: Record<PlumeContaminantKind, { name: string; unit: string; max: number; palette: string; hint: string }>
  camera: Record<PlumeCameraPreset, { label: string; heading: number; pitch: number; rangeFactor: number }>
  /** 单个时间步代表的月数 */
  timeStepMonths: number
}

/**
 * 地下水污染羽流专属配置：含水层分层、井位清单、地下水流向、污染物清单、风险阈值与相机预设。
 */
export const PLUME_CONFIG: PlumeConfig = {
  siteName: '太湖平原某化工遗留场地',
  aquifers: [
    { code: 1, name: '潜水含水层', top: 0, bottom: 24, porosity: '高', permeability: '高', role: '浅层潜水' },
    { code: 2, name: '粉质黏土隔水层', top: 24, bottom: 40, porosity: '低', permeability: '极低', role: '弱透水层' },
    { code: 3, name: '第一承压含水层', top: 40, bottom: 72, porosity: '较高', permeability: '较高', role: '主采水层' },
    { code: 4, name: '黏土隔水层', top: 72, bottom: 88, porosity: '低', permeability: '极低', role: '隔水底板' },
    { code: 5, name: '第二承压含水层', top: 88, bottom: 120, porosity: '中', permeability: '中', role: '深部含水层' }
  ],
  wells: [
    { id: 'SRC-01', name: '污染源 SRC-01', kind: 'source', x: 0.30, y: 0.42, depth: 10 },
    { id: 'MW-01', name: '监测井 MW-01', kind: 'monitor', x: 0.40, y: 0.44, depth: 18 },
    { id: 'MW-02', name: '监测井 MW-02', kind: 'monitor', x: 0.52, y: 0.48, depth: 20 },
    { id: 'MW-03', name: '监测井 MW-03', kind: 'monitor', x: 0.63, y: 0.55, depth: 52 },
    { id: 'MW-04', name: '监测井 MW-04', kind: 'monitor', x: 0.70, y: 0.44, depth: 50 },
    { id: 'MW-05', name: '监测井 MW-05', kind: 'monitor', x: 0.46, y: 0.62, depth: 56 },
    { id: 'EW-01', name: '抽出处理井 EW-01', kind: 'extract', x: 0.58, y: 0.50, depth: 54 }
  ],
  flowDir: 68,
  depthMarks: [20, 40, 60, 80, 100, 120],
  riskThresholds: [10, 25, 40, 60],
  contaminants: {
    tce: { name: '三氯乙烯 (TCE)', unit: 'µg/L', max: 400, palette: 'contaminant', hint: 'Dense NAPL 溶解相，随地下水迁移，衰减慢、穿透承压层' },
    cr6: { name: '六价铬 Cr(VI)', unit: 'mg/L', max: 30, palette: 'chromate', hint: '强迁移阴离子，主要赋存于浅层潜水含水层' },
    tds: { name: '总溶解固体 TDS', unit: 'mg/L', max: 1600, palette: 'turbo', hint: '场地综合污染指标，覆盖全含水层系统' }
  },
  camera: {
    overview: { label: '全局', heading: 32, pitch: -34, rangeFactor: 1.05 },
    plume: { label: '羽流主体', heading: 248, pitch: -24, rangeFactor: 0.68 },
    source: { label: '源区', heading: 300, pitch: -18, rangeFactor: 0.42 },
    section: { label: '沿流向剖面', heading: 68, pitch: -6, rangeFactor: 0.8 },
    wells: { label: '监测井网', heading: 40, pitch: -40, rangeFactor: 0.8 },
    top: { label: '俯视', heading: 0, pitch: -80, rangeFactor: 0.95 }
  },
  timeStepMonths: 1
}

/** 三维矿体品位 —— 元素类型 */
export type MiningElementKey = 'cu' | 'au' | 'fe'

export type MiningDrillholeDef = {
  id: string
  name: string
  x: number
  y: number
  /** 孔深（m） */
  depth: number
  grade: Record<MiningElementKey, number>
}

export type MiningCameraPreset = 'overview' | 'orebody' | 'section' | 'pit' | 'top'

export type MiningConfig = {
  pitName: string
  domain: { east: number; north: number; depth: number }
  elements: Record<MiningElementKey, { name: string; unit: string; max: number; palette: string; cutoffs: number[]; hint: string }>
  drillholes: MiningDrillholeDef[]
  /** 台阶标高（m，相对地表向下） */
  benches: number[]
  /** 边界品位（Cu %）与工业品位 */
  cutoff: { boundary: number; industrial: number }
  camera: Record<MiningCameraPreset, { label: string; heading: number; pitch: number; rangeFactor: number }>
}

/**
 * 三维矿体品位专属配置：元素清单、边界品位、钻孔样品清单、台阶标高与相机预设。
 */
export const MINING_CONFIG: MiningConfig = {
  pitName: '南岭铜多金属露天矿',
  domain: { east: 3000, north: 3000, depth: 500 },
  elements: {
    cu: { name: '铜 Cu', unit: '%', max: 2, palette: 'ore', cutoffs: [0.2, 0.4, 0.8, 1.2], hint: '主矿化元素，沿接触带与断裂交汇处富集' },
    au: { name: '金 Au', unit: 'g/t', max: 4, palette: 'gold', cutoffs: [0.3, 0.6, 1.2, 2.0], hint: '伴生金，与黄铁矿化关系密切，深部品位升高' },
    fe: { name: '全铁 Fe', unit: '%', max: 60, palette: 'terrain', cutoffs: [10, 20, 35, 50], hint: '铁帽与矽卡岩蚀变标志，浅部氧化带富集' }
  },
  drillholes: [
    { id: 'ZK-101', name: 'ZK-101', x: 0.34, y: 0.40, depth: 420, grade: { cu: 1.12, au: 1.4, fe: 28 } },
    { id: 'ZK-102', name: 'ZK-102', x: 0.46, y: 0.46, depth: 500, grade: { cu: 1.48, au: 2.1, fe: 33 } },
    { id: 'ZK-103', name: 'ZK-103', x: 0.58, y: 0.42, depth: 460, grade: { cu: 0.86, au: 1.1, fe: 24 } },
    { id: 'ZK-104', name: 'ZK-104', x: 0.40, y: 0.58, depth: 380, grade: { cu: 0.62, au: 0.7, fe: 19 } },
    { id: 'ZK-105', name: 'ZK-105', x: 0.54, y: 0.62, depth: 520, grade: { cu: 1.26, au: 1.8, fe: 30 } },
    { id: 'ZK-106', name: 'ZK-106', x: 0.66, y: 0.54, depth: 340, grade: { cu: 0.42, au: 0.5, fe: 16 } }
  ],
  benches: [500, 450, 400, 350, 300, 250, 200, 150, 100, 50],
  cutoff: { boundary: 0.2, industrial: 0.4 },
  camera: {
    overview: { label: '全局', heading: 30, pitch: -34, rangeFactor: 1.05 },
    orebody: { label: '矿体三维', heading: 238, pitch: -20, rangeFactor: 0.66 },
    section: { label: '勘探线剖面', heading: 58, pitch: -8, rangeFactor: 0.82 },
    pit: { label: '采坑', heading: 320, pitch: -22, rangeFactor: 0.72 },
    top: { label: '俯视', heading: 0, pitch: -80, rangeFactor: 0.95 }
  }
}

/** 洪水动力水深体 —— 测站与受影响对象 */
export type FloodGaugeDef = { id: string; name: string; x: number; y: number }
export type FloodZoneDef = { id: string; name: string; kind: 'city' | 'village' | 'farm' | 'infra'; x: number; y: number; r: number }

export type FloodCameraPreset = 'overview' | 'river' | 'city' | 'peak' | 'section'

export type FloodConfig = {
  basinName: string
  gauges: FloodGaugeDef[]
  zones: FloodZoneDef[]
  depthThresholds: number[]
  warningLevels: { level: string; depth: number; color: string }[]
  camera: Record<FloodCameraPreset, { label: string; heading: number; pitch: number; rangeFactor: number }>
  /** 单个时间步代表的小时数 */
  timeStepHours: number
}

/**
 * 洪水动力水深体专属配置：水文站、受影响对象、淹没分级、预警等级与相机预设。
 */
export const FLOOD_CONFIG: FloodConfig = {
  basinName: '淮河上游—郑东城市群河段',
  gauges: [
    { id: 'G-01', name: '上游水文站 G-01', x: 0.14, y: 0.50 },
    { id: 'G-02', name: '城区控制站 G-02', x: 0.46, y: 0.52 },
    { id: 'G-03', name: '下游水文站 G-03', x: 0.82, y: 0.50 }
  ],
  zones: [
    { id: 'Z-01', name: '郑东 CBD', kind: 'city', x: 0.50, y: 0.56, r: 0.09 },
    { id: 'Z-02', name: '老城片区', kind: 'city', x: 0.38, y: 0.44, r: 0.075 },
    { id: 'Z-03', name: '沿河村落', kind: 'village', x: 0.66, y: 0.58, r: 0.05 },
    { id: 'Z-04', name: '北部农田', kind: 'farm', x: 0.30, y: 0.30, r: 0.13 },
    { id: 'Z-05', name: '高铁枢纽', kind: 'infra', x: 0.58, y: 0.40, r: 0.045 }
  ],
  depthThresholds: [0.5, 1.0, 2.0, 3.0],
  warningLevels: [
    { level: '蓝色预警', depth: 0.5, color: '#3d8bfd' },
    { level: '黄色预警', depth: 1.0, color: '#f2c94c' },
    { level: '橙色预警', depth: 2.0, color: '#f2994a' },
    { level: '红色预警', depth: 3.0, color: '#eb5757' }
  ],
  camera: {
    overview: { label: '全局', heading: 28, pitch: -36, rangeFactor: 1.05 },
    river: { label: '河道', heading: 92, pitch: -20, rangeFactor: 0.7 },
    city: { label: '城区', heading: 335, pitch: -26, rangeFactor: 0.6 },
    peak: { label: '洪峰断面', heading: 70, pitch: -10, rangeFactor: 0.72 },
    section: { label: '横断面', heading: 178, pitch: -6, rangeFactor: 0.7 }
  },
  timeStepHours: 1
}

/** 火灾烟气与温度体 —— 火源 / 建筑 / 道路 / 风险分级 */

/** 火源类型：主火源 / 受热引燃次火源 / 飞火 */
export type FireSourceType = 'primary' | 'ignition' | 'spot'

/** 事件驱动火源：起火时刻、峰值时刻与峰值热释放 / 产烟强度决定其时间曲线 */
export type FireSourceDef = {
  id: string
  name: string
  /** 火源水平位置（归一化体域坐标） */
  x: number
  y: number
  /** 关联建筑 id：火源高度由楼层决定 */
  buildingId: string
  /** 起火楼层（1-based） */
  floor: number
  sourceType: FireSourceType
  /** 事件曲线（相对总时长的归一化时刻 0~1） */
  start: number
  peak: number
  end: number
  /** 峰值热释放（相对值） */
  heatRelease: number
  /** 峰值产烟强度（相对值） */
  smokeYield: number
  radius: number
}

export type FireBuildingType = 'tower' | 'residential' | 'shop' | 'warehouse'

/** 建筑：程序化三维体块（归一化包围盒 + 高度 + 层数），同时作为 Worker 障碍物输入 */
export type FireBuildingDef = {
  id: string
  name: string
  x0: number
  x1: number
  y0: number
  y1: number
  /** 顶面归一化高度（相对体域高度） */
  height: number
  floors: number
  type: FireBuildingType
}

/** 道路：归一化点串 + 线宽（米） */
export type FireRoadDef = { points: [number, number][]; width: number; kind: 'main' | 'secondary' | 'fire' }

export type FireRiskLevel = 'safe' | 'watch' | 'alert' | 'high' | 'extreme'

export type FireRiskBand = { level: FireRiskLevel; label: string; color: string; temp: number; smoke: number }

export type FireCameraPreset = 'overview' | 'source' | 'plume' | 'downwind' | 'top'

export type FireConfig = {
  siteName: string
  /** 环境温度 °C */
  ambientTemp: number
  sources: FireSourceDef[]
  buildings: FireBuildingDef[]
  roads: FireRoadDef[]
  tempThresholds: number[]
  smokeThresholds: number[]
  /** 风险等级（温度 / 烟气复合） */
  riskBands: FireRiskBand[]
  /** 火灾事件阶段（T+ 分钟） */
  eventPhases: { atMinute: number; label: string }[]
  camera: Record<FireCameraPreset, { label: string; heading: number; pitch: number; rangeFactor: number }>
  /** 单个时间步代表的分钟数 */
  timeStepMinutes: number
}

/**
 * 火灾烟气与温度体专属配置：事件驱动多火源、程序化街区建筑、道路骨架、
 * 温度/烟气危险阈值、风险分级、事件阶段与相机预设。
 */
export const FIRE_CONFIG: FireConfig = {
  siteName: '老城商业区建筑火灾',
  ambientTemp: 20,
  sources: [
    {
      id: 'F-01', name: '主火源·商贸大厦', x: 0.46, y: 0.52, buildingId: 'B-01', floor: 18,
      sourceType: 'primary', start: 0.0, peak: 0.5, end: 1.0, heatRelease: 1.0, smokeYield: 1.0, radius: 0.05
    },
    {
      id: 'F-02', name: '次火源·沿街商铺', x: 0.58, y: 0.59, buildingId: 'B-04', floor: 2,
      sourceType: 'ignition', start: 0.18, peak: 0.52, end: 0.92, heatRelease: 0.5, smokeYield: 0.55, radius: 0.04
    },
    {
      id: 'F-03', name: '飞火·屋顶堆场', x: 0.70, y: 0.62, buildingId: 'B-07', floor: 2,
      sourceType: 'spot', start: 0.45, peak: 0.74, end: 1.0, heatRelease: 0.4, smokeYield: 0.45, radius: 0.035
    }
  ],
  buildings: [
    { id: 'B-01', name: '商贸大厦', x0: 0.42, x1: 0.5, y0: 0.48, y1: 0.56, height: 0.34, floors: 24, type: 'tower' },
    { id: 'B-02', name: '居民楼 A', x0: 0.28, x1: 0.35, y0: 0.42, y1: 0.49, height: 0.19, floors: 12, type: 'residential' },
    { id: 'B-03', name: '商业裙楼', x0: 0.51, x1: 0.57, y0: 0.44, y1: 0.5, height: 0.1, floors: 6, type: 'shop' },
    { id: 'B-04', name: '沿街商铺', x0: 0.55, x1: 0.61, y0: 0.56, y1: 0.62, height: 0.07, floors: 4, type: 'shop' },
    { id: 'B-05', name: '写字楼 B', x0: 0.3, x1: 0.37, y0: 0.6, y1: 0.67, height: 0.26, floors: 18, type: 'tower' },
    { id: 'B-06', name: '居民楼 B', x0: 0.62, x1: 0.69, y0: 0.38, y1: 0.45, height: 0.16, floors: 10, type: 'residential' },
    { id: 'B-07', name: '仓库', x0: 0.66, x1: 0.74, y0: 0.58, y1: 0.66, height: 0.06, floors: 3, type: 'warehouse' },
    { id: 'B-08', name: '酒店', x0: 0.2, x1: 0.27, y0: 0.52, y1: 0.59, height: 0.22, floors: 16, type: 'tower' },
    { id: 'B-09', name: '商铺 C', x0: 0.4, x1: 0.46, y0: 0.66, y1: 0.72, height: 0.08, floors: 5, type: 'shop' },
    { id: 'B-10', name: '居民楼 C', x0: 0.52, x1: 0.59, y0: 0.68, y1: 0.75, height: 0.18, floors: 11, type: 'residential' },
    { id: 'B-11', name: '办公楼 C', x0: 0.7, x1: 0.77, y0: 0.28, y1: 0.35, height: 0.2, floors: 14, type: 'tower' },
    { id: 'B-12', name: '沿街商铺 D', x0: 0.16, x1: 0.22, y0: 0.36, y1: 0.42, height: 0.07, floors: 4, type: 'shop' },
    { id: 'B-13', name: '库房', x0: 0.62, x1: 0.7, y0: 0.72, y1: 0.79, height: 0.05, floors: 3, type: 'warehouse' },
    { id: 'B-14', name: '住宅 D', x0: 0.24, x1: 0.31, y0: 0.72, y1: 0.79, height: 0.15, floors: 9, type: 'residential' }
  ],
  roads: [
    { points: [[0.05, 0.4], [0.95, 0.4]], width: 16, kind: 'main' },
    { points: [[0.4, 0.05], [0.4, 0.95]], width: 16, kind: 'main' },
    { points: [[0.05, 0.64], [0.95, 0.64]], width: 10, kind: 'secondary' },
    { points: [[0.62, 0.05], [0.62, 0.95]], width: 10, kind: 'secondary' },
    { points: [[0.05, 0.24], [0.95, 0.24]], width: 8, kind: 'secondary' }
  ],
  tempThresholds: [60, 150, 350, 600],
  smokeThresholds: [50, 150, 300],
  riskBands: [
    { level: 'safe', label: '安全', color: '#3d8bfd', temp: 60, smoke: 50 },
    { level: 'watch', label: '关注', color: '#f2c94c', temp: 150, smoke: 150 },
    { level: 'alert', label: '警戒', color: '#f2994a', temp: 350, smoke: 250 },
    { level: 'high', label: '高危', color: '#eb5757', temp: 600, smoke: 400 },
    { level: 'extreme', label: '极高危', color: '#ff2d55', temp: 900, smoke: 600 }
  ],
  eventPhases: [
    { atMinute: 0, label: '初燃' },
    { atMinute: 6, label: '发展' },
    { atMinute: 12, label: '火势增强' },
    { atMinute: 18, label: '旺盛期' },
    { atMinute: 26, label: '烟羽抬升' },
    { atMinute: 34, label: '下风向扩散' },
    { atMinute: 42, label: '多源合并' }
  ],
  camera: {
    overview: { label: '总览', heading: 32, pitch: -30, rangeFactor: 1.05 },
    source: { label: '事故核心', heading: 315, pitch: -14, rangeFactor: 0.4 },
    plume: { label: '烟羽侧视', heading: 240, pitch: -16, rangeFactor: 0.66 },
    downwind: { label: '下风向', heading: 55, pitch: -12, rangeFactor: 0.72 },
    top: { label: '态势顶视', heading: 0, pitch: -82, rangeFactor: 0.92 }
  },
  timeStepMinutes: 2
}

/** 海洋温盐深三维体 —— 站位与水体 */
export type OceanStationDef = { id: string; name: string; x: number; y: number }
export type OceanWaterMass = { name: string; tRange: [number, number]; sRange: [number, number]; color: string }

export type OceanCameraPreset = 'overview' | 'surface' | 'thermocline' | 'section' | 'eddy'

export type OceanConfig = {
  regionName: string
  stations: OceanStationDef[]
  depthMarks: number[]
  waterMasses: OceanWaterMass[]
  camera: Record<OceanCameraPreset, { label: string; heading: number; pitch: number; rangeFactor: number }>
  /** 单个时间步代表的月数 */
  timeStepMonths: number
}

/**
 * 海洋温盐深专属配置：观测站、深度标尺、水团分类与相机预设。
 */
export const OCEAN_CONFIG: OceanConfig = {
  regionName: '黄海中部陆架海域',
  stations: [
    { id: 'CTD-01', name: 'CTD-01 近岸站', x: 0.24, y: 0.36 },
    { id: 'CTD-02', name: 'CTD-02 陆架站', x: 0.46, y: 0.50 },
    { id: 'CTD-03', name: 'CTD-03 深水站', x: 0.66, y: 0.42 },
    { id: 'CTD-04', name: 'CTD-04 冷涡站', x: 0.58, y: 0.66 }
  ],
  depthMarks: [50, 100, 200, 400, 600, 800, 1000],
  waterMasses: [
    { name: '黄海表层水', tRange: [18, 30], sRange: [29, 32], color: '#f2994a' },
    { name: '黄海冷水团', tRange: [4, 10], sRange: [32, 34], color: '#2d9cdb' },
    { name: '黄海深层水', tRange: [-1, 6], sRange: [33, 35], color: '#1b3a6b' }
  ],
  camera: {
    overview: { label: '全局', heading: 30, pitch: -30, rangeFactor: 1.05 },
    surface: { label: '海表', heading: 40, pitch: -12, rangeFactor: 0.72 },
    thermocline: { label: '温跃层', heading: 300, pitch: -18, rangeFactor: 0.6 },
    section: { label: '温盐剖面', heading: 88, pitch: -6, rangeFactor: 0.82 },
    eddy: { label: '中尺度涡', heading: 210, pitch: -24, rangeFactor: 0.55 }
  },
  timeStepMonths: 1
}

export const SCENES: Record<SceneKind, SceneSpec> = {
  radar: {
    kind: 'radar',
    title: '三维天气雷达回波与对流分析',
    tag: '气象 / Radar Volume',
    description:
      '以雷达站为中心、按距离/方位/波束几何生成的反射率体数据：分辨 20/35/45/55 dBZ 分级与强对流核心，叠加 35/45 dBZ 等值面、回波顶高与地面覆盖，支持 PPI/RHI 剖面、最强核心聚焦、时间演变与体素拾取。',
    center: { lon: 116.39, lat: 39.91, height: 40 },
    volume: { width: 80000, depth: 80000, height: 20000, base: 0 },
    channels: [
      { key: 'dbz', label: '反射率', unit: 'dBZ', min: 0, max: 70, palette: 'radar', mode: 'scalar', thresholds: [20, 35, 45, 55], decimals: 1 }
    ],
    defaultChannel: 'dbz',
    timeSteps: 12,
    timeStepUnit: 'min',
    defaults: { tileSize: 16, levels: 4, sse: 14, stepSize: 1, nearest: false, opacity: 0.92, alphaFloor: 0 },
    params: { cells: 7, seed: 20260928, wind: 0.55, maxRange: 0.5, attenuation: 0.42 }
  },
  pm25: {
    kind: 'pm25',
    title: '城市 PM2.5 三维浓度场与污染输运分析',
    tag: '环境 / PM2.5 Transport',
    description:
      '以固定污染源清单（工业烟囱 / 城区面源 / 道路线源）与气象条件（风向风速 / 风切变 / 边界层高度 / 大气稳定度）驱动的三维 PM2.5 浓度场与输运分析：支持 PM2.5 / PM10 / NO₂ 多污染物切换、35/75/150/250 关键浓度等值面、地面污染 footprint、污染热点与源贡献解析、监测站模型-观测误差评估、时间演变趋势与浓度/IAQI 对照。',
    center: { lon: 116.39, lat: 39.91, height: 40 },
    volume: { width: 40000, depth: 40000, height: 2500, base: 0 },
    channels: [
      { key: 'pm25', label: 'PM2.5', unit: 'µg/m³', min: 0, max: 300, palette: 'pm25', mode: 'scalar', thresholds: [35, 75, 115, 150, 250], decimals: 0 },
      { key: 'pm10', label: 'PM10', unit: 'µg/m³', min: 0, max: 500, palette: 'pm10', mode: 'scalar', thresholds: [50, 150, 250, 350], decimals: 0 },
      { key: 'no2', label: 'NO₂', unit: 'µg/m³', min: 0, max: 200, palette: 'no2', mode: 'scalar', thresholds: [40, 80, 120, 160], decimals: 0 }
    ],
    defaultChannel: 'pm25',
    timeSteps: 24,
    timeStepUnit: 'h',
    defaults: { tileSize: 16, levels: 4, sse: 14, stepSize: 1, nearest: false, opacity: 0.72, alphaFloor: 0 },
    params: { seed: 20260928, activeSources: 5, windFrom: 235, windSpeed: 4.5, blh: 0.35, background: 22, stability: 0.5, correct: 0 }
  },
  wind: {
    kind: 'wind',
    title: '三维风场 Vector Volume',
    tag: 'Vector / Wind Field',
    description:
      'GPU 风流粒子与体标量共享同一套 u/v/w 场语义的三维向量体：粒子层在 WebGL2 中做纹理乒乓平流，体色表达风速/垂直速度，主导风向按气象来向定义；提供多高度分层流线、沿主风向的垂直风剖面与高度层箭头，体域骨架与地面风场 footprint 锚定空间尺度；支持点击拾取垂直廓线、六种相机预设与三种场景背景。',
    center: { lon: 116.39, lat: 39.91, height: 30 },
    volume: { width: 8000, depth: 8000, height: 1000, base: 0 },
    channels: [
      { key: 'speed', label: '风速', unit: 'm/s', min: 0, max: 24, palette: 'wind', mode: 'scalar', thresholds: [5, 10, 15], decimals: 1 },
      { key: 'w', label: '垂直速度', unit: 'm/s', min: -3, max: 3, palette: 'coolwarm', mode: 'scalar', decimals: 2, diverging: true }
    ],
    defaultChannel: 'speed',
    timeSteps: 1,
    timeStepUnit: '',
    vector: { label: '风场粒子', unit: 'm/s', min: 0, max: 24, palette: 'wind', defaultCount: 4000, defaultSize: 2 },
    defaults: { tileSize: 16, levels: 4, sse: 12, stepSize: 1, nearest: false, opacity: 0.6, alphaFloor: 0.04 },
    params: { seed: 20260928, baseSpeed: 9, baseDir: 235, vortices: 3, gust: 0.25 }
  },
  geology: {
    kind: 'geology',
    title: '地质可视化-三维地层属性体',
    tag: 'Geology / Stratigraphic Model',
    description:
      '由统一构造场（地层倾斜 + 褶皱 + 断层错断 + 侵入体）驱动的三维地层模型：岩性/孔隙率/渗透率/饱和度多通道切换，叠加钻孔 ZK-01~ZK-03、断层面、深度标尺与层序图例，支持 A-B 地质剖面、水平层位切片、属性异常区与分层统计。',
    center: { lon: 118.68, lat: 32.05, height: 1200 },
    volume: { width: 12000, depth: 9000, height: 3200, base: -3200 },
    channels: [
      { key: 'litho', label: '岩性', unit: '', min: 1, max: 6, palette: 'gray', mode: 'categorical', decimals: 0 },
      { key: 'porosity', label: '孔隙率', unit: '%', min: 0, max: 35, palette: 'porosity', mode: 'scalar', decimals: 1 },
      { key: 'permeability', label: '渗透率', unit: 'mD', min: 0.1, max: 1000, palette: 'permeability', mode: 'scalar', logScale: true, decimals: 2 },
      { key: 'saturation', label: '含水饱和度', unit: '%', min: 0, max: 100, palette: 'saturation', mode: 'scalar', decimals: 0 }
    ],
    defaultChannel: 'litho',
    timeSteps: 1,
    timeStepUnit: '',
    categories: [
      { code: 1, label: '表土层', color: [193, 154, 107] },
      { code: 2, label: '砂岩', color: [233, 196, 106] },
      { code: 3, label: '页岩', color: [112, 128, 144] },
      { code: 4, label: '石灰岩', color: [160, 190, 190] },
      { code: 5, label: '花岗岩', color: [214, 120, 120] },
      { code: 6, label: '基岩', color: [92, 84, 112] }
    ],
    defaults: { tileSize: 16, levels: 4, sse: 12, stepSize: 1, nearest: false, opacity: 0.94, alphaFloor: 0 },
    params: { seed: 20260928, dip: 0.05, dipDir: 35, foldAmp: 0.045, faultThrow: 0.05, faultDir: 118, intrusion: 0.11 }
  },
  cfd: {
    kind: 'cfd',
    title: '工程仿真-CFD 多物理场体可视化',
    tag: 'CFD / Multi-field',
    description:
      '面向工程仿真的三维多物理场工作台：以程序化街区建筑为工程骨架，速度 / 压力 / 温度三场由同一解析流场模型一致生成（迎风驻点高压、绕流加速、尾流回压低谷、热源热羽随流输运），叠加仿真域、入口 / 出口边界、主风向、入口粒子与流线、等值面、剖切与工程 KPI。',
    center: { lon: 116.39, lat: 39.91, height: 30 },
    volume: { width: 2000, depth: 2000, height: 300, base: 0 },
    channels: [
      { key: 'speed', label: '速度', unit: 'm/s', min: 0, max: 20, palette: 'wind', mode: 'scalar', thresholds: [4, 8, 12], decimals: 2 },
      { key: 'pressure', label: '压力', unit: 'Pa', min: -120, max: 120, palette: 'coolwarm', mode: 'scalar', decimals: 0 },
      { key: 'temperature', label: '温度', unit: 'K', min: 280, max: 360, palette: 'thermal', mode: 'scalar', decimals: 1 }
    ],
    defaultChannel: 'speed',
    timeSteps: 12,
    timeStepUnit: 's',
    vector: { label: '流场粒子', unit: 'm/s', min: 0, max: 20, palette: 'wind', defaultCount: 4000, defaultSize: 3 },
    defaults: { tileSize: 16, levels: 4, sse: 12, stepSize: 1, nearest: false, opacity: 0.6, alphaFloor: 0.03 },
    params: {
      seed: 20260928,
      inflow: 6,
      ambientTemp: 300,
      sourceTemp: 320,
      heat: 1,
      sourceX: 0.22,
      sourceY: 0.42,
      obstacle: 1
    }
  },
  plume: {
    kind: 'plume',
    title: '空间分析-地下水污染羽流三维体',
    tag: 'Hydrology / Contaminant Plume',
    description:
      '工业遗留场地地下水污染调查：以平流—弥散—衰变模型生成三维污染羽流，叠加潜水/承压多层含水层与隔水层，支持 TCE / 六价铬 / TDS 多污染物切换、风险浓度等值面、监测井浓度剖面、沿流向剖切与污染体积/前缘距离统计。',
    center: { lon: 120.32, lat: 31.48, height: 120 },
    volume: { width: 3000, depth: 3000, height: 120, base: -120 },
    channels: [
      { key: 'tce', label: '三氯乙烯', unit: 'µg/L', min: 0, max: 400, palette: 'contaminant', mode: 'scalar', thresholds: [50, 100, 200], decimals: 0 },
      { key: 'cr6', label: '六价铬', unit: 'mg/L', min: 0, max: 30, palette: 'chromate', mode: 'scalar', thresholds: [3, 6, 12], decimals: 2 },
      { key: 'tds', label: '总溶解固体', unit: 'mg/L', min: 0, max: 1600, palette: 'turbo', mode: 'scalar', thresholds: [300, 600, 900], decimals: 0 }
    ],
    defaultChannel: 'tce',
    timeSteps: 24,
    timeStepUnit: '月',
    defaults: { tileSize: 16, levels: 4, sse: 12, stepSize: 1, nearest: false, opacity: 0.9, alphaFloor: 0 },
    params: { seed: 20260929, flowDir: 68, velocity: 0.5, dispersion: 0.5, decay: 0.4, sourceX: 0.3, sourceY: 0.42, recharge: 0.5 }
  },
  mining: {
    kind: 'mining',
    title: '矿山分析-三维矿体品位体',
    tag: 'Mining / Grade Volume',
    description:
      '露天矿三维矿体建模：以钻孔样品与 IDW 插值构建 Cu / Au / Fe 品位体，支持边界品位与工业品位阈值、矿体等值面、勘探线剖面、钻孔样品定位，并按块体模型统计吨位、平均品位与金属量。',
    center: { lon: 113.05, lat: 25.85, height: 520 },
    volume: { width: 3000, depth: 3000, height: 500, base: -500 },
    channels: [
      { key: 'cu', label: '铜 Cu', unit: '%', min: 0, max: 2, palette: 'ore', mode: 'scalar', thresholds: [0.2, 0.4, 0.8, 1.2], decimals: 2 },
      { key: 'au', label: '金 Au', unit: 'g/t', min: 0, max: 4, palette: 'gold', mode: 'scalar', thresholds: [0.3, 0.6, 1.2, 2.0], decimals: 2 },
      { key: 'fe', label: '全铁 Fe', unit: '%', min: 0, max: 60, palette: 'terrain', mode: 'scalar', thresholds: [10, 20, 35, 50], decimals: 1 }
    ],
    defaultChannel: 'cu',
    timeSteps: 1,
    timeStepUnit: '',
    defaults: { tileSize: 16, levels: 4, sse: 12, stepSize: 1, nearest: false, opacity: 0.95, alphaFloor: 0 },
    params: { seed: 20260930, oreDir: 42, oreRich: 0.6, supergene: 0.5, complexity: 0.5, lodes: 4 }
  },
  flood: {
    kind: 'flood',
    title: '水文分析-洪水动力三维水深体',
    tag: 'Flood / Hydrodynamic Volume',
    description:
      '河流—城市—低洼区联合洪水演进：由地形、河道与洪水过程线驱动的三维水深/流速/水位体，叠加水文站、受影响城区与预警分级，支持洪峰时刻、淹没范围、最大水深、断面流速与受淹对象统计。',
    center: { lon: 113.62, lat: 34.75, height: 40 },
    volume: { width: 20000, depth: 20000, height: 30, base: 0 },
    channels: [
      { key: 'depth', label: '水深', unit: 'm', min: 0, max: 12, palette: 'flood', mode: 'scalar', thresholds: [0.5, 1, 2, 3], decimals: 2 },
      { key: 'speed', label: '流速', unit: 'm/s', min: 0, max: 6, palette: 'wind', mode: 'scalar', thresholds: [1, 2, 3], decimals: 2 },
      { key: 'level', label: '水位', unit: 'm', min: 0, max: 30, palette: 'blues', mode: 'scalar', thresholds: [5, 10, 15], decimals: 2 }
    ],
    defaultChannel: 'depth',
    timeSteps: 36,
    timeStepUnit: 'h',
    vector: { label: '洪水流场', unit: 'm/s', min: 0, max: 6, palette: 'flood', defaultCount: 4000, defaultSize: 2 },
    defaults: { tileSize: 16, levels: 4, sse: 12, stepSize: 1, nearest: false, opacity: 0.55, alphaFloor: 0.03 },
    params: { seed: 20260928, peakDepth: 5, riverFlow: 0.6, roughness: 0.035, rainfall: 0.6, levee: 0.4 }
  },
  fire: {
    kind: 'fire',
    title: '灾害分析-火灾烟气与温度三维体',
    tag: 'Disaster / Fire Smoke',
    description:
      '城市建筑火灾态势：多火源随时间的成长与浮升烟羽在环境风驱动下向下风向输运，生成三维温度 / 烟气浓度 / 能见度场，叠加周边建筑、危险温度与烟气阈值等值面、垂直剖面与危险体积、烟羽顶高、下风向影响距离统计。',
    center: { lon: 114.3, lat: 30.6, height: 40 },
    volume: { width: 900, depth: 900, height: 300, base: 0 },
    channels: [
      { key: 'temp', label: '温度', unit: '°C', min: 20, max: 900, palette: 'thermal', mode: 'scalar', thresholds: [60, 150, 350, 600], decimals: 0 },
      { key: 'smoke', label: '烟气浓度', unit: 'mg/m³', min: 0, max: 400, palette: 'smoke', mode: 'scalar', thresholds: [50, 150, 300], decimals: 0 },
      { key: 'visibility', label: '能见度', unit: 'm', min: 0, max: 1500, palette: 'gray', mode: 'scalar', thresholds: [100, 300, 800], decimals: 0 }
    ],
    defaultChannel: 'temp',
    timeSteps: 24,
    timeStepUnit: 'min',
    vector: { label: '环境风场', unit: 'm/s', min: 0, max: 12, palette: 'wind', defaultCount: 5000, defaultSize: 2 },
    defaults: { tileSize: 16, levels: 4, sse: 12, stepSize: 1, nearest: false, opacity: 0.55, alphaFloor: 0.02 },
    params: { seed: 20260928, windDir: 235, windSpeed: 6, heat: 1, fireX: 0.44, fireY: 0.54, spread: 0.5 }
  },
  ocean: {
    kind: 'ocean',
    title: '海洋分析-温盐深三维体',
    tag: 'Ocean / TS Volume',
    description:
      '黄海陆架温盐深三维结构：温跃层、盐跃层与密度锋面随深度的层化结构，叠加中尺度涡与海流，支持温度 / 盐度 / 密度多变量切换、海表与指定深度层、垂向剖面、温盐散点与水团判别。',
    center: { lon: 122.5, lat: 33.0, height: 0 },
    volume: { width: 200000, depth: 200000, height: 1000, base: -1000 },
    channels: [
      { key: 'temperature', label: '温度', unit: '°C', min: -2, max: 32, palette: 'ocean', mode: 'scalar', thresholds: [4, 12, 20], decimals: 2 },
      { key: 'salinity', label: '盐度', unit: 'PSU', min: 30, max: 36, palette: 'salinity', mode: 'scalar', thresholds: [32, 33, 34.5], decimals: 2 },
      { key: 'density', label: '密度', unit: 'kg/m³', min: 1020, max: 1028, palette: 'coolwarm', mode: 'scalar', thresholds: [1024, 1025, 1026], decimals: 2 }
    ],
    defaultChannel: 'temperature',
    timeSteps: 12,
    timeStepUnit: '月',
    vector: { label: '海流', unit: 'm/s', min: 0, max: 1.2, palette: 'wind', defaultCount: 3000, defaultSize: 2 },
    defaults: { tileSize: 16, levels: 4, sse: 12, stepSize: 1, nearest: false, opacity: 0.5, alphaFloor: 0.03 },
    params: { seed: 20260928, sst: 24, front: 0.5, eddy: 0.6, season: 0.4, mixedLayer: 0.18 }
  }
}

export function channelOf(spec: SceneSpec, key: string): ChannelSpec {
  return spec.channels.find((c) => c.key === key) ?? spec.channels[0]
}
