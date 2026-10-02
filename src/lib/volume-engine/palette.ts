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
  /**
   * PM2.5 浓度密度色带：低值冷青 → 青绿 → 黄橙 → 橙红 → 核心深红/紫红。
   * 与 aqi 分级色不同，用于体渲染连续表达“污染密度场”，避免彩虹色削弱空间感知。
   */
  pm25: {
    label: 'PM2.5 浓度',
    stops: [[44, 116, 176], [40, 178, 158], [150, 214, 96], [246, 200, 52], [240, 116, 34], [186, 34, 58], [120, 12, 48]]
  },
  /** 粗颗粒物 PM10：偏黄褐的地壳色，与 PM2.5 冷青色带区分 */
  pm10: {
    label: 'PM10 浓度',
    stops: [[74, 62, 42], [140, 108, 58], [196, 158, 86], [228, 200, 132], [246, 232, 186]]
  },
  /** 二氧化氮 NO₂：黄绿 → 紫红，与道路源/燃烧源关联 */
  no2: {
    label: 'NO₂ 浓度',
    stops: [[30, 62, 92], [46, 140, 128], [150, 200, 92], [232, 196, 70], [214, 96, 46], [150, 30, 72]]
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
  /**
   * 双向发散量中心（归一化 0~1）。设置后不透明度以该点为中心对称上升，
   * 中心接近全透明、正负两端接近全不透明，用于垂直速度等正负物理量。
   */
  divergingCenter?: number
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
  const divergingCenter = options.divergingCenter
  const lut = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255
    const [r, g, b] = lerpStops(stops, t)
    let ramp: number
    if (divergingCenter !== undefined) {
      const reach = Math.max(divergingCenter, 1 - divergingCenter) || 1
      ramp = Math.pow(Math.abs(t - divergingCenter) / reach, gamma)
    } else {
      ramp = t <= threshold ? 0 : Math.pow((t - threshold) / (1 - threshold), gamma)
    }
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

/**
 * 雷达业务分级色带：颜色表达等级，透明度表达“存在感”。
 * 以 dBZ 断点定义，避免连续插值把弱回波与强回波糊成一片。
 */
export type RadarBand = { dbz: number; color: Stop; alpha: number }

export const RADAR_BANDS: RadarBand[] = [
  { dbz: 0, color: [4, 16, 40], alpha: 0.0 },
  { dbz: 5, color: [8, 44, 96], alpha: 0.02 },
  { dbz: 20, color: [0, 120, 220], alpha: 0.08 },
  { dbz: 30, color: [0, 205, 175], alpha: 0.18 },
  { dbz: 35, color: [46, 220, 66], alpha: 0.26 },
  { dbz: 40, color: [232, 224, 40], alpha: 0.4 },
  { dbz: 45, color: [255, 150, 24], alpha: 0.56 },
  { dbz: 50, color: [255, 44, 30], alpha: 0.72 },
  { dbz: 55, color: [206, 24, 112], alpha: 0.86 },
  { dbz: 65, color: [255, 128, 220], alpha: 0.94 },
  { dbz: 70, color: [255, 255, 255], alpha: 0.98 }
]

export type RadarLutOptions = {
  min?: number
  max?: number
  /** 低于该值完全透明（数据单位） */
  threshold?: number
  /** 整体不透明度上限 */
  alphaMax?: number
}

export function radarColorAt(dbz: number, min = 0, max = 70): Stop {
  const t = clamp((dbz - min) / (max - min || 1), 0, 1)
  const target = t * 70
  if (target <= RADAR_BANDS[0].dbz) return RADAR_BANDS[0].color
  for (let i = 0; i < RADAR_BANDS.length - 1; i += 1) {
    const a = RADAR_BANDS[i]
    const b = RADAR_BANDS[i + 1]
    if (target <= b.dbz) {
      const local = (target - a.dbz) / (b.dbz - a.dbz || 1)
      return [
        Math.round(a.color[0] + (b.color[0] - a.color[0]) * local),
        Math.round(a.color[1] + (b.color[1] - a.color[1]) * local),
        Math.round(a.color[2] + (b.color[2] - a.color[2]) * local)
      ]
    }
  }
  return RADAR_BANDS[RADAR_BANDS.length - 1].color
}

/** 业务分级传递函数：分段 RGB + 分段 Alpha（256×1 RGBA） */
export function buildRadarTransferLut(options: RadarLutOptions = {}): Uint8Array {
  const min = options.min ?? 0
  const max = options.max ?? 70
  const alphaMax = clamp(options.alphaMax ?? 1, 0, 1)
  const threshold = options.threshold ?? 0
  const span = max - min || 1
  const lut = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i += 1) {
    const dbz = min + (i / 255) * span
    const color = radarColorAt(dbz, min, max)
    let alpha: number
    if (dbz <= threshold) {
      alpha = 0
    } else {
      const target = clamp((dbz - min) / span, 0, 1) * 70
      if (target <= RADAR_BANDS[0].dbz) alpha = RADAR_BANDS[0].alpha
      else if (target >= RADAR_BANDS[RADAR_BANDS.length - 1].dbz) alpha = RADAR_BANDS[RADAR_BANDS.length - 1].alpha
      else {
        alpha = RADAR_BANDS[RADAR_BANDS.length - 1].alpha
        for (let b = 0; b < RADAR_BANDS.length - 1; b += 1) {
          const lo = RADAR_BANDS[b]
          const hi = RADAR_BANDS[b + 1]
          if (target <= hi.dbz) {
            const local = (target - lo.dbz) / (hi.dbz - lo.dbz || 1)
            alpha = lo.alpha + (hi.alpha - lo.alpha) * local
            break
          }
        }
      }
    }
    lut[i * 4] = color[0]
    lut[i * 4 + 1] = color[1]
    lut[i * 4 + 2] = color[2]
    lut[i * 4 + 3] = Math.round(255 * clamp(alpha * alphaMax, 0, 1))
  }
  return lut
}

