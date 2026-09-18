import {
  Cartesian3,
  Cartographic,
  Ellipsoid,
  EllipsoidGeodesic,
  Math as CesiumMath,
  Matrix4,
  Transforms,
  type Scene
} from 'cesium'

export type TriangleInfo = {
  sides: [number, number, number]
  angles: [number, number, number]
  perimeter: number
  area: number
}

function heightAt(scene: Scene, carto: Cartographic): number {
  if (!scene || scene.isDestroyed()) return 0
  const h = scene.globe.getHeight(carto)
  return h ?? 0
}

function midPointOnSurface(scene: Scene, a: Cartesian3, b: Cartesian3): Cartesian3 {
  const ga = Cartographic.fromCartesian(a, scene.globe.ellipsoid)
  const gb = Cartographic.fromCartesian(b, scene.globe.ellipsoid)
  const geodesic = new EllipsoidGeodesic(ga, gb)
  const mid = geodesic.interpolateUsingFraction(0.5)
  const h = heightAt(scene, mid)
  return Cartesian3.fromRadians(mid.longitude, mid.latitude, h)
}

export function spatialDistance(a: Cartesian3, b: Cartesian3): number {
  return Cartesian3.distance(a, b)
}

export function projectedDistance(a: Cartesian3, b: Cartesian3): number {
  const ga = Cartographic.fromCartesian(a, Ellipsoid.WGS84)
  const gb = Cartographic.fromCartesian(b, Ellipsoid.WGS84)
  const geodesic = new EllipsoidGeodesic(
    Cartographic.fromRadians(ga.longitude, ga.latitude, 0),
    Cartographic.fromRadians(gb.longitude, gb.latitude, 0)
  )
  return geodesic.surfaceDistance
}

export function surfaceDistance(scene: Scene, a: Cartesian3, b: Cartesian3, samples = 40): number {
  const ga = Cartographic.fromCartesian(a, scene.globe.ellipsoid)
  const gb = Cartographic.fromCartesian(b, scene.globe.ellipsoid)
  const geodesic = new EllipsoidGeodesic(ga, gb)

  let total = 0
  let prev = a
  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples
    const carto = geodesic.interpolateUsingFraction(t)
    const pos = Cartesian3.fromRadians(carto.longitude, carto.latitude, heightAt(scene, carto))
    total += Cartesian3.distance(prev, pos)
    prev = pos
  }
  return total
}

function triangleArea3D(a: Cartesian3, b: Cartesian3, c: Cartesian3): number {
  const ab = Cartesian3.distance(a, b)
  const bc = Cartesian3.distance(b, c)
  const ca = Cartesian3.distance(c, a)
  const s = (ab + bc + ca) / 2
  return Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ca)))
}

export function spatialArea(positions: Cartesian3[]): number {
  if (positions.length < 3) return 0
  let area = 0
  const origin = positions[0]
  for (let i = 1; i < positions.length - 1; i += 1) {
    area += triangleArea3D(origin, positions[i], positions[i + 1])
  }
  return area
}

function surfaceTriangleArea(scene: Scene, a: Cartesian3, b: Cartesian3, c: Cartesian3, depth: number): number {
  if (depth <= 0) return triangleArea3D(a, b, c)

  const ab = midPointOnSurface(scene, a, b)
  const bc = midPointOnSurface(scene, b, c)
  const ca = midPointOnSurface(scene, c, a)

  return surfaceTriangleArea(scene, a, ab, ca, depth - 1)
    + surfaceTriangleArea(scene, ab, b, bc, depth - 1)
    + surfaceTriangleArea(scene, ca, bc, c, depth - 1)
    + surfaceTriangleArea(scene, ab, bc, ca, depth - 1)
}

export function surfaceArea(scene: Scene, positions: Cartesian3[], depth = 4): number {
  if (positions.length < 3) return 0
  let area = 0
  const origin = positions[0]
  for (let i = 1; i < positions.length - 1; i += 1) {
    area += surfaceTriangleArea(scene, origin, positions[i], positions[i + 1], depth)
  }
  return area
}

export function projectedArea(positions: Cartesian3[]): number {
  if (positions.length < 3) return 0
  let origin = Cartesian3.ZERO
  for (const p of positions) {
    origin = Cartesian3.add(origin, p, new Cartesian3())
  }
  origin = Cartesian3.multiplyByScalar(origin, 1 / positions.length, new Cartesian3())

  const frame = Transforms.eastNorthUpToFixedFrame(origin)
  const inverse = Matrix4.inverse(frame, new Matrix4())

  let area = 0
  for (let i = 0; i < positions.length; i += 1) {
    const j = (i + 1) % positions.length
    const a = Matrix4.multiplyByPoint(inverse, positions[i], new Cartesian3())
    const b = Matrix4.multiplyByPoint(inverse, positions[j], new Cartesian3())
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area) / 2
}

export function bearing(a: Cartesian3, b: Cartesian3): number {
  const ga = Cartographic.fromCartesian(a, Ellipsoid.WGS84)
  const gb = Cartographic.fromCartesian(b, Ellipsoid.WGS84)
  const geodesic = new EllipsoidGeodesic(
    Cartographic.fromRadians(ga.longitude, ga.latitude, 0),
    Cartographic.fromRadians(gb.longitude, gb.latitude, 0)
  )
  const heading = geodesic.startHeading
  let deg = CesiumMath.toDegrees(heading)
  if (deg < 0) deg += 360
  return deg
}

