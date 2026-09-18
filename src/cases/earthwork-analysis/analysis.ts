/**
 * 土方量分析核心算法（纯前端，无 Cesium 依赖，便于测试与复用）。
 *
 * 采用网格法（Grid Method）：把分析区域投影到以区域重心为原点的局部平面米坐标系，
 * 按设定分辨率划分规则网格，对每个网格单元用原始地面高程与设计面高程之差积分求体积：
 *   V_cell = A_cell × coverage × (h_design_avg − h_original_avg)
 * 约定 diff = 设计高程 − 原始高程：
 *   diff < 0（原始高于设计）→ 挖方；diff > 0（原始低于设计）→ 填方。
 */

export type LngLat = { lon: number; lat: number }

export type DesignMode = 'plane' | 'slope' | 'offset'

export type EarthworkParams = {
  /** 网格分辨率（米） */
  resolution: number
  /** 设计面类型：水平面 / 斜面 / 地形偏移面 */
  designMode: DesignMode
  /** 设计标高（米，绝对高程；斜面作为基准点高程） */
  designHeight: number
  /** 坡度（百分比，斜面专用） */
  slopePercent: number
  /** 坡向（度，正北起顺时针；斜面专用） */
  aspectDeg: number
  /** 地形偏移量（米，偏移面专用；正为抬升填方，负为下挖） */
  offset: number
}

export type GridCorner = { lon: number; lat: number; x: number; y: number }

export type EarthworkGrid = {
  cols: number
  rows: number
  resolution: number
  cellArea: number
  lon0: number
  lat0: number
  minX: number
  minY: number
  corners: GridCorner[]
  /** 每个网格单元被区域覆盖的面积比例（0—1） */
  coverage: Float32Array
  /** 每个网格单元是否与区域相交 */
  cellInside: Uint8Array
  /** 区域实际投影面积（平方米） */
  regionArea: number
  /** 区域边界围合面积（平方米） */
  boundaryArea: number
}

export type EarthworkStats = {
  regionArea: number
  cutArea: number
  fillArea: number
  cutVolume: number
  fillVolume: number
  netVolume: number
  maxCutDepth: number
  maxFillDepth: number
  avgCutDepth: number
  avgFillDepth: number
  cells: number
  samplePoints: number
}

export type EarthworkResult = {
  grid: EarthworkGrid
  stats: EarthworkStats
  /** 每个网格单元的设计-原始平均高差（含区域外单元，值为 0） */
  cellDiff: Float32Array
  calcTimeMs: number
}

const METERS_PER_DEG_LAT = 111320
const MAX_CELLS = 12000

export function metersPerDegLon(lat: number): number {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)
}

/** 经纬度多边形 → 以重心为原点的局部平面米坐标 */
export function ringToLocal(ring: LngLat[]): { x: number; y: number }[] {
  const centroid = ringCentroid(ring)
  const mx = metersPerDegLon(centroid.lat)
  return ring.map((p) => ({ x: (p.lon - centroid.lon) * mx, y: (p.lat - centroid.lat) * METERS_PER_DEG_LAT }))
}

export function ringCentroid(ring: LngLat[]): LngLat {
  if (ring.length === 0) return { lon: 0, lat: 0 }
  let lon = 0
  let lat = 0
  for (const p of ring) {
    lon += p.lon
    lat += p.lat
  }
  return { lon: lon / ring.length, lat: lat / ring.length }
}

export function pointInRing(ring: { x: number; y: number }[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x
    const yi = ring[i].y
    const xj = ring[j].x
    const yj = ring[j].y
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** 局部平面多边形面积（鞋带公式，平方 meters） */
export function localRingArea(ring: { x: number; y: number }[]): number {
  let area = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[i].x * ring[j].y - ring[j].x * ring[i].y
  }
  return Math.abs(area) / 2
}

/**
 * 根据区域多边形与分辨率构建规则采样网格。
 * 若网格规模过大，会自动放大分辨率以控制采样点数。
 */
export function buildGrid(ring: LngLat[], resolution: number): EarthworkGrid | null {
  if (ring.length < 3) return null
  const centroid = ringCentroid(ring)
  const mx = metersPerDegLon(centroid.lat)
  const local = ringToLocal(ring)

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of local) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  if (!Number.isFinite(minX) || maxX - minX <= 0 || maxY - minY <= 0) return null

  let res = Math.max(0.5, resolution)
  let cols = Math.max(1, Math.ceil((maxX - minX) / res))
  let rows = Math.max(1, Math.ceil((maxY - minY) / res))
  while (cols * rows > MAX_CELLS) {
    res *= 1.5
    cols = Math.max(1, Math.ceil((maxX - minX) / res))
    rows = Math.max(1, Math.ceil((maxY - minY) / res))
  }

  const corners: GridCorner[] = []
  for (let row = 0; row <= rows; row += 1) {
    const y = minY + row * res
    for (let col = 0; col <= cols; col += 1) {
      const x = minX + col * res
      corners.push({
        x,
        y,
        lon: centroid.lon + x / mx,
        lat: centroid.lat + y / METERS_PER_DEG_LAT
      })
    }
  }

  const coverage = new Float32Array(cols * rows)
  const cellInside = new Uint8Array(cols * rows)
  let regionArea = 0
  const samples = [0.25, 0.5, 0.75]
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let hit = 0
      for (const sy of samples) {
        for (const sx of samples) {
          const x = minX + (col + sx) * res
          const y = minY + (row + sy) * res
          if (pointInRing(local, x, y)) hit += 1
        }
      }
      const cov = hit / (samples.length * samples.length)
      const index = row * cols + col
      coverage[index] = cov
      cellInside[index] = cov > 0 ? 1 : 0
      regionArea += cov * res * res
    }
  }

  return {
    cols,
    rows,
    resolution: res,
    cellArea: res * res,
    lon0: centroid.lon,
    lat0: centroid.lat,
    minX,
    minY,
    corners,
    coverage,
    cellInside,
    regionArea,
    boundaryArea: localRingArea(local)
  }
}

