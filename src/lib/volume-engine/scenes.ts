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

export const SCENES: Record<SceneKind, SceneSpec> = {
  radar: {
    kind: 'radar',
    title: '三维气象雷达回波体',
    tag: '气象 / Radar Volume',
    description:
      '把天气雷达反射率体数据放进真实三维地球场景，用传递函数颜色与透明度表达对流单体、强回波核心与回波顶高，支持任意方向剖切、阈值分析、时间轴回放与体素拾取。',
    center: { lon: 116.39, lat: 39.91, height: 40 },
    volume: { width: 80000, depth: 80000, height: 20000, base: 0 },
    channels: [
      { key: 'dbz', label: '反射率', unit: 'dBZ', min: 0, max: 70, palette: 'radar', mode: 'scalar', thresholds: [20, 35, 45], decimals: 1 }
    ],
    defaultChannel: 'dbz',
    timeSteps: 12,
    timeStepUnit: 'min',
    defaults: { tileSize: 16, levels: 4, sse: 14, stepSize: 1, nearest: false, opacity: 0.9, alphaFloor: 0 },
    params: { cells: 7, seed: 20260928, wind: 0.55 }
  },
  pm25: {
    kind: 'pm25',
    title: '三维 PM2.5 浓度体',
    tag: '环境 / Pollution Volume',
    description:
      '将地面监测、气象场与模拟浓度组合成三维污染浓度体，展示污染羽流随高度和风向的变化，支持超标体积分析、任意剖切、多变量切换与时间轴回放。',
    center: { lon: 116.39, lat: 39.91, height: 40 },
    volume: { width: 40000, depth: 40000, height: 1500, base: 0 },
    channels: [
      { key: 'pm25', label: 'PM2.5', unit: 'µg/m³', min: 0, max: 300, palette: 'aqi', mode: 'scalar', thresholds: [35, 75, 115, 150, 250], decimals: 0 },
      { key: 'pm10', label: 'PM10', unit: 'µg/m³', min: 0, max: 500, palette: 'aqi', mode: 'scalar', decimals: 0 },
      { key: 'no2', label: 'NO₂', unit: 'µg/m³', min: 0, max: 200, palette: 'terrain', mode: 'scalar', decimals: 0 }
    ],
    defaultChannel: 'pm25',
    timeSteps: 12,
    timeStepUnit: 'h',
    defaults: { tileSize: 16, levels: 4, sse: 14, stepSize: 1, nearest: false, opacity: 0.72, alphaFloor: 0.02 },
    params: { sources: 5, seed: 20260928, windDir: 225, windSpeed: 4.5, blh: 0.35, background: 22 }
  },
  wind: {
    kind: 'wind',
    title: '三维风场 Vector Volume',
    tag: 'Vector / Wind Field',
    description:
      '从只看粒子的风场升级为真正的三维向量体，同时提供体标量（风速/垂直速度）与 GPU 粒子两种表达，支持任意高度与剖面分析、粒子预算与尾迹参数调节。',
    center: { lon: 116.39, lat: 39.91, height: 30 },
    volume: { width: 8000, depth: 8000, height: 1000, base: 0 },
    channels: [
      { key: 'speed', label: '风速', unit: 'm/s', min: 0, max: 20, palette: 'wind', mode: 'scalar', thresholds: [5, 10, 15], decimals: 1 },
      { key: 'w', label: '垂直速度', unit: 'm/s', min: -3, max: 3, palette: 'coolwarm', mode: 'scalar', decimals: 2 }
    ],
    defaultChannel: 'speed',
    timeSteps: 1,
    timeStepUnit: '',
    vector: { label: '风场粒子', unit: 'm/s', min: 0, max: 20, palette: 'wind', defaultCount: 4000, defaultSize: 3 },
    defaults: { tileSize: 16, levels: 4, sse: 12, stepSize: 1, nearest: false, opacity: 0.6, alphaFloor: 0.04 },
    params: { seed: 20260928, baseSpeed: 9, baseDir: 235, vortices: 3, gust: 0.25 }
  },
  geology: {
    kind: 'geology',
    title: '三维地质-地层属性体可视化',
    tag: 'Geology / Attribute Volume',
    description:
      '在现有地层体素基础上增加连续属性通道，把岩性分类升级到孔隙率、渗透率、饱和度等工程属性体，支持岩性/属性双通道切换、任意剖切、分层裁剪与钻孔拾取。',
    center: { lon: 110.0, lat: 35.0, height: 1200 },
    volume: { width: 10000, depth: 8000, height: 3000, base: -3000 },
    channels: [
      { key: 'litho', label: '岩性', unit: '', min: 1, max: 6, palette: 'gray', mode: 'categorical', decimals: 0 },
      { key: 'porosity', label: '孔隙率', unit: '%', min: 0, max: 35, palette: 'porosity', mode: 'scalar', decimals: 1 },
      { key: 'permeability', label: '渗透率', unit: 'mD', min: 0.1, max: 1000, palette: 'permeability', mode: 'scalar', decimals: 2 },
      { key: 'saturation', label: '饱和度', unit: '%', min: 0, max: 100, palette: 'saturation', mode: 'scalar', decimals: 0 }
    ],
    defaultChannel: 'litho',
    timeSteps: 1,
    timeStepUnit: '',
    categories: [
      { code: 1, label: '表土层', color: [139, 69, 19] },
      { code: 2, label: '砂岩', color: [210, 180, 140] },
      { code: 3, label: '页岩', color: [192, 192, 192] },
      { code: 4, label: '石灰岩', color: [128, 128, 128] },
      { code: 5, label: '花岗岩', color: [105, 105, 105] },
      { code: 6, label: '基岩', color: [75, 0, 130] }
    ],
    defaults: { tileSize: 16, levels: 4, sse: 14, stepSize: 1, nearest: false, opacity: 0.9, alphaFloor: 0 },
    params: { seed: 20260928, undulation: 0.06, intrusion: 0.12 }
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
