/**
 * 北斗网格位置码（GB/T 39409-2020）二维网格剖分。
 *
 * 本模块实现标准规定的非极地区域 1~11 级网格尺寸与层次剖分：
 *   1 级 6°×4°（对应 1:100 万图幅）
 *   2 级 3°×2°      3 级 1°×1°       4 级 30′×30′
 *   5 级 15′×10′    6 级 5′×5′       7 级 1′×1′
 *   8 级 12″×12″    9 级 4″×4′       10 级 2″×2″    11 级 1″×1″
 * 网格剖分原点取赤道面与本初子午线交点，各相邻层级均按整数倍等经纬度嵌套，
 * 因此任意经纬度可逐级整除得到行列号。编码采用「半球 + 百万图幅号 + 逐级行列号」
 * 的层次结构，与标准示例 N50J475492E 的组织方式一致（逐级行列号以 36 进制压缩）。
 *
 * 三维网格体（GB/T 39409-2020 三维位置码 / GB/T 40087-2021 高度域）：
 * 标准要求高度方向粒度与赤道处经向粒度一致，以维持单元「近似立方体」特征，
 * 故高度域第 Lh 级的单元厚度 Δh 取该级纬向跨度对应的地面距离；三维单元为
 * 「二维 Lt 级水平单元 × 高度域 Lh 级竖向单元」，从地面向上逐层剖分。
 * 高度域采用标准规定的二进制层次编码：方向位 0 表示地面以上，其后按 Lh 位
 * 由粗到细表示层序号。
 */

export type BeiDouLevelSpec = {
  level: number
  /** 纬度方向网格跨度（度） */
  latDeg: number
  /** 经度方向网格跨度（度） */
  lonDeg: number
  /** 网格尺寸描述 */
  label: string
}

const MINUTE = 1 / 60
const SECOND = 1 / 3600

export const BEIDOU_LEVELS: BeiDouLevelSpec[] = [
  { level: 1, latDeg: 4, lonDeg: 6, label: '6°×4°（1:100万图幅）' },
  { level: 2, latDeg: 2, lonDeg: 3, label: '3°×2°' },
  { level: 3, latDeg: 1, lonDeg: 1, label: '1°×1°' },
  { level: 4, latDeg: 30 * MINUTE, lonDeg: 30 * MINUTE, label: '30′×30′' },
  { level: 5, latDeg: 10 * MINUTE, lonDeg: 15 * MINUTE, label: '15′×10′' },
  { level: 6, latDeg: 5 * MINUTE, lonDeg: 5 * MINUTE, label: '5′×5′' },
  { level: 7, latDeg: 1 * MINUTE, lonDeg: 1 * MINUTE, label: '1′×1′' },
  { level: 8, latDeg: 12 * SECOND, lonDeg: 12 * SECOND, label: '12″×12″' },
  { level: 9, latDeg: 4 * SECOND, lonDeg: 4 * SECOND, label: '4″×4″' },
  { level: 10, latDeg: 2 * SECOND, lonDeg: 2 * SECOND, label: '2″×2″' },
  { level: 11, latDeg: 1 * SECOND, lonDeg: 1 * SECOND, label: '1″×1″' }
]

const METERS_PER_DEG_LAT = 111320
const DEG = Math.PI / 180
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'

export function beidouLevel(level: number): BeiDouLevelSpec {
  const clamped = Math.max(1, Math.min(BEIDOU_LEVELS.length, Math.round(level)))
  return BEIDOU_LEVELS[clamped - 1]
}

/** 高度域第 Lh 级单元厚度（米）：取该级纬向跨度对应的地面距离，保持近立方体单元。 */
export function beidouHeightStep(heightLevel: number): number {
  return beidouLevel(heightLevel).latDeg * METERS_PER_DEG_LAT
}

export type BeiDouHeightSlab = {
  /** 自地面向上的层序号（0 起） */
  index: number
  /** 层底高度（米） */
  base: number
  /** 层顶高度（米） */
  top: number
  /** 层厚（米） */
  thickness: number
  /** 高度域二进制编码（方向位 0=地面以上 + Lh 位层序） */
  code: string
}

/** 高度域二进制层次编码：方向位 0 表示地面以上，其后为 Lh 位由粗到细的层序号。 */
export function beidouHeightCode(index: number, heightLevel: number): string {
  const bits = Math.max(1, Math.min(24, Math.round(heightLevel)))
  const span = 2 ** bits
  const value = ((Math.round(index) % span) + span) % span
  return `0${value.toString(2).padStart(bits, '0')}`
}

/**
 * 依网格体高自动选择高度域层级 Lh：使分层数量接近 targetLayers（默认 3 层）。
 * 使网格体整体高度与水平单元边长接近，呈近正方体，同时保留少量高度分层。
 * 对应标准「按对象高度范围选取能够包含该对象的高度域层级」的取值方式。
 */
export function beidouHeightLevelFor(solidHeight: number, targetLayers = 3): number {
  const height = Math.max(1, solidHeight)
  let best = 1
  let bestErr = Infinity
  for (const spec of BEIDOU_LEVELS) {
    const step = spec.latDeg * METERS_PER_DEG_LAT
    const layers = Math.max(1, Math.ceil(height / step))
    const err = Math.abs(layers - targetLayers)
    if (err < bestErr) {
      bestErr = err
      best = spec.level
    }
  }
  return best
}

