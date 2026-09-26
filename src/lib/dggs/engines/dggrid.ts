import type { Feature, FeatureCollection, Polygon, Position } from 'geojson'
import {
  normalizeColor,
  normalizeBool,
  clampNumber,
  VIEWPORT_CELL_LIMIT,
  type DggsSystem,
  type DggsSettings,
  type DggsBounds
} from '../spec'

/** DGGRID 支持的最细分辨率（vgrid-maplibre 默认 21）。 */
const MAX_DGGRID_RESOLUTION = 21

/** 单元形状（面板中的「单元类型」）。 */
const DGGRID_TOPOLOGIES = ['HEXAGON', 'DIAMOND', 'TRIANGLE'] as const
type DggridTopology = (typeof DGGRID_TOPOLOGIES)[number]

/** 将二十面体面投影到球面的投影方式。 */
const DGGRID_PROJECTIONS = ['ISEA', 'FULLER'] as const
type DggridProjection = (typeof DGGRID_PROJECTIONS)[number]

/**
 * 六边形可接受的细分孔径。DIAMOND 与 TRIANGLE 仅存在孔径 4 —— 其他值会使 WASM
 * 引擎以 `DgIDGGS::makeRF(): invalid aperture` 中止，故归一化时将其固定为 4。
 */
const DGGRID_APERTURES = [3, 4, 7] as const
type DggridAperture = (typeof DGGRID_APERTURES)[number]

interface DggridConfig {
  poleCoordinates: { lat: number; lng: number }
  azimuth: number
  topology: DggridTopology
  projection: DggridProjection
  aperture?: DggridAperture
}

interface DggridEngine {
  setDggs(dggs: DggridConfig, resolution: number): void
  cellAreaKM(resolution?: number): number
  geoToSequenceNum(coordinates: number[][], resolution?: number): bigint[]
  sequenceNumToGeo(sequenceNum: bigint[], resolution?: number): Position[]
  sequenceNumToGrid(sequenceNum: bigint[], resolution?: number, unwrap?: boolean): Position[][]
  sequenceNumNeighbors(sequenceNum: bigint[], resolution?: number): bigint[][]
  sequenceNumParent(sequenceNum: bigint[], resolution?: number): bigint[]
  sequenceNumAllParents(sequenceNum: bigint[], resolution?: number): bigint[][]
  sequenceNumChildren(sequenceNum: bigint[], resolution?: number): bigint[][]
}

const DEFAULT_DGGRID_GRID_SETTINGS: DggsSettings = {
  topology: 'HEXAGON',
  projection: 'ISEA',
  aperture: 4,
  autoResolution: true,
  resolution: 3,
  fillColor: '#9333ea',
  fillOpacity: 0.08,
  lineColor: '#9333ea',
  lineWidth: 1,
  showLabels: true,
  includeNeighbors: false,
  includeParents: false
}

let engine: DggridEngine | null = null
let enginePromise: Promise<DggridEngine> | null = null
/** DGGRID 序号不编码分辨率，故单独记录最近一次渲染使用的分辨率。 */
let activeResolution = (DEFAULT_DGGRID_GRID_SETTINGS.resolution as number) || 0

/** 动态加载 webdggrid WASM 模块一次并复用实例。 */
export function loadDggrid(): Promise<DggridEngine> {
  enginePromise ??= import('webdggrid')
    .then(async (module) => {
      const instance = (await module.Webdggrid.load()) as unknown as DggridEngine
      instance.setDggs({ ...DGGRID_CONFIG }, DEFAULT_DGGRID_GRID_SETTINGS.resolution as number)
      engine = instance
      return instance
    })
    .catch((error) => {
      enginePromise = null
      throw error
    })
  return enginePromise
}

/** 默认 DGGS：ISEA4H（等积二十面体，孔径 4 六边形）。 */
const DGGRID_CONFIG: DggridConfig = {
  poleCoordinates: { lat: 0, lng: 0 },
  azimuth: 0,
  topology: 'HEXAGON',
  projection: 'ISEA',
  aperture: 4
}

function normalizeLon(lon: number): number {
  let x = lon
  while (x > 180) x -= 360
  while (x < -180) x += 360
  return x
}

