// packages/cesium-clouds/src/weatherTime.ts
//
// 云图时间轴纯函数（spec §4.1/§5.4）——全部 CPU 侧 float64 计算。
// 铁律：JulianDate 绝对秒 ~8.4e8，float32 ULP=64s——tNorm/windOffset 必须
// 在 CPU mod 完再传 uniform，GPU 侧禁止对原始秒 mod（spec §4.1 精度陷阱）。
import { Cartesian2, Cartesian3 } from 'cesium'

/** 烘焙种子（硬编码常量——两个 Viewer 各自烘焙结果逐位相同的前提，spec §4.5）。 */
export const WEATHER_BAKE_SEED = 1337
/** 演化环周期（秒）——64 切片 × 5min = 5.3h，?cloudsEvolutionHours= 可覆盖。 */
export const WEATHER_EVOLUTION_PERIOD_S = 5.3 * 3600
/** 平流风速 m/s（≈30km/h，信风/中纬地面风量级，spec §5.3）。 */
export const WEATHER_WIND_SPEED_MPS = 8
/** cube-sphere 每 face 赤道向弧长（km）：赤道周长 40075.017/4。 */
export const CUBE_FACE_WIDTH_KM = 40075.017 / 4

/** 正安全 mod（负时间回退时结果仍 ∈[0,mod)）。 */
function posMod(a: number, m: number): number {
  return ((a % m) + m) % m
}

/**
 * 演化归一化相位 tNorm ∈ [0,1)——3D 云图 z 采样坐标。
 * 纯函数：clock 同刻 ⇒ 同 tNorm（同机多 Viewer 确定性的时间轴半边）。
 */
export function computeEvolutionTNorm(tSec: number, periodS: number): number {
  return posMod(tSec, periodS) / periodS
}

/**
 * 平流偏移（tile 单位，mod 1）——加在 `uv × localWeatherRepeat` 之后（spec §5.3，
 * 与 repeat 语义解耦；tileKm = CUBE_FACE_WIDTH_KM / repeat）。
 * 风向固定对角（x=y），v1 不暴露风向（spec §9）。
 */
export function computeWindOffsetTiles(
  tSec: number,
  speedMps: number,
  tileKm: number
): Cartesian2 {
  const offsetTiles = (speedMps * tSec) / (tileKm * 1000)
  const o = posMod(offsetTiles, 1)
  return new Cartesian2(o, o)
}

/**
 * 云内形状/细节噪声的风向（ECEF 对角，归一化后合成模长 = speedMps）。
 * v1 固定不暴露（spec §9 风向例外同款）。与 coverage 平流（computeWindOffsetTiles，
 * face uv 域对角）同速不同域——方向系差异由真实大气风切变部分掩盖；v1 目标是
 * 「云团带着内部结构走」的量级正确（2026-09-03 P1，对照桌面 README 方案补强），
 * 方向精确对齐留观感反馈后再做。
 */
const SHAPE_WIND_DIR = { x: 1.0, y: 0.7, z: 0.45 }
const SHAPE_WIND_DIR_LEN = Math.sqrt(
  SHAPE_WIND_DIR.x ** 2 + SHAPE_WIND_DIR.y ** 2 + SHAPE_WIND_DIR.z ** 2
)

/**
 * shape/shapeDetail 纹理域风平流偏移（P1）——修「云内三维纹理完全静态」缝隙
 * （shapeOffset/shapeDetailOffset 恒 (0,0,0)：云团 coverage 轮廓动而内部花纹焊死，
 * 延时视角显形）。米距 = speedMps × tSec（方向分量归一化）；纹理域 = 米距 × repeat
 * （per 分量），posMod 1（纹理 REPEAT 域，CPU float64 mod 铁律同 spec §4.1——
 * tSec~8.4e8 时纹理域值 ~1e7，float32 直接传会丢掉全部有效位）。
 * 时钟冻结 ⇒ tSec 不变 ⇒ 偏移冻结（与 atlasT/windOffset 同源语义）。
 * shader 侧直接加在 `... × repeat + offset` 之后（clouds.glsl shape/detail 两处）。
 */
export function computeShapeWindOffsets(
  tSec: number,
  speedMps: number,
  shapeRepeat: Cartesian3,
  shapeDetailRepeat: Cartesian3
): { shape: Cartesian3; detail: Cartesian3 } {
  const meters = (speedMps * tSec) / SHAPE_WIND_DIR_LEN
  const shape = new Cartesian3(
    posMod(meters * SHAPE_WIND_DIR.x * shapeRepeat.x, 1),
    posMod(meters * SHAPE_WIND_DIR.y * shapeRepeat.y, 1),
    posMod(meters * SHAPE_WIND_DIR.z * shapeRepeat.z, 1)
  )
  const detail = new Cartesian3(
    posMod(meters * SHAPE_WIND_DIR.x * shapeDetailRepeat.x, 1),
    posMod(meters * SHAPE_WIND_DIR.y * shapeDetailRepeat.y, 1),
    posMod(meters * SHAPE_WIND_DIR.z * shapeDetailRepeat.z, 1)
  )
  return { shape, detail }
}

const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

/** 年内天序（1-based，平年；ITCZ 相位容差 ≫ 闰日 1 天，不修闰年）。 */
export function computeDayOfYear(month: number, day: number): number {
  return DAYS_BEFORE_MONTH[month - 1] + day
}

/**
 * ITCZ 中心纬度（度，spec §5.4）：年均 ~5°N（海陆不对称北偏），不对称漂移
 * 北移 ~12°/南移 ~3°；最北 8 月初（doy=215 精确峰 12.5°N）、最南 2 月初（doy=33 谷 ≈−2.5°S）。
 * 相位锚点由 weatherTime.test.ts 断言（spec §8）。
 */
export function computeItczCenterLatDeg(dayOfYear: number): number {
  return 5 + 7.5 * Math.cos((2 * Math.PI * (dayOfYear - 215)) / 365.25)
}
