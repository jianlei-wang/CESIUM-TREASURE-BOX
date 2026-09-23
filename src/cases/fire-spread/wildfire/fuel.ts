import { buildRiverPath, buildRoadPaths, distanceToGridPathMeters, toGridPath } from './hydro'
import { fbm2 } from './noise'
import type { TerrainGrid } from './terrain'
import type { AreaBounds, LonLat } from './types'

const DEG = Math.PI / 180

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

export function buildFuelGrid(
  terrain: TerrainGrid,
  bounds: AreaBounds,
  seed: number,
  riverPath?: LonLat[]
): FuelGrid {
  const { cols, rows } = terrain
  const kind = new Uint8Array(cols * rows)
  const road = new Uint8Array(cols * rows)
  const water = new Uint8Array(cols * rows)

  const river = riverPath && riverPath.length >= 2 ? riverPath : buildRiverPath(bounds, seed)
  const roadPaths = buildRoadPaths(bounds, seed)
  const riverGrid = toGridPath(terrain, river)
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
      const slope = terrain.slope[index]
      const x = col / cols
      const y = row / rows
      // 无真实区域植被分类数据时，以「大尺度斑块 + 细碎林窗」噪声叠加坡向/海拔/水系立地条件，
      // 程序化生成连续有机的地类分布（含生态过渡带），作为异质可燃物下垫面的代理。
      const patch = fbm2(x * 6.5, y * 6.5, seed + 71)
      const fine = fbm2(x * 24, y * 24, seed + 137)
      const aspect = (terrain.upslope[index] + 180) % 360
      const northness = 0.5 + 0.5 * Math.cos(aspect * DEG)
      const riparian = 1 - Math.min(riverDist / 260, 1)

      if (riverDist < 58) {
        kind[index] = FuelKind.Water
        water[index] = 1
      } else if (roadDist < 24) {
        kind[index] = FuelKind.Road
        road[index] = 1
      } else if (slope > 39 || elevNorm > 0.94 || (slope > 33 && elevNorm > 0.86 && patch < 0.42)) {
        kind[index] = FuelKind.Rock
      } else {
        // 立地生产力：海拔、阴坡（湿润）、连片度、林窗细碎度与近水程度共同决定林型
        const vigor =
          0.5 * elevNorm + 0.26 * northness + 0.34 * (patch - 0.5) + 0.12 * (fine - 0.5) + 0.14 * riparian
        if (riverDist < 130 || patch < 0.33) {
          kind[index] = FuelKind.Grass
        } else if (vigor < 0.42) {
          kind[index] = FuelKind.Grass
        } else if (vigor < 0.6) {
          kind[index] = FuelKind.Shrub
        } else {
          kind[index] = FuelKind.Forest
        }
      }
    }
  }

  return { kind, road, water, riverPath: river, roadPaths }
}
