/**
 * Volume Engine —— 场景描述表
 *
 * 每个体渲染案例对应一个 SceneSpec：声明体域范围、变量通道、色带、默认渲染参数与
 * 场景生成参数。主线程控制器（VolumeEngine）与 Worker 都以此为准，
 * 案例组件只负责选择场景 + 组装附加交互。
 */

export type SceneKind = 'radar' | 'pm25' | 'wind' | 'geology' | 'cfd'

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
  }
}

export function channelOf(spec: SceneSpec, key: string): ChannelSpec {
  return spec.channels.find((c) => c.key === key) ?? spec.channels[0]
}
