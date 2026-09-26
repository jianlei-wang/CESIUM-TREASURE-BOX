import type { Feature, FeatureCollection, Polygon } from 'geojson'
import {
  clampNumber,
  normalizeBool,
  normalizeColor,
  type DggsBounds,
  type DggsSettings,
  type DggsSystem,
  type IdentifyRow,
} from '../spec'

/**
 * Tilecode 网格引擎：Web Mercator 四叉树瓦片编码。
 *
 * 该文件由 GeoLibre 的 maplibre-tilecode 插件移植而来，去除了 maplibre-gl
 * 依赖与右侧面板/图层代码，仅保留纯 TypeScript 的网格计算能力。
 */

/** 防止在大视域下使用过深层级导致浏览器卡死。 */
export const TILECODE_VIEWPORT_CELL_LIMIT = 20_000

/** Web Mercator 瓦片层级范围（26 可保证 x/y 仍处于位运算安全区间）。 */
export const MIN_TILECODE_ZOOM = 0
export const MAX_TILECODE_ZOOM = 26

/** 每个瓦片细分为 4 个子单元（四叉树）。 */
export const TILECODE_CHILDREN_PER_CELL = 4

/** Web Mercator 纬度上限；超过该纬度不存在瓦片。 */
const MERCATOR_MAX_LAT = 85.0511287798066

const D2R = Math.PI / 180
const R2D = 180 / Math.PI

/** 插件原始设置类型，保持单数 includeParent 以忠实移植。 */
export interface TilecodeGridSettings {
  /** 由地图缩放推导瓦片层级，而不是使用手动滑杆。 */
  autoResolution: boolean
  /** 瓦片层级（分辨率）：0–26。 */
  resolution: number
  fillColor: string
  fillOpacity: number
  lineColor: string
  lineWidth: number
  showLabels: boolean
  includeNeighbors: boolean
  includeParent: boolean
}

export const DEFAULT_TILECODE_GRID_SETTINGS: TilecodeGridSettings = {
  autoResolution: true,
  // GeoLibre 默认世界视图（zoom 1）下即可用：4 个瓦片铺满 Mercator 世界。
  resolution: 1,
  fillColor: '#0284c7',
  fillOpacity: 0.08,
  lineColor: '#0284c7',
  lineWidth: 1,
  showLabels: true,
  includeNeighbors: false,
  includeParent: false,
}

/** [x, y, z] Web Mercator 瓦片坐标。 */
export type Tile = [number, number, number]

/** 将瓦片格式化为 vgrid-maplibre 的 tilecode ID。 */
export function tileToTilecode([x, y, z]: Tile): string {
  return `z${z}x${x}y${y}`
}

/** 将 tilecode ID 解析回瓦片坐标（非法时返回 null）。 */
export function tilecodeToTile(cell: string): Tile | null {
  const match = /^z(\d+)x(\d+)y(\d+)$/.exec(cell)
  if (!match) return null
  const z = Number(match[1])
  const x = Number(match[2])
  const y = Number(match[3])
  const size = 2 ** z
  return z <= MAX_TILECODE_ZOOM && x < size && y < size ? [x, y, z] : null
}

/** 瓦片的 Bing 风格四叉键（z0 根单元返回空串）。 */
export function tileToQuadkey([x, y, z]: Tile): string {
  let key = ''
  for (let i = z; i > 0; i--) {
    let digit = 0
    const mask = 1 << (i - 1)
    if ((x & mask) !== 0) digit += 1
    if ((y & mask) !== 0) digit += 2
    key += digit.toString()
  }
  return key
}

function tileToLng(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}

function tileToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return R2D * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

/** 点所在瓦片。经度环绕；纬度钳制到 Mercator 范围。 */
export function pointToTile(lat: number, lng: number, z: number): Tile {
  const size = 2 ** z
  const clampedLat = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat))
  const sin = Math.sin(clampedLat * D2R)
  let x = Math.floor(size * (lng / 360 + 0.5))
  x = ((x % size) + size) % size
  const y = Math.min(
    size - 1,
    Math.max(0, Math.floor(size * (0.5 - (0.25 * Math.log((1 + sin) / (1 - sin))) / Math.PI))),
  )
  return [x, y, z]
}

/**
 * 由地图缩放推导瓦片层级的自动规则，对应 vgrid-maplibre 的 TilecodeGrid：
 * 比地图层级细一级，并钳制到支持范围内。
 */
export function tilecodeResolutionForZoom(zoom: number): number {
  return Math.min(MAX_TILECODE_ZOOM, Math.max(MIN_TILECODE_ZOOM, Math.floor(zoom) + 1))
}

