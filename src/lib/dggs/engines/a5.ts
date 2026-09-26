/**
 * A5 离散全球网格引擎（纯 TypeScript）。
 *
 * 从 GeoLibre MapLibre 插件 `maplibre-a5.ts` 移植而来，只保留与渲染无关的
 * 「编码 / 几何 / 层级」纯逻辑，不依赖 maplibre-gl 或任何面板 / 图层代码。
 */
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import {
  MAX_RESOLUTION,
  cellArea,
  cellToBoundary,
  cellToChildren,
  cellToLonLat,
  cellToParent,
  getNumCells,
  getRes0Cells,
  getResolution,
  gridDisk,
  hexToU64,
  lonLatToCell,
  polygonToCells,
  u64ToHex,
  uncompact
} from 'a5-js'
import {
  clampNumber,
  normalizeBool,
  normalizeColor,
  type DggsBounds,
  type DggsSettings,
  type DggsSystem
} from '../spec'

/**
 * a5-js 对坐标元组做了品牌标注，但该品牌类型未导出，因此从函数签名上取回。
 */
type A5LonLat = Parameters<typeof lonLatToCell>[0]

/** 单次渲染的单元上限，避免精细分辨率下卡死浏览器。 */
export const A5_VIEWPORT_CELL_LIMIT = 20_000

/** A5 网格默认设置。 */
export const DEFAULT_A5_GRID_SETTINGS: DggsSettings = {
  autoResolution: true,
  resolution: 4,
  fillColor: '#16a34a',
  fillOpacity: 0.08,
  lineColor: '#16a34a',
  lineWidth: 1,
  showLabels: true,
  includeNeighbors: false,
  includeParents: false
}

/**
 * 缩放层级 → A5 分辨率：一个缩放级别对应一个分辨率，并夹取到合法范围，
 * 与 vgrid-maplibre 的 A5Grid 规则保持一致。
 */
export function a5ResolutionForZoom(zoom: number): number {
  return Math.min(MAX_RESOLUTION, Math.max(0, Math.floor(zoom)))
}

/** 规范化持久化的 A5 网格设置。 */
export function normalizeA5GridSettings(value: unknown): DggsSettings {
  const candidate = (value ?? {}) as Partial<DggsSettings>
  return {
    autoResolution: normalizeBool(
      candidate.autoResolution,
      DEFAULT_A5_GRID_SETTINGS.autoResolution as boolean
    ),
    resolution: Math.round(
      clampNumber(candidate.resolution, 0, MAX_RESOLUTION, DEFAULT_A5_GRID_SETTINGS.resolution)
    ),
    fillColor: normalizeColor(candidate.fillColor, DEFAULT_A5_GRID_SETTINGS.fillColor),
    fillOpacity: clampNumber(
      candidate.fillOpacity,
      0,
      1,
      DEFAULT_A5_GRID_SETTINGS.fillOpacity
    ),
    lineColor: normalizeColor(candidate.lineColor, DEFAULT_A5_GRID_SETTINGS.lineColor),
    lineWidth: clampNumber(candidate.lineWidth, 0.1, 8, DEFAULT_A5_GRID_SETTINGS.lineWidth),
    showLabels: normalizeBool(candidate.showLabels, DEFAULT_A5_GRID_SETTINGS.showLabels as boolean),
    includeNeighbors: normalizeBool(
      candidate.includeNeighbors,
      DEFAULT_A5_GRID_SETTINGS.includeNeighbors as boolean
    ),
    includeParents: normalizeBool(
      candidate.includeParents,
      DEFAULT_A5_GRID_SETTINGS.includeParents as boolean
    )
  }
}

/**
 * 显示标注所需的最小缩放级别。A5 单元面积每升一级缩小 4 倍（线性 2 倍），
 * 一个缩放级别对应一个分辨率可让标注密度大致恒定。
 */
export function a5LabelMinZoom(resolution: number): number {
  return Math.min(18, Math.max(2, Math.round(resolution) + 1))
}

