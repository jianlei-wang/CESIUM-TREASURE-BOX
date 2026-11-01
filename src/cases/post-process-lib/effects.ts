export type Slider = { name: string; label: string; min: number; max: number; step: number; value: number }
export type EffectSpec = { key: string; label: string; sliders: Slider[] }

export const ORDER = [
  'snowLine',
  'valleyFog',
  'spotlight',
  'precipitation',
  'rainRings',
  'lightning',
  'dufour',
  'tiltShift',
  'motionBlur',
  'speedLines',
  'colorIsolation',
  'infrared',
  'technicolor',
  'super8',
  'lensDistortion',
  'jello',
  'droneDisplay',
  'analogVideo',
  'digitalVideo'
]

export const GROUPS: Record<string, string[]> = {
  weather: ['snowLine', 'valleyFog', 'precipitation', 'rainRings', 'lightning'],
  camera: ['spotlight', 'tiltShift', 'motionBlur', 'speedLines', 'lensDistortion', 'jello'],
  style: ['dufour', 'colorIsolation', 'infrared', 'technicolor', 'super8'],
  video: ['droneDisplay', 'analogVideo', 'digitalVideo']
}

export const SPECS: EffectSpec[] = [
  { key: 'snowLine', label: '雪线', sliders: [
    { name: 'altitude', label: '海拔 (m)', min: 500, max: 4000, step: 50, value: 2000 },
    { name: 'transition', label: '过渡 (m)', min: 0, max: 1000, step: 10, value: 200 },
    { name: 'maxSlope', label: '最大坡度 (°)', min: 10, max: 80, step: 1, value: 50 },
    { name: 'coverage', label: '覆盖', min: 0, max: 1, step: 0.05, value: 1 }
  ] },
  { key: 'valleyFog', label: '山谷雾', sliders: [
    { name: 'top', label: '雾顶 (m)', min: 400, max: 3000, step: 10, value: 1500 },
    { name: 'density', label: '浓度', min: 0.0005, max: 0.02, step: 0.0005, value: 0.005 },
    { name: 'softness', label: '柔和 (m)', min: 0, max: 500, step: 10, value: 100 }
  ] },
  { key: 'spotlight', label: '聚光灯', sliders: [
    { name: 'power', label: '强度', min: 0, max: 4, step: 0.1, value: 1 },
    { name: 'radius', label: '半径 (m)', min: 20, max: 2000, step: 10, value: 200 },
    { name: 'softness', label: '柔化', min: 0, max: 1, step: 0.05, value: 0.5 },
    { name: 'darkness', label: '暗度', min: 0, max: 1, step: 0.05, value: 0.8 }
  ] },
  { key: 'precipitation', label: '降水', sliders: [
    { name: 'intensity', label: '强度', min: 0, max: 1, step: 0.05, value: 0.5 },
    { name: 'snow', label: '降雪', min: 0, max: 1, step: 0.05, value: 0 },
    { name: 'wind', label: '风向 (°)', min: 0, max: 60, step: 1, value: 10 },
    { name: 'speed', label: '速度', min: 0.25, max: 2, step: 0.05, value: 1 }
  ] },
  { key: 'rainRings', label: '雨圈', sliders: [
    { name: 'intensity', label: '强度', min: 0, max: 1, step: 0.05, value: 0.5 },
    { name: 'cell', label: '格距 (m)', min: 0.5, max: 10, step: 0.1, value: 2 },
    { name: 'reach', label: '波及 (m)', min: 0.05, max: 1.5, step: 0.05, value: 0.35 }
  ] },
  { key: 'lightning', label: '闪电', sliders: [
    { name: 'intensity', label: '强度', min: 0, max: 1, step: 0.05, value: 0.5 },
    { name: 'cloudBase', label: '云底 (m)', min: 500, max: 5000, step: 50, value: 2500 },
    { name: 'radius', label: '半径 (m)', min: 1000, max: 15000, step: 500, value: 5000 }
  ] },
  { key: 'dufour', label: 'Dufour 地图', sliders: [
    { name: 'spacing', label: '间距 (px)', min: 3, max: 12, step: 0.5, value: 3.5 },
    { name: 'strokeLength', label: '笔长', min: 2, max: 30, step: 1, value: 14 },
    { name: 'oblique', label: '斜射光', min: 0, max: 1, step: 0.05, value: 0.8 }
  ] },
  { key: 'tiltShift', label: '移轴', sliders: [
    { name: 'range', label: '清晰带', min: 0.05, max: 1, step: 0.05, value: 0.3 },
    { name: 'blur', label: '模糊', min: 1, max: 10, step: 0.5, value: 4 },
    { name: 'saturation', label: '饱和度', min: 0, max: 1, step: 0.05, value: 0.3 }
  ] },
  { key: 'motionBlur', label: '运动模糊', sliders: [
    { name: 'strength', label: '强度', min: 0, max: 1, step: 0.05, value: 1 },
    { name: 'exposure', label: '曝光 (s)', min: 0.005, max: 0.1, step: 0.005, value: 0.04 }
  ] },
  { key: 'speedLines', label: '速度线', sliders: [
    { name: 'strength', label: '强度', min: 0, max: 1, step: 0.05, value: 1 }
  ] },
  { key: 'colorIsolation', label: '色彩隔离', sliders: [
    { name: 'hue', label: '色相 (°)', min: 0, max: 359, step: 1, value: 0 },
    { name: 'range', label: '范围 (°)', min: 5, max: 120, step: 1, value: 60 }
  ] },
  { key: 'infrared', label: '红外', sliders: [
    { name: 'strength', label: '强度', min: 0, max: 1, step: 0.05, value: 1 }
  ] },
  { key: 'technicolor', label: '特艺彩色', sliders: [
    { name: 'strength', label: '强度', min: 0, max: 1, step: 0.05, value: 1 }
  ] },
  { key: 'super8', label: '超 8 胶片', sliders: [
    { name: 'fade', label: '褪色', min: 0, max: 1, step: 0.05, value: 0.5 },
    { name: 'grain', label: '颗粒', min: 0, max: 0.5, step: 0.01, value: 0.15 },
    { name: 'weave', label: '抖动 (px)', min: 0, max: 5, step: 0.1, value: 1.5 },
    { name: 'lightLeaks', label: '漏光', min: 0, max: 1, step: 0.05, value: 0.5 }
  ] },
  { key: 'lensDistortion', label: '广角镜头', sliders: [
    { name: 'distortion', label: '畸变', min: 0, max: 1, step: 0.05, value: 0.5 },
    { name: 'vignette', label: '暗角', min: 0, max: 1, step: 0.05, value: 0.5 }
  ] },
  { key: 'jello', label: '果冻效应', sliders: [
    { name: 'amount', label: '幅度', min: 0, max: 1, step: 0.05, value: 0.1 },
    { name: 'frequency', label: '频率 (Hz)', min: 2, max: 80, step: 1, value: 30 }
  ] },
  { key: 'droneDisplay', label: '无人机 OSD', sliders: [
    { name: 'opacity', label: '不透明度', min: 0, max: 1, step: 0.05, value: 1 }
  ] },
  { key: 'analogVideo', label: '模拟图传', sliders: [
    { name: 'noise', label: '噪点', min: 0, max: 1, step: 0.05, value: 0.5 },
    { name: 'interference', label: '干扰', min: 0, max: 1, step: 0.05, value: 0.15 }
  ] },
  { key: 'digitalVideo', label: '数字图传', sliders: [
    { name: 'breakup', label: '马赛克', min: 0, max: 1, step: 0.05, value: 0.5 }
  ] }
]