export type CategoryDef = {
  code: number
  label: string
  color: Stop
}

/** 地层岩性分类色板（源自 geological-voxel 的分层配色） */
export const LITHOLOGY_CATEGORIES: CategoryDef[] = [
  { code: 1, label: '表土层', color: [193, 154, 107] },
  { code: 2, label: '砂岩', color: [233, 196, 106] },
  { code: 3, label: '页岩', color: [112, 128, 144] },
  { code: 4, label: '石灰岩', color: [160, 190, 190] },
  { code: 5, label: '花岗岩', color: [214, 120, 120] },
  { code: 6, label: '基岩', color: [92, 84, 112] }
]

export function categoryColor(code: number): Stop {
  const hit = LITHOLOGY_CATEGORIES.find((c) => c.code === code)
  return hit ? hit.color : [120, 120, 120]
}

/**
 * PM2.5 浓度分级（质量浓度 μg/m³，非 AQI）。
 * 颜色沿用国标空气质量等级色，用于图例、分级统计与等值面配色。
 */
export type Pm25Class = {
  code: number
  label: string
  /** 区间下界（含） */
  lower: number
  /** 区间上界（不含），最后一档为 Infinity */
  upper: number
  color: Stop
}

export const PM25_CLASSES: Pm25Class[] = [
  { code: 0, label: '优', lower: 0, upper: 35, color: [0, 228, 0] },
  { code: 1, label: '良', lower: 35, upper: 75, color: [255, 255, 0] },
  { code: 2, label: '轻度污染', lower: 75, upper: 115, color: [255, 126, 0] },
  { code: 3, label: '中度污染', lower: 115, upper: 150, color: [255, 0, 0] },
  { code: 4, label: '重度污染', lower: 150, upper: 250, color: [143, 63, 151] },
  { code: 5, label: '严重污染', lower: 250, upper: Infinity, color: [126, 0, 35] }
]

export function pm25ClassOf(value: number): Pm25Class {
  for (const cls of PM25_CLASSES) {
    if (value < cls.upper) return cls
  }
  return PM25_CLASSES[PM25_CLASSES.length - 1]
}

export function pm25ClassColor(value: number): Stop {
  return pm25ClassOf(value).color
}

/** PM2.5 → IAQI 分段断点（HJ 633-2012），用于浓度/AQI 对照 */
const PM25_IAQI_BREAKPOINTS: Array<{ c: number; iaqi: number }> = [
  { c: 0, iaqi: 0 },
  { c: 35, iaqi: 50 },
  { c: 75, iaqi: 100 },
  { c: 115, iaqi: 150 },
  { c: 150, iaqi: 200 },
  { c: 250, iaqi: 300 },
  { c: 350, iaqi: 400 },
  { c: 500, iaqi: 500 }
]

/** PM2.5 浓度（μg/m³）→ 个人 IAQI */
export function iaqiOfPm25(value: number): number {
  const v = clamp(value, 0, 500)
  for (let i = 0; i < PM25_IAQI_BREAKPOINTS.length - 1; i += 1) {
    const lo = PM25_IAQI_BREAKPOINTS[i]
    const hi = PM25_IAQI_BREAKPOINTS[i + 1]
    if (v <= hi.c) {
      const local = (v - lo.c) / (hi.c - lo.c || 1)
      return Math.round(lo.iaqi + (hi.iaqi - lo.iaqi) * local)
    }
  }
  return 500
}

export type Pm25LutOptions = {
  min?: number
  max?: number
  /** 低于该浓度完全透明（μg/m³） */
  threshold?: number
  alphaMax?: number
  /** 透明度上升幂次：>1 时高浓度核心更突出 */
  alphaGamma?: number
  /** 低浓度基底不透明度：>0 时污染范围更完整，避免稀疏羽流断裂 */
  alphaFloor?: number
}

/**
 * PM2.5 业务传递函数：连续色带表达浓度，不透明度随浓度非线性上升。
 * 低浓度保持较高透明度，35/75/115/150/250 等关键断点附近逐级增强，
 * 使高浓度污染核心在三维空间中自然凸显。
 */
export function buildPm25TransferLut(options: Pm25LutOptions = {}): Uint8Array {
  const min = options.min ?? 0
  const max = options.max ?? 300
  const alphaMax = clamp(options.alphaMax ?? 1, 0, 1)
  const floor = clamp(options.alphaFloor ?? 0, 0, 1)
  const threshold = clamp(options.threshold ?? 10, min, max)
  const gamma = Math.max(0.2, options.alphaGamma ?? 1.25)
  const stops = PALETTES.pm25.stops
  const span = max - min || 1
  const lut = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i += 1) {
    const value = min + (i / 255) * span
    const t = (value - min) / span
    const [r, g, b] = lerpStops(stops, t)
    let ramp: number
    if (value <= threshold) {
      ramp = 0
    } else {
      const normalized = (value - threshold) / (max - threshold || 1)
      ramp = Math.pow(clamp(normalized, 0, 1), gamma)
    }
    const alpha = floor + (1 - floor) * ramp
    lut[i * 4] = r
    lut[i * 4 + 1] = g
    lut[i * 4 + 2] = b
    lut[i * 4 + 3] = Math.round(255 * alphaMax * alpha)
  }
  return lut
}
