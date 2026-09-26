import type { Polygon, Position } from 'geojson'

/** 画布视图状态：中心经纬度、缩放与像素尺寸。 */
export type DggsView = {
  centerLon: number
  centerLat: number
  zoom: number
  width: number
  height: number
}

/** 屏幕坐标。 */
export type ScreenPoint = { x: number; y: number }

const TILE_SIZE = 256
const DEG = Math.PI / 180
/** Web Mercator 可表示的纬度上限。 */
const MAX_MERCATOR_LAT = 85.05112878

function clampLat(lat: number): number {
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat))
}

/** 经度归一化到 [-180, 180)。 */
export function normalizeLon(lon: number): number {
  let x = lon
  while (x >= 180) x -= 360
  while (x < -180) x += 360
  return x
}

function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom
}

/** Mercator 归一化 x（0..1）。 */
function mercatorX(lon: number): number {
  return (lon + 180) / 360
}

/** Mercator 归一化 y（0..1）。 */
function mercatorY(lat: number): number {
  const s = Math.sin(clampLat(lat) * DEG)
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
}

function inverseMercatorLat(t: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * t))) / DEG
}

/** 当前视图左上角对应的归一化世界坐标。 */
function viewOrigin(view: DggsView): { x: number; y: number } {
  return {
    x: mercatorX(view.centerLon) * worldSize(view.zoom) - view.width / 2,
    y: mercatorY(view.centerLat) * worldSize(view.zoom) - view.height / 2
  }
}

/** 经度 / 纬度投影到屏幕坐标（经度可落在任意世界副本）。 */
export function project(lon: number, lat: number, view: DggsView): ScreenPoint {
  const world = worldSize(view.zoom)
  const origin = viewOrigin(view)
  // 选择最靠近视图中心的世界副本，保证跨 180° 的连续经纬不会突然折返。
  const centerWorldX = mercatorX(view.centerLon) * world
  const rawX = mercatorX(lon) * world
  let x = rawX
  while (x - centerWorldX > world / 2) x -= world
  while (centerWorldX - x > world / 2) x += world
  return { x: x - origin.x, y: mercatorY(lat) * world - origin.y }
}

/** 屏幕坐标反投影为原始经度（不归一化）与纬度。 */
export function unprojectRaw(x: number, y: number, view: DggsView): [number, number] {
  const world = worldSize(view.zoom)
  const origin = viewOrigin(view)
  const lon = ((x + origin.x) / world) * 360 - 180
  const lat = inverseMercatorLat((y + origin.y) / world)
  return [lon, lat]
}

/** 屏幕坐标反投影为 [经度, 纬度]（经度归一化）。 */
export function unproject(x: number, y: number, view: DggsView): [number, number] {
  const [lon, lat] = unprojectRaw(x, y, view)
  return [normalizeLon(lon), lat]
}

/** 由视图推出的经纬四至（纬度夹取到 Web Mercator 范围，经度可跨 180°）。 */
export function viewBounds(view: DggsView): {
  west: number
  south: number
  east: number
  north: number
} {
  const [rawWest, north] = unprojectRaw(0, 0, view)
  const [rawEast, south] = unprojectRaw(view.width, view.height, view)
  if (rawEast - rawWest >= 360) {
    return { west: -180, south, east: 180, north }
  }
  return {
    west: normalizeLon(rawWest),
    south,
    east: normalizeLon(rawEast),
    north
  }
}

/**
 * 在保持某经纬点固定于指定屏幕坐标的前提下求新的视图中心。
 * 用于滚轮以光标为锚点缩放。
 */
export function recenterOn(
  view: DggsView,
  lon: number,
  lat: number,
  px: number,
  py: number
): { centerLon: number; centerLat: number } {
  const world = worldSize(view.zoom)
  const cx = (mercatorX(lon) * world - px + view.width / 2) / world
  const cy = (mercatorY(lat) * world - py + view.height / 2) / world
  return { centerLon: normalizeLon(cx * 360 - 180), centerLat: inverseMercatorLat(cy) }
}

/** 按屏幕像素位移平移视图中心。 */
export function panCenter(
  view: DggsView,
  dx: number,
  dy: number
): { centerLon: number; centerLat: number } {
  const world = worldSize(view.zoom)
  const cx = mercatorX(view.centerLon) - dx / world
  const cy = mercatorY(view.centerLat) - dy / world
  return { centerLon: normalizeLon(cx * 360 - 180), centerLat: inverseMercatorLat(cy) }
}

/** 多边形环投影为屏幕路径。 */
export function ringToScreen(ring: Position[], view: DggsView): ScreenPoint[] {
  const points: ScreenPoint[] = []
  for (const [lon, lat] of ring) {
    const point = project(lon, lat, view)
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    points.push(point)
  }
  return points
}

/** 多边形（含洞）的屏幕坐标；外环 + 内部孔环。 */
export function polygonToScreen(polygon: Polygon, view: DggsView): ScreenPoint[][] {
  return polygon.coordinates.map((ring) => ringToScreen(ring as Position[], view))
}

/** 屏幕点是否落在某环内（射线法）。 */
export function screenPointInRing(point: ScreenPoint, ring: ScreenPoint[]): boolean {
  if (ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x
    const yi = ring[i].y
    const xj = ring[j].x
    const yj = ring[j].y
    if (yi > point.y !== yj > point.y) {
      const x = ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
      if (point.x < x) inside = !inside
    }
  }
  return inside
}

/** 屏幕点是否落在已投影的环组内（外环内且不在任一孔内）。 */
export function pointInProjectedPolygon(point: ScreenPoint, rings: ScreenPoint[][]): boolean {
  if (rings.length === 0 || !screenPointInRing(point, rings[0])) return false
  for (let i = 1; i < rings.length; i += 1) {
    if (screenPointInRing(point, rings[i])) return false
  }
  return true
}
