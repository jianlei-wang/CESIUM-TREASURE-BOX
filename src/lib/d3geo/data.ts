type LonLat = [number, number]

/** Mulberry32 可复现伪随机数生成器。 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type CityDatum = {
  name: string
  lon: number
  lat: number
  /** 基础指标（人口 / GDP 量级）。 */
  value: number
}

/** 国内主要城市样本数据，供各类案例复用。 */
export const CHINA_CITIES: CityDatum[] = [
  { name: '北京', lon: 116.407, lat: 39.904, value: 100 },
  { name: '上海', lon: 121.473, lat: 31.23, value: 96 },
  { name: '广州', lon: 113.264, lat: 23.129, value: 82 },
  { name: '深圳', lon: 114.058, lat: 22.543, value: 85 },
  { name: '成都', lon: 104.066, lat: 30.572, value: 74 },
  { name: '重庆', lon: 106.551, lat: 29.563, value: 76 },
  { name: '杭州', lon: 120.155, lat: 30.274, value: 70 },
  { name: '武汉', lon: 114.305, lat: 30.593, value: 66 },
  { name: '西安', lon: 108.94, lat: 34.341, value: 62 },
  { name: '南京', lon: 118.797, lat: 32.06, value: 64 },
  { name: '天津', lon: 117.19, lat: 39.125, value: 60 },
  { name: '郑州', lon: 113.625, lat: 34.746, value: 58 },
  { name: '长沙', lon: 112.938, lat: 28.228, value: 55 },
  { name: '青岛', lon: 120.382, lat: 36.067, value: 52 },
  { name: '沈阳', lon: 123.429, lat: 41.796, value: 50 },
  { name: '昆明', lon: 102.833, lat: 24.879, value: 46 },
  { name: '哈尔滨', lon: 126.535, lat: 45.803, value: 44 },
  { name: '福州', lon: 119.296, lat: 26.074, value: 45 },
  { name: '济南', lon: 117.12, lat: 36.651, value: 48 },
  { name: '合肥', lon: 117.227, lat: 31.821, value: 47 },
  { name: '南昌', lon: 115.858, lat: 28.683, value: 42 },
  { name: '贵阳', lon: 106.63, lat: 26.647, value: 40 },
  { name: '南宁', lon: 108.366, lat: 22.817, value: 41 },
  { name: '太原', lon: 112.549, lat: 37.857, value: 38 },
  { name: '石家庄', lon: 114.514, lat: 38.042, value: 43 },
  { name: '兰州', lon: 103.834, lat: 36.061, value: 34 },
  { name: '乌鲁木齐', lon: 87.617, lat: 43.792, value: 32 },
  { name: '呼和浩特', lon: 111.751, lat: 40.842, value: 30 },
  { name: '银川', lon: 106.231, lat: 38.487, value: 26 },
  { name: '西宁', lon: 101.778, lat: 36.617, value: 24 },
  { name: '拉萨', lon: 91.14, lat: 29.645, value: 18 },
  { name: '海口', lon: 110.199, lat: 20.044, value: 33 },
  { name: '长春', lon: 125.324, lat: 43.887, value: 36 },
  { name: '大连', lon: 121.615, lat: 38.914, value: 40 },
  { name: '苏州', lon: 120.585, lat: 31.299, value: 56 },
  { name: '宁波', lon: 121.55, lat: 29.874, value: 48 },
  { name: '厦门', lon: 118.089, lat: 24.48, value: 42 },
  { name: '无锡', lon: 120.312, lat: 31.491, value: 44 },
  { name: '佛山', lon: 113.122, lat: 23.028, value: 46 },
  { name: '东莞', lon: 113.752, lat: 23.021, value: 45 }
]

