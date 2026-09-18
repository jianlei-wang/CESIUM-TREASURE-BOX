/**
 * 三级影响区计算引擎（纯 TS，不依赖 Cesium / DOM）。
 *
 * 变形场：各向异性反距离加权（IDW）插值站点速率 → 阈值等值线（marching squares）
 *  → 红/橙区面化（含站点缓冲、边界裁剪、jsts 布尔运算）。
 * 影响区：D8 最陡下降流路 + Scheidegger 能量线 + Corominas / 浅层降雨经验滑距，
 *  取最不利包络，横向按扩散角展宽并在坡脚生成堆积扇。
 */

import * as jstsModule from 'jsts'
import type { JtsGeometry } from 'jsts'
import {
  DEFAULT_ZONE_CONFIG,
  type DemGrid,
  type Ring,
  type SlopeProfile,
  type ThresholdConfig,
  type ZoneConfig,
  type ZoneSnapshot
} from './types'
import { WarningLevel, type WarningLevelValue } from './types'
import { makeProjector, pointInRing, signedArea, type Projector } from './projection'
import { clamp } from './rng'

type JstsNamespace = typeof jstsModule
type JstsApi = JstsNamespace['default']
const jstsNs = jstsModule as unknown as { operation?: unknown; default?: JstsNamespace }
const jsts = (jstsNs.operation ? jstsNs : jstsNs.default) as unknown as JstsApi
const { BufferOp, BufferParameters } = jsts.operation.buffer
const { GeoJSONReader, GeoJSONWriter } = jsts.io
const reader = new GeoJSONReader()
const writer = new GeoJSONWriter()

type PolyCoords = number[][][]
type MultiCoords = number[][][][]
type LocalPoint = [number, number]

export interface StationState {
  id: string
  lon: number
  lat: number
  v: number
  level: WarningLevelValue
  qualityOk: boolean
  azimuth: number
}

export interface ZoneInput {
  index: number
  time: number
  stations: StationState[]
  boundary: [number, number][]
  /** 变形场（IDW / 等值线）计算网格 */
  zoneSpec: GridSpec
  /** 用于能量线与流路推演的高程网格 */
  dem: DemGrid
  thickness: number
  zoneConfig: ZoneConfig
  thresholdConfig: ThresholdConfig
  slopeProfile: SlopeProfile
}

const DEG = Math.PI / 180

/* ------------------------------- jsts 包装 ------------------------------- */

function closeRing(ring: number[][]): number[][] {
  if (ring.length === 0) return ring
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) return ring
  return [...ring, [first[0], first[1]]]
}

function jstsFromMultiPolygons(polys: MultiCoords): JtsGeometry | null {
  const valid = polys
    .filter((poly) => poly.length > 0 && poly[0].length >= 3)
    .map((poly) => poly.map(closeRing))
    .filter((poly) => poly[0].length >= 4)
  if (valid.length === 0) return null
  try {
    return reader.read({ type: 'MultiPolygon', coordinates: valid })
  } catch {
    return null
  }
}

function jstsToMultiPolygons(geometry: JtsGeometry | null): MultiCoords {
  if (!geometry || geometry.isEmpty()) return []
  try {
    const written = writer.write(geometry) as { type: string; coordinates: unknown }
    if (written.type === 'Polygon') return [written.coordinates as PolyCoords]
    if (written.type === 'MultiPolygon') return written.coordinates as MultiCoords
  } catch {
    return []
  }
  return []
}

function jstsUnion(list: (JtsGeometry | null)[]): JtsGeometry | null {
  const valid = list.filter((item): item is JtsGeometry => !!item && !item.isEmpty())
  if (valid.length === 0) return null
  try {
    let acc = valid[0]
    for (let i = 1; i < valid.length; i += 1) acc = acc.union(valid[i])
    return acc
  } catch {
    return valid[0]
  }
}

