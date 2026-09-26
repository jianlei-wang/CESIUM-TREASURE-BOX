/**
 * OLC（Open Location Code / Plus Codes）DGGS 引擎。
 *
 * 从 GeoLibre MapLibre 插件 maplibre-olc.ts 移植为纯 TypeScript 引擎：
 * 只保留「编码单元 + 几何生成」的纯计算逻辑，不依赖 maplibre-gl、
 * 面板或图层代码，由通用 DGGS 外壳（DggsSystem）驱动渲染。
 */
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import OpenLocationCodeModule from 'open-location-code-typescript'
import { clampNumber, normalizeBool, normalizeColor } from '../spec'
import type { DggsBounds, DggsSettings, DggsSystem, IdentifyRow } from '../spec'

// 该库以 CommonJS 发布，带 `exports.default` 类。Vite、tsx 的 CJS 转换或
// Node 原生 ESM 互操作下，默认导入可能是类本身，也可能是包裹它的 exports 对象。
const OpenLocationCode = ((OpenLocationCodeModule as { default?: unknown }).default ??
  OpenLocationCodeModule) as typeof OpenLocationCodeModule

/** 防止过细编码长度在大视域下冻结浏览器。 */
export const OLC_VIEWPORT_CELL_LIMIT = 20_000

/**
 * 完整 Open Location Code 允许的编码长度：最多 10 位成对数字，
 * 之后是单个网格细化位（此时单元不再为正方形）。
 */
export const OLC_CODE_LENGTHS = [2, 4, 6, 8, 10, 11, 12, 13, 14, 15] as const

export type OlcCodeLength = (typeof OLC_CODE_LENGTHS)[number]

export const MAX_OLC_CODE_LENGTH: OlcCodeLength = 15

export interface OlcGridSettings {
  /** 由地图缩放推导编码长度，而非使用手动选择值。 */
  autoResolution: boolean
  /** 完整编码长度：OLC_CODE_LENGTHS 之一。 */
  resolution: OlcCodeLength
  fillColor: string
  fillOpacity: number
  lineColor: string
  lineWidth: number
  showLabels: boolean
  includeNeighbors: boolean
  /** 插件设置键为单数；外壳统一使用 includeParents。 */
  includeParent: boolean
}

export const DEFAULT_OLC_GRID_SETTINGS: OlcGridSettings = {
  autoResolution: true,
  // GeoLibre 默认世界视图下即刻可用：长度 2 的编码以 162 个二十度单元铺满全球。
  resolution: 2,
  fillColor: '#e11d48',
  fillOpacity: 0.08,
  lineColor: '#e11d48',
  lineWidth: 1,
  showLabels: true,
  includeNeighbors: false,
  includeParent: false,
}

/** 将任意数值吸附到最近的合法完整编码长度。 */
function toCodeLength(value: unknown, fallback: OlcCodeLength): OlcCodeLength {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  let best: OlcCodeLength = OLC_CODE_LENGTHS[0]
  for (const length of OLC_CODE_LENGTHS) {
    if (Math.abs(length - number) < Math.abs(best - number)) best = length
  }
  return best
}

/**
 * 自动缩放→编码长度规则，镜像 vgrid-maplibre 的 OLCGrid
 * （https://www.npmjs.com/package/vgrid-maplibre）：随着约 20°/1°/0.05°…
 * 的单元达到可用的屏幕尺寸，逐级切换到合法编码长度。
 */
export function olcResolutionForZoom(zoom: number): OlcCodeLength {
  if (zoom <= 6) return 2
  if (zoom <= 10) return 4
  if (zoom <= 14) return 6
  if (zoom <= 18) return 8
  if (zoom <= 21) return 10
  if (zoom <= 23) return 11
  if (zoom <= 25) return 12
  if (zoom <= 27) return 13
  if (zoom <= 29) return 14
  return 15
}

/** 归一化持久化配置，返回插件自身的 OlcGridSettings 形态。 */
export function normalizeOlcGridSettings(value: unknown): OlcGridSettings {
  const candidate = (value ?? {}) as Partial<OlcGridSettings>
  return {
    autoResolution: normalizeBool(
      candidate.autoResolution,
      DEFAULT_OLC_GRID_SETTINGS.autoResolution,
    ),
    resolution: toCodeLength(candidate.resolution, DEFAULT_OLC_GRID_SETTINGS.resolution),
    fillColor: normalizeColor(candidate.fillColor, DEFAULT_OLC_GRID_SETTINGS.fillColor),
    fillOpacity: clampNumber(candidate.fillOpacity, 0, 1, DEFAULT_OLC_GRID_SETTINGS.fillOpacity),
    lineColor: normalizeColor(candidate.lineColor, DEFAULT_OLC_GRID_SETTINGS.lineColor),
    lineWidth: clampNumber(candidate.lineWidth, 0.1, 8, DEFAULT_OLC_GRID_SETTINGS.lineWidth),
    showLabels: normalizeBool(candidate.showLabels, DEFAULT_OLC_GRID_SETTINGS.showLabels),
    includeNeighbors: normalizeBool(
      candidate.includeNeighbors,
      DEFAULT_OLC_GRID_SETTINGS.includeNeighbors,
    ),
    includeParent: normalizeBool(candidate.includeParent, DEFAULT_OLC_GRID_SETTINGS.includeParent),
  }
}

