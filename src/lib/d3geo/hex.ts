import type { LonLat } from './render'

export type HexCell = {
  /** 稳定的轴向键，形如 "i,j"。 */
  key: string
  /** 单元中心经纬度。 */
  center: LonLat
  /** 单元边界（闭合成环前的顶点序列）。 */
  polygon: LonLat[]
  /** 落入该单元的点索引。 */
  indices: number[]
  /** 落入该单元的点数量。 */
  count: number
}

/**
 * 平面六边形聚合（扁平顶 flat-top）。以 lat0 处的经度缩放把经纬度近似为平面坐标，
 * 用「邻域最近中心」策略分桶，避免边界抖动。返回被占据的单元。
 */
export function hexbin(points: LonLat[], radiusDeg: number, lat0 = 34): HexCell[] {
  const cos = Math.cos((lat0 * Math.PI) / 180) || 0.01
  const R = Math.max(0.0001, radiusDeg)
  const w = 2 * R
  const h = Math.sqrt(3) * R
  const bucket = new Map<string, HexCell>()

  for (let index = 0; index < points.length; index += 1) {
    const [lon, lat] = points[index]
    const x = lon * cos
    const y = lat
    const j0 = Math.round(y / h)
    let bestI = 0
    let bestJ = 0
    let bestCx = 0
    let bestCy = 0
    let bestDist = Number.POSITIVE_INFINITY
    for (let j = j0 - 1; j <= j0 + 1; j += 1) {
      const offset = ((j % 2) + 2) % 2 === 0 ? 0 : R
      const i0 = Math.round((x - offset) / w)
      for (let i = i0 - 1; i <= i0 + 1; i += 1) {
        const cx = i * w + offset
        const cy = j * h
        const dist = (cx - x) ** 2 + (cy - y) ** 2
        if (dist < bestDist) {
          bestDist = dist
          bestI = i
          bestJ = j
          bestCx = cx
          bestCy = cy
        }
      }
    }
    const key = `${bestI},${bestJ}`
    let cell = bucket.get(key)
    if (!cell) {
      const polygon: LonLat[] = []
      for (let k = 0; k < 6; k += 1) {
        const angle = (Math.PI / 3) * k
        polygon.push([(bestCx + R * Math.cos(angle)) / cos, bestCy + R * Math.sin(angle)])
      }
      cell = { key, center: [bestCx / cos, bestCy], polygon, indices: [], count: 0 }
      bucket.set(key, cell)
    }
    cell.indices.push(index)
    cell.count += 1
  }

  return [...bucket.values()]
}

/** 生成以 (lon,lat) 为中心、外接半径 radiusDeg 的扁平顶六边形。 */
export function hexagonAt(lon: number, lat: number, radiusDeg: number, lat0 = 34): LonLat[] {
  const cos = Math.cos((lat0 * Math.PI) / 180) || 0.01
  const x = lon * cos
  const y = lat
  const polygon: LonLat[] = []
  for (let k = 0; k < 6; k += 1) {
    const angle = (Math.PI / 3) * k
    polygon.push([(x + radiusDeg * Math.cos(angle)) / cos, y + radiusDeg * Math.sin(angle)])
  }
  return polygon
}

/** 将点集按规则方格聚合。 */
export type GridCell = {
  key: string
  center: LonLat
  polygon: LonLat[]
  indices: number[]
  count: number
}

export function gridbin(
  points: LonLat[],
  cellSize: number,
  bounds?: { west: number; south: number; east: number; north: number }
): GridCell[] {
  const bucket = new Map<string, GridCell>()
  for (let index = 0; index < points.length; index += 1) {
    const [lon, lat] = points[index]
    const i = Math.floor(lon / cellSize)
    const j = Math.floor(lat / cellSize)
    const key = `${i},${j}`
    let cell = bucket.get(key)
    if (!cell) {
      const west = i * cellSize
      const south = j * cellSize
      const east = west + cellSize
      const north = south + cellSize
      cell = {
        key,
        center: [(west + east) / 2, (south + north) / 2],
        polygon: [
          [west, south],
          [east, south],
          [east, north],
          [west, north]
        ],
        indices: [],
        count: 0
      }
      bucket.set(key, cell)
    }
    cell.indices.push(index)
    cell.count += 1
  }
  void bounds
  return [...bucket.values()]
}
