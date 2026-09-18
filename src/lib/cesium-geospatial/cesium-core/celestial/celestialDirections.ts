// 月方向与月相因子（spec 2026-08-30 r2 §4）——单源实现，AtmosphereStage（月盘）与
// clouds（月光照云）两处消费。单位全链米制；ICRF 旋转由调用方传入
// （computeIcrfToCentralBodyFixedMatrix 竞态修复版，与各 stage 太阳管线同帧共享，
// 省每帧重复旋转矩阵）。
import {
  Cartesian3,
  JulianDate,
  Math as CesiumMath,
  Matrix3,
  Simon1994PlanetaryPositions,
  Transforms
} from 'cesium'

const moonInertialScratch = new Cartesian3()
const sunInertialScratch = new Cartesian3()
const moonFixedScratch = new Cartesian3()

/**
 * 观察者月方向（ECEF 单位向量）。
 * 管线：Simon1994 月位置（ICRF，米）→ icrfToFixed 旋转 → 视差修正（moon − origin，米）→ 归一。
 * 视差必做：月地 38 万 km，月球地平视差 57′ ≈ 月盘视直径两倍——不修正月盘方位偏两个盘径。
 */
export function computeMoonDirectionECEF(
  time: JulianDate,
  icrfToFixed: Matrix3,
  originECEF: Cartesian3,
  result: Cartesian3
): Cartesian3 {
  const moonInertial = Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(
    time,
    moonInertialScratch
  )
  if (moonInertial == null) return result
  const moonFixed = Matrix3.multiplyByVector(icrfToFixed, moonInertial, moonFixedScratch)
  // originECEF 语义 = camera.positionWC + altitudeCorrection（米）——调用方算好传入
  Cartesian3.subtract(moonFixed, originECEF, moonFixed)
  const mag = Cartesian3.magnitude(moonFixed)
  if (Number.isFinite(mag) && mag > 1e-15) {
    Cartesian3.normalize(moonFixed, result)
  }
  return result
}

/**
 * Lambert 球积分月相照明因子：f = (sin ε − ε·cos ε)/π（朔 0 / 弦 0.318 / 望 1）。
 * 运行时消费方手头已有 state 两方向——直接调本函数（dot 即得，零天文计算）。
 */
export function computeMoonIlluminatedFractionFromDirections(
  sunDirection: Cartesian3,
  moonDirection: Cartesian3
): number {
  const d = CesiumMath.clamp(Cartesian3.dot(sunDirection, moonDirection), -1.0, 1.0)
  const elongation = Math.acos(d) // clamp 防 float 越界 NaN（朔望点高危）
  return (Math.sin(elongation) - elongation * Math.cos(elongation)) / Math.PI
}

/**
 * 独立版月相因子（内部自算两方向）——仅供单测/独立消费。
 * 运行时勿每帧独立调用（内部 Simon1994×2+ICRF×1；消费方已有两方向，用 FromDirections 版）。
 */
export function computeMoonIlluminatedFraction(time: JulianDate): number {
  const sunInertial = Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
    time,
    sunInertialScratch
  )
  const moonInertial = Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(
    time,
    moonInertialScratch
  )
  if (sunInertial == null || moonInertial == null) return 0
  const icrfToFixed = Transforms.computeIcrfToCentralBodyFixedMatrix(time, new Matrix3())
  if (icrfToFixed == null) return 0
  const sun = Cartesian3.normalize(
    Matrix3.multiplyByVector(icrfToFixed, sunInertial, sunInertialScratch),
    sunInertialScratch
  )
  const moon = Cartesian3.normalize(
    Matrix3.multiplyByVector(icrfToFixed, moonInertial, moonFixedScratch),
    moonFixedScratch
  )
  return computeMoonIlluminatedFractionFromDirections(sun, moon)
}