function pointInRing(lon: number, lat: number, ring: Position[]): boolean {
  if (!ring?.length) return false
  const last = ring.length - 1
  const closed = ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1]
  const count = closed ? ring.length - 1 : ring.length
  let inside = false
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    if (yj - yi === 0) continue
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function ccw(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  return (cy - ay) * (bx - ax) > (by - ay) * (cx - ax)
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): boolean {
  const a = ccw(ax, ay, cx, cy, dx, dy) !== ccw(bx, by, cx, cy, dx, dy)
  const b = ccw(ax, ay, bx, by, cx, cy) !== ccw(ax, ay, bx, by, dx, dy)
  return a && b
}

function segmentCrossesLonLatRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  west: number,
  south: number,
  east: number,
  north: number
): boolean {
  if (Math.max(ax, bx) < west || Math.min(ax, bx) > east) return false
  if (Math.max(ay, by) < south || Math.min(ay, by) > north) return false
  if (ax >= west && ax <= east && ay >= south && ay <= north) return true
  if (bx >= west && bx <= east && by >= south && by <= north) return true
  const edges: Array<[number, number, number, number]> = [
    [west, south, east, south],
    [east, south, east, north],
    [east, north, west, north],
    [west, north, west, south]
  ]
  return edges.some(([x1, y1, x2, y2]) => segmentsIntersect(ax, ay, bx, by, x1, y1, x2, y2))
}

/** 单元环是否与经纬矩形相交（平面近似）。 */
function ringIntersectsBounds(
  ring: Position[],
  west: number,
  south: number,
  east: number,
  north: number
): boolean {
  if (!ring?.length) return false
  const framed: Position[] = []
  for (const [rawLon, lat] of ring) {
    let lon = rawLon
    if (framed.length > 0) {
      const reference = framed[0][0]
      while (lon - reference > 180) lon -= 360
      while (lon - reference < -180) lon += 360
    }
    framed.push([lon, lat])
  }
  const mid = (west + east) / 2
  const shift = Math.round((mid - framed[0][0]) / 360) * 360
  const normalized =
    shift === 0 ? framed : framed.map(([lon, lat]) => [lon + shift, lat] as Position)

  const last = normalized.length - 1
  const closed =
    normalized[0][0] === normalized[last][0] && normalized[0][1] === normalized[last][1]
  const count = closed ? normalized.length - 1 : normalized.length

  for (let i = 0; i < count; i += 1) {
    const lon = normalized[i][0]
    const lat = normalized[i][1]
    if (lon >= west && lon <= east && lat >= south && lat <= north) return true
  }
  for (const [lon, lat] of [
    [west, south],
    [west, north],
    [east, south],
    [east, north],
    [(west + east) / 2, (south + north) / 2]
  ]) {
    if (pointInRing(lon, lat, normalized)) return true
  }
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % count
    if (
      segmentCrossesLonLatRect(
        normalized[i][0],
        normalized[i][1],
        normalized[j][0],
        normalized[j][1],
        west,
        south,
        east,
        north
      )
    ) {
      return true
    }
  }
  return false
}

function boundsToRects(
  bounds: [number, number, number, number]
): Array<[number, number, number, number]> {
  const west = normalizeLon(bounds[0])
  const east = normalizeLon(bounds[2])
  const south = bounds[1]
  const north = bounds[3]
  if (west <= east) return [[west, south, east, north]]
  return [
    [west, south, 180, north],
    [-180, south, east, north]
  ]
}

function closeRing(ring: Position[]): Position[] {
  if (ring.length === 0) return ring
  const [firstLng, firstLat] = ring[0]
  const [lastLng, lastLat] = ring[ring.length - 1]
  return firstLng === lastLng && firstLat === lastLat ? ring : [...ring, [firstLng, firstLat]]
}

function currentConfig(settings: DggsSettings): DggridConfig {
  return {
    poleCoordinates: { lat: 0, lng: 0 },
    azimuth: 0,
    topology: (settings.topology as DggridTopology) ?? 'HEXAGON',
    projection: (settings.projection as DggridProjection) ?? 'ISEA',
    aperture: (settings.aperture as DggridAperture) ?? 4
  }
}

/** 确保 WASM 已加载，并写入当前配置与分辨率。 */
function ensureEngine(settings: DggsSettings, resolution: number): DggridEngine {
  if (!engine) throw new Error('DGGRID engine not loaded')
  engine.setDggs(currentConfig(settings), resolution)
  activeResolution = resolution
  return engine
}

