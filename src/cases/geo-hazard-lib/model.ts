/**
 * 滑坡 / 泥石流 3D 演示的共享模型层（与渲染框架无关）。
 *
 * 从参考的单文件演示中抽取出地形高程、发育阶段、时间曲线与配色等纯数学逻辑，
 * 供 Three.js 与 Cesium 两套渲染层复用。所有函数均为确定性纯函数，
 * 不依赖任何渲染库，便于在不同后端之间保持一致的地貌形态。
 */

export type RGB = [number, number, number]

export interface HazardStage {
  /** 阶段名称（含序号前缀） */
  name: string
  /** 阶段起始进度（0~1） */
  start: number
  /** 阶段结束进度（0~1） */
  end: number
}

/* ==================================================================
   全局参数（模型单位）
   ================================================================== */
export const BW = 40
export const BD = 44
export const HALF_W = BW / 2
export const HALF_D = BD / 2
/** 地块底面高程 */
export const BASE_Y = -5

/** 滑坡体后缘 / 剪出口 */
export const ZA = -16
export const ZB = 2
/** 滑面弧线起点（用于形成后缘陡壁） */
export const ZAP = ZA - 2.2
/** 滑体最大厚度 */
export const SLIDE_DEEP = 6.0
/** 滑体半宽（加宽以贴山体两翼） */
export const SLIDE_HALFW = 15.5
/** 滑体初始中心（纵向） */
export const ZC0 = -7
/** 最大滑移距离 */
export const MAX_S = 14

/** 泥石流沟道路径纵向范围 */
export const S0 = -19
export const S1 = 22

/** 一轮演示时长（秒，1× 速度） */
export const DURATION = 26

/* ==================================================================
   数学工具
   ================================================================== */
