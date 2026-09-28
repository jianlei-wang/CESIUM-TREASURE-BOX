/**
 * Volume Engine —— 传递函数与色带
 *
 * 统一维护体数据的色带定义（RGB 停靠点），并提供 CPU 端 256 级 RGBA 传递函数生成、
 * 以及供图例直接使用的 CSS 渐变。所有体渲染案例共用同一套实现，避免逐案例重复。
 */

export type Stop = [number, number, number]

export type PaletteDef = {
  label: string
  stops: Stop[]
}

/** 常用色带：业务色带 + 通用科学色带，CPU 与 GPU 共用同一份定义 */
export const PALETTES: Record<string, PaletteDef> = {
  viridis: { label: 'Viridis', stops: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]] },
  turbo: { label: 'Turbo', stops: [[48, 18, 59], [70, 134, 251], [27, 229, 181], [170, 255, 72], [251, 126, 33], [122, 4, 3]] },
  coolwarm: { label: '冷暖', stops: [[59, 76, 192], [141, 176, 254], [221, 221, 221], [247, 164, 137], [180, 4, 38]] },
  terrain: { label: '地形', stops: [[26, 52, 90], [46, 125, 77], [180, 190, 120], [150, 100, 60], [255, 255, 255]] },
  rainbow: { label: '彩虹', stops: [[110, 64, 170], [0, 200, 255], [0, 255, 160], [255, 255, 0], [255, 120, 0], [255, 0, 0]] },
  jet: { label: 'Jet', stops: [[0, 0, 143], [0, 0, 255], [0, 255, 255], [255, 255, 0], [255, 0, 0], [128, 0, 0]] },
  gray: { label: '灰度', stops: [[20, 20, 20], [130, 130, 130], [245, 245, 245]] },
  blues: { label: '蓝色系', stops: [[8, 20, 48], [24, 78, 150], [72, 158, 214], [180, 224, 245]] },
  greens: { label: '绿色系', stops: [[8, 38, 20], [24, 116, 62], [96, 190, 110], [220, 250, 190]] },
  reds: { label: '红色系', stops: [[48, 8, 8], [158, 24, 24], [230, 96, 48], [255, 220, 160]] },
  /** 气象雷达反射率（dBZ）：弱回波青蓝 → 强回波红 → 极强回波品红/白 */
  radar: {
    label: '雷达 dBZ',
    stops: [[4, 16, 40], [0, 120, 220], [0, 210, 170], [40, 220, 60], [240, 230, 40], [255, 150, 20], [255, 40, 30], [170, 0, 120], [255, 255, 255]]
  },
  /** 空气质量（PM2.5 国标 6 级） */
  aqi: {
    label: '空气质量',
    stops: [[0, 228, 0], [255, 255, 0], [255, 126, 0], [255, 0, 0], [143, 63, 151], [126, 0, 35]]
  },
  /** 风速（气象惯用）：低速蓝绿 → 高速红紫 */
  wind: {
    label: '风速',
    stops: [[6, 24, 70], [20, 110, 200], [30, 200, 190], [150, 230, 80], [255, 210, 40], [255, 110, 20], [180, 20, 60]]
  },
  /** 温度（对流层）：冷蓝 → 暖红 */
  thermal: {
    label: '温度',
    stops: [[18, 30, 90], [30, 120, 210], [90, 200, 220], [240, 240, 190], [250, 160, 60], [200, 30, 20]]
  },
  /** 地层属性连续色带（低值→高值） */
  porosity: {
    label: '孔隙率',
    stops: [[196, 176, 128], [170, 200, 120], [90, 190, 170], [40, 130, 190]]
  },
  permeability: {
    label: '渗透率',
    stops: [[210, 190, 150], [190, 205, 120], [110, 190, 140], [40, 150, 190], [24, 80, 150]]
  },
  saturation: {
    label: '饱和度',
    stops: [[150, 90, 30], [200, 170, 70], [120, 190, 190], [40, 120, 200]]
  }
}

export type TransferOptions = {
  /** 低值体元素保留的最低不透明度，0 表示低值完全透明 */
  alphaFloor?: number
  /** 不透明度上升幂次，1 为线性，>1 更集中于高值 */
  alphaGamma?: number
  /** 低于该归一化阈值时不显示 */
  threshold?: number
  /** 不透明度整体上限 */
  alphaMax?: number
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** 在停靠点之间做线性插值 */
export function lerpStops(stops: Stop[], t: number): Stop {
  const c = clamp(t, 0, 1)
  const scaled = c * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(scaled))
  const local = scaled - i
  const a = stops[i]
  const b = stops[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * local),
    Math.round(a[1] + (b[1] - a[1]) * local),
    Math.round(a[2] + (b[2] - a[2]) * local)
  ]
}

/**
 * 生成 256×1 RGBA 传递函数：RGB 取自色带，A 为带基底与阈值的平滑上升曲线。
 * 传送到 GPU 前会再包一层 TextureUniform。
 */
export function buildTransferLut(paletteKey: string, options: TransferOptions = {}): Uint8Array {
  const stops = (PALETTES[paletteKey] ?? PALETTES.viridis).stops
  const floor = clamp(options.alphaFloor ?? 0, 0, 1)
  const gamma = Math.max(0.05, options.alphaGamma ?? 1)
  const threshold = clamp(options.threshold ?? 0, 0, 0.999)
  const alphaMax = clamp(options.alphaMax ?? 1, 0, 1)
  const lut = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255
    const [r, g, b] = lerpStops(stops, t)
    const ramp = t <= threshold ? 0 : Math.pow((t - threshold) / (1 - threshold), gamma)
    lut[i * 4] = r
    lut[i * 4 + 1] = g
    lut[i * 4 + 2] = b
    lut[i * 4 + 3] = Math.round(255 * alphaMax * (floor + (1 - floor) * ramp))
  }
  return lut
}

/** 图例用 CSS 线性渐变 */
export function gradientCss(paletteKey: string): string {
  const stops = (PALETTES[paletteKey] ?? PALETTES.viridis).stops
  return `linear-gradient(90deg, ${stops.map((s) => `rgb(${s[0]}, ${s[1]}, ${s[2]})`).join(', ')})`
}

export type CategoryDef = {
  code: number
  label: string
  color: Stop
}

/** 地层岩性分类色板（源自 geological-voxel 的分层配色） */
export const LITHOLOGY_CATEGORIES: CategoryDef[] = [
  { code: 1, label: '表土层', color: [139, 69, 19] },
  { code: 2, label: '砂岩', color: [210, 180, 140] },
  { code: 3, label: '页岩', color: [192, 192, 192] },
  { code: 4, label: '石灰岩', color: [128, 128, 128] },
  { code: 5, label: '花岗岩', color: [105, 105, 105] },
  { code: 6, label: '基岩', color: [75, 0, 130] }
]

export function categoryColor(code: number): Stop {
  const hit = LITHOLOGY_CATEGORIES.find((c) => c.code === code)
  return hit ? hit.color : [120, 120, 120]
}
