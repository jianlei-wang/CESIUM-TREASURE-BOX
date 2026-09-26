import type { Feature, FeatureCollection, Polygon } from 'geojson'
import geohash from 'ngeohash'
import type { DggsBounds, DggsSettings, DggsSystem, IdentifyRow } from '../spec'
import { clampNumber, normalizeBool, normalizeColor } from '../spec'

/** Geohash 字符精度：每增加一位，经纬度各增加 5 bit。 */
export const MIN_GEOHASH_PRECISION = 1
export const MAX_GEOHASH_PRECISION = 12

/** 每个 Geohash 单元细分为 32 个子单元（Base32 字母表）。 */
export const GEOHASH_CHILDREN_PER_CELL = 32

/** 系统默认配置；原插件的 singular 键 `includeParent` 在此映射为复数键 `includeParents`。 */
export const DEFAULT_GEOHASH_GRID_SETTINGS: DggsSettings = {
  autoResolution: true,
  resolution: 1,
  fillColor: '#7c3aed',
  fillOpacity: 0.08,
  lineColor: '#7c3aed',
  lineWidth: 1,
  showLabels: true,
  includeNeighbors: false,
  includeParents: false,
}

export type GeohashGridSettings = DggsSettings & { includeParent?: unknown }

/**
 * 自动缩放→精度规则，对齐 vgrid-maplibre 的 GeohashGrid：`floor(zoom * 0.45)`，
 * 并夹取到可用精度范围。vgrid 的发布版从 0 起夹取，但精度 0 不是合法 Geohash，
 * 因此把下界提高到 1。
 */
export function geohashResolutionForZoom(zoom: number): number {
  return Math.min(MAX_GEOHASH_PRECISION, Math.max(MIN_GEOHASH_PRECISION, Math.floor(zoom * 0.45)))
}

/** 忠实移植原插件的设置归一化逻辑：非法值回落到默认值。 */
export function normalizeGeohashGridSettings(value: unknown): DggsSettings {
  const candidate = (value ?? {}) as Partial<GeohashGridSettings>
  return {
    autoResolution: normalizeBool(
      candidate.autoResolution,
      DEFAULT_GEOHASH_GRID_SETTINGS.autoResolution,
    ),
    resolution: Math.round(
      clampNumber(
        candidate.resolution,
        MIN_GEOHASH_PRECISION,
        MAX_GEOHASH_PRECISION,
        DEFAULT_GEOHASH_GRID_SETTINGS.resolution,
      ),
    ),
    fillColor: normalizeColor(candidate.fillColor, DEFAULT_GEOHASH_GRID_SETTINGS.fillColor),
    fillOpacity: clampNumber(
      candidate.fillOpacity,
      0,
      1,
      DEFAULT_GEOHASH_GRID_SETTINGS.fillOpacity,
    ),
    lineColor: normalizeColor(candidate.lineColor, DEFAULT_GEOHASH_GRID_SETTINGS.lineColor),
    lineWidth: clampNumber(candidate.lineWidth, 0.1, 8, DEFAULT_GEOHASH_GRID_SETTINGS.lineWidth),
    showLabels: normalizeBool(candidate.showLabels, DEFAULT_GEOHASH_GRID_SETTINGS.showLabels),
    includeNeighbors: normalizeBool(
      candidate.includeNeighbors,
      DEFAULT_GEOHASH_GRID_SETTINGS.includeNeighbors,
    ),
    // 兼容旧键 includeParent 与新键 includeParents。
    includeParents: normalizeBool(
      candidate.includeParents ?? candidate.includeParent,
      DEFAULT_GEOHASH_GRID_SETTINGS.includeParents,
    ),
  }
}

/**
 * 全局视角下避免上千个标签重叠。精度大约每 2¼ 个缩放级增长一次（`1 / 0.45`），
 * 因此标签比“选择下一更细精度”的缩放低约一级出现。
 */
export function geohashLabelMinZoom(precision: number): number {
  return Math.min(22, Math.max(2, Math.round(precision / 0.45) - 1))
}