export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function smooth(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function easeIn(t: number): number {
  return t * t
}

export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function easeIO(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

/* ==================================================================
   地形高程函数
   ================================================================== */

/** 滑坡斜坡基准坡面（含圈椅状凹槽与两侧山脊） */
export function baseH(x: number, z: number): number {
  const t = clamp((z + HALF_D) / BD, 0, 1)
  let y = 26 * Math.pow(1 - t, 1.35)
  // 滑动凹槽（圈椅状洼地）
  const gz = smooth(1.0, 0.4, t)
  y -= 3.6 * gz * Math.exp(-Math.pow(x / 9.5, 2))
  // 两侧山脊
  y += 5.0 * Math.pow(Math.max(0, Math.abs(x) - 11) / 9, 1.6)
  y += 0.45 * Math.sin(x * 0.31) * Math.cos(z * 0.26)
  return y
}

export function valleyCX(t: number): number {
  return 4.2 * Math.sin(t * Math.PI * 1.15) * (1 - t * 0.45)
}

export function valleyW(t: number): number {
  if (t <= 0.28) return lerp(9.0, 5.0, t / 0.28)
  if (t <= 0.62) return lerp(5.0, 4.0, (t - 0.28) / 0.34)
  return lerp(4.0, 13.5, Math.pow((t - 0.62) / 0.38, 0.85))
}

export function valleyD(t: number): number {
  // 形成区：漏斗状洼地，下切渐深
  if (t <= 0.28) return lerp(3.5, 7.0, t / 0.28)
  // 流通区：狭窄深切，比降最大
  if (t <= 0.62) return lerp(7.0, 8.5, (t - 0.28) / 0.34)
  // 堆积区：沟槽消失，坡度骤缓
  return 8.5 * (1 - Math.pow(clamp((t - 0.62) / 0.38, 0, 1), 1.3))
}

/** 泥石流沟谷地形高程 */
export function valleyH(x: number, z: number): number {
  const t = clamp((z + HALF_D) / BD, 0, 1)
  // 沟谷基准坡面：指数取 0.774，保证沟床纵剖面自上游到沟口单调下降
  let y = 0.5 + 25.5 * Math.pow(1 - t, 0.774)
  const cx = valleyCX(t)
  const w = valleyW(t)
  const d = valleyD(t)
  const dx = (x - cx) / w
  y -= d * Math.exp(-dx * dx)
  if (t > 0.66) y += 0.55 * Math.exp(-Math.pow((x - cx) / 11, 2)) * smooth(0.7, 0.86, t)
  y += 5.0 * Math.pow(Math.max(0, Math.abs(x) - 11) / 9, 1.6)
  y += 0.45 * Math.sin(x * 0.31) * Math.cos(z * 0.26)
  return y
}

/* ---------- 滑体几何 ---------- */

/** 滑体厚度沿纵向呈弧形，后缘保留陡壁 */
export function slideThickZ(z: number): number {
  const u = (z - ZAP) / (ZB - ZAP)
  if (u <= 0 || u >= 1) return 0
  return SLIDE_DEEP * Math.pow(Math.sin(Math.PI * u), 0.35)
}

export function slideTaperX(x: number): number {
  const q = 1 - Math.pow(x / SLIDE_HALFW, 2)
  return q <= 0 ? 0 : Math.pow(q, 0.42)
}

export function slideThick(x: number, z: number): number {
  return slideThickZ(z) * slideTaperX(x)
}

export function slideSurf(x: number, z: number): number {
  return baseH(x, z) - slideThick(x, z)
}

/** 滑坡地块地表高程 = 原坡面 - 滑床凹槽厚度（滑走后裸露为滑床） */
export const terrainH = slideSurf

/** 滑体顶面局部起伏（滑坡台阶感），随体坐标 */
export function slideBump(zl: number): number {
  return 0.35 * Math.sin((zl + 16) * 1.35)
}

/** 滑体顶面某点高程（供标注定位） */
export function slideTopAt(x: number, zl: number, s: number): number {
  return slideSurf(x, zl + s) + 0.15 + Math.max(slideThick(x, zl), 0.12) + slideBump(zl)
}

/* ---------- 泥石流沟道路径 ---------- */

export function pathT(s: number): number {
  return clamp((s * (S1 - S0) + S0 + HALF_D) / BD, 0, 1)
}

export function pathZ(s: number): number {
  return lerp(S0, S1, s)
}

export function pathX(s: number): number {
  return valleyCX(pathT(s))
}

export function pathBed(s: number): number {
  return Math.max(valleyH(pathX(s), pathZ(s)), 0.06)
}

export function pathWidth(s: number): number {
  return valleyW(pathT(s))
}

/* ==================================================================
   发育阶段
   ================================================================== */
export const SLIDE_STAGES: HazardStage[] = [
  { name: '① 蠕动变形 · 裂缝张开', start: 0, end: 0.2 },
  { name: '② 滑动破坏 · 整体启动', start: 0.2, end: 0.36 },
  { name: '③ 高速滑移 · 滑体解体', start: 0.36, end: 0.62 },
  { name: '④ 减速堆积 · 渐趋稳定', start: 0.62, end: 1.01 }
]

export const DEBRIS_STAGES: HazardStage[] = [
  { name: '① 暴雨汇流 · 清水冲刷', start: 0, end: 0.12 },
  { name: '② 启动掺混 · 固体加入', start: 0.12, end: 0.24 },
  { name: '③ 阵流下泄 · 龙头推进', start: 0.24, end: 0.62 },
  { name: '④ 出沟堆积 · 扇体扩展', start: 0.62, end: 1.01 }
]

export function stageIndex(stages: HazardStage[], p: number): number {
  for (let i = 0; i < stages.length; i += 1) {
    if (p >= stages[i].start && p < stages[i].end) return i
  }
  return stages.length - 1
}

/* ==================================================================
   时间曲线
   ================================================================== */

/** 滑体位移曲线 */
export function slideS(p: number): number {
  if (p < 0.06) return 0
  if (p < 0.2) return 0.85 * easeIO((p - 0.06) / 0.14)
  if (p < 0.36) return 0.85 + 6.6 * easeIn((p - 0.2) / 0.16)
  if (p < 0.62) return 7.45 + 5.4 * easeOut((p - 0.36) / 0.26)
  return 12.85 + 1.15 * easeOut((p - 0.62) / 0.38)
}

/** 泥石流龙头沿程位置 */
export function debrisFront(p: number): number {
  if (p < 0.1) return 0
  if (p < 0.24) return 0.19 * easeIO((p - 0.1) / 0.14)
  if (p < 0.62) return 0.19 + 0.52 * easeIO((p - 0.24) / 0.38)
  return 0.71 + 0.29 * easeOut((p - 0.62) / 0.38)
}

/** 堆积扇发育 */
export function fanGrow(p: number): number {
  return smooth(0.55, 1.0, p)
}

/* ==================================================================
   配色（sRGB 十六进制 → 线性工作空间，与 Three.js 顶点色一致）
   ================================================================== */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function hexToLinear(hex: number): RGB {
  const r = ((hex >> 16) & 255) / 255
  const g = ((hex >> 8) & 255) / 255
  const b = (hex & 255) / 255
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]
}

function mixInto(out: RGB, a: RGB, b: RGB, t: number): RGB {
  out[0] = a[0] + (b[0] - a[0]) * t
  out[1] = a[1] + (b[1] - a[1]) * t
  out[2] = a[2] + (b[2] - a[2]) * t
  return out
}

const C_VEG: RGB = hexToLinear(0x5f8a3e)
const C_ROCK_HIGH: RGB = hexToLinear(0x8d8577)
const C_STEEP: RGB = hexToLinear(0x8a8272)
const C_SLIDE_BED: RGB = hexToLinear(0x9c7c42)
const C_FOOT: RGB = hexToLinear(0x8d8158)
const C_CHANNEL: RGB = hexToLinear(0x6b5334)
const C_FAN: RGB = hexToLinear(0xb3a07e)
const C_SOURCE: RGB = hexToLinear(0x9a8256)

const scratch: RGB = [0, 0, 0]
const scratch2: RGB = [0, 0, 0]

function slopeOf(h: (x: number, z: number) => number, x: number, z: number): number {
  const e = 0.8
  const dyx = (h(x + e, z) - h(x - e, z)) / (2 * e)
  const dyz = (h(x, z + e) - h(x, z - e)) / (2 * e)
  return Math.hypot(dyx, dyz)
}

/** 滑坡地块配色：植被 → 高处裸岩 → 陡坡 → 滑床 → 坡脚平缓带 */
export function landslideColor(x: number, z: number, y: number, out: RGB = [0, 0, 0]): RGB {
  const sl = slopeOf(terrainH, x, z)
  out[0] = C_VEG[0]
  out[1] = C_VEG[1]
  out[2] = C_VEG[2]
  mixInto(out, out, C_ROCK_HIGH, smooth(17, 25, y))
  mixInto(out, out, C_STEEP, smooth(0.85, 1.55, sl) * 0.85)
  // 滑床（滑动凹槽内裸露面）
  const inZ = smooth(ZA - 1.5, ZA + 1.5, z) * smooth(ZB + 5, ZB - 1, z)
  const inX = smooth(SLIDE_HALFW + 2, SLIDE_HALFW - 4, Math.abs(x))
  if (inZ * inX > 0.01) mixInto(out, out, C_SLIDE_BED, inZ * inX * 0.72)
  mixInto(out, out, C_FOOT, smooth(6, 0.5, y) * 0.5)
  return out
}

/** 泥石流地块配色：植被 → 裸岩 → 陡坡 → 沟道泥沙 → 堆积扇 → 形成区物源 */
export function debrisColor(x: number, z: number, y: number, out: RGB = [0, 0, 0]): RGB {
  const t = clamp((z + HALF_D) / BD, 0, 1)
  const sl = slopeOf(valleyH, x, z)
  out[0] = C_VEG[0]
  out[1] = C_VEG[1]
  out[2] = C_VEG[2]
  mixInto(out, out, C_ROCK_HIGH, smooth(17, 25, y))
  mixInto(out, out, C_STEEP, smooth(0.85, 1.55, sl) * 0.85)

  const cx = valleyCX(t)
  const w = valleyW(t)
  const inChan = smooth(w * 1.5, w * 0.55, Math.abs(x - cx))
  mixInto(out, out, C_CHANNEL, inChan * 0.9)

  if (t > 0.6) {
    const fan = smooth(0.6, 0.8, t) * smooth(12.5, 5.5, Math.abs(x - cx))
    mixInto(out, out, C_FAN, fan * 0.75)
  }
  if (t < 0.3) {
    const src = smooth(0.3, 0.06, t) * smooth(w * 2.6, w * 1.1, Math.abs(x - cx))
    mixInto(out, out, C_SOURCE, src * 0.7)
  }
  mixInto(out, out, C_FOOT, smooth(6, 0.5, y) * 0.45)
  return out
}

/* 供渐变着色使用（如流体清水→泥浆） */
export function colorDrift(fromHex: number, toHex: number, t: number): RGB {
  mixInto(scratch, hexToLinear(fromHex), hexToLinear(toHex), t)
  return scratch
}

export function colorOf(hex: number, out: RGB = [0, 0, 0]): RGB {
  const c = hexToLinear(hex)
  out[0] = c[0]
  out[1] = c[1]
  out[2] = c[2]
  return out
}

export { scratch2 as _scratch }
