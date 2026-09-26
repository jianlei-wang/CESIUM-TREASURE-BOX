import type { Feature, FeatureCollection, Polygon } from 'geojson'
import {
  cellToBoundary,
  cellToChildren,
  cellToLatLng,
  cellToParent,
  getBaseCellNumber,
  getHexagonAreaAvg,
  getResolution,
  gridDisk,
  isPentagon,
  latLngToCell,
  polygonToCells
} from 'h3-js'
import {
  normalizeColor,
  normalizeBool,
  clampNumber,
  VIEWPORT_CELL_LIMIT,
  type DggsSystem,
  type DggsSettings,
  type DggsBounds
} from '../spec'

/** H3 最细分辨率。 */
const MAX_H3_RESOLUTION = 15

/**
 * H3 投影所依据的二十面体，以加密大圆边线的 GeoJSON 描述。插件首次添加图层时由
 * MapLibre 拉取；离线时叠加层保持为空。
 */
const ICOSAHEDRON_GEOJSON_URL =
  'https://raw.githubusercontent.com/opengeoshub/vgrid-maplibre/main/H3/icosahedron.geojson'

type H3FeatureProperties = {
  h3: string
  resolution: number
  base_cell: number
  center_lat: number
  center_lng: number
  is_pentagon: boolean
}

const DEFAULT_H3_GRID_SETTINGS: DggsSettings = {
  autoResolution: true,
  resolution: 2,
  fillColor: '#2563eb',
  fillOpacity: 0.08,
  lineColor: '#2563eb',
  lineWidth: 1,
  showLabels: true,
  includeNeighbors: false,
  includeParents: false,
  showIcosahedron: false
}

let icosahedron: FeatureCollection<Polygon> | null = null
let icosahedronPromise: Promise<void> | null = null

/** 拉取并缓存二十面体叠加层；失败时静默保持为空。 */
function ensureIcosahedron(): Promise<void> {
  icosahedronPromise ??= fetch(ICOSAHEDRON_GEOJSON_URL)
    .then(async (response) => {
      if (!response.ok) return
      icosahedron = (await response.json()) as FeatureCollection<Polygon>
    })
    .catch(() => {
      icosahedronPromise = null
    })
  return icosahedronPromise
}

/**
 * 保持跨 180° 经线单元边界的连续性：当环上出现小于 -130° 的顶点时，把所有正
 * 经度下移 360°，使环围绕 -180° 连续。
 */
function fixTransmeridianBoundary(ring: [number, number][]): [number, number][] {
  if (!ring.some(([longitude]) => longitude < -130)) return ring
  return ring.map(([longitude, latitude]) =>
    longitude > 0 ? [longitude - 360, latitude] : [longitude, latitude]
  )
}

/** 单元中心，返回 [经度, 纬度]（度）。 */
function cellCenter(cell: string): [number, number] {
  const [lat, lng] = cellToLatLng(cell)
  return [lng, lat]
}

/** 将 H3 单元转换为带导出属性的 GeoJSON 多边形。 */
function h3CellFeature(cell: string): Feature<Polygon> {
  const [lat, lng] = cellToLatLng(cell)
  const boundary = fixTransmeridianBoundary(cellToBoundary(cell, true) as [number, number][])
  return {
    type: 'Feature',
    id: cell,
    properties: {
      h3: cell,
      resolution: getResolution(cell),
      base_cell: getBaseCellNumber(cell),
      center_lat: lat,
      center_lng: lng,
      is_pentagon: isPentagon(cell)
    },
    geometry: { type: 'Polygon', coordinates: [boundary] }
  }
}

/**
 * 自动分辨率规则：缩放每加一级约前进一个分辨率，缩放 3 时归零，并夹取到合法范围。
 */
function h3ResolutionForZoom(zoom: number): number {
  return Math.min(MAX_H3_RESOLUTION, Math.max(0, Math.floor((zoom - 3) * 0.9)))
}

/** 标签最小缩放：避免全球视图下数千个 ID 相互重叠。 */
function h3LabelMinZoom(resolution: number): number {
  return Math.min(18, Math.max(3, Math.round(resolution) + 3))
}

/** 用 H3 单元填充 WGS84 视域；跨 180° 时拆成两块；超出上限抛出 RangeError。 */
function h3GridForBounds(
  bounds: [number, number, number, number],
  resolution: number,
  limit = VIEWPORT_CELL_LIMIT
): FeatureCollection<Polygon> {
  const [west, southRaw, east, northRaw] = bounds
  const south = Math.max(-89.999999, Math.min(89.999999, southRaw))
  const north = Math.max(-89.999999, Math.min(89.999999, northRaw))
  const span = east >= west ? east - west : east + 360 - west
  const ranges: Array<[number, number]> =
    span >= 359.999
      ? [
          [-180, 0],
          [0, 180]
        ]
      : east < west
        ? [
            [west, 180],
            [-180, east]
          ]
        : [[Math.max(-180, west), Math.min(180, east)]]
  // 先用球面矩形估算提前拒绝明显超限的请求；精确硬上限在循环中兜底。
  const radians = Math.PI / 180
  const areaKm2 = ranges.reduce(
    (sum, [left, right]) =>
      sum +
      6371.0088 ** 2 *
        Math.abs((right - left) * radians) *
        Math.abs(Math.sin(north * radians) - Math.sin(south * radians)),
    0
  )
  if (areaKm2 / getHexagonAreaAvg(resolution, 'km2') > limit * 1.2) {
    throw new RangeError(`H3 cell limit exceeded: ${limit}`)
  }
  const cells = new Set<string>()
  for (const [left, right] of ranges) {
    const polygon: [number, number][] = [
      [south, left],
      [south, right],
      [north, right],
      [north, left],
      [south, left]
    ]
    for (const cell of polygonToCells(polygon, resolution)) {
      cells.add(cell)
      if (cells.size > limit) {
        throw new RangeError(`H3 cell limit exceeded: ${limit}`)
      }
    }
  }
  return { type: 'FeatureCollection', features: [...cells].map(h3CellFeature) }
}

