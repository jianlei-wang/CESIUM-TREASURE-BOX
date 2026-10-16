/**
 * 海洋分析-温盐深三维体 —— 案例自有色带
 *
 * 与通用 VolumeEngine 解耦：本案例自带色带定义与传递函数生成，颜色服务数据解读。
 * 温度使用感知连续、冷暖有序的色带；盐度、密度、流速各自使用独立语义色带。
 */

export type OceanStop = [number, number, number]

export type OceanPaletteDef = { label: string; stops: OceanStop[] }

export const OCEAN_PALETTES: Record<string, OceanPaletteDef> = {
  /** 温度：深蓝冷 → 青 → 黄绿 → 橙红暖，冷暖顺序明确 */
  temperature: {
    label: '海温',
    stops: [
      [10, 26, 76],
      [22, 78, 158],
      [40, 152, 196],
      [120, 208, 190],
      [228, 226, 130],
      [246, 156, 60],
      [198, 46, 42]
    ]
  },
  /** 盐度：低盐青绿 → 高盐紫红，与温度语义区分 */
  salinity: {
    label: '盐度',
    stops: [
      [22, 88, 110],
      [44, 150, 158],
      [118, 200, 172],
      [216, 208, 130],
      [228, 142, 116],
      [172, 58, 110]
    ]
  },
  /** 密度：浅绿低密度 → 深蓝紫高密度（连续） */
  density: {
    label: '密度 σt',
    stops: [
      [222, 240, 200],
      [160, 214, 176],
      [86, 178, 178],
      [48, 120, 176],
      [34, 70, 138],
      [24, 34, 92]
    ]
  },
  /** 流速：低速青蓝 → 高速黄红，与风场语义一致 */
  current: {
    label: '流速',
    stops: [
      [8, 40, 82],
      [24, 108, 176],
      [40, 190, 190],
      [150, 222, 96],
      [250, 206, 48],
      [246, 118, 40],
      [190, 30, 60]
    ]
  },
  /** 海底地形：浅海暖褐 → 深海冷蓝 */
  bathymetry: {
    label: '海底深度',
    stops: [
      [236, 214, 168],
      [198, 178, 120],
      [128, 168, 150],
      [64, 132, 168],
      [30, 82, 140],
      [16, 42, 92]
    ]
  }
}

export type OceanPaletteOptions = {
  alphaFloor?: number
  alphaGamma?: number
  alphaMax?: number
  threshold?: number
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function oceanLerpStops(stops: OceanStop[], t: number): OceanStop {
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

export function oceanPaletteColorAt(id: string, t: number): OceanStop {
  const stops = (OCEAN_PALETTES[id] ?? OCEAN_PALETTES.temperature).stops
  return oceanLerpStops(stops, t)
}

export function oceanGradientCss(id: string): string {
  const stops = (OCEAN_PALETTES[id] ?? OCEAN_PALETTES.temperature).stops
  return `linear-gradient(90deg, ${stops.map((s) => `rgb(${s[0]}, ${s[1]}, ${s[2]})`).join(', ')})`
}

/** 生成 256×1 RGBA 传递函数纹理数据 */
export function oceanTransferLut(id: string, options: OceanPaletteOptions = {}): Uint8Array {
  const stops = (OCEAN_PALETTES[id] ?? OCEAN_PALETTES.temperature).stops
  const floor = clamp(options.alphaFloor ?? 0, 0, 1)
  const gamma = Math.max(0.05, options.alphaGamma ?? 1)
  const alphaMax = clamp(options.alphaMax ?? 1, 0, 1)
  const threshold = clamp(options.threshold ?? 0, 0, 0.999)
  const lut = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255
    const [r, g, b] = oceanLerpStops(stops, t)
    const ramp = t <= threshold ? 0 : Math.pow((t - threshold) / (1 - threshold), gamma)
    lut[i * 4] = r
    lut[i * 4 + 1] = g
    lut[i * 4 + 2] = b
    lut[i * 4 + 3] = Math.round(255 * alphaMax * (floor + (1 - floor) * ramp))
  }
  return lut
}

/** 采样色带返回 0~1 的 RGB，用于 2D canvas 绘图 */
export function oceanColorRgb01(id: string, t: number): [number, number, number] {
  const [r, g, b] = oceanPaletteColorAt(id, t)
  return [r / 255, g / 255, b / 255]
}
