import { Cartographic, Math as CesiumMath, sampleTerrainMostDetailed, type TerrainProvider } from 'cesium'
import { fbm2, ridged2 } from './noise'
import type { AreaBounds, LonLat } from './types'

const METERS_PER_DEG_LAT = 111320
const SAMPLE_CHUNK = 512

export type TerrainGrid = {
  cols: number
  rows: number
  cellMeters: number
  west: number
  south: number
  east: number
  north: number
  dLon: number
  dLat: number
  /** 行优先，row 0 = 最北 */
  elevation: Float32Array
  slope: Float32Array
  /** 上坡方向方位角（0=北，90=东） */
  upslope: Float32Array
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function boundsFromCenter(lon: number, lat: number, spanMeters: number): AreaBounds {
  const dLat = spanMeters / 2 / METERS_PER_DEG_LAT
  const dLon = spanMeters / 2 / (METERS_PER_DEG_LAT * Math.cos(CesiumMath.toRadians(lat)))
  return { west: lon - dLon, south: lat - dLat, east: lon + dLon, north: lat + dLat }
}

export function createGridMeta(bounds: AreaBounds, cols: number, rows: number, spanMeters: number) {
  return {
    cols,
    rows,
    cellMeters: spanMeters / cols,
    west: bounds.west,
    south: bounds.south,
    east: bounds.east,
    north: bounds.north,
    dLon: (bounds.east - bounds.west) / cols,
    dLat: (bounds.north - bounds.south) / rows
  }
}

export function cellLon(grid: TerrainGrid, col: number): number {
  return grid.west + (col + 0.5) * grid.dLon
}

export function cellLat(grid: TerrainGrid, row: number): number {
  return grid.north - (row + 0.5) * grid.dLat
}

export function cellCenter(grid: TerrainGrid, index: number): LonLat {
  const row = Math.floor(index / grid.cols)
  const col = index - row * grid.cols
  return { lon: cellLon(grid, col), lat: cellLat(grid, row) }
}

export function gridFraction(grid: TerrainGrid, lon: number, lat: number): { x: number; y: number } {
  return {
    x: (lon - grid.west) / grid.dLon - 0.5,
    y: (grid.north - lat) / grid.dLat - 0.5
  }
}

export function lonLatToIndex(grid: TerrainGrid, lon: number, lat: number): number {
  const col = Math.floor((lon - grid.west) / grid.dLon)
  const row = Math.floor((grid.north - lat) / grid.dLat)
  if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return -1
  return row * grid.cols + col
}

export function sampleElevation(grid: TerrainGrid, lon: number, lat: number): number {
  const fx = (lon - grid.west) / grid.dLon - 0.5
  const fy = (grid.north - lat) / grid.dLat - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const pick = (x: number, y: number): number => {
    const cx = clamp(x, 0, grid.cols - 1)
    const cy = clamp(y, 0, grid.rows - 1)
    return grid.elevation[cy * grid.cols + cx]
  }
  const top = pick(x0, y0) + (pick(x0 + 1, y0) - pick(x0, y0)) * tx
  const bottom = pick(x0, y0 + 1) + (pick(x0 + 1, y0 + 1) - pick(x0, y0 + 1)) * tx
  return top + (bottom - top) * ty
}

function carveRiver(
  grid: TerrainGrid,
  elevation: Float32Array,
  river: LonLat[],
  halfWidthMeters: number,
  depth: number
): void {
  const riverGrid = river.map((p) => gridFraction(grid, p.lon, p.lat))
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      let best = Infinity
      for (let i = 0; i < riverGrid.length - 1; i += 1) {
        const a = riverGrid[i]
        const b = riverGrid[i + 1]
        const abx = b.x - a.x
        const aby = b.y - a.y
        const apx = col - a.x
        const apy = row - a.y
        const len2 = abx * abx + aby * aby || 1
        const t = clamp((apx * abx + apy * aby) / len2, 0, 1)
        const dx = apx - abx * t
        const dy = apy - aby * t
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < best) best = dist
      }
      const meters = best * grid.cellMeters
      const carve = depth * Math.exp(-(meters / halfWidthMeters) * (meters / halfWidthMeters))
      elevation[row * grid.cols + col] -= carve
    }
  }
}

