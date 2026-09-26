import type { AirspaceZone, AreaBounds, GridCell, GridState, Obstacle } from './types'
import { createPrng, pointInRing } from './util'

/**
 * 北斗网格（GB/T 39409 思路）简化实现：
 * 以度/分/秒逐级四分的方式给出网格边长，用于低空场景网格化表达。
 * level 15=1′、16=32″、17=16″、18=8″、19=4″、20=2″、21=1″。
 */
const LEVEL_SECONDS: Record<number, number> = {
  15: 60,
  16: 32,
  17: 16,
  18: 8,
  19: 4,
  20: 2,
  21: 1
}

export const GRID_LEVEL_MIN = 15
export const GRID_LEVEL_MAX = 19
export const GRID_LEVEL_OPTIONS = [15, 16, 17, 18, 19]

export function cellDegrees(level: number): number {
  const seconds = LEVEL_SECONDS[level] ?? LEVEL_SECONDS[GRID_LEVEL_MAX]
  return seconds / 3600
}

export function cellSizeMeters(level: number): number {
  return cellDegrees(level) * 111320
}

/** 位交错得到类 Morton 的行列编码，作为网格码的一部分。 */
function morton(row: number, col: number): string {
  let code = ''
  for (let i = 0; i < 16; i += 1) {
    const r = (row >> i) & 1
    const c = (col >> i) & 1
    code = `${r}${c}${code}`
  }
  return BigInt(`0b${code || '0'}`).toString(10).padStart(8, '0')
}

export function geosotCode(level: number, row: number, col: number, altLayer: number): string {
  return `BDG${level}-${morton(row, col)}-L${altLayer}`
}

/** 计算单元格中心所在高度层的层号（60m 一层，自 0m 起）。 */
export function altLayerOf(alt: number): number {
  return Math.max(0, Math.floor(alt / 60))
}

function classify(
  center: { lon: number; lat: number },
  airspaces: AirspaceZone[],
  obstacles: Obstacle[]
): { state: GridState; value: number; density: number } {
  let state: GridState = 'free'
  for (const zone of airspaces) {
    if (!zone.active) continue
    const hit =
      zone.shape === 'polygon'
        ? pointInRing(center, zone.ring)
        : Math.hypot(center.lon - zone.center.lon, center.lat - zone.center.lat) * 111320 <= zone.radius
    if (!hit) continue
    if (zone.type === 'forbid') state = 'forbid'
    else if (zone.type === 'restrict' && state !== 'forbid') state = 'restrict'
  }
  let density = 0
  let value = 0
  for (const obstacle of obstacles) {
    if (
      center.lon >= obstacle.west &&
      center.lon <= obstacle.east &&
      center.lat >= obstacle.south &&
      center.lat <= obstacle.north
    ) {
      density += 0.35
      value += obstacle.height
    }
  }
  density = Math.min(1, density)
  return { state, value: Math.round(value), density }
}

export type BuildGridOptions = {
  bounds: AreaBounds
  level: number
  altMin: number
  altMax: number
  airspaces: AirspaceZone[]
  obstacles: Obstacle[]
  seed: number
}

/** 按四至与层级生成网格单元集合。 */
export function buildGrid(options: BuildGridOptions): GridCell[] {
  const { bounds, level, altMin, altMax, airspaces, obstacles, seed } = options
  const step = cellDegrees(level)
  const cols = Math.max(1, Math.ceil((bounds.east - bounds.west) / step))
  const rows = Math.max(1, Math.ceil((bounds.north - bounds.south) / step))
  const prng = createPrng(seed + level)
  const altLayer = altLayerOf((altMin + altMax) / 2)
  const cells: GridCell[] = []
  const colStart = Math.floor(bounds.west / step)
  const rowStart = Math.floor(bounds.south / step)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const west = (colStart + col) * step
      const south = (rowStart + row) * step
      const east = west + step
      const north = south + step
      const centerLon = (west + east) / 2
      const centerLat = (south + north) / 2
      const cls = classify({ lon: centerLon, lat: centerLat }, airspaces, obstacles)
      const jitter = prng()
      const used = cls.state === 'free' && jitter > 0.62
      cells.push({
        id: `${row}-${col}`,
        code: geosotCode(level, rowStart + row, colStart + col, altLayer),
        level,
        row,
        col,
        west,
        south,
        east,
        north,
        centerLon,
        centerLat,
        state: used ? 'used' : cls.state,
        altMin,
        altMax,
        density: cls.density,
        value: cls.value > 0 ? cls.value : Math.round(30 + jitter * 90)
      })
    }
  }
  return cells
}

export const GRID_STATE_META: Record<GridState, { label: string; color: string; css: string }> = {
  free: { label: '适飞', color: '#2ecc71', css: '#2ecc71' },
  used: { label: '占用', color: '#f39c12', css: '#f39c12' },
  restrict: { label: '限飞', color: '#f1c40f', css: '#f1c40f' },
  forbid: { label: '禁飞', color: '#e74c3c', css: '#e74c3c' }
}

/** 数值分级色带（单值/分级/热力/点云共用）。 */
export const VALUE_RAMP = ['#123c69', '#1f6fb2', '#38bdf8', '#7dd3fc', '#facc15', '#fb923c', '#ef4444']

export function rampColor(t: number): string {
  const clamped = Math.min(0.999, Math.max(0, t))
  return VALUE_RAMP[Math.floor(clamped * VALUE_RAMP.length)]
}
