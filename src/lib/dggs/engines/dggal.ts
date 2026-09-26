import type { Feature, FeatureCollection, Polygon } from 'geojson'
import {
  normalizeColor,
  normalizeBool,
  clampNumber,
  VIEWPORT_CELL_LIMIT,
  type DggsSystem,
  type DggsSettings,
  type DggsBounds
} from '../spec'

/** 各 DGGRS 类型及其最大分辨率。 */
const DGGAL_TYPES = {
  GNOSISGlobalGrid: 28,
  ISEA4R: 20,
  ISEA9R: 16,
  ISEA3H: 33,
  ISEA7H: 19,
  ISEA7H_Z7: 19,
  IVEA4R: 20,
  IVEA9R: 16,
  IVEA3H: 33,
  IVEA7H: 19,
  IVEA7H_Z7: 19,
  RTEA4R: 20,
  RTEA9R: 16,
  RTEA3H: 33,
  RTEA7H: 19,
  RTEA7H_Z7: 19,
  HEALPix: 26,
  rHEALPix: 16
} as const

type DggalType = keyof typeof DGGAL_TYPES

const DGGAL_TYPE_NAMES = Object.keys(DGGAL_TYPES) as DggalType[]

/** 以弧度表示的地理点，DGGAL 的原生单位。 */
interface GeoPoint {
  lat: number
  lon: number
}

/** 本插件用到的 DGGAL `DGGRS` 实例子集。 */
interface DggalDggrs {
  getZoneFromTextID(zoneId: string): bigint
  getZoneTextID(zone: bigint): string
  getZoneLevel(zone: bigint): number
  getZoneParents(zone: bigint): bigint[]
  getZoneChildren(zone: bigint): bigint[]
  getZoneNeighbors(zone: bigint): Array<{ zone: bigint; type: number }>
  getZoneWGS84Centroid(zone: bigint): GeoPoint
  getZoneRefinedWGS84Vertices(zone: bigint, edgeRefinement: number): GeoPoint[]
  listZones(level: number, bbox: { ll: GeoPoint; ur: GeoPoint }): bigint[]
  getZoneFromWGS84Centroid(level: number, geoPoint: GeoPoint): bigint
  countZones(level: number): bigint
  getMaxDGGRSZoneLevel(): number
  delete(): void
}

interface DggalEngine {
  createDGGRS(name: string): DggalDggrs
  listDGGRS(): string[]
}

const DEFAULT_DGGAL_GRID_SETTINGS: DggsSettings = {
  dggrsType: 'ISEA3H',
  autoResolution: true,
  resolution: 2,
  fillColor: '#0d9488',
  fillOpacity: 0.08,
  lineColor: '#0d9488',
  lineWidth: 1,
  showLabels: true,
  includeNeighbors: false,
  includeParents: false
}

const DEG_PER_RAD = 180 / Math.PI
const RAD_PER_DEG = Math.PI / 180

let dggal: DggalEngine | null = null
let dggalPromise: Promise<DggalEngine> | null = null
let dggrs: DggalDggrs | null = null
let dggrsType: DggalType | null = null

/** 动态加载 DGGAL WASM 模块一次并复用句柄。 */
export function loadDggal(): Promise<DggalEngine> {
  dggalPromise ??= import('dggal')
    .then(async (module) => {
      const handle = (await module.DGGAL.init()) as unknown as DggalEngine
      dggal = handle
      return handle
    })
    .catch((error) => {
      dggalPromise = null
      throw error
    })
  return dggalPromise
}

/** 当前网格类型对应的 DGGRS 实例，类型变化时重建。 */
function activeDggrs(type: string): DggalDggrs {
  if (!dggal) throw new Error('DGGAL engine not loaded')
  const next = type as DggalType
  if (!dggrs || dggrsType !== next) {
    dggrs?.delete()
    dggrs = dggal.createDGGRS(next)
    dggrsType = next
  }
  return dggrs
}

/**
 * 自动分辨率规则：因子取决于细化方式 —— 孔径 3 六边形最慢（1.15/zoom），九分菱形与
 * rHEALPix 最快（0.6/zoom）—— 并夹取到该类型的合法范围。
 */
