/**
 * 局部米制投影：以中心经纬度为原点的等距圆柱近似，适用于 2km 以内的工程尺度。
 * 距离 / 面积一律在米制平面内计算，避免直接在经纬度上做几何运算。
 */

const METERS_PER_DEG_LAT = 110540
const METERS_PER_DEG_LON_AT_EQ = 111320

export interface Projector {
  lon0: number
  lat0: number
  mPerDegLon: number
  mPerDegLat: number
  toLocal: (lon: number, lat: number) => [number, number]
  toLngLat: (x: number, y: number) => [number, number]
}

export function makeProjector(lon0: number, lat0: number): Projector {
  const mPerDegLon = METERS_PER_DEG_LON_AT_EQ * Math.cos((lat0 * Math.PI) / 180)
  const mPerDegLat = METERS_PER_DEG_LAT
  return {
    lon0,
    lat0,
    mPerDegLon,
    mPerDegLat,
    toLocal(lon: number, lat: number): [number, number] {
      return [(lon - lon0) * mPerDegLon, (lat - lat0) * mPerDegLat]
    },
    toLngLat(x: number, y: number): [number, number] {
      return [lon0 + x / mPerDegLon, lat0 + y / mPerDegLat]
    }
  }
}

export function planarDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

/** 多边形环的有符号面积（正为逆时针）。 */
export function signedArea(ring: [number, number][]): number {
  let area = 0
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

/** 射线法判断点是否在环内。 */
export function pointInRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}
