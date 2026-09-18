import {
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  Matrix4,
  Transforms
} from 'cesium'

export function computeCircularFlight(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  fx: number,
  angle: number
): number[] {
  const positionArr: number[] = [x1, y1, 0]
  const radius = Cartesian3.distance(
    Cartesian3.fromDegrees(x1, y1),
    Cartesian3.fromDegrees(x2, y2)
  )
  for (let i = fx; i <= fx + angle; i++) {
    const rad = CesiumMath.toRadians(i)
    const h = radius * Math.sin(rad)
    const r = Math.cos(rad)
    const x = (x2 - x1) * r + x1
    const y = (y2 - y1) * r + y1
    positionArr.push(x, y, h)
  }
  return positionArr
}

export function calcScanPoints(
  lon1: number,
  lat1: number,
  range: number,
  headingDeg: number,
  sweepAngleDeg: number
): number[] {
  const m = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lon1, lat1))
  const rad = CesiumMath.toRadians(headingDeg)
  const rx = range * Math.cos(rad)
  const ry = range * Math.sin(rad)
  const translation = Cartesian3.fromElements(rx, ry, 0)
  const d = Matrix4.multiplyByPoint(m, translation, new Cartesian3())
  const c = Cartographic.fromCartesian(d)
  const lon2 = CesiumMath.toDegrees(c.longitude)
  const lat2 = CesiumMath.toDegrees(c.latitude)
  return computeCircularFlight(lon1, lat1, lon2, lat2, 0, sweepAngleDeg)
}