function jstsDifference(base: JtsGeometry | null, others: (JtsGeometry | null)[]): JtsGeometry | null {
  if (!base || base.isEmpty()) return null
  let acc = base
  for (const other of others) {
    if (!other || other.isEmpty()) continue
    try {
      acc = acc.difference(other)
    } catch {
      // 布尔运算失败时跳过该次裁剪，保证结果可用
    }
  }
  return acc
}

function jstsIntersection(a: JtsGeometry | null, b: JtsGeometry | null): JtsGeometry | null {
  if (!a || !b) return null
  try {
    const out = a.intersection(b)
    return out && !out.isEmpty() ? out : null
  } catch {
    return a
  }
}

function jstsBuffer(geometry: JtsGeometry | null, radius: number): JtsGeometry | null {
  if (!geometry || geometry.isEmpty() || radius <= 0) return geometry
  try {
    const params = new BufferParameters()
    params.setQuadrantSegments(8)
    params.setJoinStyle(BufferParameters.JOIN_ROUND)
    params.setEndCapStyle(BufferParameters.CAP_ROUND)
    return new BufferOp(geometry, params).getResultGeometry(radius)
  } catch {
    return geometry
  }
}

function pointBufferPolygon(x: number, y: number, radius: number): JtsGeometry | null {
  const segments = 16
  const ring: number[][] = []
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2
    ring.push([x + Math.cos(a) * radius, y + Math.sin(a) * radius])
  }
  try {
    return reader.read({ type: 'Polygon', coordinates: [ring] })
  } catch {
    return null
  }
}

/* ------------------------------- 网格与 IDW ------------------------------- */

export interface GridExtent {
  west: number
  south: number
  east: number
  north: number
}

export function computeGridExtent(boundary: [number, number][], expandM: number, projector: Projector): GridExtent {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [lon, lat] of boundary) {
    const [x, y] = projector.toLocal(lon, lat)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  const [west, south] = projector.toLngLat(minX - expandM, minY - expandM)
  const [east, north] = projector.toLngLat(maxX + expandM, maxY + expandM)
  return { west, south, east, north }
}

export interface GridSpec {
  extent: GridExtent
  nx: number
  ny: number
  dx: number
  dy: number
  /** 网格左下角局部米坐标 */
  x0: number
  y0: number
}

export function gridSpecFromBounds(
  extent: GridExtent,
  projector: Projector,
  nx: number,
  ny: number
): GridSpec {
  const [xMin, yMin] = projector.toLocal(extent.west, extent.south)
  const [xMax, yMax] = projector.toLocal(extent.east, extent.north)
  const widthM = Math.abs(xMax - xMin)
  const heightM = Math.abs(yMax - yMin)
  return {
    extent,
    nx,
    ny,
    dx: widthM / (nx - 1),
    dy: heightM / (ny - 1),
    x0: Math.min(xMin, xMax),
    y0: Math.min(yMin, yMax)
  }
}

export function makeGridSpec(extent: GridExtent, projector: Projector, zoneConfig: ZoneConfig): GridSpec {
  const [xMin, yMin] = projector.toLocal(extent.west, extent.south)
  const [xMax, yMax] = projector.toLocal(extent.east, extent.north)
  const widthM = Math.abs(xMax - xMin)
  const heightM = Math.abs(yMax - yMin)
  let resolution = Math.max(8, zoneConfig.grid.targetResolutionM)
  let nx = Math.max(8, Math.round(widthM / resolution) + 1)
  let ny = Math.max(8, Math.round(heightM / resolution) + 1)
  while (nx * ny > zoneConfig.grid.maxCells) {
    resolution *= 1.12
    nx = Math.max(8, Math.round(widthM / resolution) + 1)
    ny = Math.max(8, Math.round(heightM / resolution) + 1)
  }
  return gridSpecFromBounds(extent, projector, nx, ny)
}

export function nodeLocal(spec: GridSpec, i: number, j: number): LocalPoint {
  return [spec.x0 + i * spec.dx, spec.y0 + j * spec.dy]
}

