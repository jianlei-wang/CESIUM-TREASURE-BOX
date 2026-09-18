import type { Bounds, HeatPoint } from './heatmap-engine'

export type HeatmapScene = {
  id: string
  label: string
  bounds: Bounds
  defaultRadius: number
  pointCount: number
  description: string
}

export type SceneData = {
  points: HeatPoint[]
  valueMin: number
  valueMax: number
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(random: () => number): number {
  let u = 0
  let v = 0
  while (u === 0) u = random()
  while (v === 0) v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function buildScenePoints(
  seed: number,
  bounds: Bounds,
  count: number,
  mode: 'clusters' | 'band' | 'ring' | 'core'
): SceneData {
  const random = seededRandom(seed)
  const points: HeatPoint[] = []
  const centerLon = (bounds.west + bounds.east) / 2
  const centerLat = (bounds.south + bounds.north) / 2
  const lonRange = bounds.east - bounds.west
  const latRange = bounds.north - bounds.south

  const clusters =
    mode === 'clusters'
      ? Array.from({ length: 3 }, () => ({
          lon: centerLon + (random() - 0.5) * lonRange * 0.6,
          lat: centerLat + (random() - 0.5) * latRange * 0.6
        }))
      : []

  for (let index = 0; index < count; index += 1) {
    let lon = 0
    let lat = 0
    let value = 0
    if (mode === 'clusters') {
      const cluster = clusters[Math.floor(random() * clusters.length)]
      lon = cluster.lon + gaussian(random) * lonRange * 0.08
      lat = cluster.lat + gaussian(random) * latRange * 0.08
      value = 500 + Math.abs(gaussian(random)) * 250 + random() * 250
    } else if (mode === 'band') {
      lon = bounds.west + random() * lonRange
      lat = centerLat + gaussian(random) * latRange * 0.18
      value = 400 + Math.abs(Math.sin((lon - bounds.west) / lonRange * Math.PI * 2)) * 500 + random() * 100
    } else if (mode === 'ring') {
      const angle = random() * Math.PI * 2
      const ringRadius = 0.28 + random() * 0.24
      lon = centerLon + Math.cos(angle) * lonRange * 0.5 * ringRadius
      lat = centerLat + Math.sin(angle) * latRange * 0.5 * ringRadius
      value = 500 + Math.sin(angle * 3) * 150 + random() * 350
    } else {
      lon = centerLon + gaussian(random) * lonRange * 0.12
      lat = centerLat + gaussian(random) * latRange * 0.12
      value = 600 + Math.abs(gaussian(random)) * 200 + random() * 200
    }
    points.push({
      x: clampValue(lon, bounds.west, bounds.east),
      y: clampValue(lat, bounds.south, bounds.north),
      value: clampValue(value, 0, 1000)
    })
  }

  const valueMin = Math.min(...points.map((point) => point.value))
  const valueMax = Math.max(...points.map((point) => point.value))
  return { points, valueMin, valueMax }
}

export const heatmapScenes: HeatmapScene[] = [
  {
    id: 'beijing-clusters',
    label: '北京多中心',
    bounds: { west: 114.9, south: 38.4, east: 118.0, north: 41.4 },
    defaultRadius: 70,
    pointCount: 120,
    description: '三个高值核心的高斯聚集点'
  },
  {
    id: 'shanghai-band',
    label: '上海沿江带状',
    bounds: { west: 120.8, south: 30.6, east: 122.3, north: 31.9 },
    defaultRadius: 55,
    pointCount: 100,
    description: '沿江线性分布、随位置波动的高值'
  },
  {
    id: 'guangzhou-ring',
    label: '广州环形',
    bounds: { west: 112.8, south: 22.5, east: 114.0, north: 23.6 },
    defaultRadius: 50,
    pointCount: 80,
    description: '环形分布的模拟数据'
  },
  {
    id: 'chengdu-core',
    label: '成都核心聚集',
    bounds: { west: 103.6, south: 30.3, east: 104.6, north: 31.1 },
    defaultRadius: 65,
    pointCount: 60,
    description: '中心高密度聚集模拟数据'
  }
]

export function generateSceneData(scene: HeatmapScene, seed = 20260827, mode?: 'clusters' | 'band' | 'ring' | 'core'): SceneData {
  const modeMap: Record<string, 'clusters' | 'band' | 'ring' | 'core'> = {
    'beijing-clusters': 'clusters',
    'shanghai-band': 'band',
    'guangzhou-ring': 'ring',
    'chengdu-core': 'core'
  }
  return buildScenePoints(seed, scene.bounds, scene.pointCount, mode ?? modeMap[scene.id] ?? 'core')
}
