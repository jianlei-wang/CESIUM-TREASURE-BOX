import { fbm2, valueNoise2 } from './noise'
import { gridFraction, type TerrainGrid } from './terrain'
import type { AreaBounds, LonLat } from './types'

/** 生成一条自北向南蜿蜒的山地河道中心线。 */
export function buildRiverPath(bounds: AreaBounds, seed: number, samples = 48): LonLat[] {
  const spanLon = bounds.east - bounds.west
  const points: LonLat[] = []
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples
    const lonRatio =
      0.5 +
      0.2 * Math.sin(t * Math.PI * 2.4 + 0.7) +
      0.08 * (valueNoise2(t * 3.1, 0.5, seed) * 2 - 1)
    points.push({
      lon: bounds.west + lonRatio * spanLon,
      lat: bounds.north - t * (bounds.north - bounds.south)
    })
  }
  return points
}

/** 生成两条穿越研究区的山路（东西向 + 南北向），用于道路匹配分析。 */
export function buildRoadPaths(bounds: AreaBounds, seed: number, samples = 40): LonLat[][] {
  const spanLon = bounds.east - bounds.west
  const spanLat = bounds.north - bounds.south

  const eastWest: LonLat[] = []
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples
    const latRatio = 0.58 + 0.12 * Math.sin(t * Math.PI * 1.6 + 1.2) + 0.05 * (fbm2(t * 4, 9, seed) * 2 - 1)
    eastWest.push({ lon: bounds.west + t * spanLon, lat: bounds.south + latRatio * spanLat })
  }

  const northSouth: LonLat[] = []
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples
    const lonRatio = 0.34 + 0.1 * Math.sin(t * Math.PI * 1.9 + 0.4) + 0.04 * (fbm2(t * 4, 21, seed) * 2 - 1)
    northSouth.push({ lon: bounds.west + lonRatio * spanLon, lat: bounds.south + t * spanLat })
  }

  return [eastWest, northSouth]
}

export type GridPath = Array<{ x: number; y: number }>

export function toGridPath(terrain: TerrainGrid, path: LonLat[]): GridPath {
  return path.map((point) => gridFraction(terrain, point.lon, point.lat))
}

/** 单元格中心到路径的最短距离（米）。 */
export function distanceToGridPathMeters(terrain: TerrainGrid, path: GridPath, col: number, row: number): number {
  let best = Infinity
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i]
    const b = path[i + 1]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const apx = col - a.x
    const apy = row - a.y
    const len2 = abx * abx + aby * aby || 1
    const t = Math.min(1, Math.max(0, (apx * abx + apy * aby) / len2))
    const dx = apx - abx * t
    const dy = apy - aby * t
    const dist = Math.hypot(dx, dy)
    if (dist < best) best = dist
  }
  return best * terrain.cellMeters
}
