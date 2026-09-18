/**
 * 堰塞湖演化解析模型（与渲染引擎无关）。
 *
 * 供 Three.js 版（barrier-lake）与 Cesium 版（barrier-lake-cesium）共用：
 * 河床纵剖面 + V 形谷 + 坝体高斯堆积 + 溃口下切 + 滑坡舌状体，
 * 以及「深切河谷 → 触发 → 失稳 → 成坝 → 蓄水 → 漫顶 → 溃决 → 稳湖」八阶段参数状态机。
 */

export interface BarrierLakeStepMeta {
  /** 步骤短名，用于步骤条 */
  name: string
  /** 阶段副标题 */
  sub: string
  /** 阶段解说 */
  txt: string
  /** 关键标签 */
  kv: string[]
}

export interface StepParams {
  level: number
  depth: number
  ds: number
  flood: number
  flow: number
  turbid: number
  wave: number
  dam: number
  breach: number
  slide: number
  rain: number
  quake: number
  scar: number
}

export interface StepDef extends BarrierLakeStepMeta {
  dur: number
  labels: string[]
  p: StepParams
}

export const LX = 260
export const LZ = 140
export const NX = 150
export const NZ = 90
export const DX = LX / NX
export const DZ = LZ / NZ
export const DAM_X = 30
export const NXW = 130
export const NZW = 76
export const DXW = LX / NXW
export const DZW = LZ / NZW

export function bed(x: number): number {
  if (x < -40) return (-40 - x) * 0.18
  if (x < 60) return -(x + 40) * 0.03
  return -3 - (x - 60) * 0.1
}

export function valleyHalf(x: number): number {
  return 11 + 1.8 * Math.sin(x * 0.045) + 0.9 * Math.cos(x * 0.11)
}

export function terrainH(x: number, z: number, dam: number, breach: number, slide = 0): number {
  const b = bed(x)
  const hw = valleyHalf(x)
  const d = Math.abs(z) - hw
  let h = b
  if (d > 0) h += 0.25 * Math.pow(d, 1.15)
  const ridge = Math.min(1, Math.max(0, (Math.abs(z) - hw) / 8))
  h +=
    (Math.sin(x * 0.07) * Math.cos(z * 0.075) * 1.5 +
      Math.sin(x * 0.021 + z * 0.031) * 2.0 +
      Math.cos(x * 0.12 + z * 0.047) * 0.7) *
    ridge
  h += Math.sin(x * 0.19) * 0.25 + Math.cos(z * 0.33) * 0.2
  if (dam > 0.01) {
    const dx = (x - DAM_X) / 11
    const dz = z / 26
    const dw = Math.exp(-dx * dx) * Math.exp(-dz * dz)
    h += dam * dw
    if (dw > 0.015) {
      const lump =
        Math.sin(x * 0.85 + z * 0.6) * 0.5 +
        Math.sin(x * 1.7 - z * 1.3) * 0.32 +
        Math.cos(z * 1.1 + x * 0.4) * 0.28 +
        Math.sin(x * 2.6 + z * 2.2) * 0.16
      h += dam * dw * lump * 0.22
    }
    if (breach > 0.001) {
      const bx = (x - DAM_X) / 7.5
      const bz = z / 6.5
      h -= breach * (dam + 2.5) * Math.exp(-bx * bx) * Math.exp(-bz * bz)
    }
  }
  if (slide > 0.01) {
    const scx = DAM_X - 16
    const scz = -28
    const ddx = x - scx
    const ddz = z - scz
    const along = (ddx * 0.51 + ddz * 0.86) / 22
    const perp = (-ddx * 0.86 + ddz * 0.51) / 12
    const sd = Math.exp(-along * along) * Math.exp(-perp * perp)
    if (sd > 0.015) {
      const dlump =
        Math.sin(x * 0.7 + z * 0.5) * 0.4 +
        Math.sin(x * 1.6 - z * 1.1) * 0.3 +
        Math.cos(z * 1.3 + x * 0.3) * 0.25
      h += slide * 4.8 * sd * (0.7 + 0.3 * dlump)
    }
  }
  return h
}

export function backwaterX(level: number, depth: number): number {
  let x = -40 - (level - depth) / 0.18
  if (x > -40) x = -40 + (depth - level) / 0.03
  return Math.max(-128, Math.min(126, x))
}

/** 某点水面高程（上游按水位，坝下游按河床+水深） */
export function waterY(x: number, level: number, depth: number, ds: number, flood: number): number {
  const b = bed(x)
  const upY = Math.max(b + depth, level)
  const downY = b + depth * ds
  const t = Math.min(1, Math.max(0, (x - (DAM_X + 1)) / 7))
  return upY + (downY - upY) * t + t * flood * 4.2
}