/** 各向异性 IDW：主滑方向相关性更强（k 倍放大垂直滑向距离）。无站覆盖返回 null。 */
export function idwValue(
  x: number,
  y: number,
  samples: { x: number; y: number; z: number }[],
  radiusM: number,
  power: number,
  anisotropyK: number,
  theta0Deg: number
): number | null {
  let wSum = 0
  let zSum = 0
  const theta = -theta0Deg * DEG
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  for (const sample of samples) {
    const dx = sample.x - x
    const dy = sample.y - y
    const along = dx * cos - dy * sin
    const cross = dx * sin + dy * cos
    const r = Math.hypot(along, anisotropyK * cross)
    if (r < 0.001) return sample.z
    if (r > radiusM) continue
    const w = 1 / Math.pow(r, power)
    wSum += w
    zSum += w * sample.z
  }
  return wSum === 0 ? null : zSum / wSum
}

/* ----------------------------- marching squares ----------------------------- */

export function marchingSquares(
  values: (number | null)[],
  spec: GridSpec,
  threshold: number
): LocalPoint[][] {
  const { nx, ny } = spec
  const segments: [LocalPoint, LocalPoint][] = []

  const edgePoint = (a: number, b: number, va: number, vb: number, kind: number, i: number, j: number): LocalPoint => {
    const t = va === vb ? 0.5 : clamp((threshold - va) / (vb - va), 0, 1)
    if (kind === 0) return [spec.x0 + (i + t) * spec.dx, spec.y0 + j * spec.dy]
    if (kind === 1) return [spec.x0 + (i + 1) * spec.dx, spec.y0 + (j + t) * spec.dy]
    if (kind === 2) return [spec.x0 + (i + t) * spec.dx, spec.y0 + (j + 1) * spec.dy]
    return [spec.x0 + i * spec.dx, spec.y0 + (j + t) * spec.dy]
  }

  for (let j = 0; j < ny - 1; j += 1) {
    for (let i = 0; i < nx - 1; i += 1) {
      const c0 = values[j * nx + i]
      const c1 = values[j * nx + i + 1]
      const c2 = values[(j + 1) * nx + i + 1]
      const c3 = values[(j + 1) * nx + i]
      if (c0 === null || c1 === null || c2 === null || c3 === null) continue
      let idx = 0
      if (c0 >= threshold) idx |= 1
      if (c1 >= threshold) idx |= 2
      if (c2 >= threshold) idx |= 4
      if (c3 >= threshold) idx |= 8
      if (idx === 0 || idx === 15) continue

      const e0 = () => edgePoint(c0, c1, c0, c1, 0, i, j)
      const e1 = () => edgePoint(c1, c2, c1, c2, 1, i, j)
      const e2 = () => edgePoint(c3, c2, c3, c2, 2, i, j)
      const e3 = () => edgePoint(c0, c3, c0, c3, 3, i, j)

      switch (idx) {
        case 1:
        case 14:
          segments.push([e0(), e3()])
          break
        case 2:
        case 13:
          segments.push([e0(), e1()])
          break
        case 3:
        case 12:
          segments.push([e1(), e3()])
          break
        case 4:
        case 11:
          segments.push([e1(), e2()])
          break
        case 6:
        case 9:
          segments.push([e0(), e2()])
          break
        case 7:
        case 8:
          segments.push([e2(), e3()])
          break
        case 5:
          segments.push([e0(), e3()])
          segments.push([e1(), e2()])
          break
        case 10:
          segments.push([e0(), e1()])
          segments.push([e2(), e3()])
          break
        default:
          break
      }
    }
  }

  return stitch(segments)
}

function pointKey(point: LocalPoint): string {
  return `${Math.round(point[0] * 100)},${Math.round(point[1] * 100)}`
}