/**
 * 展开跨 180° 经线的 A5 环，使经度保持连续。
 * a5-js 返回原始 ±180 跳变，渲染侧需要相邻世界副本。
 */
export function a5UnwrapBoundary(ring: [number, number][]): [number, number][] {
  if (ring.length === 0) return ring
  const out: [number, number][] = []
  for (const [lng, lat] of ring) {
    let lon = lng
    if (out.length > 0) {
      const reference = out[0][0]
      if (lon - reference > 180) lon -= 360
      if (lon - reference < -180) lon += 360
    }
    out.push([lon, lat])
  }
  return out
}

/** 将 A5 单元（十六进制编码）转换为带导出属性的 GeoJSON 多边形。 */
export function a5CellFeature(cell: string): Feature<Polygon> {
  const id = hexToU64(cell)
  const [lng, lat] = cellToLonLat(id)
  const boundary = a5UnwrapBoundary(cellToBoundary(id) as [number, number][])
  return {
    type: 'Feature',
    id: cell,
    properties: {
      a5: cell,
      resolution: getResolution(id),
      center_lat: lat,
      center_lng: lng
    },
    geometry: { type: 'Polygon', coordinates: [boundary] }
  }
}

const EARTH_AREA_M2 = 4 * Math.PI * 6371008.8 ** 2

/**
 * polygonToCells 对视域级多边形可靠，但当多边形接近半球尺度时会开始漏掉内部单元
 * （实测超过球面约 20% 后出现），而横跨完整 360° 经线的环本身退化。大于该比例的
 * 视域改为枚举该分辨率下的全部单元并按中心筛选——结果精确，且只会在粗分辨率下
 * 触发（单元上限守卫会拒绝精细分辨率下的大视域），此时枚举开销很低。
 */
const POLYGON_FILL_MAX_EARTH_FRACTION = 0.15

/** 用 A5 单元铺满 WGS84 包围盒。 */
export function a5GridForBounds(
  bounds: [number, number, number, number],
  resolution: number,
  limit = A5_VIEWPORT_CELL_LIMIT
): FeatureCollection<Polygon> {
  const [west, southRaw, east, northRaw] = bounds
  const south = Math.max(-90, Math.min(90, southRaw))
  const north = Math.max(-90, Math.min(90, northRaw))
  const span = Math.min(360, east >= west ? east - west : east + 360 - west)
  // 在生成完整结果前先拒绝明显超限的请求。该球面矩形估计故意略偏保守，
  // 下方精确硬上限仍是最终守卫。A5 单元严格等面积，故 cellArea 不是平均值
  // 而是真实大小。
  const radians = Math.PI / 180
  const areaM2 =
    6371008.8 ** 2 *
    span *
    radians *
    Math.abs(Math.sin(north * radians) - Math.sin(south * radians))
  if (areaM2 / cellArea(resolution) > limit * 1.2) {
    throw new RangeError(`A5 cell limit exceeded: ${limit}`)
  }

  const cells: bigint[] = []
  const push = (cell: bigint): void => {
    cells.push(cell)
    if (cells.length > limit) {
      throw new RangeError(`A5 cell limit exceeded: ${limit}`)
    }
  }
  const enumerable = getNumCells(resolution) <= limit * 4
  if (enumerable && (span >= 359.999 || areaM2 > EARTH_AREA_M2 * POLYGON_FILL_MAX_EARTH_FRACTION)) {
    for (const cell of uncompact(getRes0Cells(), resolution)) {
      const [lng, lat] = cellToLonLat(cell)
      if (lat < south || lat > north) continue
      // 取模可兼容跨 180° 经线以及未展开的 west 值。
      const offset = (((lng - west) % 360) + 360) % 360
      if (offset <= span || span >= 360) push(cell)
    }
  } else {
    // A5 在球面上工作，环可直接跨 180° 经线或携带未展开经度——无需切分。
    // polygonToCells 会压缩结果；这里 uncompact 回单一分辨率，因为混合分辨率的
    // 五边形无法嵌套，会产生缝隙 / 重叠。
    const eastEdge = west + Math.min(span, 359.999)
    const ring = [
      [west, south],
      [eastEdge, south],
      [eastEdge, north],
      [west, north],
      [west, south]
    ] as A5LonLat[]
    for (const cell of uncompact(polygonToCells(ring, resolution), resolution)) {
      push(cell)
    }
  }
  return {
    type: 'FeatureCollection',
    features: cells.map((cell) => a5CellFeature(u64ToHex(cell)))
  }
}

