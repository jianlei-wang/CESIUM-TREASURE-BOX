import * as jstsModule from 'jsts'
import { pointInRing, ringSignedArea, type GridPoint, type GridRing } from './contour'

type JstsNamespace = typeof jstsModule
type JstsApi = JstsNamespace['default']
const jstsNs = jstsModule as unknown as { operation?: unknown; default?: JstsNamespace }
const jsts = (jstsNs.operation ? jstsNs : jstsNs.default) as unknown as JstsApi

const reader = new jsts.io.GeoJSONReader()
const writer = new jsts.io.GeoJSONWriter()

type RingGroup = { outer: GridRing; holes: GridRing[] }

function closeRing(points: GridRing): number[][] {
  const out = points.map((point) => [point.x, point.y])
  const first = out[0]
  const last = out[out.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]])
  return out
}

/**
 * 以「射线法嵌套深度」区分外环与孔洞：深度为偶数的是实体外环，奇数的是被包围的未过火孔洞。
 * 再将每个孔洞归入包含它且面积最小的外环，重建带孔多边形，避免布尔并集把孔洞错误填实。
 */
function groupRings(rings: GridRing[]): RingGroup[] {
  const reps = rings.map((ring) => ring[0])
  const depth = rings.map((_, i) => {
    let count = 0
    for (let j = 0; j < rings.length; j += 1) {
      if (i === j) continue
      if (pointInRing(reps[i], rings[j])) count += 1
    }
    return count
  })

  const outers: number[] = []
  const holes: number[] = []
  rings.forEach((_, i) => (depth[i] % 2 === 0 ? outers : holes).push(i))

  const groups: RingGroup[] = outers.map((i) => ({ outer: rings[i], holes: [] }))
  for (const h of holes) {
    let best = -1
    let bestArea = Infinity
    for (let g = 0; g < groups.length; g += 1) {
      if (!pointInRing(reps[h], groups[g].outer)) continue
      const area = Math.abs(ringSignedArea(groups[g].outer))
      if (area < bestArea) {
        bestArea = area
        best = g
      }
    }
    if (best >= 0) groups[best].holes.push(rings[h])
  }
  return groups
}

function toGridRing(coords: unknown): GridRing {
  if (!Array.isArray(coords)) return []
  const points: GridPoint[] = []
  for (const raw of coords as unknown[]) {
    if (!Array.isArray(raw) || raw.length < 2) continue
    const x = Number(raw[0])
    const y = Number(raw[1])
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y })
  }
  if (points.length >= 2) {
    const first = points[0]
    const last = points[points.length - 1]
    if (first.x === last.x && first.y === last.y) points.pop()
  }
  return points
}

function collectRings(node: unknown, out: GridRing[]): void {
  if (!node || typeof node !== 'object') return
  const geom = node as { type?: string; coordinates?: unknown; geometries?: unknown }
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
    for (const ring of geom.coordinates as unknown[]) {
      const grid = toGridRing(ring)
      if (grid.length >= 3) out.push(grid)
    }
    return
  }
  if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
    for (const poly of geom.coordinates as unknown[]) collectRings({ type: 'Polygon', coordinates: poly }, out)
    return
  }
  if (geom.type === 'GeometryCollection' && Array.isArray(geom.geometries)) {
    for (const child of geom.geometries as unknown[]) collectRings(child, out)
  }
}

/**
 * 多边形布尔融合：把多个（可能重叠/嵌套的）等时线环通过 jsts 布尔并集合并为拓扑正确的边界。
 * 多着火点的火场范围切割、边界重叠；等时线环的微小自交；未过火孔洞均在此一并修复。
 * 任何异常都回退到原始环，保证渲染不中断。
 */
export function fuseRings(rings: GridRing[]): GridRing[] {
  if (rings.length <= 1) return rings
  try {
    const groups = groupRings(rings)
    if (!groups.length) return rings
    if (groups.length === 1) {
      return [groups[0].outer, ...groups[0].holes]
    }
    const polygons = groups.map((group) => ({
      type: 'Polygon',
      coordinates: [closeRing(group.outer), ...group.holes.map((hole) => closeRing(hole))]
    }))
    const geometries = polygons.map((polygon) => reader.read(polygon))
    const unioned = jsts.operation.union.UnaryUnionOp.union(geometries)
    const written = writer.write(unioned) as unknown
    const out: GridRing[] = []
    collectRings(written, out)
    return out.length ? out : rings
  } catch {
    return rings
  }
}
