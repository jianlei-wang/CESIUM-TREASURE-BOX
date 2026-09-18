/**
 * 实时 CFD 仿真场景：程序化城市白模 + 仿真区域。
 */

import { buildDefaultCity, type CityModel, type LonLat } from '../sunshine-lib/city'
import type { ObstacleBox } from './cfd-lbm'

export const CFD_CENTER: LonLat = { lon: 116.4074, lat: 39.9042 }

export type CfdSceneModel = {
  city: CityModel
  center: LonLat
  width: number
  depth: number
  height: number
  buildings: ObstacleBox[]
}

export function createCfdScene(center: LonLat = CFD_CENTER, width = 400, depth = 400, height = 160): CfdSceneModel {
  const blockSize = 72
  const street = 16
  const cols = Math.max(8, Math.min(14, Math.ceil((width + 40) / (blockSize + street))))
  const rows = Math.max(7, Math.min(14, Math.ceil((depth + 40) / (blockSize + street))))
  const city = buildDefaultCity(center, { cols, rows, blockSize, street, seed: 20260911 })
  const halfW = width / 2
  const halfD = depth / 2
  const buildings: ObstacleBox[] = city.buildings
    .filter((b) => b.maxX > -halfW && b.minX < halfW && b.maxY > -halfD && b.minY < halfD)
    .map((b) => ({
      minX: Math.max(b.minX, -halfW),
      maxX: Math.min(b.maxX, halfW),
      minY: Math.max(b.minY, -halfD),
      maxY: Math.min(b.maxY, halfD),
      height: Math.min(b.topHeight, height * 0.92)
    }))
  return { city, center, width, depth, height, buildings }
}

export function createCfdSceneFromRectangle(
  west: number,
  south: number,
  east: number,
  north: number
): CfdSceneModel | undefined {
  const center: LonLat = { lon: (west + east) / 2, lat: (south + north) / 2 }
  const metersPerDegLat = 111320
  const metersPerDegLon = 111320 * Math.cos((center.lat * Math.PI) / 180)
  let width = Math.abs(east - west) * metersPerDegLon
  let depth = Math.abs(north - south) * metersPerDegLat
  if (width < 80 || depth < 80) return undefined
  width = Math.min(1200, width)
  depth = Math.min(1200, depth)
  const height = Math.max(80, Math.min(220, Math.max(width, depth) * 0.4))
  return createCfdScene(center, width, depth, height)
}