/**
 * 避免全球视域下成千上万个编码互相重叠：仅显示「自动规则会切到下一更细
 * 编码长度」那一级之下的标注。
 */
export function olcLabelMinZoom(codeLength: number): number {
  const minZoom: Record<number, number> = {
    2: 2,
    4: 5,
    6: 9,
    8: 13,
    10: 17,
    11: 19,
    12: 21,
    13: 22,
    14: 23,
    15: 24,
  }
  return minZoom[toCodeLength(codeLength, 2)] ?? 2
}

/**
 * 将 OLC 单元转为带导出属性的 GeoJSON 多边形。`lngOffset`（360 的整数倍）
 * 把环放置到跨 180° 视域实际观察的「世界副本」中。
 */
export function olcCellFeature(cell: string, lngOffset = 0): Feature<Polygon> {
  const area = OpenLocationCode.decode(cell)
  const west = area.longitudeLo + lngOffset
  const east = area.longitudeHi + lngOffset
  return {
    type: 'Feature',
    id: cell,
    properties: {
      olc: cell,
      resolution: area.codeLength,
      center_lat: area.latitudeCenter,
      center_lng: area.longitudeCenter,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [west, area.latitudeLo],
          [east, area.latitudeLo],
          [east, area.latitudeHi],
          [west, area.latitudeHi],
          [west, area.latitudeLo],
        ],
      ],
    },
  }
}

/**
 * 用 OLC 单元铺满 WGS84 包围盒，镜像 vgrid-maplibre 的 OLCGrid：单元是以
 * -180/-90 为锚点的轴对齐经纬格网，因此填充逐行逐列遍历与盒子相交的部分。
 * 经度可越过 ±180（连续视域）；每个单元用其归一化质心编码，但绘制在视域
 * 所在的世界副本中。
 */
export function olcGridForBounds(
  bounds: [number, number, number, number],
  codeLength: OlcCodeLength,
  limit = OLC_VIEWPORT_CELL_LIMIT,
): FeatureCollection<Polygon> {
  let [west, south, east, north] = bounds
  south = Math.max(-90, Math.min(90, south))
  north = Math.max(-90, Math.min(90, north))
  if (east - west >= 360) {
    west = -180
    east = 180
  }
  // 编码长度 10 以上时网格细化为 4 列 × 5 行，因此从参考单元分别测量两个维度。
  const reference = OpenLocationCode.decode(OpenLocationCode.encode(0, 0, codeLength))
  const latHeight = reference.getLatitudeHeight()
  const lngWidth = reference.getLongitudeWidth()

  if (((east - west) / lngWidth) * ((north - south) / latHeight) > limit * 1.2) {
    throw new RangeError(`OLC cell limit exceeded: ${limit}`)
  }

  const startLng = Math.floor((west + 180) / lngWidth) * lngWidth - 180
  const startLat = Math.max(-90, Math.floor((south + 90) / latHeight) * latHeight - 90)

  const features: Feature<Polygon>[] = []
  // 浮点步进在单元边界附近可能命中同一单元两次；以 (编码, 世界副本) 为键，
  // 使跨 180° 视域仍能在相邻两个副本中绘制同一编码。
  const seen = new Set<string>()
  for (let lng = startLng; lng < east; lng += lngWidth) {
    for (let lat = startLat; lat < north && lat < 90; lat += latHeight) {
      const centerLng = lng + lngWidth / 2
      const cell = OpenLocationCode.encode(lat + latHeight / 2, centerLng, codeLength)
      // 绘制列与归一化单元之间的 360° 倍数差。
      const lngOffset =
        Math.round((centerLng - OpenLocationCode.decode(cell).longitudeCenter) / 360) * 360
      const key = `${cell}@${lngOffset}`
      if (seen.has(key)) continue
      seen.add(key)
      features.push(olcCellFeature(cell, lngOffset))
      if (features.length > limit) {
        throw new RangeError(`OLC cell limit exceeded: ${limit}`)
      }
    }
  }
  return { type: 'FeatureCollection', features }
}

/**
 * OLC 是严格嵌套的网格，因此每个单元恰有一个父级：包含其中心点的上一个
 * 合法编码长度对应的单元。
 */
export function olcParentCell(cell: string): string | null {
  const area = OpenLocationCode.decode(cell)
  const index = OLC_CODE_LENGTHS.indexOf(area.codeLength as OlcCodeLength)
  if (index <= 0) return null
  return OpenLocationCode.encode(
    area.latitudeCenter,
    area.longitudeCenter,
    OLC_CODE_LENGTHS[index - 1],
  )
}