/** 邻域单元（不含自身）。 */
function neighborCells(cell: string): string[] {
  return gridDisk(cell, 1).filter((neighbor) => neighbor !== cell)
}

/** 直接父级；0 级单元无父级。 */
function parentCells(cell: string): string[] {
  const resolution = getResolution(cell)
  return resolution > 0 ? [cellToParent(cell, resolution - 1)] : []
}

/** 归一化持久化配置，行为与插件一致。 */
function normalizeH3GridSettings(value: unknown): DggsSettings {
  const candidate = (value ?? {}) as Partial<DggsSettings>
  return {
    autoResolution: normalizeBool(
      candidate.autoResolution,
      DEFAULT_H3_GRID_SETTINGS.autoResolution
    ),
    resolution: Math.round(
      clampNumber(candidate.resolution, 0, MAX_H3_RESOLUTION, DEFAULT_H3_GRID_SETTINGS.resolution)
    ),
    fillColor: normalizeColor(candidate.fillColor, DEFAULT_H3_GRID_SETTINGS.fillColor),
    fillOpacity: clampNumber(candidate.fillOpacity, 0, 1, DEFAULT_H3_GRID_SETTINGS.fillOpacity),
    lineColor: normalizeColor(candidate.lineColor, DEFAULT_H3_GRID_SETTINGS.lineColor),
    lineWidth: clampNumber(candidate.lineWidth, 0.1, 8, DEFAULT_H3_GRID_SETTINGS.lineWidth),
    showLabels: normalizeBool(candidate.showLabels, DEFAULT_H3_GRID_SETTINGS.showLabels),
    includeNeighbors: normalizeBool(
      candidate.includeNeighbors,
      DEFAULT_H3_GRID_SETTINGS.includeNeighbors
    ),
    includeParents: normalizeBool(
      candidate.includeParents,
      DEFAULT_H3_GRID_SETTINGS.includeParents
    ),
    showIcosahedron: normalizeBool(
      candidate.showIcosahedron,
      DEFAULT_H3_GRID_SETTINGS.showIcosahedron as boolean
    )
  }
}

export const system: DggsSystem = {
  id: 'dggs-h3',
  title: 'H3 六边形网格',
  english: 'H3 Grid',
  subtitle: '二十面体六边形网格 · 孔径 7',
  description:
    'H3 将地球投影到二十面体并递归细分为 15 层六边形（含 12 个五边形）单元，孔径为 7。',
  tag: 'H3',
  accentColor: '#2563eb',

  defaults: { ...DEFAULT_H3_GRID_SETTINGS },
  normalize: normalizeH3GridSettings,

  minResolution: 0,
  maxResolution: MAX_H3_RESOLUTION,
  resolutionName: '分辨率',

  extraFields: [{ kind: 'checkbox', label: '显示二十面体', key: 'showIcosahedron' }],

  resolutionForZoom: (zoom) => h3ResolutionForZoom(zoom),
  labelMinZoom: (resolution) => h3LabelMinZoom(resolution),

  load: () => ensureIcosahedron().then(() => undefined),

  cellAt: (lon, lat, resolution) => latLngToCell(lat, lon, resolution),
  buildGrid: (bounds: DggsBounds, resolution) =>
    h3GridForBounds([bounds.west, bounds.south, bounds.east, bounds.north], resolution),
  cellFeature: (id) => h3CellFeature(id),
  parentIds: (id) => parentCells(id),
  neighborIds: (id) => neighborCells(id),
  childCount: (id) => {
    const resolution = getResolution(id)
    return resolution < MAX_H3_RESOLUTION ? cellToChildren(id, resolution + 1).length : 0
  },
  identify: (id) => {
    const [lng, lat] = cellCenter(id)
    const resolution = getResolution(id)
    const rows = [
      { label: 'ID', value: id },
      { label: '分辨率', value: String(resolution) },
      { label: '中心', value: `${lat.toFixed(6)}, ${lng.toFixed(6)}` },
      { label: '基础单元', value: String(getBaseCellNumber(id)) },
      { label: '五边形', value: isPentagon(id) ? '是' : '否' }
    ]
    if (resolution > 0) {
      rows.push({ label: '父级', value: cellToParent(id, resolution - 1) })
    }
    if (resolution < MAX_H3_RESOLUTION) {
      rows.push({ label: '子级', value: String(cellToChildren(id, resolution + 1).length) })
    }
    rows.push({ label: '邻域', value: String(neighborCells(id).length) })
    return rows
  },
  parentLabel: '父级',

  exportName: 'h3-grid',
  csvColumns: ['h3', 'resolution', 'base_cell', 'center_lat', 'center_lng', 'is_pentagon'],
  csvRow: (feature) => {
    const p = (feature.properties ?? {}) as unknown as H3FeatureProperties
    return [p.h3, p.resolution, p.base_cell, p.center_lat, p.center_lng, p.is_pentagon]
  },

  overlay: (settings) => (settings.showIcosahedron ? icosahedron : null),

  statusNote: (_settings, resolution) => `分辨率 ${resolution} · 二十面体六边形（孔径 7）`
}