function dggalResolutionForZoom(zoom: number, type: DggalType): number {
  let factor: number
  switch (type) {
    case 'ISEA3H':
    case 'IVEA3H':
    case 'RTEA3H':
      factor = 1.15
      break
    case 'ISEA4R':
    case 'IVEA4R':
    case 'RTEA4R':
    case 'HEALPix':
      factor = 0.95
      break
    case 'ISEA7H':
    case 'ISEA7H_Z7':
    case 'IVEA7H':
    case 'IVEA7H_Z7':
    case 'RTEA7H':
    case 'RTEA7H_Z7':
      factor = 0.65
      break
    case 'ISEA9R':
    case 'IVEA9R':
    case 'RTEA9R':
    case 'rHEALPix':
      factor = 0.6
      break
    default:
      factor = 1
      break
  }
  return Math.min(DGGAL_TYPES[type], Math.max(0, Math.floor(zoom * factor)))
}

/** 标签最小缩放。 */
function dggalLabelMinZoom(resolution: number): number {
  return Math.min(18, Math.max(2, Math.round(resolution) + 1))
}

/** 单元边界的闭合经纬环（度）。 */
function zoneRing(inst: DggalDggrs, zone: bigint): [number, number][] {
  const ring = inst
    .getZoneRefinedWGS84Vertices(zone, 0)
    .map(({ lat, lon }): [number, number] => [lon * DEG_PER_RAD, lat * DEG_PER_RAD])
  if (ring.length > 0) {
    const [firstLng, firstLat] = ring[0]
    const [lastLng, lastLat] = ring[ring.length - 1]
    if (firstLng !== lastLng || firstLat !== lastLat) ring.push([firstLng, firstLat])
  }
  return ring
}

/** 将 DGGAL 单元（文本 ID）转换为 GeoJSON 多边形。 */
function dggalZoneFeature(inst: DggalDggrs, cell: string): Feature<Polygon> {
  const zone = inst.getZoneFromTextID(cell)
  const centroid = inst.getZoneWGS84Centroid(zone)
  return {
    type: 'Feature',
    id: cell,
    properties: {
      dggal: cell,
      resolution: inst.getZoneLevel(zone),
      center_lat: centroid.lat * DEG_PER_RAD,
      center_lng: centroid.lon * DEG_PER_RAD
    },
    geometry: { type: 'Polygon', coordinates: [zoneRing(inst, zone)] }
  }
}

function normalizeLon(lon: number): number {
  let x = lon
  while (x > 180) x -= 360
  while (x < -180) x += 360
  return x
}

/** 用 DGGAL 单元填充 WGS84 视域，`listZones` 原生完成视域查询。 */
function dggalGridForBounds(
  inst: DggalDggrs,
  bounds: [number, number, number, number],
  resolution: number,
  limit = VIEWPORT_CELL_LIMIT
): FeatureCollection<Polygon> {
  let [west, south, east, north] = bounds
  south = Math.max(-90, Math.min(90, south))
  north = Math.max(-90, Math.min(90, north))
  if (east - west >= 360) {
    west = -180
    east = 180
  } else {
    west = normalizeLon(west)
    east = normalizeLon(east)
  }
  if (east < west) {
    const left = dggalGridForBounds(inst, [west, south, 180, north], resolution, limit)
    const right = dggalGridForBounds(inst, [-180, south, east, north], resolution, limit)
    const seen = new Set<string>()
    const features: Feature<Polygon>[] = []
    for (const feature of [...left.features, ...right.features]) {
      const id = String(feature.properties?.dggal ?? feature.id)
      if (seen.has(id)) continue
      seen.add(id)
      features.push(feature)
      if (features.length > limit) {
        throw new RangeError(`DGGAL zone limit exceeded: ${limit}`)
      }
    }
    return { type: 'FeatureCollection', features }
  }
  const radians = Math.PI / 180
  const areaFraction =
    ((east - west) * radians * Math.abs(Math.sin(north * radians) - Math.sin(south * radians))) /
    (4 * Math.PI)
  if (Number(inst.countZones(resolution)) * areaFraction > limit * 1.2) {
    throw new RangeError(`DGGAL zone limit exceeded: ${limit}`)
  }
  const zones = inst.listZones(resolution, {
    ll: { lat: south * RAD_PER_DEG, lon: west * RAD_PER_DEG },
    ur: { lat: north * RAD_PER_DEG, lon: east * RAD_PER_DEG }
  })
  if (zones.length > limit) {
    throw new RangeError(`DGGAL zone limit exceeded: ${limit}`)
  }
  return {
    type: 'FeatureCollection',
    features: zones.map((zone) => dggalZoneFeature(inst, inst.getZoneTextID(zone)))
  }
}

