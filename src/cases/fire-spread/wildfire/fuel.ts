import { buildRiverPath, buildRoadPaths, distanceToGridPathMeters, toGridPath } from './hydro'
import { fbm2 } from './noise'
import type { TerrainGrid } from './terrain'
import type { AreaBounds, LonLat } from './types'

export const FuelKind = {
  Water: 0,
  Rock: 1,
  Road: 2,
  Grass: 3,
  Shrub: 4,
  Forest: 5
} as const

export type FuelKindValue = (typeof FuelKind)[keyof typeof FuelKind]

export type FuelProfile = {
  name: string
  flammable: boolean
  /** 基准蔓延速率（m/min，无风无坡） */
  baseRos: number
  /** 燃烧持续时间（min） */
  burnMinutes: number
  /** 熄灭含水率 */
  moistureOfExtinction: number
  /** 单位面积可燃物载量（t/ha） */
  load: number
  color: string
}

export const FUEL_PROFILES: Record<number, FuelProfile> = {
  [FuelKind.Water]: { name: '水域', flammable: false, baseRos: 0, burnMinutes: 0, moistureOfExtinction: 0, load: 0, color: '#2b6ca3' },
  [FuelKind.Rock]: { name: '裸岩/裸地', flammable: false, baseRos: 0, burnMinutes: 0, moistureOfExtinction: 0, load: 0, color: '#8d8a80' },
  [FuelKind.Road]: { name: '道路', flammable: false, baseRos: 0, burnMinutes: 0, moistureOfExtinction: 0, load: 0, color: '#c9c4b4' },
  [FuelKind.Grass]: { name: '草地', flammable: true, baseRos: 8.4, burnMinutes: 6, moistureOfExtinction: 0.34, load: 1.3, color: '#b9c46a' },
  [FuelKind.Shrub]: { name: '灌丛', flammable: true, baseRos: 5.2, burnMinutes: 13, moistureOfExtinction: 0.4, load: 2.6, color: '#7f9a4e' },
  [FuelKind.Forest]: { name: '针阔混交林', flammable: true, baseRos: 3.3, burnMinutes: 27, moistureOfExtinction: 0.46, load: 5.1, color: '#315f3a' }
}

export type FuelGrid = {
  kind: Uint8Array
  road: Uint8Array
  water: Uint8Array
  riverPath: LonLat[]
  roadPaths: LonLat[][]
}

export function buildFuelGrid(terrain: TerrainGrid, bounds: AreaBounds, seed: number): FuelGrid {
  const { cols, rows } = terrain
  const kind = new Uint8Array(cols * rows)
  const road = new Uint8Array(cols * rows)
  const water = new Uint8Array(cols * rows)

  const riverPath = buildRiverPath(bounds, seed)
  const roadPaths = buildRoadPaths(bounds, seed)
  const riverGrid = toGridPath(terrain, riverPath)
  const roadGrids = roadPaths.map((path) => toGridPath(terrain, path))

  let minElev = Infinity
  let maxElev = -Infinity
  for (let i = 0; i < terrain.elevation.length; i += 1) {
    const value = terrain.elevation[i]
    if (value < minElev) minElev = value
    if (value > maxElev) maxElev = value
  }
  const span = Math.max(maxElev - minElev, 1)

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col
      const elevNorm = (terrain.elevation[index] - minElev) / span
      const riverDist = distanceToGridPathMeters(terrain, riverGrid, col, row)
      let roadDist = Infinity
      for (const path of roadGrids) {
        roadDist = Math.min(roadDist, distanceToGridPathMeters(terrain, path, col, row))
      }
      const clearing = fbm2((col / cols) * 9, (row / rows) * 9, seed + 71)

      if (riverDist < 58) {
        kind[index] = FuelKind.Water
        water[index] = 1
      } else if (roadDist < 24) {
        kind[index] = FuelKind.Road
        road[index] = 1
      } else if (terrain.slope[index] > 39 || elevNorm > 0.94) {
        kind[index] = FuelKind.Rock
      } else if (riverDist < 130 || clearing > 0.63) {
        kind[index] = FuelKind.Grass
      } else if (elevNorm < 0.42) {
        kind[index] = FuelKind.Grass
      } else if (elevNorm < 0.68) {
        kind[index] = FuelKind.Shrub
      } else {
        kind[index] = FuelKind.Forest
      }
    }
  }

  return { kind, road, water, riverPath, roadPaths }
}