export const STEPS: StepDef[] = [
  {
    name: '深切河谷',
    sub: '深切河谷 · 河流正常下切',
    dur: 1.2,
    txt: '高山峡谷区，河流以下切侵蚀为主，把谷底越切越深、两岸越切越陡，形成谷底狭窄、谷坡陡峻的 V 形谷。这样的地形既给滑坡提供了落差，也让河道极易被一次性堵死——它是堰塞湖诞生的舞台。',
    kv: ['V 形谷', '谷坡 25°～45°', '以下切侵蚀为主'],
    labels: ['valley', 'river'],
    p: { level: -0.5, depth: 1.6, ds: 1, flood: 0, flow: 1.0, turbid: 0.12, wave: 1.0, dam: 0, breach: 0, slide: 0, rain: 0, quake: 0, scar: 0 }
  },
  {
    name: '触发震动',
    sub: '触发 · 地震与强降雨',
    dur: 1.4,
    txt: '一次强震或一场持续强降雨打破了坡体的平衡：地震给坡体施加惯性力、在坡顶拉出裂缝；雨水渗入则增加坡体重量、抬高孔隙水压力，使岩土强度骤降。山体还没有动，但已经「站不住」了。',
    kv: ['地震惯性力', '拉张裂缝', '孔隙水压力升高'],
    labels: ['quake', 'crack', 'source'],
    p: { level: -0.5, depth: 1.6, ds: 1, flood: 0, flow: 1.0, turbid: 0.15, wave: 1.0, dam: 0, breach: 0, slide: 0, rain: 0.7, quake: 1, scar: 1 }
  },
  {
    name: '山体失稳',
    sub: '失稳 · 滑坡体高速下滑',
    dur: 2.2,
    txt: '坡体沿软弱结构面整体下滑，体积可达数百万乃至上亿立方米。高速下滑使岩体彻底解体、碎屑化，一部分越过谷底冲上对岸，其余在谷底堆积。下滑速度越快、物质越集中，越容易形成完整坝体。',
    kv: ['整体下滑', '碎屑化解体', '体积数百万方以上'],
    labels: ['slide', 'source', 'quake'],
    p: { level: -0.5, depth: 1.6, ds: 0.92, flood: 0, flow: 1.0, turbid: 0.3, wave: 1.1, dam: 3.5, breach: 0, slide: 1, rain: 0.75, quake: 0.45, scar: 1 }
  },
  {
    name: '堵塞成坝',
    sub: '成坝 · 河道被完全堵断',
    dur: 2.0,
    txt: '松散岩土体在谷底堆成一道天然坝——堰塞坝。它没有碾压密实、没有防渗心墙，也没有溢洪道，坝体内部孔隙大、级配不良。此刻上游来水仍在不断汇入，河道却在下游断流，水位开始上涨。',
    kv: ['天然松散坝体', '无溢洪设施', '下游断流'],
    labels: ['dam', 'dry', 'lake'],
    p: { level: -0.5, depth: 1.6, ds: 0.0, flood: 0, flow: 0.55, turbid: 0.25, wave: 0.9, dam: 16, breach: 0, slide: 1, rain: 0.35, quake: 0, scar: 1 }
  },
  {
    name: '蓄水成湖',
    sub: '蓄水 · 回水向上游延伸',
    dur: 4.6,
    txt: '来水被坝体拦住，水位快速抬升，湖面沿河谷向上游回溯，形成回水末端，上游谷地的低洼处与道路被逐渐淹没。蓄水快慢取决于入库流量与库容：小库容、大流量的堰塞湖，往往几天之内就涨到坝顶。',
    kv: ['水位持续抬升', '回水末端上溯', '上游低地受淹'],
    labels: ['lake', 'end', 'dam', 'dry'],
    p: { level: 9.5, depth: 1.6, ds: 0.0, flood: 0, flow: 0.35, turbid: 0.2, wave: 0.7, dam: 16, breach: 0, slide: 1, rain: 0.3, quake: 0, scar: 1 }
  },
  {
    name: '漫顶溢流',
    sub: '溢流 · 湖水越过坝顶',
    dur: 3.0,
    txt: '湖水终于漫过坝顶最低处。松散坝体经不起水流冲刷，溢流很快在坝坡上切出冲沟，冲沟溯源侵蚀、迅速加深加宽，坝顶高程被不断「锯」低，下泄流量随之滚雪球式增大——溃决进入倒计时。',
    kv: ['坝顶过流', '溯源侵蚀成槽', '下泄流量激增'],
    labels: ['spill', 'lake', 'end'],
    p: { level: 15.4, depth: 1.6, ds: 0.45, flood: 0.45, flow: 1.8, turbid: 0.6, wave: 1.4, dam: 16, breach: 0.2, slide: 1, rain: 0.35, quake: 0, scar: 1 }
  },
  {
    name: '溃坝洪峰',
    sub: '溃决 · 库水在数小时内泄空',
    dur: 2.8,
    txt: '冲沟贯通坝体，溃口在短时间内急剧扩宽加深，库水倾泻而下。溃决洪峰流量常远超河道常年洪水，且挟带大量泥沙石块，破坏力极强；洪峰下泄还可能冲刷下游其他堰塞体，造成连锁溃决。这是堰塞湖最危险的一幕。',
    kv: ['溃口迅速扩大', '洪峰远超常年洪水', '可能连锁溃决'],
    labels: ['breach', 'flood'],
    p: { level: 11.0, depth: 1.6, ds: 1, flood: 1, flow: 3.0, turbid: 0.9, wave: 1.8, dam: 7, breach: 1.0, slide: 1, rain: 0.2, quake: 0, scar: 1 }
  },
  {
    name: '稳湖留存',
    sub: '另一条路 · 稳定湖盆长期保存',
    dur: 3.6,
    txt: '并不是所有堰塞湖都会溃决。若坝体规模大、物质抗冲刷（如熔岩、巨块石），或形成了稳定的溢流通道，湖盆就能长期保存下来，甚至成为著名景观。黑龙江的镜泊湖、五大连池，都是火山熔岩堵江后留存至今的堰塞湖。',
    kv: ['稳定溢流通道', '坝体抗冲刷', '镜泊湖 · 五大连池'],
    labels: ['stable', 'lake', 'dam', 'end'],
    p: { level: 12.8, depth: 1.6, ds: 0.6, flood: 0.12, flow: 0.7, turbid: 0.18, wave: 0.8, dam: 16, breach: 0.05, slide: 1, rain: 0.2, quake: 0, scar: 1 }
  }
]

