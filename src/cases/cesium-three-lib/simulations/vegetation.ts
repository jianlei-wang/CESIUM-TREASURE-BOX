import { clamp, deterministicRng } from './contract'

export type VegetationKind = 'tree' | 'grass' | 'flower' | 'rock'

export type TreePreset = 'mixed' | 'oak' | 'pine' | 'aspen' | 'bush'

export interface TreeProfile {
  label: string
  bark: string
  canopy: string
  height: number
}

export const TREE_PROFILES: Record<TreePreset, TreeProfile> = {
  mixed: { label: '混交林', bark: '#6e5237', canopy: '#578f57', height: 12 },
  oak: { label: '阔叶乔木', bark: '#6b5034', canopy: '#5f9e63', height: 11 },
  pine: { label: '针叶乔木', bark: '#5c4530', canopy: '#376b4d', height: 16 },
  aspen: { label: '落叶小乔木', bark: '#8a7b62', canopy: '#8dbb62', height: 10 },
  bush: { label: '灌丛', bark: '#5f4a33', canopy: '#6aa85f', height: 3 }
}

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

export function terrainHeight(x: number, z: number): number {
  const ridge = 9 * Math.exp(-((x - 26) ** 2 + (z + 18) ** 2) / 1500)
  const hill = 7 * Math.exp(-((x + 34) ** 2 + (z - 30) ** 2) / 1100)
  const knoll = 4 * Math.exp(-((x + 6) ** 2 + (z + 44) ** 2) / 640)
  return 0.02 * x + 0.01 * z + ridge + hill + knoll
}

export function polygonArea(points: readonly Vec2[]): number {
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    sum += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(sum) * 0.5
}

export function pointInPolygon(x: number, z: number, points: readonly Vec2[]): boolean {
  let inside = false
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const a = points[index]
    const b = points[previous]
    if (a[0] > x !== b[0] > x && z < ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1e-9) + a[1]) {
      inside = !inside
    }
  }
  return inside
}

export function polygonBounds(points: readonly Vec2[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point[0])
    maxX = Math.max(maxX, point[0])
    minZ = Math.min(minZ, point[1])
    maxZ = Math.max(maxZ, point[1])
  }
  if (!Number.isFinite(minX)) return { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }
  return { minX, maxX, minZ, maxZ }
}

export function polygonCentroid(points: readonly Vec2[]): Vec2 {
  let x = 0
  let z = 0
  for (const point of points) {
    x += point[0]
    z += point[1]
  }
  return [x / Math.max(1, points.length), z / Math.max(1, points.length)]
}

export interface Region {
  outer: Vec2[]
  holes: Vec2[][]
  points: Vec2[]
  label: string
}

export function regionAreaHa(region: Region): number {
  if (region.outer.length < 3) return 0
  let area = polygonArea(region.outer)
  for (const hole of region.holes) area -= polygonArea(hole)
  return Math.max(0, area) / 10000
}

export function insideRegion(x: number, z: number, region: Region): boolean {
  if (region.outer.length >= 3 && pointInPolygon(x, z, region.outer)) {
    for (const hole of region.holes) {
      if (hole.length >= 3 && pointInPolygon(x, z, hole)) return false
    }
    return true
  }
  return false
}

export function rectangleOutline(width: number, depth: number, rotation: number): Vec2[] {
  const halfW = width * 0.5
  const halfD = depth * 0.5
  const angle = (rotation * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD]
  ].map(([x, z]) => [x * cos - z * sin, x * sin + z * cos] as Vec2)
}

export function circleOutline(radius: number, segments = 48): Vec2[] {
  const points: Vec2[] = []
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius])
  }
  return points
}

export function sampleForestRegion(): Region {
  const outer: Vec2[] = [
    [-92, -46],
    [36, -62],
    [96, -18],
    [84, 44],
    [18, 70],
    [-72, 58],
    [-104, 12]
  ]
  const hole: Vec2[] = [
    [-16, -6],
    [18, -16],
    [30, 14],
    [-4, 30],
    [-28, 12]
  ]
  return { outer, holes: [hole], points: [], label: '林地面状区域（含采伐孔洞）' }
}

export function sampleRoadsidePoints(): Vec2[] {
  const points: Vec2[] = []
  for (let index = 0; index < 48; index += 1) {
    const t = index / 47
    points.push([-110 + t * 230, -76 + Math.sin(t * 3.1) * 16 + t * 18])
  }
  return points
}

export function gridPoints(rows: number, cols: number, interval: number, offset: Vec2): Vec2[] {
  const rowCount = clamp(Math.round(rows), 1, 200)
  const colCount = clamp(Math.round(cols), 1, 200)
  const spacing = clamp(interval, 1, 100)
  const points: Vec2[] = []
  for (let row = 0; row < rowCount; row += 1) {
    for (let col = 0; col < colCount; col += 1) {
      points.push([
        offset[0] + (col - (colCount - 1) / 2) * spacing,
        offset[1] + (row - (rowCount - 1) / 2) * spacing
      ])
    }
  }
  return points
}