/** 点击点 → 单元编码。a5-js 坐标顺序为 [经度, 纬度]。 */
export function cellAtLonLat(lon: number, lat: number, resolution: number): string {
  return u64ToHex(lonLatToCell([lon, lat] as A5LonLat, resolution))
}

/** 单元的边邻域（不含自身）。gridDisk 会压缩结果，需展开回单元分辨率。 */
export function neighborCells(cell: string): string[] {
  const id = hexToU64(cell)
  return [...uncompact(gridDisk(id, 1), getResolution(id))]
    .map(u64ToHex)
    .filter((neighbor) => neighbor !== cell)
}

/** 分辨率 r-1 的唯一父级；分辨率 0 的单元没有父级。 */
export function parentCells(cell: string): string[] {
  const id = hexToU64(cell)
  return getResolution(id) > 0 ? [u64ToHex(cellToParent(id))] : []
}

/** identify 面板行。 */
function identifyA5Cell(cell: string): Array<{ label: string; value: string }> {
  const id = hexToU64(cell)
  const resolution = getResolution(id)
  const [lng, lat] = cellToLonLat(id)
  const rows: Array<{ label: string; value: string }> = [
    { label: 'ID', value: cell },
    { label: '分辨率', value: String(resolution) },
    { label: '中心', value: `${lat.toFixed(6)}, ${lng.toFixed(6)}` }
  ]
  if (resolution > 0) {
    const [parent] = parentCells(cell)
    if (parent) rows.push({ label: '父级', value: parent })
  }
  if (resolution < MAX_RESOLUTION) {
    rows.push({ label: '子级', value: String(cellToChildren(id).length) })
  }
  rows.push({ label: '邻域', value: String(neighborCells(cell).length) })
  return rows
}

/** A5 网格系统描述。 */
export const system: DggsSystem = {
  id: 'dggs-a5',
  title: 'A5 网格',
  english: 'A5 Grid',
  subtitle: '等面积五边形 / 六边形全球离散网格',
  description:
    '基于正十二面体的 A5 全球离散网格，单元严格等面积，随分辨率细分出五边形与六边形。',
  tag: 'DGGS',
  accentColor: '#16a34a',

  defaults: DEFAULT_A5_GRID_SETTINGS,
  normalize: normalizeA5GridSettings,

  minResolution: 0,
  maxResolution: MAX_RESOLUTION,
  resolutionName: '分辨率',

  resolutionForZoom: a5ResolutionForZoom,
  labelMinZoom: a5LabelMinZoom,

  cellAt: cellAtLonLat,
  buildGrid: (bounds: DggsBounds, resolution: number): FeatureCollection<Polygon> =>
    a5GridForBounds([bounds.west, bounds.south, bounds.east, bounds.north], resolution),
  cellFeature: a5CellFeature,
  parentIds: parentCells,
  neighborIds: neighborCells,
  childCount: (id: string): number => cellToChildren(hexToU64(id)).length,
  identify: (id: string): Array<{ label: string; value: string }> => identifyA5Cell(id),
  parentLabel: '父级',

  exportName: 'a5-grid',
  csvColumns: ['a5', 'resolution', 'center_lat', 'center_lng'],
  csvRow: (feature: Feature<Polygon>): Array<string | number | boolean> => {
    const p = (feature.properties ?? {}) as Record<string, unknown>
    return [p.a5 as string, p.resolution as number, p.center_lat as number, p.center_lng as number]
  },

  statusNote: (_settings: DggsSettings, resolution: number): string =>
    `分辨率 ${resolution} · 等面积五边形/六边形`
}