/** 把经度包裹到 (−180, 180]，使 ngeohash 的夹取编码结果有确定含义。 */
function wrapLongitude(lng: number): number {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180
  // MapLibre 的连续世界把 180 作为基准副本的东边缘；ngeohash 把 180 视为同一
  // 单元的西边缘，因此统一保留 −180。
  return wrapped === -180 ? -180 : wrapped === 180 ? -180 : wrapped
}

/**
 * 把 Geohash 转为带导出属性的 GeoJSON 多边形。`lngOffset`（360 的倍数）把环放到
 * 跨 180° 视域真正观察到的世界副本中——ngeohash 始终返回归一化到 (−180, 180] 的经度。
 */
export function geohashCellFeature(cell: string, lngOffset = 0): Feature<Polygon> {
  const [south, west, north, east] = geohash.decode_bbox(cell)
  const { latitude, longitude } = geohash.decode(cell)
  return {
    type: 'Feature',
    id: cell,
    properties: {
      geohash: cell,
      resolution: cell.length,
      center_lat: latitude,
      center_lng: longitude,
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
 * 用 Geohash 单元铺满 WGS84 视域，对齐 vgrid-maplibre 的 GeohashGrid：单元是轴对齐的
 * 经纬网格，因此填充遍历与包围盒相交的行列。经度可越过 ±180（MapLibre 的连续边界）；
 * 每个单元由其包裹后的质心编码，但绘制在视域所在的世界副本中。
 */
export function geohashGridForBounds(
  bounds: [number, number, number, number],
  precision: number,
  limit = 20_000,
): FeatureCollection<Polygon> {
  let [west, south, east, north] = bounds
  south = Math.max(-90, Math.min(90, south))
  north = Math.max(-90, Math.min(90, north))
  if (east - west >= 360) {
    west = -180
    east = 180
  }
  // 奇偶精度会交换哪条轴获得额外 bit，因此从参考单元测量两个维度，而非硬编码表。
  const [refSouth, refWest, refNorth, refEast] = geohash.decode_bbox(geohash.encode(0, 0, precision))
  const latHeight = refNorth - refSouth
  const lngWidth = refEast - refWest

  if (((east - west) / lngWidth) * ((north - south) / latHeight) > limit * 1.2) {
    throw new RangeError(`Geohash cell limit exceeded: ${limit}`)
  }

  const startLng = Math.floor((west + 180) / lngWidth) * lngWidth - 180
  const startLat = Math.max(-90, Math.floor((south + 90) / latHeight) * latHeight - 90)

  const features: Feature<Polygon>[] = []
  // 浮点遍历可能在单元边界附近两次落到同一单元；以 (id, 世界副本) 为键去重，
  // 使跨 180° 视域仍能在相邻副本中绘制同一 hash。
  const seen = new Set<string>()
  for (let lng = startLng; lng < east; lng += lngWidth) {
    for (let lat = startLat; lat < north && lat < 90; lat += latHeight) {
      const centerLng = lng + lngWidth / 2
      const centerLat = lat + latHeight / 2
      const cell = geohash.encode(centerLat, wrapLongitude(centerLng), precision)
      const [, cellWest, , cellEast] = geohash.decode_bbox(cell)
      const lngOffset = Math.round((centerLng - (cellWest + cellEast) / 2) / 360) * 360
      const key = `${cell}@${lngOffset}`
      if (seen.has(key)) continue
      seen.add(key)
      features.push(geohashCellFeature(cell, lngOffset))
      if (features.length > limit) {
        throw new RangeError(`Geohash cell limit exceeded: ${limit}`)
      }
    }
  }
  return { type: 'FeatureCollection', features }
}

/**
 * Geohash 是严格嵌套网格，每个单元恰有一个父级：去掉末位字符后的 hash。
 */
export function geohashParentCell(cell: string): string | null {
  return cell.length > MIN_GEOHASH_PRECISION ? cell.slice(0, -1) : null
}

/**
 * 单元及其（最多 4 个）边邻域，通过 `ngeohash.neighbor`
 * ([1,0]/[-1,0]/[0,1]/[0,-1] = 北/南/东/西)。`neighbors` 的斜角邻域被排除。
 */
export function geohashNeighborCells(cell: string): string[] {
  return [
    ...new Set([
      cell,
      geohash.neighbor(cell, [1, 0]),
      geohash.neighbor(cell, [-1, 0]),
      geohash.neighbor(cell, [0, 1]),
      geohash.neighbor(cell, [0, -1]),
    ]),
  ]
}

function geohashNeighborCount(cell: string): number {
  return geohashNeighborCells(cell).filter((neighbor) => neighbor !== cell).length
}

/** 从要素属性中读取导出字段，缺省时给出稳定回退值。 */
function geohashProperties(
  feature: Feature<Polygon>,
): { geohash: string; resolution: number; center_lat: number; center_lng: number } {
  const properties = (feature.properties ?? {}) as {
    geohash?: string
    resolution?: number
    center_lat?: number
    center_lng?: number
  }
  return {
    geohash: properties.geohash ?? '',
    resolution: properties.resolution ?? 0,
    center_lat: properties.center_lat ?? 0,
    center_lng: properties.center_lng ?? 0,
  }
}

export const system: DggsSystem = {
  id: 'dggs-geohash',
  title: 'Geohash 网格',
  english: 'Geohash Grid',
  subtitle: '基于 Base32 编码的层级地理网格',
  description:
    'Geohash 将经纬度编码为 Base32 字符串，末位每增加一个字符，父单元即细分为 32 个子单元，形成沿 Z 阶曲线排列的层级网格。',
  tag: 'Geohash',
  accentColor: '#0d9488',

  defaults: DEFAULT_GEOHASH_GRID_SETTINGS,
  normalize: normalizeGeohashGridSettings,

  minResolution: MIN_GEOHASH_PRECISION,
  maxResolution: MAX_GEOHASH_PRECISION,
  resolutionName: '精度',

  resolutionForZoom: (zoom) => geohashResolutionForZoom(zoom),
  labelMinZoom: (resolution) => geohashLabelMinZoom(resolution),

  cellAt: (lon, lat, resolution, _settings) => geohash.encode(lat, lon, resolution),
  buildGrid: (bounds: DggsBounds, resolution: number, _settings: DggsSettings) =>
    geohashGridForBounds([bounds.west, bounds.south, bounds.east, bounds.north], resolution),
  cellFeature: (id, _settings) => geohashCellFeature(id),
  parentIds: (id, _settings) =>
    [geohashParentCell(id)].filter((cell): cell is string => cell !== null),
  neighborIds: (id, _settings) => geohashNeighborCells(id).filter((neighbor) => neighbor !== id),
  childCount: (_id, _settings) => GEOHASH_CHILDREN_PER_CELL,
  identify: (id: string, _settings: DggsSettings, _feature: Feature<Polygon>): IdentifyRow[] => {
    const { latitude, longitude } = geohash.decode(id)
    const rows: IdentifyRow[] = [
      { label: 'ID', value: id },
      { label: '精度', value: String(id.length) },
      { label: '中心', value: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` },
    ]
    const parent = geohashParentCell(id)
    if (parent) rows.push({ label: '父级', value: parent })
    if (id.length < MAX_GEOHASH_PRECISION) {
      rows.push({ label: '子级', value: String(GEOHASH_CHILDREN_PER_CELL) })
    }
    rows.push({ label: '邻域', value: String(geohashNeighborCount(id)) })
    return rows
  },
  parentLabel: '父级',

  exportName: 'geohash-grid',
  csvColumns: ['geohash', 'resolution', 'center_lat', 'center_lng'],
  csvRow: (feature) => {
    const p = geohashProperties(feature)
    return [p.geohash, p.resolution, p.center_lat, p.center_lng]
  },

  statusNote: (_settings, resolution) => `精度 ${resolution} · Base32（Z 阶曲线）`,
}
