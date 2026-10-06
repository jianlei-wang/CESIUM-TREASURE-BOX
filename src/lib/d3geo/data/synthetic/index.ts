/**
 * Synthetic Data Lab —— 全模块唯一保留随机数据的地方。
 *
 * 明确用于「性能压力测试」，不冒充真实地理业务数据。
 * 所有输出均为 TypedArray 列式结构，可直接 Transfer 到 Worker 或喂给 GPU。
 */
import { GeoPointBufferBuilder, type FlowBuffer, type GeoPointBuffer, type TrajectoryBuffer } from '../../core/buffer'
import { mulberry32 } from '../../data'

export const SYNTHETIC_SIZES = [10_000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000, 10_000_000] as const

export type SyntheticPattern = 'uniform' | 'clustered' | 'hotspot' | 'trajectory' | 'grid' | 'flow' | 'temporal'

export const SYNTHETIC_PATTERNS: Array<{ value: SyntheticPattern; label: string }> = [
  { value: 'uniform', label: 'Uniform 均匀分布' },
  { value: 'clustered', label: 'Clustered 多中心聚簇' },
  { value: 'hotspot', label: 'Hotspot 热点集中' },
  { value: 'trajectory', label: 'Trajectory 轨迹走廊' },
  { value: 'grid', label: 'Grid 规则网格' },
  { value: 'flow', label: 'Flow 流场分布' },
  { value: 'temporal', label: 'Temporal 时空演化' }
]

/** 地理范围（中国及周边）。 */
export const SYNTHETIC_BOUNDS = { west: 73, south: 18, east: 135, north: 54 }

/** 合成数据用的城市种子点（仅作为分布骨架，不是业务数据）。 */
const SKELETON: Array<[number, number, number]> = [
  [116.4, 39.9, 0.16], [121.47, 31.23, 0.14], [113.26, 23.13, 0.12], [114.06, 22.54, 0.11],
  [104.07, 30.57, 0.09], [106.55, 29.56, 0.08], [120.15, 30.27, 0.07], [114.31, 30.59, 0.06],
  [108.94, 34.34, 0.05], [118.8, 32.06, 0.05], [117.19, 39.13, 0.04], [113.63, 34.75, 0.04],
  [126.53, 45.8, 0.03], [87.62, 43.79, 0.02], [91.14, 29.65, 0.02], [102.83, 24.88, 0.03]
]

function gaussian(rng: () => number): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export type SyntheticOptions = {
  pattern?: SyntheticPattern
  seed?: number
  /** 统一时间基准（毫秒）。 */
  timeStart?: number
  /** 时间跨度（毫秒），默认 24 小时。 */
  timeSpan?: number
  /** 类别数量。 */
  categoryCount?: number
}