/** 下一个合法编码长度中包含的单元数量。 */
export function olcChildCount(cell: string): number {
  const area = OpenLocationCode.decode(cell)
  const index = OLC_CODE_LENGTHS.indexOf(area.codeLength as OlcCodeLength)
  if (index < 0 || index >= OLC_CODE_LENGTHS.length - 1) return 0
  const child = OpenLocationCode.decode(
    OpenLocationCode.encode(area.latitudeCenter, area.longitudeCenter, OLC_CODE_LENGTHS[index + 1]),
  )
  return Math.round(
    (area.getLatitudeHeight() / child.getLatitudeHeight()) *
      (area.getLongitudeWidth() / child.getLongitudeWidth()),
  )
}

/**
 * 单元本身及其（最多 4 个）边邻域，由偏移质心编码。省略对角线——仅取
 * 东/西/南/北。顶行与底行的单元没有越过极点的邻域；经度通过 encode 的
 * 归一化自动环绕。
 */
export function olcNeighborCells(cell: string): string[] {
  const area = OpenLocationCode.decode(cell)
  const latHeight = area.getLatitudeHeight()
  const lngWidth = area.getLongitudeWidth()
  const ids = new Set<string>([cell])
  for (const [dLat, dLng] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    const lat = area.latitudeCenter + dLat * latHeight
    if (lat < -90 || lat > 90) continue
    ids.add(
      OpenLocationCode.encode(lat, area.longitudeCenter + dLng * lngWidth, area.codeLength),
    )
  }
  return [...ids]
}

/** 外壳使用的默认配置：解包单数 includeParent 为 includeParents。 */
const defaults: DggsSettings = {
  ...DEFAULT_OLC_GRID_SETTINGS,
  includeParents: DEFAULT_OLC_GRID_SETTINGS.includeParent,
}

/**
 * 将持久化配置归一化为 DggsSettings：复用插件逻辑，并把单数 includeParent
 * 映射到外壳使用的 includeParents。同时接受外壳回写的 includeParents，并
 * 保留 includeParent 以兼容旧数据。
 */
export function normalize(value: unknown): DggsSettings {
  const base = normalizeOlcGridSettings(value)
  const candidate = (value ?? {}) as { includeParent?: unknown; includeParents?: unknown }
  const includeParents = normalizeBool(
    candidate.includeParents,
    normalizeBool(candidate.includeParent, base.includeParent),
  )
  return { ...base, includeParents, includeParent: includeParents }
}

export const system: DggsSystem = {
  id: 'dggs-olc',
  title: 'OLC 网格',
  english: 'OLC Grid',
  subtitle: 'Open Location Code · 编码长度分层网格',
  description:
    'Open Location Code（Plus Codes）用变长字母数字编码将地球划分为固定网格，编码长度 2–15 决定单元尺寸，编码越长定位越精确。',
  tag: 'Plus Codes',
  accentColor: '#7c3aed',

  defaults,
  normalize,

  minResolution: 2,
  maxResolution: 15,
  resolutionName: '编码长度',
  resolutionOptions: [...OLC_CODE_LENGTHS],

  resolutionForZoom: olcResolutionForZoom,
  labelMinZoom: olcLabelMinZoom,

  cellAt: (lon, lat, resolution) => OpenLocationCode.encode(lat, lon, resolution),
  buildGrid: (bounds: DggsBounds, resolution) =>
    olcGridForBounds(
      [bounds.west, bounds.south, bounds.east, bounds.north],
      resolution as OlcCodeLength,
    ),
  cellFeature: (id) => olcCellFeature(id),
  parentIds: (id) => {
    const parent = olcParentCell(id)
    return parent ? [parent] : []
  },
  neighborIds: (id) => olcNeighborCells(id).filter((neighbor) => neighbor !== id),
  childCount: (id) => olcChildCount(id),
  identify: (id) => {
    const area = OpenLocationCode.decode(id)
    const rows: IdentifyRow[] = [
      { label: 'ID', value: id },
      { label: '编码长度', value: String(area.codeLength) },
      {
        label: '中心',
        value: `${area.latitudeCenter.toFixed(6)}, ${area.longitudeCenter.toFixed(6)}`,
      },
    ]
    const parent = olcParentCell(id)
    if (parent) rows.push({ label: '父级', value: parent })
    const children = olcChildCount(id)
    if (children > 0) rows.push({ label: '子级', value: String(children) })
    rows.push({ label: '邻域', value: String(olcNeighborCells(id).length - 1) })
    return rows
  },
  parentLabel: '父级',

  exportName: 'olc-grid',
  csvColumns: ['olc', 'resolution', 'center_lat', 'center_lng'],
  csvRow: (feature) => {
    const properties = (feature.properties ?? {}) as {
      olc: string
      resolution: number
      center_lat: number
      center_lng: number
    }
    return [properties.olc, properties.resolution, properties.center_lat, properties.center_lng]
  },

  statusNote: (_settings, resolution) => `编码长度 ${resolution} · Open Location Code`,
}