function stitch(segments: [LocalPoint, LocalPoint][]): LocalPoint[][] {
  const map = new Map<string, number[]>()
  segments.forEach((seg, index) => {
    for (const end of seg) {
      const key = pointKey(end)
      const list = map.get(key)
      if (list) list.push(index)
      else map.set(key, [index])
    }
  })
  const used = new Array(segments.length).fill(false)
  const rings: LocalPoint[][] = []
  for (let start = 0; start < segments.length; start += 1) {
    if (used[start]) continue
    used[start] = true
    const ring: LocalPoint[] = [segments[start][0], segments[start][1]]
    let current = segments[start][1]
    let guard = 0
    while (guard++ < segments.length + 4) {
      const candidates = map.get(pointKey(current)) ?? []
      let nextIndex = -1
      for (const index of candidates) {
        if (!used[index]) {
          nextIndex = index
          break
        }
      }
      if (nextIndex === -1) break
      used[nextIndex] = true
      const seg = segments[nextIndex]
      const nextPoint = pointKey(seg[0]) === pointKey(current) ? seg[1] : seg[0]
      if (pointKey(nextPoint) === pointKey(ring[0])) {
        rings.push(ring)
        break
      }
      ring.push(nextPoint)
      current = nextPoint
    }
    if (!(pointKey(ring[ring.length - 1]) === pointKey(ring[0])) && ring.length >= 4) {
      rings.push(ring)
    }
  }
  return rings.filter((ring) => ring.length >= 4 && Math.abs(signedArea(ring)) > 1)
}

/* ------------------------------ 环 → 多边形 ------------------------------ */

export function ringsToPolygons(rings: LocalPoint[][]): MultiCoords {
  const outers: LocalPoint[][] = []
  const holes: LocalPoint[][] = []
  for (const ring of rings) {
    if (signedArea(ring) >= 0) outers.push(ring)
    else holes.push(ring)
  }
  const polygons: MultiCoords = outers.map((outer) => [outer.map((p) => [p[0], p[1]])])
  for (const hole of holes) {
    let assigned = false
    for (let i = 0; i < outers.length; i += 1) {
      if (pointInRing(hole[0][0], hole[0][1], outers[i])) {
        polygons[i].push(hole.map((p) => [p[0], p[1]]))
        assigned = true
        break
      }
    }
    if (!assigned) polygons.push([hole.map((p) => [p[0], p[1]])])
  }
  return polygons
}

/* ------------------------------ 能量线与流路 ------------------------------ */

function bilinear(z: number[], spec: GridSpec, x: number, y: number): number | null {
  const fx = (x - spec.x0) / spec.dx
  const fy = (y - spec.y0) / spec.dy
  if (fx < 0 || fy < 0 || fx > spec.nx - 1 || fy > spec.ny - 1) return null
  const i0 = Math.floor(fx)
  const j0 = Math.floor(fy)
  const i1 = Math.min(spec.nx - 1, i0 + 1)
  const j1 = Math.min(spec.ny - 1, j0 + 1)
  const tx = fx - i0
  const ty = fy - j0
  const z00 = z[j0 * spec.nx + i0]
  const z10 = z[j0 * spec.nx + i1]
  const z01 = z[j1 * spec.nx + i0]
  const z11 = z[j1 * spec.nx + i1]
  if ([z00, z10, z01, z11].some((value) => !Number.isFinite(value))) return null
  const top = z00 * (1 - tx) + z10 * tx
  const bottom = z01 * (1 - tx) + z11 * tx
  return top * (1 - ty) + bottom * ty
}

interface FlowNode {
  i: number
  j: number
  x: number
  y: number
  z: number
  dist: number
}