export const PKEYS = ['level', 'depth', 'ds', 'flood', 'flow', 'turbid', 'wave', 'dam', 'breach', 'slide', 'rain', 'quake', 'scar'] as const
export type PKey = (typeof PKEYS)[number]

export const STEP_META: BarrierLakeStepMeta[] = STEPS.map((s) => ({
  name: s.name,
  sub: s.sub,
  txt: s.txt,
  kv: s.kv
}))

export const STEP_COUNT = STEPS.length

const C_BED = [0.34, 0.32, 0.25]
const C_LOW = [0.4, 0.44, 0.24]
const C_MID = [0.28, 0.37, 0.23]
const C_HIGH = [0.44, 0.43, 0.39]
const C_TOP = [0.74, 0.76, 0.78]
const C_DAM = [0.6, 0.47, 0.28]
const C_BREACH = [0.52, 0.29, 0.18]
const C_SLIDE = [0.72, 0.6, 0.43]
const C_ROCK = [0.6, 0.59, 0.56]

export function terrainColor(
  x: number,
  z: number,
  h: number,
  dam: number,
  breach: number,
  slide: number,
  out: number[]
): void {
  const b = bed(x)
  const rel = h - b
  let c0: number[]
  let c1: number[]
  let t: number
  if (rel < 0.8) {
    c0 = C_BED
    c1 = C_LOW
    t = (rel + 1) / 1.8
  } else if (rel < 4) {
    c0 = C_LOW
    c1 = C_MID
    t = (rel - 0.8) / 3.2
  } else if (rel < 13) {
    c0 = C_MID
    c1 = C_HIGH
    t = (rel - 4) / 9
  } else if (rel < 24) {
    c0 = C_HIGH
    c1 = C_ROCK
    t = (rel - 13) / 11
  } else {
    c0 = C_ROCK
    c1 = C_TOP
    t = (rel - 24) / 10
  }
  t = Math.max(0, Math.min(1, t))
  let r = c0[0] + (c1[0] - c0[0]) * t
  let g = c0[1] + (c1[1] - c0[1]) * t
  let bl = c0[2] + (c1[2] - c0[2]) * t
  if (dam > 0.01) {
    const dx = (x - DAM_X) / 11
    const dz = z / 26
    let w = Math.exp(-dx * dx) * Math.exp(-dz * dz)
    w = Math.pow(w, 0.7) * Math.min(1, dam / 4)
    const mott = 0.8 + 0.2 * Math.sin(x * 1.1 + z * 0.7) * Math.sin(x * 0.5 - z * 1.9)
    w *= mott
    r += (C_DAM[0] - r) * w
    g += (C_DAM[1] - g) * w
    bl += (C_DAM[2] - bl) * w
    if (breach > 0.001) {
      const bx = (x - DAM_X) / 7.5
      const bz = z / 6.5
      const wb = Math.exp(-bx * bx) * Math.exp(-bz * bz) * Math.min(1, breach * 2.2)
      r += (C_BREACH[0] - r) * wb
      g += (C_BREACH[1] - g) * wb
      bl += (C_BREACH[2] - bl) * wb
    }
  }
  if (slide > 0.01) {
    const ddx2 = x - (DAM_X - 16)
    const ddz2 = z - -28
    const along2 = (ddx2 * 0.51 + ddz2 * 0.86) / 22
    const perp2 = (-ddx2 * 0.86 + ddz2 * 0.51) / 12
    let sd2 = Math.exp(-along2 * along2) * Math.exp(-perp2 * perp2) * Math.min(1, slide)
    sd2 = Math.max(0, Math.min(1, sd2)) * 0.85
    r += (C_SLIDE[0] - r) * sd2
    g += (C_SLIDE[1] - g) * sd2
    bl += (C_SLIDE[2] - bl) * sd2
  }
  out[0] = r
  out[1] = g
  out[2] = bl
}
