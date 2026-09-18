const BD_FACTOR = (3.14159265358979324 * 3000.0) / 180.0
const PI = 3.1415926535897932384626
const RADIUS = 6378245.0
const EE = 0.00669342162296594323

function outOfChina(lng: number, lat: number): boolean {
  lat = +lat
  lng = +lng
  return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55)
}

function transformLng(lng: number, lat: number): number {
  lat = +lat
  lng = +lng
  let ret =
    300.0 +
    lng +
    2.0 * lat +
    0.1 * lng * lng +
    0.1 * lng * lat +
    0.1 * Math.sqrt(Math.abs(lng))
  ret +=
    ((20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) *
      2.0) /
    3.0
  ret +=
    ((20.0 * Math.sin(lng * PI) + 40.0 * Math.sin((lng / 3.0) * PI)) * 2.0) /
    3.0
  ret +=
    ((150.0 * Math.sin((lng / 12.0) * PI) +
      300.0 * Math.sin((lng / 30.0) * PI)) *
      2.0) /
    3.0
  return ret
}

function transformLat(lng: number, lat: number): number {
  lat = +lat
  lng = +lng
  let ret =
    -100.0 +
    2.0 * lng +
    3.0 * lat +
    0.2 * lat * lat +
    0.1 * lng * lat +
    0.2 * Math.sqrt(Math.abs(lng))
  ret +=
    ((20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) *
      2.0) /
    3.0
  ret +=
    ((20.0 * Math.sin(lat * PI) + 40.0 * Math.sin((lat / 3.0) * PI)) * 2.0) /
    3.0
  ret +=
    ((160.0 * Math.sin((lat / 12.0) * PI) +
      320 * Math.sin((lat * PI) / 30.0)) *
      2.0) /
    3.0
  return ret
}

function delta(lng: number, lat: number): number[] {
  const dLng = transformLng(lng - 105, lat - 35)
  const dLat = transformLat(lng - 105, lat - 35)
  const radLat = (lat / 180) * PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  const dLngFinal = (dLng * 180) / ((RADIUS / sqrtMagic) * Math.cos(radLat) * PI)
  const dLatFinal = (dLat * 180) / (((RADIUS * (1 - EE)) / (magic * sqrtMagic)) * PI)
  return [dLngFinal, dLatFinal]
}

/**
 * WGS84 -> GCJ02（火星坐标）
 */
export function WGS84ToGCJ02(lng: number, lat: number): number[] {
  lat = +lat
  lng = +lng
  if (outOfChina(lng, lat)) {
    return [lng, lat]
  }
  const d = delta(lng, lat)
  return [lng + d[0], lat + d[1]]
}

/**
 * GCJ02 -> WGS84（火星坐标）
 */
export function GCJ02ToWGS84(lng: number, lat: number): number[] {
  lat = +lat
  lng = +lng
  if (outOfChina(lng, lat)) {
    return [lng, lat]
  }
  const d = delta(lng, lat)
  const mgLng = lng + d[0]
  const mgLat = lat + d[1]
  return [lng * 2 - mgLng, lat * 2 - mgLat]
}

/**
 * GCJ02 -> BD09（百度坐标）
 */
export function GCJ02ToBD09(lng: number, lat: number): number[] {
  lat = +lat
  lng = +lng
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * BD_FACTOR)
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * BD_FACTOR)
  const bdLng = z * Math.cos(theta) + 0.0065
  const bdLat = z * Math.sin(theta) + 0.006
  return [bdLng, bdLat]
}

/**
 * BD09 -> GCJ02（百度坐标）
 */
export function BD09ToGCJ02(lng: number, lat: number): number[] {
  const x = +lng - 0.0065
  const y = +lat - 0.006
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * BD_FACTOR)
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * BD_FACTOR)
  const ggLng = z * Math.cos(theta)
  const ggLat = z * Math.sin(theta)
  return [ggLng, ggLat]
}

/**
 * WGS84 -> BD09（百度坐标）
 */
export function WGS84ToBD09(lng: number, lat: number): number[] {
  const gcj = WGS84ToGCJ02(lng, lat)
  return GCJ02ToBD09(gcj[0], gcj[1])
}

/**
 * BD09 -> WGS84（百度坐标）
 */
export function BD09ToWGS84(lng: number, lat: number): number[] {
  const gcj = BD09ToGCJ02(lng, lat)
  return GCJ02ToWGS84(gcj[0], gcj[1])
}