/**
 * 生成自地面向上的高度域分层：单层厚度取该级经向粒度，末层为不足一层的余量。
 * 层数受 maxLayers 限制，避免三维体单元数失控。
 */
export function beidouHeightSlabs(heightLevel: number, solidHeight: number, maxLayers = 24): BeiDouHeightSlab[] {
  const step = Math.max(1, beidouHeightStep(heightLevel))
  const total = Math.max(1, Math.ceil(solidHeight / step))
  const count = Math.min(total, Math.max(1, Math.round(maxLayers)))
  const slabs: BeiDouHeightSlab[] = []
  for (let i = 0; i < count; i += 1) {
    const base = i * step
    const top = Math.min(solidHeight, base + step)
    if (top <= base) break
    slabs.push({ index: i, base, top, thickness: top - base, code: beidouHeightCode(i, heightLevel) })
  }
  return slabs
}

export type BeiDouCell = {
  level: number
  row: number
  col: number
  west: number
  south: number
  east: number
  north: number
  centerLon: number
  centerLat: number
  /** 单元边长（米），经度方向按纬度收缩 */
  widthM: number
  heightM: number
  /** 北斗网格位置码 */
  code: string
  /** 用于统计聚合的稳定键 */
  key: string
}

function base36(value: number): string {
  const index = ((value % 36) + 36) % 36
  return BASE36[index]
}

/** 半球 + 1:100 万图幅号（列号 1~60 + 纬度带字母 A~V）。 */
function millionSheet(lon: number, lat: number): string {
  const hemi = lat >= 0 ? 'N' : 'S'
  const band = Math.min(21, Math.floor(Math.abs(lat) / 4))
  const letter = String.fromCharCode(65 + band)
  const col = Math.max(1, Math.min(60, Math.floor((lon + 180) / 6) + 1))
  return `${hemi}${col}${letter}`
}

/**
 * 逐级行列号编码：第 L 级在父级单元内的列/行序号（各以 36 进制单字符表示）。
 * 相邻层级均为整数倍嵌套，故序号 = 全局行列号对父级倍率取模。
 */
export function beidouCode(lon: number, lat: number, level: number): string {
  const spec = beidouLevel(level)
  let code = millionSheet(lon, lat)
  for (let l = 2; l <= spec.level; l += 1) {
    const child = beidouLevel(l)
    const parent = beidouLevel(l - 1)
    const subLon = Math.round(parent.lonDeg / child.lonDeg)
    const subLat = Math.round(parent.latDeg / child.latDeg)
    const col = Math.floor(lon / child.lonDeg)
    const row = Math.floor(lat / child.latDeg)
    code += base36(((col % subLon) + subLon) % subLon) + base36(((row % subLat) + subLat) % subLat)
  }
  return code.toUpperCase()
}

export function cellFromRowCol(level: number, row: number, col: number): BeiDouCell {
  const spec = beidouLevel(level)
  const west = col * spec.lonDeg
  const south = row * spec.latDeg
  const east = west + spec.lonDeg
  const north = south + spec.latDeg
  const centerLon = (west + east) / 2
  const centerLat = (south + north) / 2
  return {
    level: spec.level,
    row,
    col,
    west,
    south,
    east,
    north,
    centerLon,
    centerLat,
    widthM: spec.lonDeg * METERS_PER_DEG_LAT * Math.cos(centerLat * DEG),
    heightM: spec.latDeg * METERS_PER_DEG_LAT,
    code: beidouCode(centerLon, centerLat, level),
    key: `${spec.level}:${row}:${col}`
  }
}

export function cellAt(lon: number, lat: number, level: number): BeiDouCell {
  const spec = beidouLevel(level)
  return cellFromRowCol(spec.level, Math.floor(lat / spec.latDeg), Math.floor(lon / spec.lonDeg))
}

export type AreaRect = { west: number; south: number; east: number; north: number }

/** 枚举覆盖给定范围的该级全部网格单元。 */
export function enumerateCells(bounds: AreaRect, level: number): BeiDouCell[] {
  const spec = beidouLevel(level)
  const colMin = Math.floor(bounds.west / spec.lonDeg)
  const colMax = Math.floor(bounds.east / spec.lonDeg)
  const rowMin = Math.floor(bounds.south / spec.latDeg)
  const rowMax = Math.floor(bounds.north / spec.latDeg)
  const cells: BeiDouCell[] = []
  for (let row = rowMin; row <= rowMax; row += 1) {
    for (let col = colMin; col <= colMax; col += 1) {
      cells.push(cellFromRowCol(spec.level, row, col))
    }
  }
  return cells
}

/** 依据平均格点跨度反查最接近的北斗层级（用于自动剖分/LOD）。 */
export function levelForCellMeters(targetMeters: number, latitude: number): number {
  let best = 1
  let bestErr = Infinity
  for (const spec of BEIDOU_LEVELS) {
    const meters = spec.lonDeg * METERS_PER_DEG_LAT * Math.cos(latitude * DEG)
    const err = Math.abs(Math.log(Math.max(meters, 1e-6)) - Math.log(Math.max(targetMeters, 1e-6)))
    if (err < bestErr) {
      bestErr = err
      best = spec.level
    }
  }
  return best
}