export interface VegetationInstance {
  kind: VegetationKind
  position: Vec3
  scale: number
  rotation: number
  variant: number
}

export interface ScatterConfig {
  seed: number
  treeDensity: number
  grassDensity: number
  flowerDensity: number
  rockDensity: number
  treeScale: number
  grassScale: number
  enabled: Record<VegetationKind, boolean>
  clampToTerrain: boolean
  terrain: boolean
}

const LIMITS: Record<VegetationKind, number> = {
  tree: 2400,
  grass: 40000,
  flower: 16000,
  rock: 2000
}

const SPACING: Record<VegetationKind, number> = {
  tree: 3.4,
  grass: 0.9,
  flower: 1.6,
  rock: 3.2
}

function heightOf(x: number, z: number, config: ScatterConfig): number {
  return config.clampToTerrain && config.terrain ? terrainHeight(x, z) : 0
}

function scatterArea(
  region: Region,
  kind: VegetationKind,
  density: number,
  config: ScatterConfig,
  rng: () => number,
  target: VegetationInstance[]
): void {
  const areaHa = regionAreaHa(region)
  if (areaHa <= 0 || density <= 0) return
  const desired = clamp(Math.round(areaHa * density), 0, LIMITS[kind])
  if (desired === 0) return
  const bounds = polygonBounds(region.outer)
  const spacing = SPACING[kind]
  const useSpacing = kind === 'tree' || kind === 'rock'
  const cell = Math.max(1, spacing)
  const buckets = new Map<string, Vec2[]>()
  const accepted: Vec2[] = []
  const guard = desired * 40
  for (let attempt = 0; attempt < guard && accepted.length < desired; attempt += 1) {
    const x = bounds.minX + rng() * (bounds.maxX - bounds.minX)
    const z = bounds.minZ + rng() * (bounds.maxZ - bounds.minZ)
    if (!insideRegion(x, z, region)) continue
    if (useSpacing) {
      const cx = Math.floor(x / cell)
      const cz = Math.floor(z / cell)
      let blocked = false
      for (let ox = -1; ox <= 1 && !blocked; ox += 1) {
        for (let oz = -1; oz <= 1 && !blocked; oz += 1) {
          const bucket = buckets.get(`${cx + ox}|${cz + oz}`)
          if (!bucket) continue
          for (const other of bucket) {
            if ((other[0] - x) ** 2 + (other[1] - z) ** 2 < spacing * spacing) {
              blocked = true
              break
            }
          }
        }
      }
      if (blocked) continue
      const key = `${cx}|${cz}`
      const bucket = buckets.get(key)
      if (bucket) bucket.push([x, z])
      else buckets.set(key, [[x, z]])
    }
    accepted.push([x, z])
  }
  const scale = kind === 'tree' ? config.treeScale : kind === 'grass' ? config.grassScale : 1
  for (const [x, z] of accepted) {
    const jitter = kind === 'tree' ? 0.72 + rng() * 0.56 : 0.7 + rng() * 0.66
    target.push({
      kind,
      position: [x, heightOf(x, z, config), z],
      scale: Math.max(0.05, scale * jitter),
      rotation: rng() * Math.PI * 2,
      variant: Math.floor(rng() * 3)
    })
  }
}

export function scatterVegetation(region: Region, config: ScatterConfig): VegetationInstance[] {
  const rng = deterministicRng(Math.max(1, Math.round(config.seed)) * 2654435761)
  const instances: VegetationInstance[] = []
  const densities: Record<VegetationKind, number> = {
    tree: config.treeDensity,
    grass: config.grassDensity,
    flower: config.flowerDensity,
    rock: config.rockDensity
  }
  const kinds: VegetationKind[] = ['tree', 'grass', 'flower', 'rock']
  if (region.outer.length >= 3) {
    for (const kind of kinds) {
      if (!config.enabled[kind]) continue
      scatterArea(region, kind, densities[kind], config, rng, instances)
    }
  }
  if (region.points.length > 0 && config.enabled.tree) {
    for (const [x, z] of region.points) {
      instances.push({
        kind: 'tree',
        position: [x, heightOf(x, z, config), z],
        scale: Math.max(0.05, config.treeScale * (0.78 + rng() * 0.44)),
        rotation: rng() * Math.PI * 2,
        variant: Math.floor(rng() * 3)
      })
    }
  }
  return instances
}

export function countKinds(instances: readonly VegetationInstance[]): Record<VegetationKind, number> {
  const counts: Record<VegetationKind, number> = { tree: 0, grass: 0, flower: 0, rock: 0 }
  for (const instance of instances) counts[instance.kind] += 1
  return counts
}