/** 将 DGGRID 单元（序号字符串）转换为 GeoJSON 多边形。 */
function dggridCellFeature(inst: DggridEngine, cell: string, resolution: number): Feature<Polygon> {
  const id = BigInt(cell)
  const ring = closeRing(inst.sequenceNumToGrid([id], resolution)[0])
  const [lng, lat] = inst.sequenceNumToGeo([id], resolution)[0]
  return {
    type: 'Feature',
    id: cell,
    properties: {
      dggrid: cell,
      resolution,
      center_lat: lat,
      center_lng: lng
    },
    geometry: { type: 'Polygon', coordinates: [ring] }
  }
}

/** 在采样点阵下取单元序号，供无邻域查询的 TRIANGLE 拓扑回退使用。 */
function sampledCells(
  inst: DggridEngine,
  west: number,
  south: number,
  span: number,
  latSpan: number,
  resolution: number
): bigint[] {
  const maxSamples = Math.min(
    420,
    Math.max(72, Math.round(56 + resolution * 22 + resolution * resolution * 0.35))
  )
  const gridCap = Math.min(42, Math.max(10, Math.ceil(Math.sqrt(maxSamples)) + 8))
  const aspect = span / Math.max(1e-9, latSpan)
  let cols = Math.ceil(Math.sqrt(maxSamples * aspect))
  cols = Math.min(gridCap, Math.max(3, cols))
  let rows = Math.ceil(maxSamples / cols)
  rows = Math.min(gridCap, Math.max(3, rows))

  const coords: number[][] = []
  for (let i = 0; i <= rows; i += 1) {
    const lat = south + (latSpan * i) / rows
    for (let j = 0; j <= cols; j += 1) {
      coords.push([normalizeLon(west + (span * j) / cols), lat])
    }
  }
  const seen = new Set<string>()
  const unique: bigint[] = []
  for (const id of inst.geoToSequenceNum(coords, resolution)) {
    const key = id.toString()
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(id)
    }
  }
  return unique
}

/**
 * 用 DGGRID 单元填充 WGS84 视域：从视域中心种子单元出发，经 `sequenceNumNeighbors`
 * 做 BFS，直到单元不再与边界相交。TRIANGLE 拓扑无邻域查询，改用点采样回退。
 */
function dggridGridForBounds(
  inst: DggridEngine,
  config: DggridConfig,
  bounds: [number, number, number, number],
  resolution: number,
  limit = VIEWPORT_CELL_LIMIT
): FeatureCollection<Polygon> {
  const [west, southRaw, east, northRaw] = bounds
  const south = Math.max(-89.999999, Math.min(89.999999, southRaw))
  const north = Math.max(-89.999999, Math.min(89.999999, northRaw))
  const span = Math.min(360, east >= west ? east - west : east + 360 - west)
  const radians = Math.PI / 180
  const areaKm2 =
    6371.0088 ** 2 *
    span *
    radians *
    Math.abs(Math.sin(north * radians) - Math.sin(south * radians))
  inst.setDggs({ ...config }, resolution)
  if (areaKm2 / inst.cellAreaKM(resolution) > limit * 1.2) {
    throw new RangeError(`DGGRID cell limit exceeded: ${limit}`)
  }

  let collected: bigint[]
  if (config.topology === 'TRIANGLE') {
    collected = sampledCells(inst, west, south, span, north - south, resolution)
    if (collected.length > limit) {
      throw new RangeError(`DGGRID cell limit exceeded: ${limit}`)
    }
  } else {
    const rects = boundsToRects([west, south, east, north])
    const centerLng = normalizeLon(west + span / 2)
    const centerLat = (south + north) / 2
    const seed = inst.geoToSequenceNum([[centerLng, centerLat]], resolution)[0]

    collected = []
    const covered = new Set<string>()
    const queue: bigint[] = [seed]
    let head = 0
    const maxPops = Math.max(100_000, limit * 20)
    let pops = 0

    while (head < queue.length && pops < maxPops) {
      pops += 1
      const id = queue[head++]
      const key = id.toString()
      if (covered.has(key)) continue
      covered.add(key)

      const ring = inst.sequenceNumToGrid([id], resolution)[0]
      if (!rects.some(([w, s, e, n]) => ringIntersectsBounds(ring, w, s, e, n))) continue

      collected.push(id)
      if (collected.length > limit) {
        throw new RangeError(`DGGRID cell limit exceeded: ${limit}`)
      }

      for (const neighbor of inst.sequenceNumNeighbors([id], resolution)[0] ?? []) {
        if (!covered.has(neighbor.toString())) queue.push(neighbor)
      }
    }
    if (head < queue.length) {
      throw new RangeError(`DGGRID traversal limit exceeded: ${maxPops}`)
    }
  }

  return {
    type: 'FeatureCollection',
    features: collected.map((id) => dggridCellFeature(inst, id.toString(), resolution))
  }
}

