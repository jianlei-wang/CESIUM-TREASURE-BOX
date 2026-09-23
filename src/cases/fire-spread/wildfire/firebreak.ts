/**
 * 隔离带（防火隔离带）：林火扑救中沿火头前方开设的无可燃物带状区域。
 *
 * 本模块负责：
 *  1. 定义隔离带数据结构（路径 + 宽度）；
 *  2. 将隔离带栅格化为「阻火掩膜」，供蔓延求解将其判定为不可燃；
 *  3. 依据当前火头方向与火场规模推荐一条垂直于蔓延方向、横切火头的隔离带。
 */

import { distanceToGridPathMeters, toGridPath } from './hydro'
import type { WildfireSimulation } from './model'
import { gridFraction, type TerrainGrid } from './terrain'
import type { LonLat } from './types'

const METERS_PER_DEG_LAT = 111320
const DEG = Math.PI / 180

export type Firebreak = {
  id: string
  /** 隔离带宽度（米） */
  widthM: number
  /** 隔离带中心线（经纬度） */
  path: LonLat[]
}

/** 以起点、距离与方位角（0=北，90=东）推算终点（小范围平面近似）。 */
export function destination(from: LonLat, meters: number, azimuth: number): LonLat {
  const rad = azimuth * DEG
  const dLat = (meters * Math.cos(rad)) / METERS_PER_DEG_LAT
  const dLon = (meters * Math.sin(rad)) / (METERS_PER_DEG_LAT * Math.cos(from.lat * DEG))
  return { lon: from.lon + dLon, lat: from.lat + dLat }
}

/** 隔离带中心线总长度（米）。 */
export function firebreakLengthMeters(firebreak: Firebreak): number {
  let total = 0
  for (let i = 0; i < firebreak.path.length - 1; i += 1) {
    const a = firebreak.path[i]
    const b = firebreak.path[i + 1]
    const dx = (b.lon - a.lon) * METERS_PER_DEG_LAT * Math.cos(((a.lat + b.lat) / 2) * DEG)
    const dy = (b.lat - a.lat) * METERS_PER_DEG_LAT
    total += Math.hypot(dx, dy)
  }
  return total
}

/**
 * 将隔离带集合栅格化为阻火掩膜（1 = 不可燃）。
 * 仅扫描每条隔离带包围盒内的格点，避免全域 × 全段的重复计算。
 */
export function rasterizeBarriers(terrain: TerrainGrid, firebreaks: Firebreak[]): Uint8Array {
  const { cols, rows, cellMeters } = terrain
  const mask = new Uint8Array(cols * rows)
  for (const firebreak of firebreaks) {
    if (firebreak.path.length < 2 || firebreak.widthM <= 0) continue
    const grid = toGridPath(terrain, firebreak.path)
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const point of grid) {
      if (point.x < minX) minX = point.x
      if (point.x > maxX) maxX = point.x
      if (point.y < minY) minY = point.y
      if (point.y > maxY) maxY = point.y
    }
    const halfCells = firebreak.widthM / 2 / cellMeters
    const colMin = Math.max(0, Math.floor(minX - halfCells - 1))
    const colMax = Math.min(cols - 1, Math.ceil(maxX + halfCells + 1))
    const rowMin = Math.max(0, Math.floor(minY - halfCells - 1))
    const rowMax = Math.min(rows - 1, Math.ceil(maxY + halfCells + 1))
    for (let row = rowMin; row <= rowMax; row += 1) {
      for (let col = colMin; col <= colMax; col += 1) {
        if (mask[row * cols + col]) continue
        if (distanceToGridPathMeters(terrain, grid, col, row) <= firebreak.widthM / 2) {
          mask[row * cols + col] = 1
        }
      }
    }
  }
  return mask
}

/** 隔离带中心线是否覆盖某格点（用于渲染与判定一致性检查）。 */
export function firebreakCoversCell(terrain: TerrainGrid, firebreak: Firebreak, lon: number, lat: number): boolean {
  if (firebreak.path.length < 2) return false
  const grid = toGridPath(terrain, firebreak.path)
  const point = gridFraction(terrain, lon, lat)
  const col = Math.round(point.x)
  const row = Math.round(point.y)
  return distanceToGridPathMeters(terrain, grid, col, row) <= firebreak.widthM / 2
}

export type FirebreakRecommendation = {
  firebreak: Firebreak
  /** 火头方向（方位角） */
  headAzimuth: number
  /** 距起火点推进距离（米） */
  advanceM: number
}

/**
 * 推荐隔离带：在火头前方垂直于主导蔓延方向横切火头，长度取火场当前宽度的 2.2 倍
 * （下限 900 m），使其有效拦截侧翼绕烧。
 */
export function recommendFirebreak(sim: WildfireSimulation, widthM: number, advanceM: number): FirebreakRecommendation | undefined {
  const ignition = sim.ignitionLonLat()
  if (!ignition) return undefined
  const headAzimuth = sim.metrics.headAzimuth
  const headDistanceM = sim.metrics.headDistanceM
  const radius = Math.max(headDistanceM, sim.terrain.cellMeters * 4) + advanceM
  const center = destination(ignition, radius, headAzimuth)
  const span = Math.max(headDistanceM * 2.2, 900)
  const left = destination(center, span / 2, headAzimuth + 90)
  const right = destination(center, span / 2, headAzimuth - 90)
  return {
    headAzimuth,
    advanceM: radius,
    firebreak: {
      id: `rec-${Date.now().toString(36)}`,
      widthM,
      path: [left, center, right]
    }
  }
}