function traceD8(spec: GridSpec, dem: DemGrid, startI: number, startJ: number): FlowNode[] {
  const path: FlowNode[] = []
  const visited = new Set<number>()
  let i = startI
  let j = startJ
  let dist = 0
  for (let step = 0; step < 600; step += 1) {
    const idx = j * spec.nx + i
    if (visited.has(idx)) break
    visited.add(idx)
    const x = spec.x0 + i * spec.dx
    const y = spec.y0 + j * spec.dy
    const z = dem.z[idx]
    path.push({ i, j, x, y, z, dist })
    let best: { i: number; j: number; drop: number; z: number } | null = null
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let di = -1; di <= 1; di += 1) {
        if (di === 0 && dj === 0) continue
        const ni = i + di
        const nj = j + dj
        if (ni < 0 || nj < 0 || ni >= spec.nx || nj >= spec.ny) continue
        const nz = dem.z[nj * spec.nx + ni]
        if (!Number.isFinite(nz)) continue
        const drop = (z - nz) / Math.hypot(di * spec.dx, dj * spec.dy)
        if (!best || drop > best.drop) best = { i: ni, j: nj, drop, z: nz }
      }
    }
    if (!best) break
    if (best.drop <= 0.0004) break
    dist += Math.hypot((best.i - i) * spec.dx, (best.j - j) * spec.dy)
    i = best.i
    j = best.j
  }
  return path
}

function polygonAreaLocal(polys: MultiCoords): number {
  let area = 0
  for (const poly of polys) {
    if (poly.length === 0) continue
    area += Math.abs(signedArea(poly[0] as LocalPoint[]))
    for (let k = 1; k < poly.length; k += 1) area -= Math.abs(signedArea(poly[k] as LocalPoint[]))
  }
  return Math.max(0, area)
}

function polygonBounds(polys: MultiCoords): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }
  }
  if (!Number.isFinite(minX)) return null
  return { minX, maxX, minY, maxY }
}

function fByVolume(volume: number, cfg: ZoneConfig): number {
  const t = cfg.influence.fahrboschung
  if (volume < 1e5) return t.vLt1e5
  if (volume < 1e6) return t.v1e5_1e6
  if (volume < 1e7) return t.v1e6_1e7
  return t.vGt1e7
}

/** 沿流路生成变宽走廊，并在末端叠加堆积扇。 */
function buildCorridor(path: FlowNode[], reachIndex: number, width0: number, cfg: ZoneConfig): MultiCoords {
  const used = path.slice(0, reachIndex + 1)
  if (used.length < 2) return []
  const step = Math.max(1, Math.floor(used.length / 60))
  const sampled = used.filter((_, index) => index % step === 0 || index === used.length - 1)
  const left: LocalPoint[] = []
  const right: LocalPoint[] = []
  for (let k = 0; k < sampled.length; k += 1) {
    const cur = sampled[k]
    const prev = sampled[Math.max(0, k - 1)]
    const next = sampled[Math.min(sampled.length - 1, k + 1)]
    let tx = next.x - prev.x
    let ty = next.y - prev.y
    const len = Math.hypot(tx, ty) || 1
    tx /= len
    ty /= len
    const nx = ty
    const ny = -tx
    const half = (width0 + 2 * cur.dist * Math.tan((cfg.influence.spreadAngleDeg / 2) * DEG)) / 2
    left.push([cur.x + nx * half, cur.y + ny * half])
    right.push([cur.x - nx * half, cur.y - ny * half])
  }
  const ring: LocalPoint[] = [...left, ...right.reverse()]
  const corridor: PolyCoords = [ring.map((p) => [p[0], p[1]])]

  const endNode = sampled[sampled.length - 1]
  const prevNode = sampled[Math.max(0, sampled.length - 3)]
  const dir = Math.atan2(endNode.y - prevNode.y, endNode.x - prevNode.x)
  const radius = Math.max(50, endNode.dist * 0.35)
  const halfAngle = (cfg.influence.depositFanDeg / 2) * DEG
  const fanRing: number[][] = [[endNode.x, endNode.y]]
  for (let k = 0; k <= 24; k += 1) {
    const angle = dir - halfAngle + (k / 24) * halfAngle * 2
    fanRing.push([endNode.x + Math.cos(angle) * radius, endNode.y + Math.sin(angle) * radius])
  }
  return [corridor, [fanRing]]
}

