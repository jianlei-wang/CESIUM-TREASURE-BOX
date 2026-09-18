/**
 * 城市三维分析共享几何库。
 *
 * 为控高分析、天际线分析、开敞度分析提供统一的局部东北天（ENU）坐标变换、
 * 射线与建筑包围盒求交、方位角天际线求解与球面采样等基础能力。
 * 所有分析均在“观测点局部 ENU 米坐标系”内完成，避免直接在大地坐标上做几何运算。
 */

import { Cartesian3, Cartographic, Matrix4, Transforms, type Ellipsoid, type Viewer } from 'cesium'
import { rayBoxIntersect, type CityModel } from '../sunshine-lib/city'

export const DEG2RAD = Math.PI / 180
export const RAD2DEG = 180 / Math.PI

export type LocalDir = { east: number; north: number; up: number }

export type EnuFrame = {
  origin: Cartesian3
  matrix: Matrix4
}

/** 以观测点为原点构建局部东北天坐标系（列向量：东、北、天） */
export function buildEnuFrame(origin: Cartesian3): EnuFrame {
  return { origin, matrix: Transforms.eastNorthUpToFixedFrame(origin) }
}

/** 局部 ENU 位置（米）→ 世界坐标 */
export function enuToWorld(frame: EnuFrame, east: number, north: number, up: number): Cartesian3 {
  return Matrix4.multiplyByPoint(frame.matrix, new Cartesian3(east, north, up), new Cartesian3())
}

/** 局部 ENU 方向（单位向量）→ 世界方向 */
export function enuDirectionToWorld(frame: EnuFrame, east: number, north: number, up: number): Cartesian3 {
  return Matrix4.multiplyByPointAsVector(frame.matrix, new Cartesian3(east, north, up), new Cartesian3())
}

/**
 * 水平射线与建筑底面矩形（局部 ENU）求交，返回近端距离。
 * 起点位于矩形内部时返回 0；未命中返回 null。
 */
export function rayFootprintEntry(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): number | null {
  let tMin = 0
  let tMax = Number.POSITIVE_INFINITY
  const axes: [number, number, number, number][] = [
    [ox, dx, minX, maxX],
    [oy, dy, minY, maxY]
  ]
  for (const [origin, direction, lo, hi] of axes) {
    if (Math.abs(direction) < 1e-9) {
      if (origin < lo || origin > hi) return null
      continue
    }
    const inv = 1 / direction
    let t1 = (lo - origin) * inv
    let t2 = (hi - origin) * inv
    if (t1 > t2) {
      const tmp = t1
      t1 = t2
      t2 = tmp
    }
    if (t1 > tMin) tMin = t1
    if (t2 < tMax) tMax = t2
    if (tMin > tMax) return null
  }
  if (tMax < 0) return null
  return tMin
}

export type HorizonResult = { elevation: number; distance: number }

/**
 * 求某方位角上建筑引起的天际线（最大遮挡俯仰角）。
 * 对每个建筑取水平射线进入其底面的近端距离，顶部到观测点连线与水平面夹角即为该建筑贡献的俯仰角，
 * 取所有建筑的俯仰角最大值。无遮挡时返回 null（表示可见天空）。
 */
export function buildingHorizon(
  city: CityModel,
  ox: number,
  oy: number,
  oz: number,
  azimuth: number,
  maxRadius: number,
  minDistance = 0.6
): HorizonResult | null {
  const dx = Math.sin(azimuth)
  const dy = Math.cos(azimuth)
  let bestElevation = 0
  let bestDistance = maxRadius
  let found = false
  for (const building of city.buildings) {
    if (building.topHeight <= oz) continue
    const t = rayFootprintEntry(ox, oy, dx, dy, building.minX, building.maxX, building.minY, building.maxY)
    if (t === null || t <= minDistance || t > maxRadius) continue
    const elevation = Math.atan2(building.topHeight - oz, t)
    if (!found || elevation > bestElevation) {
      bestElevation = elevation
      bestDistance = t
      found = true
    }
  }
  return found ? { elevation: bestElevation, distance: bestDistance } : null
}

/** 沿方位角采样地形高程，返回地形引起的最大俯仰角（需已加载真实地形） */
export function terrainHorizon(
  viewer: Viewer,
  frame: EnuFrame,
  azimuth: number,
  maxRadius: number,
  step: number,
  oz: number,
  ellipsoid: Ellipsoid
): HorizonResult | null {
  const dx = Math.sin(azimuth)
  const dy = Math.cos(azimuth)
  let bestElevation = -Infinity
  let bestDistance = maxRadius
  let finite = 0
  const d0 = Math.min(step, maxRadius)
  for (let d = d0; d <= maxRadius; d += step) {
    const world = enuToWorld(frame, dx * d, dy * d, 0)
    const carto = Cartographic.fromCartesian(world, ellipsoid)
    const height = viewer.scene.globe.getHeight(carto)
    if (height === undefined) continue
    finite += 1
    const elevation = Math.atan2(height - oz, d)
    if (elevation > bestElevation) {
      bestElevation = elevation
      bestDistance = d
    }
  }
  if (finite === 0 || bestElevation === -Infinity) return null
  return { elevation: bestElevation, distance: bestDistance }
}