/**
 * 直接父级。DGGAL 会把结果填充到该 DGGRS 的最大父级数，可能含未初始化的句柄，
 * 故按期望层级过滤。
 */
function parentZones(inst: DggalDggrs, cell: string): string[] {
  const zone = inst.getZoneFromTextID(cell)
  const level = inst.getZoneLevel(zone)
  if (level <= 0) return []
  const parents = new Set<string>()
  for (const parent of inst.getZoneParents(zone)) {
    try {
      if (inst.getZoneLevel(parent) === level - 1) {
        parents.add(inst.getZoneTextID(parent))
      }
    } catch {
      // 填充的无效项，跳过。
    }
  }
  return [...parents]
}

/** 下一层直接子级，过滤方式同父级。 */
function childZones(inst: DggalDggrs, cell: string): string[] {
  const zone = inst.getZoneFromTextID(cell)
  const level = inst.getZoneLevel(zone)
  const children = new Set<string>()
  for (const child of inst.getZoneChildren(zone)) {
    try {
      if (inst.getZoneLevel(child) === level + 1) {
        children.add(inst.getZoneTextID(child))
      }
    } catch {
      // 填充的无效项，跳过。
    }
  }
  return [...children]
}

/** 同层级边/顶点邻域（不含自身）。 */
function neighborCells(inst: DggalDggrs, cell: string): string[] {
  const zone = inst.getZoneFromTextID(cell)
  const level = inst.getZoneLevel(zone)
  const ids = new Set<string>()
  for (const { zone: neighbor } of inst.getZoneNeighbors(zone)) {
    try {
      if (inst.getZoneLevel(neighbor) === level) {
        ids.add(inst.getZoneTextID(neighbor))
      }
    } catch {
      // 填充的无效项，跳过。
    }
  }
  ids.delete(cell)
  return [...ids]
}

function normalizeDggalGridSettings(value: unknown): DggsSettings {
  const candidate = (value ?? {}) as Partial<DggsSettings>
  const type =
    typeof candidate.dggrsType === 'string' &&
    Object.prototype.hasOwnProperty.call(DGGAL_TYPES, candidate.dggrsType)
      ? (candidate.dggrsType as DggalType)
      : (DEFAULT_DGGAL_GRID_SETTINGS.dggrsType as DggalType)
  return {
    dggrsType: type,
    autoResolution: normalizeBool(
      candidate.autoResolution,
      DEFAULT_DGGAL_GRID_SETTINGS.autoResolution
    ),
    resolution: Math.round(
      clampNumber(
        candidate.resolution,
        0,
        DGGAL_TYPES[type],
        Math.min(DEFAULT_DGGAL_GRID_SETTINGS.resolution as number, DGGAL_TYPES[type])
      )
    ),
    fillColor: normalizeColor(candidate.fillColor, DEFAULT_DGGAL_GRID_SETTINGS.fillColor),
    fillOpacity: clampNumber(candidate.fillOpacity, 0, 1, DEFAULT_DGGAL_GRID_SETTINGS.fillOpacity),
    lineColor: normalizeColor(candidate.lineColor, DEFAULT_DGGAL_GRID_SETTINGS.lineColor),
    lineWidth: clampNumber(candidate.lineWidth, 0.1, 8, DEFAULT_DGGAL_GRID_SETTINGS.lineWidth),
    showLabels: normalizeBool(candidate.showLabels, DEFAULT_DGGAL_GRID_SETTINGS.showLabels),
    includeNeighbors: normalizeBool(
      candidate.includeNeighbors,
      DEFAULT_DGGAL_GRID_SETTINGS.includeNeighbors
    ),
    includeParents: normalizeBool(
      candidate.includeParents,
      DEFAULT_DGGAL_GRID_SETTINGS.includeParents
    )
  }
}