export function computeSlopeAspect(grid: TerrainGrid): void {
  const { cols, rows, cellMeters, elevation, slope, upslope } = grid
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col
      const left = elevation[row * cols + Math.max(col - 1, 0)]
      const right = elevation[row * cols + Math.min(col + 1, cols - 1)]
      const up = elevation[Math.max(row - 1, 0) * cols + col]
      const down = elevation[Math.min(row + 1, rows - 1) * cols + col]
      const dx = (right - left) / (2 * cellMeters)
      const dy = (up - down) / (2 * cellMeters)
      slope[index] = CesiumMath.toDegrees(Math.atan(Math.hypot(dx, dy)))
      upslope[index] = (CesiumMath.toDegrees(Math.atan2(dx, dy)) + 360) % 360
    }
  }
}

/** 程序化山地地形：脊状分形 + 起伏 + 河道下切。 */
export function buildProceduralTerrain(
  bounds: AreaBounds,
  cols: number,
  rows: number,
  spanMeters: number,
  river: LonLat[],
  seed: number
): TerrainGrid {
  const grid: TerrainGrid = {
    ...createGridMeta(bounds, cols, rows, spanMeters),
    elevation: new Float32Array(cols * rows),
    slope: new Float32Array(cols * rows),
    upslope: new Float32Array(cols * rows)
  }
  const { elevation } = grid
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col / cols
      const y = row / rows
      const ridge = ridged2(x * 3.4, y * 3.4, seed, 6)
      const hills = fbm2(x * 7.5, y * 7.5, seed + 5, 5)
      const micro = fbm2(x * 46, y * 46, seed + 11, 3)
      elevation[row * cols + col] = 820 + 1650 * (0.62 * ridge + 0.38 * hills) + 22 * (micro - 0.5)
    }
  }
  carveRiver(grid, elevation, river, 260, 190)
  computeSlopeAspect(grid)
  return grid
}

/** 将世界地形按给定量采样并双线性插值写入网格，再叠加微地形、下切河道并计算坡度坡向。 */
async function sampleTerrainInto(
  terrainProvider: TerrainProvider,
  grid: TerrainGrid,
  sampleCols: number,
  sampleRows: number,
  river: LonLat[],
  seed: number,
  onProgress?: (ratio: number) => void
): Promise<void> {
  const { cols, rows } = grid
  const positions: Cartographic[] = []
  for (let row = 0; row < sampleRows; row += 1) {
    for (let col = 0; col < sampleCols; col += 1) {
      const lon = grid.west + ((col + 0.5) / sampleCols) * (grid.east - grid.west)
      const lat = grid.north - ((row + 0.5) / sampleRows) * (grid.north - grid.south)
      positions.push(Cartographic.fromDegrees(lon, lat))
    }
  }

  const coarse = new Float32Array(sampleCols * sampleRows)
  let valid = 0
  for (let offset = 0; offset < positions.length; offset += SAMPLE_CHUNK) {
    const chunk = positions.slice(offset, offset + SAMPLE_CHUNK)
    const sampled = await sampleTerrainMostDetailed(terrainProvider, chunk)
    for (let i = 0; i < sampled.length; i += 1) {
      const height = sampled[i].height
      if (Number.isFinite(height)) {
        coarse[offset + i] = height as number
        valid += 1
      }
    }
    onProgress?.(Math.min(offset + SAMPLE_CHUNK, positions.length) / positions.length)
  }
  if (valid < coarse.length * 0.5) {
    throw new Error('世界地形数据覆盖率不足，已回退程序地形')
  }

  const { elevation } = grid
  for (let row = 0; row < rows; row += 1) {
    const sy = (row / rows) * sampleRows - 0.5
    const y0 = clamp(Math.floor(sy), 0, sampleRows - 1)
    const y1 = clamp(y0 + 1, 0, sampleRows - 1)
    const ty = clamp(sy - Math.floor(sy), 0, 1)
    for (let col = 0; col < cols; col += 1) {
      const sx = (col / cols) * sampleCols - 0.5
      const x0 = clamp(Math.floor(sx), 0, sampleCols - 1)
      const x1 = clamp(x0 + 1, 0, sampleCols - 1)
      const tx = clamp(sx - Math.floor(sx), 0, 1)
      const top = coarse[y0 * sampleCols + x0] + (coarse[y0 * sampleCols + x1] - coarse[y0 * sampleCols + x0]) * tx
      const bottom =
        coarse[y1 * sampleCols + x0] + (coarse[y1 * sampleCols + x1] - coarse[y1 * sampleCols + x0]) * tx
      elevation[row * cols + col] = top + (bottom - top) * ty
    }
  }

  // 叠加微地形并下切河道，使水面与河岸贴合
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col
      const micro = fbm2((col / cols) * 46, (row / rows) * 46, seed + 11, 3)
      elevation[index] += 12 * (micro - 0.5)
    }
  }
  carveRiver(grid, elevation, river, 220, 130)
  computeSlopeAspect(grid)
}