function empiricalRunout(
  totalFall: number,
  slopeAngleDeg: number,
  volume: number,
  cfg: ZoneConfig
): number {
  let length = 0
  if (cfg.influence.useShallowRainModel && totalFall > 1 && slopeAngleDeg > 1) {
    const tana = Math.tan(slopeAngleDeg * DEG)
    length = Math.max(
      length,
      2.67 * Math.pow(totalFall, 0.91) * Math.pow(tana, -1.19),
      3.55 * Math.pow(totalFall, 0.89) * Math.pow(tana, -1.29) * Math.pow(Math.tan(clamp(slopeAngleDeg - 6, 1, 45) * DEG), -0.24)
    )
  }
  if (volume > 0) {
    length = Math.max(length, cfg.influence.empiricalC * Math.pow(volume, cfg.influence.empiricalB))
  }
  return length
}

interface RunoutResult {
  influence: MultiCoords
  runoutLength: number
  volume: number
  frictionF: number
}

function computeRunout(
  sourcePolys: MultiCoords,
  boundaryPolys: MultiCoords,
  spec: GridSpec,
  dem: DemGrid,
  cfg: ZoneConfig,
  thickness: number,
  slideAzimuth: number
): RunoutResult {
  const sourceArea = polygonAreaLocal(sourcePolys)
  const boundaryArea = polygonAreaLocal(boundaryPolys)
  const effectiveArea = sourceArea > 100 ? sourceArea : boundaryArea
  let volume = effectiveArea * thickness
  if (!(volume > 0)) volume = 0.106 * Math.pow(Math.max(effectiveArea, 1), 1.388)
  const f = fByVolume(volume, cfg)

  // 源区尚未形成（无核心区 / 重点区）时不推演影响区，避免早期时次出现虚假滑距
  if (sourceArea <= 100) return { influence: [], runoutLength: 0, volume, frictionF: f }

  const sourceRef = sourcePolys
  const bounds = polygonBounds(sourceRef)

  // 起点：源区（或整个滑坡体）内高程最高的网格点
  let topI = -1
  let topJ = -1
  let topZ = -Infinity
  if (bounds) {
    for (let j = 0; j < spec.ny; j += 1) {
      for (let i = 0; i < spec.nx; i += 1) {
        const z = dem.z[j * spec.nx + i]
        if (!Number.isFinite(z)) continue
        const x = spec.x0 + i * spec.dx
        const y = spec.y0 + j * spec.dy
        const inside =
          x >= bounds.minX - spec.dx && x <= bounds.maxX + spec.dx && y >= bounds.minY - spec.dy && y <= bounds.maxY + spec.dy
        if (inside && z > topZ) {
          topZ = z
          topI = i
          topJ = j
        }
      }
    }
  }

  if (topI < 0 || !Number.isFinite(topZ)) {
    return { influence: [], runoutLength: 0, volume, frictionF: f }
  }

  let path = traceD8(spec, dem, topI, topJ)
  if (path.length < 3) {
    // 回退：沿标称主滑方向直线推演
    const angle = slideAzimuth * DEG
    path = []
    let dist = 0
    const startX = spec.x0 + topI * spec.dx
    const startY = spec.y0 + topJ * spec.dy
    for (let k = 0; k < 120; k += 1) {
      const x = startX + Math.cos(angle - Math.PI / 2) * dist
      const y = startY + Math.sin(angle - Math.PI / 2) * dist
      const z = bilinear(dem.z, spec, x, y)
      if (z === null) break
      path.push({ i: topI, j: topJ, x, y, z, dist })
      dist += spec.dx * 2
    }
    if (path.length < 2) return { influence: [], runoutLength: 0, volume, frictionF: f }
  }

  // 能量线：从 H0 以 θf 下降，与地面首个交点即到达点
  const h0 = path[0].z
  let reachIndex = path.length - 1
  for (let k = 1; k < path.length; k += 1) {
    const energyZ = h0 - f * path[k].dist
    if (path[k].z <= energyZ) {
      reachIndex = k
      break
    }
  }

  const toeZ = Math.min(...path.map((node) => node.z))
  const totalFall = Math.max(1, h0 - toeZ)
  const toeNode = path.reduce((acc, node) => (node.z < acc.z ? node : acc), path[0])
  const horizontalToToe = Math.max(10, toeNode.dist)
  const slopeAngle = (Math.atan2(totalFall, horizontalToToe) * 180) / Math.PI
  const empirical = Math.min(empiricalRunout(totalFall, slopeAngle, volume, cfg), cfg.influence.maxRunoutM)
  if (empirical > path[reachIndex].dist) {
    let index = reachIndex
    while (index < path.length - 1 && path[index].dist < empirical) index += 1
    reachIndex = index
  }

  while (reachIndex > 1 && path[reachIndex].dist > cfg.influence.maxRunoutM) reachIndex -= 1

  const sourceWidth = clamp(Math.sqrt(Math.max(sourceArea, 400)) * 0.7, 60, 260)
  const corridor = buildCorridor(path, reachIndex, sourceWidth, cfg)
  const runoutLength = path[reachIndex].dist
  return { influence: corridor, runoutLength, volume, frictionF: f }
}