/** 自动分辨率规则：因子取决于孔径，并夹取到合法范围。 */
function dggridResolutionForZoom(zoom: number, aperture: DggridAperture): number {
  const factor = aperture === 3 ? 1.15 : aperture === 7 ? 0.65 : 0.95
  return Math.min(MAX_DGGRID_RESOLUTION, Math.max(0, Math.floor(zoom * factor)))
}

/** 标签最小缩放。 */
function dggridLabelMinZoom(resolution: number): number {
  return Math.min(18, Math.max(2, Math.round(resolution) + 1))
}

function normalizeDggridGridSettings(value: unknown): DggsSettings {
  const candidate = (value ?? {}) as Partial<DggsSettings>
  const topology = DGGRID_TOPOLOGIES.includes(candidate.topology as DggridTopology)
    ? (candidate.topology as DggridTopology)
    : (DEFAULT_DGGRID_GRID_SETTINGS.topology as DggridTopology)
  const aperture = DGGRID_APERTURES.includes(candidate.aperture as DggridAperture)
    ? (candidate.aperture as DggridAperture)
    : (DEFAULT_DGGRID_GRID_SETTINGS.aperture as DggridAperture)
  return {
    topology,
    projection: DGGRID_PROJECTIONS.includes(candidate.projection as DggridProjection)
      ? (candidate.projection as DggridProjection)
      : (DEFAULT_DGGRID_GRID_SETTINGS.projection as DggridProjection),
    // 钻石/三角网格仅存在孔径 4。
    aperture: topology === 'HEXAGON' ? aperture : 4,
    autoResolution: normalizeBool(
      candidate.autoResolution,
      DEFAULT_DGGRID_GRID_SETTINGS.autoResolution
    ),
    resolution: Math.round(
      clampNumber(
        candidate.resolution,
        0,
        MAX_DGGRID_RESOLUTION,
        DEFAULT_DGGRID_GRID_SETTINGS.resolution as number
      )
    ),
    fillColor: normalizeColor(candidate.fillColor, DEFAULT_DGGRID_GRID_SETTINGS.fillColor),
    fillOpacity: clampNumber(candidate.fillOpacity, 0, 1, DEFAULT_DGGRID_GRID_SETTINGS.fillOpacity),
    lineColor: normalizeColor(candidate.lineColor, DEFAULT_DGGRID_GRID_SETTINGS.lineColor),
    lineWidth: clampNumber(candidate.lineWidth, 0.1, 8, DEFAULT_DGGRID_GRID_SETTINGS.lineWidth),
    showLabels: normalizeBool(candidate.showLabels, DEFAULT_DGGRID_GRID_SETTINGS.showLabels),
    includeNeighbors: normalizeBool(
      candidate.includeNeighbors,
      DEFAULT_DGGRID_GRID_SETTINGS.includeNeighbors
    ),
    includeParents: normalizeBool(
      candidate.includeParents,
      DEFAULT_DGGRID_GRID_SETTINGS.includeParents
    )
  }
}

