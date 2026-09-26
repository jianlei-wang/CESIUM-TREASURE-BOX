import type { Feature, FeatureCollection, Polygon } from 'geojson'
import { geojson as s2geojson, s1, s2 } from 's2js'
import {
  normalizeColor,
  normalizeBool,
  clampNumber,
  VIEWPORT_CELL_LIMIT,
  type DggsSystem,
  type DggsSettings,
  type DggsBounds,
} from '../spec'

/** S2 最细层级（叶子单元）。 */
const MAX_S2_LEVEL = 30

/**
 * s2js 的 GeoJSON 覆盖器要求经度落在 [-180, 180]，且环跨度超过 180° 时内外判定有歧义，
 * 因此先把经度范围切成不超过该跨度的分块，再分别覆盖。
 */
const MAX_COVER_SPAN_DEGREES = 120

/** 地球平均面积（平方米），用于按层级估算单元数量。 */
const EARTH_AREA_M2 = 4 * Math.PI * 6371008.8 ** 2

/** 导出属性结构。 */
type S2FeatureProperties = {
  s2: string
  resolution: number
  center_lat: number
  center_lng: number
}

/** S2 网格默认配置。 */
const DEFAULT_S2_GRID_SETTINGS: DggsSettings = {
  autoResolution: true,
  resolution: 4,
  fillColor: '#2563eb',
  fillOpacity: 0.08,
  lineColor: '#2563eb',
  lineWidth: 1,
  showLabels: true,
  includeNeighbors: false,
  includeParents: false,
}

/** token 转大整数单元 ID。 */
function cellIdFromToken(token: string): bigint {
  return s2.cellid.fromToken(token)
}

/** 单元中心，返回 [经度, 纬度]（度）。 */
function cellCenter(id: bigint): [number, number] {
  const latLng = s2.cellid.latLng(id)
  return [s1.angle.degrees(latLng.lng), s1.angle.degrees(latLng.lat)]
}

/** 经纬度所在单元在指定层级的 token。 */
function cellAtLonLat(lng: number, lat: number, level: number): string {
  const leaf = s2.cellid.fromLatLng(s2.LatLng.fromDegrees(lat, lng))
  return s2.cellid.toToken(s2.cellid.parent(leaf, level))
}

/**
 * 单元四角构成的闭合经纬环。跨 180° 经线的单元相对首顶点展开，
 * 使环保持连续，渲染时落到相邻的世界副本。
 */
function cellRing(id: bigint): [number, number][] {
  const cell = s2.Cell.fromCellID(id)
  const ring: [number, number][] = []
  for (let i = 0; i <= 4; i += 1) {
    const vertex = s2.LatLng.fromPoint(cell.vertex(i % 4))
    let lng = s1.angle.degrees(vertex.lng)
    const lat = s1.angle.degrees(vertex.lat)
    if (ring.length > 0) {
      const reference = ring[0][0]
      if (lng - reference > 180) lng -= 360
      if (lng - reference < -180) lng += 360
    }
    ring.push([lng, lat])
  }
  return ring
}

/** 将 S2 单元（token）转换为带导出属性的 GeoJSON 多边形。 */
function s2CellFeature(cell: string): Feature<Polygon> {
  const id = cellIdFromToken(cell)
  const [lng, lat] = cellCenter(id)
  return {
    type: 'Feature',
    id: cell,
    properties: {
      s2: cell,
      // S2 内部称 level，导出为 resolution 以与 H3/A5 保持列名一致。
      resolution: s2.cellid.level(id),
      center_lat: lat,
      center_lng: lng,
    },
    geometry: { type: 'Polygon', coordinates: [cellRing(id)] },
  }
}

/** 自动层级规则：缩放每加一级对应一个 S2 层级，并夹取到合法范围。 */
function s2LevelForZoom(zoom: number): number {
  return Math.min(MAX_S2_LEVEL, Math.max(0, Math.floor(zoom)))
}

/** 标签最小缩放：避免全球视图下数千个 ID 相互重叠。 */
function s2LabelMinZoom(level: number): number {
  return Math.min(18, Math.max(2, Math.round(level) + 1))
}

/** 平均单元面积：6 个 0 级面，每层四分。 */
function avgCellAreaM2(level: number): number {
  return EARTH_AREA_M2 / (6 * 4 ** level)
}

/** 用一个层级的 S2 单元填充 WGS84 视域；超出上限时抛出 RangeError。 */
function s2GridForBounds(
  bounds: [number, number, number, number],
  level: number,
  limit = VIEWPORT_CELL_LIMIT,
): FeatureCollection<Polygon> {
  const [west, southRaw, east, northRaw] = bounds
  const south = Math.max(-89.999999, Math.min(89.999999, southRaw))
  const north = Math.max(-89.999999, Math.min(89.999999, northRaw))
  const span = Math.min(360, east >= west ? east - west : east + 360 - west)
  // 先做粗略球面矩形估算，提前拒绝明显超限的请求；精确硬上限在覆盖循环中兜底。
  const radians = Math.PI / 180
  const areaM2 =
    6371008.8 ** 2 * span * radians * Math.abs(Math.sin(north * radians) - Math.sin(south * radians))
  if (areaM2 / avgCellAreaM2(level) > limit * 1.2) {
    throw new RangeError(`S2 cell limit exceeded: ${limit}`)
  }

  // 把西边归一化到 [-180, 180)，再按经度切块；跨 180° 的视域会拆成结束于 180
  // 和起始于 -180 的两块。
  const chunks: Array<[number, number]> = []
  let cursor = (((west % 360) + 540) % 360) - 180
  let remaining = span
  while (remaining > 1e-9) {
    const step = Math.min(remaining, MAX_COVER_SPAN_DEGREES, 180 - cursor)
    chunks.push([cursor, cursor + step])
    cursor = cursor + step >= 180 ? -180 : cursor + step
    remaining -= step
  }

  const coverer = new s2geojson.RegionCoverer({ minLevel: level, maxLevel: level })
  const cells = new Set<string>()
  for (const [left, right] of chunks) {
    const polygon: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [left, south],
          [right, south],
          [right, north],
          [left, north],
          [left, south],
        ],
      ],
    }
    for (const id of coverer.covering(polygon)) {
      cells.add(s2.cellid.toToken(id))
      if (cells.size > limit) {
        throw new RangeError(`S2 cell limit exceeded: ${limit}`)
      }
    }
  }
  return {
    type: 'FeatureCollection',
    features: [...cells].map(s2CellFeature),
  }
}