/** 忠实移植设置归一化逻辑。 */
export function normalizeTilecodeGridSettings(value: unknown): TilecodeGridSettings {
  const candidate = (value ?? {}) as Partial<TilecodeGridSettings>
  return {
    autoResolution: normalizeBool(
      candidate.autoResolution,
      DEFAULT_TILECODE_GRID_SETTINGS.autoResolution,
    ),
    resolution: Math.round(
      clampNumber(
        candidate.resolution,
        MIN_TILECODE_ZOOM,
        MAX_TILECODE_ZOOM,
        DEFAULT_TILECODE_GRID_SETTINGS.resolution,
      ),
    ),
    fillColor: normalizeColor(candidate.fillColor, DEFAULT_TILECODE_GRID_SETTINGS.fillColor),
    fillOpacity: clampNumber(
      candidate.fillOpacity,
      0,
      1,
      DEFAULT_TILECODE_GRID_SETTINGS.fillOpacity,
    ),
    lineColor: normalizeColor(candidate.lineColor, DEFAULT_TILECODE_GRID_SETTINGS.lineColor),
    lineWidth: clampNumber(candidate.lineWidth, 0.1, 8, DEFAULT_TILECODE_GRID_SETTINGS.lineWidth),
    showLabels: normalizeBool(candidate.showLabels, DEFAULT_TILECODE_GRID_SETTINGS.showLabels),
    includeNeighbors: normalizeBool(
      candidate.includeNeighbors,
      DEFAULT_TILECODE_GRID_SETTINGS.includeNeighbors,
    ),
    includeParent: normalizeBool(
      candidate.includeParent,
      DEFAULT_TILECODE_GRID_SETTINGS.includeParent,
    ),
  }
}

/**
 * 避免全球视图下出现上千个重叠 ID。自动模式下瓦片比地图细一级，标签始终显示；
 * 下限仅对宽视域下的固定细节层级生效。
 */
export function tilecodeLabelMinZoom(resolution: number): number {
  return Math.min(24, Math.max(2, Math.round(resolution) - 1))
}

/** [west, south, east, north]（度）表示的瓦片四至。 */
function tileBounds([x, y, z]: Tile): [number, number, number, number] {
  return [tileToLng(x, z), tileToLat(y + 1, z), tileToLng(x + 1, z), tileToLat(y, z)]
}

/**
 * 将瓦片转换为带导出属性的 GeoJSON 多边形（tilecode 与 quadkey ID，与
 * vgrid-maplibre 一致）。`lngOffset`（360 的整数倍）把环放到跨日期变更线的
 * 视域所在的世界副本中。
 */
export function tilecodeCellFeature(cell: string, lngOffset = 0): Feature<Polygon> {
  const tile = tilecodeToTile(cell)
  if (!tile) throw new Error(`Invalid tilecode: ${cell}`)
  const [west, south, east, north] = tileBounds(tile)
  return {
    type: 'Feature',
    id: cell,
    properties: {
      tilecode: cell,
      quadkey: tileToQuadkey(tile),
      resolution: tile[2],
      center_lat: (south + north) / 2,
      center_lng: (west + east) / 2,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [west + lngOffset, south],
          [east + lngOffset, south],
          [east + lngOffset, north],
          [west + lngOffset, north],
          [west + lngOffset, south],
        ],
      ],
    },
  }
}

/**
 * 用 Web Mercator 瓦片填满 WGS84 包围盒，对应 vgrid-maplibre 的
 * TilecodeGrid。经度可越过 ±180（MapLibre 的连续边界）；瓦片列沿连续范围
 * 行走，每个列在归一化到 [0, 2^z) 后用于 ID，但绘制在视域所在的世界副本。
 */
export function tilecodeGridForBounds(
  bounds: [number, number, number, number],
  resolution: number,
  limit = TILECODE_VIEWPORT_CELL_LIMIT,
): FeatureCollection<Polygon> {
  let [west, south, east, north] = bounds
  south = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, south))
  north = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, north))
  if (east - west >= 360) {
    west = -180
    east = 180 - 1e-9
  }
  const size = 2 ** resolution
  // 未环绕（连续）的瓦片列，使跨日期变更线视域保留其世界副本；行来自纬度范围的
  // Mercator 投影。
  const minColumn = Math.floor(size * (west / 360 + 0.5))
  const maxColumn = Math.floor(size * (east / 360 + 0.5))
  const [, minRow] = pointToTile(north, 0, resolution)
  const [, maxRow] = pointToTile(south, 0, resolution)

  if ((maxColumn - minColumn + 1) * (maxRow - minRow + 1) > limit * 1.2) {
    throw new RangeError(`Tilecode tile limit exceeded: ${limit}`)
  }

  const features: Feature<Polygon>[] = []
  for (let column = minColumn; column <= maxColumn; column++) {
    const x = ((column % size) + size) % size
    const lngOffset = ((column - x) / size) * 360
    for (let y = minRow; y <= maxRow; y++) {
      features.push(tilecodeCellFeature(tileToTilecode([x, y, resolution]), lngOffset))
      if (features.length > limit) {
        throw new RangeError(`Tilecode tile limit exceeded: ${limit}`)
      }
    }
  }
  return { type: 'FeatureCollection', features }
}

