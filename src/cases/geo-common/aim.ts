import {
  Cartesian3,
  Matrix3,
  Simon1994PlanetaryPositions,
  Transforms,
  JulianDate,
  type Camera
} from 'cesium'
import { computeMoonDirectionECEF } from '../../lib/cesium-geospatial/cesium-core'

const scratchIcrf = new Matrix3()
const scratchSunInertial = new Cartesian3()

function icrfToFixed(time: JulianDate): Matrix3 | undefined {
  const matrix = Transforms.computeIcrfToCentralBodyFixedMatrix(time, scratchIcrf)
  if (matrix != null) return matrix
  return Transforms.computeIcrfToFixedMatrix(time, scratchIcrf) ?? undefined
}

/** 太阳 ECEF 单位方向（真实天文：Simon1994 + ICRF→Fixed）。 */
export function computeSunDirectionEcef(time: JulianDate, result: Cartesian3): Cartesian3 {
  const icrf = icrfToFixed(time)
  if (icrf == null) {
    Cartesian3.clone(Cartesian3.UNIT_X, result)
    return result
  }
  const sunInertial = Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
    time,
    scratchSunInertial
  )
  if (sunInertial == null) {
    Cartesian3.clone(Cartesian3.UNIT_X, result)
    return result
  }
  Matrix3.multiplyByVector(icrf, sunInertial, result)
  Cartesian3.normalize(result, result)
  return result
}

/** 月球 ECEF 单位方向（含视差修正，observerECEF 为相机位置）。 */
export function computeMoonDirectionEcef(
  time: JulianDate,
  observerEcef: Cartesian3,
  result: Cartesian3
): Cartesian3 {
  const icrf = icrfToFixed(time)
  if (icrf == null) {
    Cartesian3.clone(Cartesian3.UNIT_Y, result)
    return result
  }
  computeMoonDirectionECEF(time, icrf, observerEcef, result)
  return result
}

const scratchWorldUp = new Cartesian3()
const scratchRight = new Cartesian3()
const scratchDir = new Cartesian3()

/**
 * 把相机放到 originEcef，视线对准 lookDir（ECEF 单位方向），通过 setView 应用正交基。
 * pitchOffsetDeg 为额外俯仰（正=抬头），yawOffsetDeg 为额外偏航（正=视线右偏）。
 */
export function aimCameraToward(
  camera: Camera,
  originEcef: Cartesian3,
  lookDir: Cartesian3,
  pitchOffsetDeg = 0,
  yawOffsetDeg = 0
): void {
  let dir = Cartesian3.normalize(lookDir, scratchDir)
  const worldUp = Cartesian3.normalize(originEcef, scratchWorldUp)

  if (pitchOffsetDeg !== 0 || yawOffsetDeg !== 0) {
    const rightBase = Cartesian3.cross(dir, worldUp, scratchRight)
    if (Cartesian3.magnitude(rightBase) < 1e-6) {
      Cartesian3.clone(Cartesian3.UNIT_X, scratchRight)
    }
    Cartesian3.normalize(rightBase, rightBase)
    const yaw = (yawOffsetDeg * Math.PI) / 180
    const pitch = (pitchOffsetDeg * Math.PI) / 180
    const cosY = Math.cos(yaw)
    const sinY = Math.sin(yaw)
    const yawed = new Cartesian3(
      dir.x * cosY + rightBase.x * sinY,
      dir.y * cosY + rightBase.y * sinY,
      dir.z * cosY + rightBase.z * sinY
    )
    const upBase = Cartesian3.normalize(
      Cartesian3.cross(rightBase, yawed, new Cartesian3()),
      new Cartesian3()
    )
    const cosP = Math.cos(pitch)
    const sinP = Math.sin(pitch)
    dir = new Cartesian3(
      yawed.x * cosP + upBase.x * sinP,
      yawed.y * cosP + upBase.y * sinP,
      yawed.z * cosP + upBase.z * sinP
    )
    Cartesian3.normalize(dir, dir)
  }

  const right = Cartesian3.normalize(Cartesian3.cross(dir, worldUp, scratchRight), scratchRight)
  const up = Cartesian3.normalize(Cartesian3.cross(right, dir, scratchWorldUp), scratchWorldUp)
  camera.setView({
    destination: originEcef,
    orientation: {
      direction: dir,
      up
    }
  })
}