/** 仅边邻域，不含顶点邻域。 */
function neighborCells(cell: string): string[] {
  const id = cellIdFromToken(cell)
  return s2.cellid.edgeNeighbors(id).map((neighbor) => s2.cellid.toToken(neighbor))
}

/** 直接父级；0 级面单元无父级。 */
function parentCells(cell: string): string[] {
  const id = cellIdFromToken(cell)
  const level = s2.cellid.level(id)
  return level > 0 ? [s2.cellid.toToken(s2.cellid.parent(id, level - 1))] : []
}

/** 归一化持久化配置，行为与插件一致。 */
function normalizeS2GridSettings(value: unknown): DggsSettings {
  const candidate = (value ?? {}) as Partial<DggsSettings>
  return {
    autoResolution: normalizeBool(
      candidate.autoResolution,
      DEFAULT_S2_GRID_SETTINGS.autoResolution,
    ),
    resolution: Math.round(
      clampNumber(candidate.resolution, 0, MAX_S2_LEVEL, DEFAULT_S2_GRID_SETTINGS.resolution),
    ),
    fillColor: normalizeColor(candidate.fillColor, DEFAULT_S2_GRID_SETTINGS.fillColor),
    fillOpacity: clampNumber(candidate.fillOpacity, 0, 1, DEFAULT_S2_GRID_SETTINGS.fillOpacity),
    lineColor: normalizeColor(candidate.lineColor, DEFAULT_S2_GRID_SETTINGS.lineColor),
    lineWidth: clampNumber(candidate.lineWidth, 0.1, 8, DEFAULT_S2_GRID_SETTINGS.lineWidth),
    showLabels: normalizeBool(candidate.showLabels, DEFAULT_S2_GRID_SETTINGS.showLabels),
    includeNeighbors: normalizeBool(
      candidate.includeNeighbors,
      DEFAULT_S2_GRID_SETTINGS.includeNeighbors,
    ),
    includeParents: normalizeBool(
      candidate.includeParents,
      DEFAULT_S2_GRID_SETTINGS.includeParents,
    ),
  }
}

export const system: DggsSystem = {
  id: 'dggs-s2',
  title: 'S2 网格',
  english: 'S2 Grid',
  subtitle: '球面四边形网格 · Hilbert 曲线',
  description: 'S2 Geometry 将球面递归四分为 30 层四边形单元，并按 Hilbert 曲线编码。',
  tag: 'S2',
  accentColor: '#2563eb',

  defaults: { ...DEFAULT_S2_GRID_SETTINGS },
  normalize: normalizeS2GridSettings,

  minResolution: 0,
  maxResolution: MAX_S2_LEVEL,
  resolutionName: '层级',

  resolutionForZoom: (zoom) => s2LevelForZoom(zoom),
  labelMinZoom: (resolution) => s2LabelMinZoom(resolution),

  cellAt: (lon, lat, resolution) => cellAtLonLat(lon, lat, resolution),
  // 让 RangeError 冒泡到外壳，由其根据 statusNote 展示「单元过多」提示。
  buildGrid: (bounds: DggsBounds, resolution) =>
    s2GridForBounds([bounds.west, bounds.south, bounds.east, bounds.north], resolution),
  cellFeature: (id) => s2CellFeature(id),
  parentIds: (id) => parentCells(id),
  neighborIds: (id) => neighborCells(id),
  childCount: (id) => s2.cellid.children(cellIdFromToken(id)).length,
  identify: (id) => {
    const cellId = cellIdFromToken(id)
    const level = s2.cellid.level(cellId)
    const [lng, lat] = cellCenter(cellId)
    const rows = [
      { label: 'ID', value: id },
      { label: '层级', value: String(level) },
      { label: '中心', value: `${lat.toFixed(6)}, ${lng.toFixed(6)}` },
    ]
    if (level > 0) {
      rows.push({ label: '父级', value: s2.cellid.toToken(s2.cellid.parent(cellId, level - 1)) })
    }
    if (level < MAX_S2_LEVEL) {
      rows.push({ label: '子级', value: String(s2.cellid.children(cellId).length) })
    }
    rows.push({ label: '邻域', value: String(neighborCells(id).length) })
    return rows
  },
  parentLabel: '父级',

  exportName: 's2-grid',
  csvColumns: ['s2', 'resolution', 'center_lat', 'center_lng'],
  csvRow: (feature) => {
    const p = (feature.properties ?? {}) as S2FeatureProperties
    return [p.s2, p.resolution, p.center_lat, p.center_lng]
  },

  statusNote: (_settings, resolution) => `层级 ${resolution} · 球面四边形（Hilbert 曲线）`,
}
