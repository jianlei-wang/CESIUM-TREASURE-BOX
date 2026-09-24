/**
 * 四类网格引擎的纯几何/编码计算：
 *   GraticuleEngine（经纬网格）· BeiDouGridEngine（北斗网格）
 *   HydroGridEngine（水文网格）    · DggsGridEngine（DGGS / H3 六边形）
 *
 * 该模块只负责「单元计算 + 几何生成 + LOD 决策」，不直接触碰 Cesium；
 * 渲染由 renderer.ts 的 GridRenderer 统一完成，接口一致、可插拔。
 */
import { cellToBoundary, cellToLatLng, polygonToCells } from 'h3-js'
import { BEIDOU_LEVELS, beidouHeightLevelFor, beidouHeightSlabs, beidouHeightStep, beidouLevel, enumerateCells, levelForCellMeters } from './beidou'
import type { AreaBounds, GridBuild, GridLabel, GridLine, GridPolygon, LonLat } from './types'

const DEG = Math.PI / 180
const METERS_PER_DEG_LAT = 111320

/** 线性插值加密：让折线沿球面弯曲（经纬网格的纬线、矩形边与六边形边）。 */
export function densify(points: LonLat[], segmentsPerEdge: number): LonLat[] {
  if (points.length < 2) return points
  const segs = Math.max(1, Math.round(segmentsPerEdge))
  const out: LonLat[] = []
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    for (let s = 0; s < segs; s += 1) {
      const t = s / segs
      out.push({ lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t })
    }
  }
  out.push(points[points.length - 1])
  return out
}