/** 全球主要机场（用于流量弧线、网络拓扑）。 */
export const WORLD_HUBS: CityDatum[] = [
  { name: 'Beijing', lon: 116.41, lat: 39.9, value: 100 },
  { name: 'Shanghai', lon: 121.47, lat: 31.23, value: 98 },
  { name: 'Tokyo', lon: 139.78, lat: 35.55, value: 95 },
  { name: 'Singapore', lon: 103.99, lat: 1.36, value: 90 },
  { name: 'Dubai', lon: 55.36, lat: 25.25, value: 92 },
  { name: 'London', lon: -0.45, lat: 51.47, value: 94 },
  { name: 'Paris', lon: 2.55, lat: 49.01, value: 88 },
  { name: 'Frankfurt', lon: 8.57, lat: 50.03, value: 86 },
  { name: 'New York', lon: -73.78, lat: 40.64, value: 96 },
  { name: 'Los Angeles', lon: -118.41, lat: 33.94, value: 85 },
  { name: 'Chicago', lon: -87.9, lat: 41.98, value: 80 },
  { name: 'Sao Paulo', lon: -46.47, lat: -23.43, value: 78 },
  { name: 'Johannesburg', lon: 28.25, lat: -26.13, value: 70 },
  { name: 'Sydney', lon: 151.18, lat: -33.94, value: 76 },
  { name: 'Mumbai', lon: 72.86, lat: 19.09, value: 82 },
  { name: 'Seoul', lon: 126.45, lat: 37.46, value: 84 },
  { name: 'Hong Kong', lon: 113.92, lat: 22.31, value: 89 },
  { name: 'Bangkok', lon: 100.75, lat: 13.69, value: 79 },
  { name: 'Moscow', lon: 37.41, lat: 55.97, value: 72 },
  { name: 'Istanbul', lon: 28.75, lat: 41.28, value: 74 }
]

/** 在给定经纬范围内生成散点。 */
export function randomPoints(
  count: number,
  bounds: { west: number; south: number; east: number; north: number },
  seed = 1
): LonLat[] {
  const rng = mulberry32(seed)
  const points: LonLat[] = []
  for (let i = 0; i < count; i += 1) {
    points.push([
      bounds.west + rng() * (bounds.east - bounds.west),
      bounds.south + rng() * (bounds.north - bounds.south)
    ])
  }
  return points
}

/** 生成带权重的散点（若干高斯簇）。 */
export function clusteredPoints(
  clusters: Array<{ lon: number; lat: number; count: number; spread?: number }>,
  seed = 1
): LonLat[] {
  const rng = mulberry32(seed)
  const points: LonLat[] = []
  for (const cluster of clusters) {
    const spread = cluster.spread ?? 0.6
    for (let i = 0; i < cluster.count; i += 1) {
      const angle = rng() * Math.PI * 2
      const radius = Math.sqrt(rng()) * spread
      points.push([cluster.lon + Math.cos(angle) * radius, cluster.lat + Math.sin(angle) * radius * 0.7])
    }
  }
  return points
}

/** 将数组按区间等分为若干桶，返回每桶计数。 */
export function histogram(values: number[], bins: number, domain?: [number, number]): number[] {
  const min = domain?.[0] ?? Math.min(...values)
  const max = domain?.[1] ?? Math.max(...values)
  const width = (max - min) / bins || 1
  const result = new Array(bins).fill(0)
  for (const value of values) {
    const index = Math.min(bins - 1, Math.max(0, Math.floor((value - min) / width)))
    result[index] += 1
  }
  return result
}

/** 二维值噪声（简化的分形噪声），用于曲面 / 热力场。 */
export function valueNoise2D(width: number, height: number, seed = 1, octaves = 4): number[][] {
  const rng = mulberry32(seed)
  const grids: number[][][] = []
  for (let o = 0; o < octaves; o += 1) {
    const size = 2 ** (o + 1) + 1
    const grid: number[][] = []
    for (let y = 0; y < size; y += 1) {
      const row: number[] = []
      for (let x = 0; x < size; x += 1) row.push(rng())
      grid.push(row)
    }
    grids.push(grid)
  }
  const sample = (grid: number[][], u: number, v: number): number => {
    const size = grid.length
    const fx = u * (size - 1)
    const fy = v * (size - 1)
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const x1 = Math.min(size - 1, x0 + 1)
    const y1 = Math.min(size - 1, y0 + 1)
    const tx = fx - x0
    const ty = fy - y0
    const sx = tx * tx * (3 - 2 * tx)
    const sy = ty * ty * (3 - 2 * ty)
    const a = grid[y0][x0] * (1 - sx) + grid[y0][x1] * sx
    const b = grid[y1][x0] * (1 - sx) + grid[y1][x1] * sx
    return a * (1 - sy) + b * sy
  }
  const result: number[][] = []
  for (let y = 0; y < height; y += 1) {
    const row: number[] = []
    for (let x = 0; x < width; x += 1) {
      let value = 0
      let amplitude = 1
      let total = 0
      for (let o = 0; o < octaves; o += 1) {
        value += sample(grids[o], x / (width - 1 || 1), y / (height - 1 || 1)) * amplitude
        total += amplitude
        amplitude *= 0.5
      }
      row.push(value / total)
    }
    result.push(row)
  }
  return result
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