export const system: DggsSystem = {
  id: 'dggs-dggal',
  title: 'DGGAL 网格',
  english: 'DGGAL Grid',
  subtitle: '通用 DGGS 库 · 18 种网格类型',
  description:
    'DGGAL 提供 18 种离散全球网格（ISEA/IVEA/RTEA 系列的 3H/4R/7H/9R、HEALPix、rHEALPix 等）。',
  tag: 'DGGAL',
  accentColor: '#0d9488',

  defaults: { ...DEFAULT_DGGAL_GRID_SETTINGS },
  normalize: normalizeDggalGridSettings,

  minResolution: 0,
  maxResolution: Math.max(...Object.values(DGGAL_TYPES)),
  resolutionName: '分辨率',

  extraFields: [
    {
      kind: 'select',
      label: 'DGGS 类型',
      key: 'dggrsType',
      options: DGGAL_TYPE_NAMES.map((name) => ({ value: name, label: name }))
    }
  ],

  resolutionForZoom: (zoom, settings) =>
    dggalResolutionForZoom(zoom, (settings.dggrsType as DggalType) ?? 'ISEA3H'),
  labelMinZoom: (resolution) => dggalLabelMinZoom(resolution),

  requiresLoad: true,
  load: () => loadDggal().then(() => undefined),

  cellAt: (lon, lat, resolution, settings) => {
    const inst = activeDggrs(settings.dggrsType as string)
    const zone = inst.getZoneFromWGS84Centroid(resolution, {
      lat: lat * RAD_PER_DEG,
      lon: lon * RAD_PER_DEG
    })
    return inst.getZoneTextID(zone)
  },
  buildGrid: (bounds: DggsBounds, resolution, settings) => {
    const inst = activeDggrs(settings.dggrsType as string)
    return dggalGridForBounds(
      inst,
      [bounds.west, bounds.south, bounds.east, bounds.north],
      resolution
    )
  },
  cellFeature: (id, settings) => dggalZoneFeature(activeDggrs(settings.dggrsType as string), id),
  parentIds: (id, settings) => parentZones(activeDggrs(settings.dggrsType as string), id),
  neighborIds: (id, settings) => neighborCells(activeDggrs(settings.dggrsType as string), id),
  childCount: (id, settings) =>
    childZones(activeDggrs(settings.dggrsType as string), id).length,
  identify: (id, settings) => {
    const inst = activeDggrs(settings.dggrsType as string)
    const zone = inst.getZoneFromTextID(id)
    const centroid = inst.getZoneWGS84Centroid(zone)
    const level = inst.getZoneLevel(zone)
    const rows = [
      { label: 'ID', value: id },
      { label: '分辨率', value: String(level) },
      {
        label: '中心',
        value: `${(centroid.lat * DEG_PER_RAD).toFixed(6)}, ${(centroid.lon * DEG_PER_RAD).toFixed(6)}`
      }
    ]
    const parents = parentZones(inst, id)
    if (parents.length > 0) rows.push({ label: '父级', value: parents.join(', ') })
    if (level < DGGAL_TYPES[settings.dggrsType as DggalType]) {
      rows.push({ label: '子级', value: String(childZones(inst, id).length) })
    }
    rows.push({ label: '邻域', value: String(neighborCells(inst, id).length) })
    return rows
  },
  parentLabel: '父级',

  exportName: 'dggal-grid',
  csvColumns: ['dggal', 'resolution', 'center_lat', 'center_lng'],
  csvRow: (feature) => {
    const p = (feature.properties ?? {}) as unknown as {
      dggal: string
      resolution: number
      center_lat: number
      center_lng: number
    }
    return [p.dggal, p.resolution, p.center_lat, p.center_lng]
  },

  statusNote: (settings, resolution) => `分辨率 ${resolution} · ${settings.dggrsType}`
}