export function heightDiff(a: Cartesian3, b: Cartesian3): { heightA: number; heightB: number; diff: number } {
  const ga = Cartographic.fromCartesian(a, Ellipsoid.WGS84)
  const gb = Cartographic.fromCartesian(b, Ellipsoid.WGS84)
  const heightA = ga.height
  const heightB = gb.height
  return { heightA, heightB, diff: heightB - heightA }
}

function computeAngle(opposite: number, s1: number, s2: number): number {
  const v = (s1 * s1 + s2 * s2 - opposite * opposite) / (2 * s1 * s2)
  return CesiumMath.toDegrees(Math.acos(Math.max(-1, Math.min(1, v))))
}

export function triangleInfo(a: Cartesian3, b: Cartesian3, c: Cartesian3): TriangleInfo {
  const ab = spatialDistance(a, b)
  const bc = spatialDistance(b, c)
  const ca = spatialDistance(c, a)
  const angleA = computeAngle(bc, ab, ca)
  const angleB = computeAngle(ca, ab, bc)
  const angleC = computeAngle(ab, bc, ca)
  return {
    sides: [ab, bc, ca],
    angles: [angleA, angleB, angleC],
    perimeter: ab + bc + ca,
    area: triangleArea3D(a, b, c)
  }
}

export function formatLength(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(3)} km`
  return `${meters.toFixed(1)} m`
}

export function formatArea(squareMeters: number): string {
  if (squareMeters >= 1_000_000) return `${(squareMeters / 1_000_000).toFixed(3)} km²`
  if (squareMeters >= 1) return `${squareMeters.toFixed(1)} m²`
  return `${squareMeters.toFixed(2)} m²`
}

export function formatDegreesText(value: number): string {
  return `${value.toFixed(6)}°`
}

export function polygonCentroid(positions: Cartesian3[]): Cartesian3 {
  if (positions.length === 0) return Cartesian3.clone(Cartesian3.ZERO)
  const cartos = positions.map((p) => Cartographic.fromCartesian(p, Ellipsoid.WGS84))
  const n = cartos.length
  let a2 = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n
    const cross = cartos[i].longitude * cartos[j].latitude - cartos[j].longitude * cartos[i].latitude
    a2 += cross
    cx += (cartos[i].longitude + cartos[j].longitude) * cross
    cy += (cartos[i].latitude + cartos[j].latitude) * cross
  }
  const avgHeight = cartos.reduce((sum, c) => sum + c.height, 0) / n
  if (Math.abs(a2) < 1e-12) {
    const avgLon = cartos.reduce((sum, c) => sum + c.longitude, 0) / n
    const avgLat = cartos.reduce((sum, c) => sum + c.latitude, 0) / n
    return Cartesian3.fromRadians(avgLon, avgLat, avgHeight)
  }
  cx /= 3 * a2
  cy /= 3 * a2
  return Cartesian3.fromRadians(cx, cy, avgHeight)
}

export type RightTriangleInfo = {
  horizontal: number
  vertical: number
  slope: number
  angle: number
  apex: Cartesian3
}

export function rightTriangleInfo(a: Cartesian3, b: Cartesian3): RightTriangleInfo {
  const ga = Cartographic.fromCartesian(a, Ellipsoid.WGS84)
  const gb = Cartographic.fromCartesian(b, Ellipsoid.WGS84)
  const vertical = Math.abs(gb.height - ga.height)
  const horizontal = projectedDistance(a, b)
  const slope = spatialDistance(a, b)
  const angle = CesiumMath.toDegrees(Math.atan2(vertical, horizontal))
  const aLon = CesiumMath.toDegrees(ga.longitude)
  const aLat = CesiumMath.toDegrees(ga.latitude)
  const bLon = CesiumMath.toDegrees(gb.longitude)
  const bLat = CesiumMath.toDegrees(gb.latitude)
  let apex: Cartesian3
  if (gb.height > ga.height) {
    apex = Cartesian3.fromDegrees(aLon, aLat, gb.height)
  } else {
    apex = Cartesian3.fromDegrees(bLon, bLat, ga.height)
  }
  return { horizontal, vertical, slope, angle, apex }
}

export function arrowHeadPositions(
  tip: Cartesian3,
  direction: Cartesian3,
  length: number,
  halfWidth: number
): [Cartesian3, Cartesian3, Cartesian3] {
  const dir = Cartesian3.normalize(direction, new Cartesian3())
  const ref = Math.abs(dir.z) > 0.9 ? Cartesian3.UNIT_X : Cartesian3.UNIT_Z
  const perp = Cartesian3.normalize(Cartesian3.cross(dir, ref, new Cartesian3()), new Cartesian3())
  const base = Cartesian3.add(tip, Cartesian3.multiplyByScalar(dir, -length, new Cartesian3()), new Cartesian3())
  const left = Cartesian3.add(base, Cartesian3.multiplyByScalar(perp, halfWidth, new Cartesian3()), new Cartesian3())
  const right = Cartesian3.add(base, Cartesian3.multiplyByScalar(perp, -halfWidth, new Cartesian3()), new Cartesian3())
  return [tip, left, right]
}