/* ------------------------------- 快照总装 ------------------------------- */

export function computeZoneSnapshot(input: ZoneInput): ZoneSnapshot {
  const { stations, boundary, dem, zoneConfig, thresholdConfig } = input
  const projector = makeProjector(input.slopeProfile.lon, input.slopeProfile.lat)
  const spec = input.zoneSpec
  const demSpec = gridSpecFromBounds(
    { west: dem.west, south: dem.south, east: dem.east, north: dem.north },
    projector,
    dem.nx,
    dem.ny
  )

  const boundaryPolys: MultiCoords = [
    [boundary.map(([lon, lat]) => projector.toLocal(lon, lat) as number[])]
  ]

  const samples = stations
    .filter((station) => station.qualityOk && station.v > 0)
    .map((station) => {
      const [x, y] = projector.toLocal(station.lon, station.lat)
      return { x, y, z: station.v }
    })

  const theta0 = samples.length > 0 ? stations.find((s) => s.qualityOk)?.azimuth ?? 0 : 0
  const values: (number | null)[] = new Array(spec.nx * spec.ny).fill(null)
  let covered = 0
  for (let j = 0; j < spec.ny; j += 1) {
    for (let i = 0; i < spec.nx; i += 1) {
      const [x, y] = nodeLocal(spec, i, j)
      const value = idwValue(x, y, samples, zoneConfig.idw.radiusM, zoneConfig.idw.power, zoneConfig.idw.anisotropyK, theta0)
      values[j * spec.nx + i] = value
      if (value !== null) covered += 1
    }
  }

  const vRed = thresholdConfig.rateMmd.red / 24
  const vOrange = thresholdConfig.rateMmd.orange / 24

  const redRings = marchingSquares(values, spec, vRed)
  const orangeRings = marchingSquares(values, spec, vOrange)
  const redRaw = jstsFromMultiPolygons(ringsToPolygons(redRings))
  const orangeRaw = jstsFromMultiPolygons(ringsToPolygons(orangeRings))
  const boundaryGeom = jstsFromMultiPolygons(boundaryPolys)

  // 核心区：红阈值等值线 ∩ 滑坡边界，并确保包含全部红警站点
  let core = jstsIntersection(redRaw, boundaryGeom)
  const redSamples = stations.filter((station) => station.level >= WarningLevel.Red)
  const redBuffers = redSamples
    .map((station) => {
      const [x, y] = projector.toLocal(station.lon, station.lat)
      return pointBufferPolygon(x, y, zoneConfig.buffer.coreStationM)
    })
    .filter((geom): geom is JtsGeometry => !!geom)
  if (redBuffers.length > 0) {
    const coreWithPoints = jstsUnion([core, ...redBuffers])
    core = jstsIntersection(coreWithPoints, boundaryGeom) ?? coreWithPoints
  } else {
    core = jstsIntersection(core, boundaryGeom)
  }

  // 重点区：(橙阈值等值线 ∪ 红区外扩缓冲) − 红区，再裁剪至边界
  let keyBand = jstsUnion([orangeRaw, jstsBuffer(core, zoneConfig.buffer.keyM)])
  keyBand = jstsDifference(keyBand, [core])
  keyBand = jstsIntersection(keyBand, boundaryGeom)

  const corePolys = jstsToMultiPolygons(core)
  const keyPolys = jstsToMultiPolygons(keyBand)
  const sourcePolys = [...corePolys, ...keyPolys]
  const okStations = stations.filter((station) => station.qualityOk)
  const azimuthFromStations =
    okStations.length > 0 ? okStations.reduce((acc, s) => acc + s.azimuth, 0) / okStations.length : 180

  const runout = computeRunout(
    sourcePolys,
    boundaryPolys,
    demSpec,
    dem,
    zoneConfig,
    input.thickness,
    azimuthFromStations
  )

  let influence = jstsFromMultiPolygons(runout.influence)
  const bufferDistance = Math.max(zoneConfig.buffer.influenceM, zoneConfig.influence.bufferFactor * runout.runoutLength)
  influence = jstsBuffer(influence, bufferDistance)
  influence = jstsDifference(influence, [core, keyBand])

  const toLngRings = (polys: MultiCoords): Ring[][] | null => {
    if (polys.length === 0) return null
    const result: Ring[][] = polys.map((poly) =>
      poly.map((ring) => ring.map(([x, y]) => projector.toLngLat(x, y) as [number, number]))
    )
    return result
  }

  const coreOut = toLngRings(corePolys)
  const keyOut = toLngRings(keyPolys)
  const influencePolys = jstsToMultiPolygons(influence)
  const influenceOut = toLngRings(influencePolys)

  const levelCounts = { normal: 0, blue: 0, yellow: 0, orange: 0, red: 0 }
  for (const station of stations) {
    if (station.level >= WarningLevel.Red) levelCounts.red += 1
    else if (station.level === WarningLevel.Orange) levelCounts.orange += 1
    else if (station.level === WarningLevel.Yellow) levelCounts.yellow += 1
    else if (station.level === WarningLevel.Blue) levelCounts.blue += 1
    else levelCounts.normal += 1
  }

  const qualityOkCount = stations.filter((station) => station.qualityOk).length
  const confidence = clamp(
    0.5 * (qualityOkCount / Math.max(1, stations.length)) + 0.5 * (covered / (spec.nx * spec.ny)),
    0,
    1
  )

  const networkLevel = stations.reduce<WarningLevelValue>(
    (acc, station) => (station.level > acc ? station.level : acc),
    WarningLevel.Normal
  )

  return {
    index: input.index,
    time: input.time,
    networkLevel,
    core: coreOut,
    key: keyOut,
    influence: influenceOut,
    stats: {
      coreAreaM2: polygonAreaLocal(corePolys),
      keyAreaM2: polygonAreaLocal(keyPolys),
      influenceAreaM2: polygonAreaLocal(influencePolys),
      runoutLengthM: runout.influence.length > 0 ? runout.runoutLength : null,
      volumeM3: runout.volume,
      frictionF: runout.frictionF,
      confidence
    },
    triggeredStationIds: stations
      .filter((station) => station.level >= WarningLevel.Orange)
      .map((station) => station.id),
    levelCounts
  }
}

export { DEFAULT_ZONE_CONFIG }