// ── 月固系（Moon-fixed，月面纹理用）──
// IAU 2009 行星自转参数（Report of the IAU WGAG 2009，月球行）：
//   北极 α0=266.857°，δ0=66.991°（相对 ICRF 赤道，固定）
//   本初子午线角 W = 38.321° + 13.17639648°/天（自 J2000 起，线性）
// 上游 three-geospatial 用 astronomy-engine RotationAxis(Body.Moon)——本项目 IAU 常数闭式替代（零依赖）。
const MOON_NORTH_ALPHA = CesiumMath.toRadians(266.857)
const MOON_NORTH_DELTA = CesiumMath.toRadians(66.991)
const MOON_W0 = CesiumMath.toRadians(38.321)
const MOON_W_RATE = CesiumMath.toRadians(13.17639648)
// J2000 历元（Cesium JulianDate）——W 的 d 天数自此起算
const J2000 = JulianDate.fromDate(new Date(Date.UTC(2000, 0, 1, 12, 0, 0)))

const moonNorthScratch = new Cartesian3()
const moonIPrimeScratch = new Cartesian3()
const moonXHatScratch = new Cartesian3()
const moonYHatScratch = new Cartesian3()
const moonMfToIcrfScratch = new Matrix3()

/**
 * 月固系 → ECEF 旋转矩阵（月面纹理投影用，IAU 2009 闭式）。
 * 列语义（行主序 Matrix3 下标 [0,3,6]/[1,4,7]/[2,5,8]）：x̂=本初子午线方向（正面中心，
 * 潮汐锁定恒指地球）、ŷ=月赤道东 90°、ẑ=月球北极。
 * icrfToFixed 由调用方传入（与太阳/月方向管线同帧共享）。GLSL 侧取转置即 ECEF→MF。
 */
export function computeMoonFixedToECEFMatrix(
  time: JulianDate,
  icrfToFixed: Matrix3,
  result: Matrix3
): Matrix3 {
  // ẑ：月球北极（ICRF 域，固定值）——本函数输出 ECEF，但 î 的构造用 ICRF 域内的北极，
  // 再整体经 icrfToFixed 转入 ECEF（旋转复合，正交性保持）。
  const north = moonNorthScratch
  north.x = Math.cos(MOON_NORTH_DELTA) * Math.cos(MOON_NORTH_ALPHA)
  north.y = Math.cos(MOON_NORTH_DELTA) * Math.sin(MOON_NORTH_ALPHA)
  north.z = Math.sin(MOON_NORTH_DELTA)
  // î = normalize(e × ẑ)，e = ICRF x 轴（春分点方向）
  const iPrime = moonIPrimeScratch
  iPrime.x = -north.y
  iPrime.y = north.x
  iPrime.z = 0.0
  Cartesian3.normalize(iPrime, iPrime)
  // ĵ = ẑ × î
  const jHat = moonYHatScratch
  Cartesian3.cross(north, iPrime, jHat)
  // W(t)：自 J2000 起的天数（UTC≈TDB 差 <2min，视觉级忽略）
  const days = JulianDate.secondsDifference(time, J2000) / 86400.0
  const w = MOON_W0 + MOON_W_RATE * days
  const cosW = Math.cos(w), sinW = Math.sin(w)
  // x̂ = cos(W)·î + sin(W)·ĵ（本初子午线方向）；ŷ = ẑ × x̂
  const xHat = moonXHatScratch
  xHat.x = cosW * iPrime.x + sinW * jHat.x
  xHat.y = cosW * iPrime.y + sinW * jHat.y
  xHat.z = cosW * iPrime.z + sinW * jHat.z
  Cartesian3.cross(north, xHat, jHat) // jHat 复用作 ŷ = ẑ × x̂
  // MF→ICRF = [x̂ ŷ ẑ]（列）；MF→ECEF = icrfToFixed × MF→ICRF
  const mfToIcrf = Matrix3.fromColumnMajorArray(
    [xHat.x, xHat.y, xHat.z, jHat.x, jHat.y, jHat.z, north.x, north.y, north.z],
    moonMfToIcrfScratch
  )
  return Matrix3.multiply(icrfToFixed, mfToIcrf, result)
}