/**
 * 三维射线与全部建筑求交，返回最近命中距离（米），未命中返回 null。
 * 开敞度分析取的是“该方向第一个遮挡点”，因此取最近距离而非最大俯仰角。
 */
export function firstBuildingHit(
  city: CityModel,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxRadius: number,
  minDistance = 0.05
): number | null {
  let best: number | null = null
  for (const building of city.buildings) {
    const t = rayBoxIntersect(
      ox,
      oy,
      oz,
      dx,
      dy,
      dz,
      building.minX,
      building.maxX,
      building.minY,
      building.maxY,
      building.baseHeight,
      building.topHeight
    )
    if (t !== null && t > minDistance && t <= maxRadius && (best === null || t < best)) {
      best = t
    }
  }
  return best
}

/** Fibonacci 上半球均匀采样（余弦分布，各方向代表相等立体角 2π/N） */
export function fibonacciHemisphere(count: number): LocalDir[] {
  const dirs: LocalDir[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i += 1) {
    const z = 1 - (i + 0.5) / count
    const r = Math.sqrt(Math.max(0, 1 - z * z))
    const theta = golden * i
    dirs.push({ east: r * Math.cos(theta), north: r * Math.sin(theta), up: z })
  }
  return dirs
}

/** Fibonacci 全球面均匀采样（各方向代表相等立体角 4π/N） */
export function fibonacciSphere(count: number): LocalDir[] {
  const dirs: LocalDir[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i += 1) {
    const z = 1 - (2 * (i + 0.5)) / count
    const r = Math.sqrt(Math.max(0, 1 - z * z))
    const theta = golden * i
    dirs.push({ east: r * Math.cos(theta), north: r * Math.sin(theta), up: z })
  }
  return dirs
}

export type HemisphereStats = {
  /** 天空可视因子：上半球可见天空方向的立体角占比 */
  skyViewFactor: number
  /** 三维全向开敞度：全球面未被遮挡方向的立体角占比 */
  omnidirectional: number
  /** 上半球采样中被遮挡的方向数 */
  occludedUpper: number
  /** 上半球采样总数 */
  upperCount: number
}

/** 基于球面采样统计 SVF、全向开敞度与遮挡计数 */
export function hemisphereStats(
  city: CityModel,
  ox: number,
  oy: number,
  oz: number,
  upperCount: number,
  maxRadius: number,
  includeBuildings: boolean
): HemisphereStats {
  const upper = fibonacciHemisphere(upperCount)
  let occluded = 0
  for (const dir of upper) {
    if (!includeBuildings) break
    const hit = firstBuildingHit(city, ox, oy, oz, dir.east, dir.north, dir.up, maxRadius)
    if (hit !== null) occluded += 1
  }
  const sphereCount = upperCount * 2
  const sphere = fibonacciSphere(sphereCount)
  let blockedSphere = 0
  if (includeBuildings) {
    for (const dir of sphere) {
      const hit = firstBuildingHit(city, ox, oy, oz, dir.east, dir.north, dir.up, maxRadius)
      if (hit !== null) blockedSphere += 1
    }
  }
  return {
    skyViewFactor: upperCount > 0 ? (upperCount - occluded) / upperCount : 1,
    omnidirectional: sphereCount > 0 ? (sphereCount - blockedSphere) / sphereCount : 1,
    occludedUpper: occluded,
    upperCount
  }
}

/** 射线法判断经纬度点是否位于多边形环内 */
export function pointInPolygon(lon: number, lat: number, ring: { lon: number; lat: number }[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lon
    const yi = ring[i].lat
    const xj = ring[j].lon
    const yj = ring[j].lat
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** 以参考纬度做局部平面近似，计算多边形面积（平方米） */
export function polygonAreaSquareMeters(ring: { lon: number; lat: number }[], refLat: number): number {
  if (ring.length < 3) return 0
  const kx = 111320 * Math.cos(refLat * DEG2RAD)
  const ky = 111320
  let area = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = (ring[i].lon - ring[0].lon) * kx
    const yi = (ring[i].lat - ring[0].lat) * ky
    const xj = (ring[j].lon - ring[0].lon) * kx
    const yj = (ring[j].lat - ring[0].lat) * ky
    area += xi * yj - xj * yi
  }
  return Math.abs(area) / 2
}