/** 瓦片构成严格四叉树，每个瓦片恰有一个父级（z0 根单元返回 null）。 */
export function tilecodeParentCell(cell: string): string | null {
  const tile = tilecodeToTile(cell)
  if (!tile || tile[2] <= MIN_TILECODE_ZOOM) return null
  return tileToTilecode([tile[0] >> 1, tile[1] >> 1, tile[2] - 1])
}

/**
 * 瓦片自身及其（最多 4 个）边邻域（N/S/E/W），不含对角。x 轴环绕世界，
 * y 轴在 Mercator 顶部与底部行处裁剪。
 */
export function tilecodeNeighborCells(cell: string): string[] {
  const tile = tilecodeToTile(cell)
  if (!tile) return [cell]
  const [x, y, z] = tile
  const size = 2 ** z
  const ids = new Set<string>([cell])
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    const ny = y + dy
    if (ny < 0 || ny >= size) continue
    const nx = (((x + dx) % size) + size) % size
    ids.add(tileToTilecode([nx, ny, z]))
  }
  return [...ids]
}

/** 把插件单数 includeParent 的设置映射为 DggsSettings 的 includeParents。 */
function toDggsSettings(settings: TilecodeGridSettings): DggsSettings {
  const { includeParent, ...rest } = settings
  return { ...rest, includeParents: includeParent }
}

/** DggsSettings（复数键）还原为插件单数键，以复用忠实移植的归一化逻辑。 */
function fromDggsSettingsRaw(value: unknown): unknown {
  const raw = (value ?? {}) as Record<string, unknown>
  return { ...raw, includeParent: raw.includeParent ?? raw.includeParents }
}

export const system: DggsSystem = {
  id: 'dggs-tilecode',
  title: 'Tilecode 网格',
  english: 'Tilecode Grid',
  subtitle: 'Web Mercator 四叉树瓦片编码',
  description:
    '基于 Web Mercator 瓦片的四叉树离散网格，使用 z/x/y 瓦片编码（tilecode）与四叉键标识单元。',
  tag: '瓦片四叉树',
  accentColor: '#db2777',

  defaults: toDggsSettings(DEFAULT_TILECODE_GRID_SETTINGS),
  normalize: (value: unknown) =>
    toDggsSettings(normalizeTilecodeGridSettings(fromDggsSettingsRaw(value))),

  minResolution: MIN_TILECODE_ZOOM,
  maxResolution: MAX_TILECODE_ZOOM,
  resolutionName: '瓦片层级',

  resolutionForZoom: (zoom: number) => tilecodeResolutionForZoom(zoom),
  labelMinZoom: (resolution: number) => tilecodeLabelMinZoom(resolution),

  cellAt: (lon: number, lat: number, resolution: number) =>
    tileToTilecode(pointToTile(lat, lon, resolution)),

  buildGrid: (bounds: DggsBounds, resolution: number) =>
    tilecodeGridForBounds([bounds.west, bounds.south, bounds.east, bounds.north], resolution),

  cellFeature: (id: string) => tilecodeCellFeature(id),

  parentIds: (id: string) => [tilecodeParentCell(id)].filter((value): value is string => !!value),
  neighborIds: (id: string) => tilecodeNeighborCells(id).filter((n) => n !== id),
  childCount: () => TILECODE_CHILDREN_PER_CELL,

  identify: (id: string): IdentifyRow[] => {
    const tile = tilecodeToTile(id)
    if (!tile) return []
    const [west, south, east, north] = tileBounds(tile)
    const rows: IdentifyRow[] = [
      { label: 'ID', value: id },
      { label: '四叉键', value: tileToQuadkey(tile) || '—' },
      { label: '瓦片层级', value: String(tile[2]) },
      { label: '中心', value: `${((south + north) / 2).toFixed(6)}, ${((west + east) / 2).toFixed(6)}` },
    ]
    const parent = tilecodeParentCell(id)
    if (parent) rows.push({ label: '父级', value: parent })
    if (tile[2] < MAX_TILECODE_ZOOM) {
      rows.push({ label: '子级', value: String(TILECODE_CHILDREN_PER_CELL) })
    }
    rows.push({ label: '邻域', value: String(tilecodeNeighborCells(id).length - 1) })
    return rows
  },
  parentLabel: '父级',

  exportName: 'tilecode-grid',
  csvColumns: ['tilecode', 'quadkey', 'resolution', 'center_lat', 'center_lng'],
  csvRow: (feature: Feature<Polygon>) => {
    const p = (feature.properties ?? {}) as {
      tilecode?: string
      quadkey?: string
      resolution?: number
      center_lat?: number
      center_lng?: number
    }
    return [
      p.tilecode ?? '',
      p.quadkey ?? '',
      p.resolution ?? 0,
      p.center_lat ?? 0,
      p.center_lng ?? 0,
    ]
  },

  statusNote: (_settings: DggsSettings, resolution: number) =>
    `层级 ${resolution} · Web Mercator 四叉树`,
}
