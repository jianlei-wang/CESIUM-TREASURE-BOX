/**
 * 海洋分析-温盐深三维体 —— 区域、变量与质量预设
 *
 * 区域与数据来源集中在此维护，渲染 / 分析代码不散落经纬度或水深常量。
 */

import type { OceanQualityPreset, OceanRegionPreset, OceanVariable } from './ocean-tsd.types'

/** 可选研究区域预设：数据目录相对 public 根 */
export const OCEAN_REGIONS: OceanRegionPreset[] = [
  {
    id: 'east-china-sea',
    title: '东海陆架坡折—黑潮邻区（月气候态样本）',
    shortName: '东海陆架坡折',
    dataDir: 'data/ocean-tsd/east-china-sea',
    center: { lon: 124.75, lat: 28.0 },
    defaultVerticalExaggeration: 22
  },
  {
    id: 'yellow-sea',
    title: '黄海中部陆架（月气候态样本）',
    shortName: '黄海中部陆架',
    dataDir: 'data/ocean-tsd/yellow-sea',
    center: { lon: 122.3, lat: 35.0 },
    defaultVerticalExaggeration: 40
  }
]

export const DEFAULT_REGION_ID = OCEAN_REGIONS[0].id

/** 变量展示定义：色带与单位在此固定，颜色范围默认由数据有效范围决定 */
export interface OceanVariableView {
  key: OceanVariable
  label: string
  unit: string
  palette: string
  decimals: number
  /** 缺测 / 无效值说明 */
  note: string
}

export const OCEAN_VARIABLES: OceanVariableView[] = [
  { key: 'temperature', label: '温度', unit: '°C', palette: 'temperature', decimals: 2, note: 'sourceVariable 以数据清单为准' },
  { key: 'salinity', label: '盐度', unit: 'PSU', palette: 'salinity', decimals: 2, note: '按源数据定义的盐度类型与单位' },
  { key: 'density', label: '密度 σt', unit: 'kg/m³', palette: 'density', decimals: 2, note: 'EOS-80 σt，参考压力 0 dbar，由 T/S 实时计算' },
  { key: 'currentSpeed', label: '流速', unit: 'm/s', palette: 'current', decimals: 2, note: 'sqrt(u²+v²)，水平流场' }
]

export function oceanVariableView(key: OceanVariable): OceanVariableView {
  return OCEAN_VARIABLES.find((v) => v.key === key) ?? OCEAN_VARIABLES[0]
}

export const OCEAN_VARIABLE_KEYS: OceanVariable[] = OCEAN_VARIABLES.map((v) => v.key)

/** 渲染质量档：以步长 / 屏幕误差 / 流场抽稀控制成本，不改变数据原生分辨率 */
export const OCEAN_QUALITY_PRESETS: OceanQualityPreset[] = [
  { key: 'performance', label: '性能', stepSize: 2.4, screenSpaceError: 24, currentStride: 4 },
  { key: 'balanced', label: '标准', stepSize: 1.6, screenSpaceError: 15, currentStride: 3 },
  { key: 'quality', label: '高质量', stepSize: 1.0, screenSpaceError: 9, currentStride: 2 }
]

export function oceanQuality(key: string): OceanQualityPreset {
  return OCEAN_QUALITY_PRESETS.find((q) => q.key === key) ?? OCEAN_QUALITY_PRESETS[1]
}

/** 相机预设视角（相对体域中心，heading 为地理方位角，pitch 为俯仰） */
export interface OceanCameraPreset {
  key: string
  label: string
  heading: number
  pitch: number
  /** 视距相对水平尺度的倍数 */
  rangeFactor: number
}

export const OCEAN_CAMERA_PRESETS: OceanCameraPreset[] = [
  { key: 'overview', label: '全局', heading: 20, pitch: -32, rangeFactor: 1.15 },
  { key: 'surface', label: '俯视表层', heading: 0, pitch: -78, rangeFactor: 0.9 },
  { key: 'stratify', label: '垂向层结', heading: 32, pitch: -8, rangeFactor: 0.85 },
  { key: 'section', label: '剖切观察', heading: 62, pitch: -16, rangeFactor: 0.8 },
  { key: 'profile', label: '侧视剖面', heading: 96, pitch: -4, rangeFactor: 0.95 }
]

/** 分析面板对各变量提供的层结目标说明 */
export const OCEAN_STRATIFICATION_LABEL: Record<OceanVariable, string> = {
  temperature: '温跃层',
  salinity: '盐跃层',
  density: '密度跃层',
  currentSpeed: '流速梯度'
}

/** 混合层判据阈值 */
export const OCEAN_MIXED_LAYER = {
  /** 温度判据：距表层温差超过该值视为混合层底 */
  temperatureDelta: 0.2,
  /** 密度判据：距表层位密度差超过该值视为混合层底 */
  densityDelta: 0.03
}