/** 查询某角点处的设计面高程 */
export function designHeightAt(params: EarthworkParams, corner: GridCorner, originalHeight: number): number {
  if (params.designMode === 'offset') return originalHeight + params.offset
  if (params.designMode === 'slope') {
    const aspect = (params.aspectDeg * Math.PI) / 180
    const east = corner.x * Math.sin(aspect) + corner.y * Math.cos(aspect)
    return params.designHeight + (params.slopePercent / 100) * east
  }
  return params.designHeight
}

/**
 * 计算设计面高程数组（按角点顺序），偏移面需要原始高程。
 */
export function buildDesignHeights(
  grid: EarthworkGrid,
  params: EarthworkParams,
  original: ArrayLike<number>
): Float64Array {
  const out = new Float64Array(grid.corners.length)
  for (let i = 0; i < grid.corners.length; i += 1) {
    out[i] = designHeightAt(params, grid.corners[i], original[i] ?? 0)
  }
  return out
}

/** 汇总填挖方量与统计指标 */
export function evaluateEarthwork(
  grid: EarthworkGrid,
  original: ArrayLike<number>,
  design: ArrayLike<number>
): { stats: EarthworkStats; cellDiff: Float32Array } {
  const { cols, rows, cellArea, coverage } = grid
  const rowWidth = cols + 1
  const cellDiff = new Float32Array(cols * rows)

  let cutArea = 0
  let fillArea = 0
  let cutVolume = 0
  let fillVolume = 0
  let maxCutDepth = 0
  let maxFillDepth = 0
  let cutDepthSum = 0
  let fillDepthSum = 0
  let cutCells = 0
  let fillCells = 0

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col
      const cov = coverage[index]
      if (cov <= 0) continue
      const i00 = row * rowWidth + col
      const i10 = i00 + 1
      const i01 = i00 + rowWidth
      const i11 = i01 + 1
      const diff =
        ((design[i00] - original[i00]) +
          (design[i10] - original[i10]) +
          (design[i01] - original[i01]) +
          (design[i11] - original[i11])) /
        4
      cellDiff[index] = diff
      const area = cellArea * cov
      if (diff < 0) {
        const depth = -diff
        cutVolume += area * depth
        cutArea += area
        cutDepthSum += depth
        cutCells += 1
        if (depth > maxCutDepth) maxCutDepth = depth
      } else if (diff > 0) {
        fillVolume += area * diff
        fillArea += area
        fillDepthSum += diff
        fillCells += 1
        if (diff > maxFillDepth) maxFillDepth = diff
      }
    }
  }

  const regionArea = cutArea + fillArea
  return {
    cellDiff,
    stats: {
      regionArea,
      cutArea,
      fillArea,
      cutVolume,
      fillVolume,
      netVolume: cutVolume - fillVolume,
      maxCutDepth,
      maxFillDepth,
      avgCutDepth: cutCells > 0 ? cutDepthSum / cutCells : 0,
      avgFillDepth: fillCells > 0 ? fillDepthSum / fillCells : 0,
      cells: cols * rows,
      samplePoints: grid.corners.length
    }
  }
}

/** 高差 → 颜色（挖方红、平衡黄、填方蓝），diff = 设计 − 原始 */
export function diffColor(diff: number, maxCut: number, maxFill: number): { r: number; g: number; b: number } {
  if (diff < 0) {
    const t = maxCut > 0 ? Math.min(1, -diff / maxCut) : 0
    return { r: Math.round(255), g: Math.round(210 * (1 - t) + 60 * t), b: Math.round(60 * (1 - t)) }
  }
  const t = maxFill > 0 ? Math.min(1, diff / maxFill) : 0
  if (t < 0.5) {
    const k = t * 2
    return { r: Math.round(255 * (1 - k)), g: Math.round(210 + 45 * k), b: Math.round(60 + 60 * k) }
  }
  const k = (t - 0.5) * 2
  return { r: Math.round(0), g: Math.round(255 - 105 * k), b: Math.round(120 + 100 * k) }
}

/** 默认分析区域（北京西山附近，地形起伏明显，便于观察填挖分布） */
export const DEFAULT_CENTER: LngLat = { lon: 116.2, lat: 40.02 }

export function defaultRing(widthMeters = 600, depthMeters = 500): LngLat[] {
  const mx = metersPerDegLon(DEFAULT_CENTER.lat)
  const halfLon = widthMeters / 2 / mx
  const halfLat = depthMeters / 2 / METERS_PER_DEG_LAT
  return [
    { lon: DEFAULT_CENTER.lon - halfLon, lat: DEFAULT_CENTER.lat - halfLat },
    { lon: DEFAULT_CENTER.lon + halfLon, lat: DEFAULT_CENTER.lat - halfLat },
    { lon: DEFAULT_CENTER.lon + halfLon, lat: DEFAULT_CENTER.lat + halfLat },
    { lon: DEFAULT_CENTER.lon - halfLon, lat: DEFAULT_CENTER.lat + halfLat }
  ]
}
