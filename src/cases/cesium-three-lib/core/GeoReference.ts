export type Vec3 = [number, number, number]

export interface Geodetic {
  lon: number
  lat: number
  height: number
}

export interface EnuOrigin extends Geodetic {
  ecef: Vec3
  east: Vec3
  north: Vec3
  up: Vec3
}

const WGS84_A = 6378137
const WGS84_F = 1 / 298.257223563
const WGS84_E2 = WGS84_F * (2 - WGS84_F)
const DEG = Math.PI / 180

export function geodeticToEcef(lon: number, lat: number, height = 0): Vec3 {
  const lambda = lon * DEG
  const phi = lat * DEG
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi)
  return [
    (n + height) * cosPhi * Math.cos(lambda),
    (n + height) * cosPhi * Math.sin(lambda),
    (n * (1 - WGS84_E2) + height) * sinPhi
  ]
}

export function createEnuOrigin(lon: number, lat: number, height = 0): EnuOrigin {
  const lambda = lon * DEG
  const phi = lat * DEG
  const sinLambda = Math.sin(lambda)
  const cosLambda = Math.cos(lambda)
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  return {
    lon,
    lat,
    height,
    ecef: geodeticToEcef(lon, lat, height),
    east: [-sinLambda, cosLambda, 0],
    north: [-sinPhi * cosLambda, -sinPhi * sinLambda, cosPhi],
    up: [cosPhi * cosLambda, cosPhi * sinLambda, sinPhi]
  }
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function ecefToEnu(origin: EnuOrigin, ecef: Vec3): Vec3 {
  const dx = ecef[0] - origin.ecef[0]
  const dy = ecef[1] - origin.ecef[1]
  const dz = ecef[2] - origin.ecef[2]
  const delta: Vec3 = [dx, dy, dz]
  return [dot(origin.east, delta), dot(origin.north, delta), dot(origin.up, delta)]
}

export function enuToEcef(origin: EnuOrigin, enu: Vec3): Vec3 {
  return [
    origin.ecef[0] + origin.east[0] * enu[0] + origin.north[0] * enu[1] + origin.up[0] * enu[2],
    origin.ecef[1] + origin.east[1] * enu[0] + origin.north[1] * enu[1] + origin.up[1] * enu[2],
    origin.ecef[2] + origin.east[2] * enu[0] + origin.north[2] * enu[1] + origin.up[2] * enu[2]
  ]
}

export function geodeticToEnu(origin: EnuOrigin, lon: number, lat: number, height = 0): Vec3 {
  return ecefToEnu(origin, geodeticToEcef(lon, lat, height))
}

export function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

export function shouldReanchor(distanceMeters: number, threshold = 50000): boolean {
  return Math.abs(distanceMeters) > threshold
}