/** 采样 Cesium 世界地形，双线性插值到模拟网格；失败时抛出异常由调用方回退。 */
export async function buildSampledTerrain(
  terrainProvider: TerrainProvider,
  bounds: AreaBounds,
  cols: number,
  rows: number,
  spanMeters: number,
  river: LonLat[],
  seed: number,
  onProgress?: (ratio: number) => void
): Promise<TerrainGrid> {
  const grid: TerrainGrid = {
    ...createGridMeta(bounds, cols, rows, spanMeters),
    elevation: new Float32Array(cols * rows),
    slope: new Float32Array(cols * rows),
    upslope: new Float32Array(cols * rows)
  }
  await sampleTerrainInto(terrainProvider, grid, Math.min(cols, 65), Math.min(rows, 65), river, seed, onProgress)
  return grid
}

export type TerrainResampleMode = 'count' | 'distance'

export type TerrainResampleOptions = {
  /** count = 按每边采样点数；distance = 按采样间距（米） */
  mode: TerrainResampleMode
  value: number
}

export type TerrainResampleResult = {
  sampleCols: number
  sampleRows: number
  /** 实际采样间距（米） */
  spacingMeters: number
}

const RESAMPLE_MIN = 10
const RESAMPLE_MAX = 500
const RESAMPLE_DISTANCE_MIN = 5
const RESAMPLE_DISTANCE_MAX = 500

/** 依据「按数量」或「按距离」参数换算两个方向的采样点数。 */
export function resolveResampleCounts(
  grid: TerrainGrid,
  options: TerrainResampleOptions
): TerrainResampleResult {
  const spanMeters = Math.max(grid.cellMeters * grid.cols, 1)
  let sampleCols: number
  let sampleRows: number
  if (options.mode === 'count') {
    sampleCols = clamp(Math.round(options.value), RESAMPLE_MIN, RESAMPLE_MAX)
    sampleRows = clamp(Math.round((sampleCols * grid.rows) / grid.cols), RESAMPLE_MIN, RESAMPLE_MAX)
  } else {
    const spacing = clamp(options.value, RESAMPLE_DISTANCE_MIN, RESAMPLE_DISTANCE_MAX)
    sampleCols = clamp(Math.round(spanMeters / spacing), RESAMPLE_MIN, RESAMPLE_MAX)
    sampleRows = clamp(
      Math.round((grid.cellMeters * grid.rows) / spacing),
      RESAMPLE_MIN,
      RESAMPLE_MAX
    )
  }
  return {
    sampleCols,
    sampleRows,
    spacingMeters: spanMeters / Math.max(sampleCols - 1, 1)
  }
}

/** 按自定义重采样参数就地更新已有网格的高程、坡度与坡向（保持网格尺寸不变）。 */
export async function resampleTerrainGrid(
  terrainProvider: TerrainProvider,
  grid: TerrainGrid,
  options: TerrainResampleOptions,
  river: LonLat[],
  seed: number,
  onProgress?: (ratio: number) => void
): Promise<TerrainResampleResult> {
  const counts = resolveResampleCounts(grid, options)
  await sampleTerrainInto(terrainProvider, grid, counts.sampleCols, counts.sampleRows, river, seed, onProgress)
  return counts
}