export const system: DggsSystem = {
  id: 'dggs-dggrid',
  title: 'DGGRID 网格',
  english: 'DGGRID Grid',
  subtitle: '二十面体 DGGS · 多拓扑多投影',
  description:
    'DGGRID 支持六边形 / 钻石 / 三角形拓扑与 ISEA / Fuller 投影，可选孔径 3、4、7。',
  tag: 'DGGRID',
  accentColor: '#9333ea',

  defaults: { ...DEFAULT_DGGRID_GRID_SETTINGS },
  normalize: normalizeDggridGridSettings,

  minResolution: 0,
  maxResolution: MAX_DGGRID_RESOLUTION,
  resolutionName: '分辨率',

  extraFields: [
    {
      kind: 'select',
      label: '单元类型',
      key: 'topology',
      options: [
        { value: 'HEXAGON', label: '六边形' },
        { value: 'DIAMOND', label: '钻石形' },
        { value: 'TRIANGLE', label: '三角形' }
      ]
    },
    {
      kind: 'select',
      label: '投影',
      key: 'projection',
      options: [
        { value: 'ISEA', label: 'ISEA' },
        { value: 'FULLER', label: 'FULLER' }
      ]
    },
    {
      kind: 'select',
      label: '孔径',
      key: 'aperture',
      options: [
        { value: '3', label: '3' },
        { value: '4', label: '4' },
        { value: '7', label: '7' }
      ],
      disabledWhen: 'HEXAGON',
      disabledKey: 'topology'
    }
  ],

  resolutionForZoom: (zoom, settings) =>
    dggridResolutionForZoom(zoom, (settings.aperture as DggridAperture) ?? 4),
  labelMinZoom: (resolution) => dggridLabelMinZoom(resolution),

  requiresLoad: true,
  load: () => loadDggrid().then(() => undefined),

  cellAt: (lon, lat, resolution, settings) => {
    const inst = ensureEngine(settings, resolution)
    return inst.geoToSequenceNum([[lon, lat]], resolution)[0].toString()
  },
  buildGrid: (bounds: DggsBounds, resolution, settings) => {
    const inst = ensureEngine(settings, resolution)
    return dggridGridForBounds(
      inst,
      currentConfig(settings),
      [bounds.west, bounds.south, bounds.east, bounds.north],
      resolution
    )
  },
  cellFeature: (id, settings) => {
    const inst = ensureEngine(settings, activeResolution)
    return dggridCellFeature(inst, id, activeResolution)
  },
  parentIds: (id, settings) => {
    if (activeResolution <= 0) return []
    const inst = ensureEngine(settings, activeResolution)
    const [parent] = inst.sequenceNumParent([BigInt(id)], activeResolution)
    return parent !== undefined ? [parent.toString()] : []
  },
  neighborIds: (id, settings) => {
    const inst = ensureEngine(settings, activeResolution)
    return (inst.sequenceNumNeighbors([BigInt(id)], activeResolution)[0] ?? []).map((n) =>
      n.toString()
    )
  },
  childCount: (id, settings) => {
    const inst = ensureEngine(settings, activeResolution)
    return (inst.sequenceNumChildren([BigInt(id)], activeResolution)[0] ?? []).length
  },
  identify: (id, settings) => {
    const inst = ensureEngine(settings, activeResolution)
    const [lng, lat] = inst.sequenceNumToGeo([BigInt(id)], activeResolution)[0]
    const rows = [
      { label: 'ID', value: id },
      { label: '分辨率', value: String(activeResolution) },
      { label: '中心', value: `${lat.toFixed(6)}, ${lng.toFixed(6)}` }
    ]
    const [parent] = activeResolution > 0 ? inst.sequenceNumParent([BigInt(id)], activeResolution) : []
    if (parent !== undefined) rows.push({ label: '父级', value: parent.toString() })
    const children = inst.sequenceNumChildren([BigInt(id)], activeResolution)[0] ?? []
    rows.push({ label: '子级', value: String(children.length) })
    rows.push({
      label: '邻域',
      value: String((inst.sequenceNumNeighbors([BigInt(id)], activeResolution)[0] ?? []).length)
    })
    return rows
  },
  parentLabel: '父级',

  exportName: 'dggrid-grid',
  csvColumns: ['dggrid', 'resolution', 'center_lat', 'center_lng'],
  csvRow: (feature) => {
    const p = (feature.properties ?? {}) as unknown as {
      dggrid: string
      resolution: number
      center_lat: number
      center_lng: number
    }
    return [p.dggrid, p.resolution, p.center_lat, p.center_lng]
  },

  statusNote: (settings, resolution) =>
    `分辨率 ${resolution} · ${settings.topology} · ${settings.projection} · 孔径 ${settings.aperture}`
}