/** 生成 N 个合成点（唯一用途：性能压力测试）。 */
export function generateSyntheticPoints(count: number, options: SyntheticOptions = {}): GeoPointBuffer {
  const pattern = options.pattern ?? 'clustered'
  const seed = options.seed ?? 20261006
  const rng = mulberry32(seed)
  const timeStart = options.timeStart ?? Date.UTC(2026, 9, 6)
  const timeSpan = options.timeSpan ?? 24 * 3600 * 1000
  const categoryCount = options.categoryCount ?? 6
  const builder = new GeoPointBufferBuilder(count)
  const { west, south, east, north } = SYNTHETIC_BOUNDS

  const clusterCenters: Array<[number, number, number]> = []
  let weightSum = 0
  for (const [lon, lat, weight] of SKELETON) {
    clusterCenters.push([lon, lat, weight])
    weightSum += weight
  }

  for (let i = 0; i < count; i += 1) {
    let lon = 0
    let lat = 0
    let value = 1
    switch (pattern) {
      case 'uniform': {
        lon = west + rng() * (east - west)
        lat = south + rng() * (north - south)
        value = 20 + rng() * 80
        break
      }
      case 'clustered': {
        let pick = rng() * weightSum
        let chosen = clusterCenters[clusterCenters.length - 1]
        for (const center of clusterCenters) {
          pick -= center[2]
          if (pick <= 0) {
            chosen = center
            break
          }
        }
        lon = chosen[0] + gaussian(rng) * 1.6
        lat = chosen[1] + gaussian(rng) * 1.1
        value = Math.max(1, 100 * Math.exp(-(gaussian(rng) ** 2) / 2))
        break
      }
      case 'hotspot': {
        const hotspot = SKELETON[Math.floor(rng() * 4)]
        lon = hotspot[0] + gaussian(rng) * 0.5
        lat = hotspot[1] + gaussian(rng) * 0.4
        value = 200 + rng() * 300
        break
      }
      case 'trajectory': {
        const corridor = SKELETON[Math.floor(rng() * SKELETON.length)]
        const t = rng()
        lon = corridor[0] + (rng() - 0.5) * 18
        lat = corridor[1] + (t - 0.5) * 8 + Math.sin(t * Math.PI * 2) * 3
        value = 50 + t * 150
        break
      }
      case 'grid': {
        const cols = Math.ceil(Math.sqrt(count * 1.6))
        const rows = Math.ceil(count / cols)
        const gx = i % cols
        const gy = Math.floor(i / cols)
        lon = west + (gx / Math.max(1, cols - 1)) * (east - west)
        lat = south + (gy / Math.max(1, rows - 1)) * (north - south)
        value = 30 + rng() * 40
        break
      }
      case 'flow': {
        const base = SKELETON[Math.floor(rng() * SKELETON.length)]
        const angle = rng() * Math.PI * 2
        const radius = rng() * 6
        lon = base[0] + Math.cos(angle) * radius
        lat = base[1] + Math.sin(angle) * radius * 0.6
        value = Math.max(1, 120 * Math.abs(Math.sin(angle)))
        break
      }
      case 'temporal': {
        const phase = (i % count) / count
        lon = west + phase * (east - west) + gaussian(rng) * 0.8
        lat = south + (north - south) * (0.5 + 0.4 * Math.sin(phase * Math.PI * 2)) + gaussian(rng) * 0.6
        value = 40 + 80 * Math.abs(Math.cos(phase * Math.PI * 2))
        break
      }
    }
    builder.push(lon, lat, value, i % categoryCount, timeStart + rng() * timeSpan)
  }
  return builder.build()
}

/** 生成合成 OD 流（用于流量网络性能测试）。 */
export function generateSyntheticFlows(count: number, seed = 7): FlowBuffer {
  const rng = mulberry32(seed)
  const originLon = new Float32Array(count)
  const originLat = new Float32Array(count)
  const destLon = new Float32Array(count)
  const destLat = new Float32Array(count)
  const values = new Float32Array(count)
  const categories = new Uint16Array(count)
  for (let i = 0; i < count; i += 1) {
    const a = SKELETON[Math.floor(rng() * SKELETON.length)]
    const b = SKELETON[Math.floor(rng() * SKELETON.length)]
    originLon[i] = a[0]
    originLat[i] = a[1]
    destLon[i] = b[0]
    destLat[i] = b[1]
    values[i] = Math.round(1 + rng() * 999)
    categories[i] = Math.floor(rng() * 4)
  }
  return { length: count, originLon, originLat, destLon, destLat, values, categories }
}

/** 生成合成轨迹（用于时空轨迹性能测试）。 */
export function generateSyntheticTrajectories(count: number, pointsPerTrack = 120, seed = 11): TrajectoryBuffer {
  const rng = mulberry32(seed)
  const total = count * pointsPerTrack
  const offsets = new Uint32Array(count + 1)
  const positions = new Float32Array(total * 2)
  const timestamps = new Float64Array(total)
  const speeds = new Float32Array(total)
  const categories = new Uint16Array(total)
  const timeStart = Date.UTC(2026, 9, 6)
  let cursor = 0
  for (let t = 0; t < count; t += 1) {
    offsets[t] = cursor
    const start = SKELETON[Math.floor(rng() * SKELETON.length)]
    const end = SKELETON[Math.floor(rng() * SKELETON.length)]
    let lon = start[0]
    let lat = start[1]
    for (let p = 0; p < pointsPerTrack; p += 1) {
      const ratio = p / pointsPerTrack
      const targetLon = start[0] + (end[0] - start[0]) * ratio
      const targetLat = start[1] + (end[1] - start[1]) * ratio
      lon += (targetLon - lon) * 0.3 + gaussian(rng) * 0.25
      lat += (targetLat - lat) * 0.3 + gaussian(rng) * 0.2
      positions[cursor * 2] = lon
      positions[cursor * 2 + 1] = lat
      timestamps[cursor] = timeStart + ratio * 24 * 3600 * 1000
      speeds[cursor] = 20 + rng() * 120
      categories[cursor] = t % 5
      cursor += 1
    }
  }
  offsets[count] = cursor
  return { count, offsets, positions, timestamps, speeds, categories }
}