function rectRing(west: number, south: number, east: number, north: number): LonLat[] {
  return [
    { lon: west, lat: south },
    { lon: east, lat: south },
    { lon: east, lat: north },
    { lon: west, lat: north },
    { lon: west, lat: south }
  ]
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`
}

/** 度数格式化为 度/分/秒 方位标注，如 107°E、28°50′N、117°33′45″E。 */
export function formatDegree(value: number, axis: 'lon' | 'lat'): string {
  const hemi = axis === 'lon' ? (value >= 0 ? 'E' : 'W') : value >= 0 ? 'N' : 'S'
  const abs = Math.abs(value)
  let d = Math.floor(abs)
  let m = Math.floor((abs - d) * 60)
  let s = Math.round(((abs - d) * 60 - m) * 60)
  if (s >= 60) {
    s -= 60
    m += 1
  }
  if (m >= 60) {
    m -= 60
    d += 1
  }
  if (s > 0) return `${d}°${m}′${s}″${hemi}`
  if (m > 0) return `${d}°${m}′${hemi}`
  return `${d}°${hemi}`
}

/** 经纬网格：相机高度 → 间隔（度），保证任意视域下网格线数量可控。 */
const GRATICULE_INTERVALS: Array<{ minHeight: number; interval: number }> = [
  { minHeight: 6_000_000, interval: 30 },
  { minHeight: 3_000_000, interval: 15 },
  { minHeight: 1_500_000, interval: 10 },
  { minHeight: 800_000, interval: 5 },
  { minHeight: 400_000, interval: 2 },
  { minHeight: 180_000, interval: 1 },
  { minHeight: 90_000, interval: 0.5 },
  { minHeight: 45_000, interval: 0.2 },
  { minHeight: 22_000, interval: 0.1 },
  { minHeight: 11_000, interval: 0.05 },
  { minHeight: 5_500, interval: 0.02 },
  { minHeight: 2_600, interval: 0.01 },
  { minHeight: 1_200, interval: 0.005 },
  { minHeight: 600, interval: 0.002 },
  { minHeight: 0, interval: 0.001 }
]

export function graticuleIntervalFor(height: number): number {
  for (const item of GRATICULE_INTERVALS) {
    if (height >= item.minHeight) return item.interval
  }
  return 0.001
}

export function formatInterval(interval: number): string {
  if (interval >= 1) return `${interval}°`
  const minutes = interval * 60
  if (minutes >= 1) return `${Number(minutes.toFixed(minutes % 1 === 0 ? 0 : 2))}′`
  return `${Number((interval * 3600).toFixed(2))}″`
}

export function buildGraticule(bounds: AreaBounds, interval: number): GridBuild {
  const lines: GridLine[] = []
  const labels: GridLabel[] = []
  const lonStart = Math.ceil(bounds.west / interval - 1e-9) * interval
  for (let lon = lonStart; lon <= bounds.east + 1e-9; lon += interval) {
    const lng = Math.abs(lon) < 1e-9 ? 0 : lon
    lines.push({ points: densify([{ lon: lng, lat: bounds.south }, { lon: lng, lat: bounds.north }], 20) })
    labels.push({ position: { lon: lng, lat: bounds.south + (bounds.north - bounds.south) * 0.015 }, text: formatDegree(lng, 'lon') })
  }
  const latStart = Math.ceil(bounds.south / interval - 1e-9) * interval
  for (let lat = latStart; lat <= bounds.north + 1e-9; lat += interval) {
    if (Math.abs(lat) > 85) continue
    lines.push({ points: densify([{ lon: bounds.west, lat }, { lon: bounds.east, lat }], 48) })
    labels.push({ position: { lon: bounds.west + (bounds.east - bounds.west) * 0.012, lat }, text: formatDegree(lat, 'lat') })
  }
  return {
    lines,
    polygons: [],
    labels,
    count: lines.length,
    note: `间隔 ${formatInterval(interval)}`,
    levelValue: interval,
    downgraded: false
  }
}

/** 北斗网格：相机高度 → 目标层级，并保证视域内单元数不超过上限。 */
export function beidouLevelForHeight(height: number, latitude: number): number {
  const targetMeters = Math.max(30, height / 6)
  return levelForCellMeters(targetMeters, latitude)
}

export function estimateBeidouCount(bounds: AreaBounds, level: number): number {
  const spec = beidouLevel(level)
  const cols = Math.floor(bounds.east / spec.lonDeg) - Math.floor(bounds.west / spec.lonDeg) + 1
  const rows = Math.floor(bounds.north / spec.latDeg) - Math.floor(bounds.south / spec.latDeg) + 1
  return Math.max(0, cols) * Math.max(0, rows)
}

export function buildBeidou(bounds: AreaBounds, level: number, maxCells: number, labelTarget = 90, solidHeight = 0, maxBoxes = 24000): GridBuild {
  const solid = solidHeight > 0
  // 三维网格体的高度分层数：体高 ÷ 水平层级单元格边长（近立方体约束）。
  const layersAt = (lv: number): number => (solid ? Math.max(1, Math.ceil(solidHeight / beidouHeightStep(lv))) : 1)
  const fits = (lv: number): boolean => {
    const count = estimateBeidouCount(bounds, lv)
    return count <= maxCells && count * layersAt(lv) <= maxBoxes
  }
  // 三维网格体：水平层级取网格体高对应的层级，使长宽高一致（近立方体）；二维贴地沿用相机 LOD 层级。
  let useLevel = solid
    ? beidouHeightLevelFor(solidHeight)
    : Math.max(1, Math.min(BEIDOU_LEVELS.length, Math.round(level)))
  let adjusted = false
  // 单元过多：向更粗层级（更低级）回退，降低单元数量（同时约束立体单元总量）。
  while (useLevel > 1 && !fits(useLevel)) {
    useLevel -= 1
    adjusted = true
  }
  // 最粗层级仍超限：当前视域过大，暂停该网格以保证渲染流畅。
  if (estimateBeidouCount(bounds, useLevel) > maxCells) {
    return {
      lines: [],
      polygons: [],
      labels: [],
      count: 0,
      note: `视域过大（> ${maxCells} 单元）· 已暂停渲染`,
      levelValue: useLevel,
      downgraded: true
    }
  }
  // 单元过少：向更细层级（更高级）细化，提升可读性（三维下仍保持立方体约束）。
  while (estimateBeidouCount(bounds, useLevel) < 24 && useLevel < BEIDOU_LEVELS.length) {
    const finer = useLevel + 1
    if (!fits(finer)) break
    useLevel = finer
    adjusted = true
  }
  const spec = beidouLevel(useLevel)
  const cells = enumerateCells(bounds, useLevel)
  const lines: GridLine[] = []
  const polygons: GridPolygon[] = []
  const labels: GridLabel[] = []
  // 三维网格体：按标准高度域逐层剖分（层厚 = 水平边长 → 近立方体）。
  let heightDomain: GridBuild['heightDomain']
  let solidLayers: Array<{ base: number; top: number }> | undefined
  let layerAdjusted = false
  if (solid && cells.length > 0) {
    const slabs = beidouHeightSlabs(useLevel, solidHeight, 4096)
    if (cells.length * slabs.length <= maxBoxes) {
      solidLayers = slabs.map((slab) => ({ base: slab.base, top: slab.top }))
      heightDomain = { level: useLevel, layers: slabs.length, thickness: beidouHeightStep(useLevel) }
    } else {
      // 分层后立体单元仍过多：退化为单层整体拉伸以保证渲染流畅。
      layerAdjusted = true
    }
  }
  const labelEvery = Math.max(1, Math.ceil(cells.length / labelTarget))
  cells.forEach((cell, index) => {
    const ring = densify(rectRing(cell.west, cell.south, cell.east, cell.north), 6)
    lines.push({ points: ring })
    const polygon: GridPolygon = { ring, center: { lon: cell.centerLon, lat: cell.centerLat }, code: cell.code }
    if (solidLayers) polygon.solidLayers = solidLayers
    polygons.push(polygon)
    if (index % labelEvery === 0) {
      labels.push({ position: { lon: cell.centerLon, lat: cell.centerLat }, text: cell.code })
    }
  })
  const thicknessText = heightDomain
    ? heightDomain.thickness >= 1000
      ? `${(heightDomain.thickness / 1000).toFixed(heightDomain.thickness % 1000 === 0 ? 0 : 1)} km`
      : `${heightDomain.thickness.toFixed(0)} m`
    : ''
  return {
    lines,
    polygons,
    labels,
    count: cells.length,
    note: heightDomain ? `${useLevel} 级 · ${spec.label} · 高度域 Lh ${heightDomain.level} 级（水平同级）· ${heightDomain.layers} 层 × ${thicknessText}` : `${useLevel} 级 · ${spec.label}`,
    levelValue: useLevel,
    downgraded: adjusted || layerAdjusted,
    heightDomain
  }
}

/** 水文网格：固定目标流域 + 步长（米）→ 行列规则格网。 */
export function buildHydro(region: AreaBounds, stepMeters: number, maxCells: number, labelTarget = 60): GridBuild {
  const centerLat = (region.south + region.north) / 2
  let step = Math.max(20, stepMeters)
  let rows = 0
  let cols = 0
  for (let guard = 0; guard < 24; guard += 1) {
    const dLat = step / METERS_PER_DEG_LAT
    const dLon = step / (METERS_PER_DEG_LAT * Math.max(0.15, Math.cos(centerLat * DEG)))
    rows = Math.max(1, Math.ceil((region.north - region.south) / dLat))
    cols = Math.max(1, Math.ceil((region.east - region.west) / dLon))
    if (rows * cols <= maxCells) break
    step *= 2
  }
  const downgraded = step !== Math.max(20, stepMeters)
  const dLat = step / METERS_PER_DEG_LAT
  const dLon = step / (METERS_PER_DEG_LAT * Math.max(0.15, Math.cos(centerLat * DEG)))
  const lines: GridLine[] = []
  const polygons: GridPolygon[] = []
  const labels: GridLabel[] = []
  const labelEvery = Math.max(1, Math.ceil((rows * cols) / labelTarget))
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const west = region.west + col * dLon
      const south = region.south + row * dLat
      const east = Math.min(region.east, west + dLon)
      const north = Math.min(region.north, south + dLat)
      const code = `R${pad2(row + 1)}C${pad2(col + 1)}`
      const ring = densify(rectRing(west, south, east, north), 4)
      lines.push({ points: ring })
      polygons.push({ ring, center: { lon: (west + east) / 2, lat: (south + north) / 2 }, code })
      const index = row * cols + col
      if (index % labelEvery === 0) {
        labels.push({ position: { lon: (west + east) / 2, lat: (south + north) / 2 }, text: code })
      }
    }
  }
  return {
    lines,
    polygons,
    labels,
    count: rows * cols,
    note: `${rows} 行 × ${cols} 列 · 步长 ${step >= 1000 ? `${(step / 1000).toFixed(step % 1000 === 0 ? 0 : 1)} km` : `${step} m`}`,
    levelValue: step,
    downgraded
  }
}

/** DGGS：相机高度 → H3 分辨率（层级）。 */
const DGGS_RESOLUTIONS: Array<{ minHeight: number; res: number }> = [
  { minHeight: 4_000_000, res: 0 },
  { minHeight: 1_200_000, res: 1 },
  { minHeight: 500_000, res: 2 },
  { minHeight: 200_000, res: 3 },
  { minHeight: 80_000, res: 4 },
  { minHeight: 32_000, res: 5 },
  { minHeight: 12_000, res: 6 },
  { minHeight: 5_000, res: 7 },
  { minHeight: 2_000, res: 8 },
  { minHeight: 800, res: 9 },
  { minHeight: 0, res: 10 }
]

export function dggsResolutionForHeight(height: number): number {
  for (const item of DGGS_RESOLUTIONS) {
    if (height >= item.minHeight) return item.res
  }
  return 10
}

function clampDggsBounds(bounds: AreaBounds): AreaBounds {
  const west = Math.max(-179, Math.min(179, bounds.west))
  const east = Math.max(west + 1e-4, Math.min(179, bounds.east))
  const south = Math.max(-80, Math.min(80, bounds.south))
  const north = Math.max(south + 1e-4, Math.min(80, bounds.north))
  return { west, south, east, north }
}

export function buildDggs(bounds: AreaBounds, res: number, maxCells: number, labelTarget = 70): GridBuild {
  const area = clampDggsBounds(bounds)
  const ring: Array<[number, number]> = [
    [area.west, area.north],
    [area.east, area.north],
    [area.east, area.south],
    [area.west, area.south],
    [area.west, area.north]
  ]
  let useRes = Math.max(0, Math.min(12, Math.round(res)))
  let cells: string[] = []
  let adjusted = false
  // 单元过多：向更粗分辨率（更低 res）回退，降低单元数量。
  for (let guard = 0; guard < 14; guard += 1) {
    try {
      cells = polygonToCells([ring], useRes, true) as unknown as string[]
    } catch {
      cells = []
    }
    if (cells.length <= maxCells || useRes <= 0) break
    useRes -= 1
    adjusted = true
  }
  if (cells.length > maxCells) {
    const stride = Math.ceil(cells.length / maxCells)
    cells = cells.filter((_, index) => index % stride === 0)
    adjusted = true
  }
  const lines: GridLine[] = []
  const polygons: GridPolygon[] = []
  const labels: GridLabel[] = []
  const labelEvery = Math.max(1, Math.ceil(cells.length / labelTarget))
  cells.forEach((cell, index) => {
    let boundary: number[][]
    let centerTuple: number[]
    try {
      boundary = cellToBoundary(cell, false) as unknown as number[][]
      centerTuple = cellToLatLng(cell) as unknown as number[]
    } catch {
      return
    }
    if (!boundary.length || !centerTuple.length) return
    const ringPoints: LonLat[] = boundary.map((p) => ({ lat: p[0], lon: p[1] }))
    ringPoints.push({ ...ringPoints[0] })
    const ringDense = densify(ringPoints, 3)
    lines.push({ points: ringDense })
    polygons.push({ ring: ringDense, center: { lon: centerTuple[1], lat: centerTuple[0] }, code: cell })
    if (index % labelEvery === 0) {
      labels.push({ position: { lon: centerTuple[1], lat: centerTuple[0] }, text: cell.slice(-5) })
    }
  })
  return {
    lines,
    polygons,
    labels,
    count: cells.length,
    note: `res ${useRes} · 六边形孔径 7`,
    levelValue: useRes,
    downgraded: adjusted
  }
}
