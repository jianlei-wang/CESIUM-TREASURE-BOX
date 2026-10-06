import { Delaunay } from 'd3'
import { haversine, type LonLat } from '../core/geo'

export type DelaunayIndex = {
  raw: unknown
  count: number
  /** 相邻（Delaunay 邻接）点索引。 */
  neighbors: (i: number) => number[]
  /** 最近邻点索引（按球面距离排序）。 */
  nearest: (i: number, k: number) => number[]
  /** 包含点 (lon,lat) 的三角形索引。 */
  find: (lon: number, lat: number) => number
  /** Voronoi 单元多边形。 */
  cellPolygon: (i: number) => LonLat[] | null
}

/** 基于 d3-delaunay 构建经纬度平面上的 Delaunay / Voronoi 索引。 */
export function buildDelaunay(points: LonLat[]): DelaunayIndex {
  const delaunay = Delaunay.from(points as never) as unknown as {
    neighbors(i: number): Iterable<number>
    find(x: number, y: number): number
    voronoi(bounds: [number, number, number, number]): { cellPolygon(i: number): Array<[number, number]> | null }
  }
  let bounds: [number, number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const [lon, lat] of points) {
    bounds = [Math.min(bounds[0], lon), Math.min(bounds[1], lat), Math.max(bounds[2], lon), Math.max(bounds[3], lat)]
  }
  const pad = 0.02 * Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1], 1)
  const voronoi = delaunay.voronoi([bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad])

  return {
    raw: delaunay,
    count: points.length,
    neighbors: (i) => [...delaunay.neighbors(i)],
    nearest: (i, k) => {
      const origin = points[i]
      const scored: Array<{ index: number; distance: number }> = []
      const neighborSet = new Set<number>(delaunay.neighbors(i))
      for (const index of neighborSet) {
        if (index === i) continue
        scored.push({ index, distance: haversine(origin, points[index]) })
      }
      scored.sort((a, b) => a.distance - b.distance)
      return scored.slice(0, k).map((item) => item.index)
    },
    find: (lon, lat) => delaunay.find(lon, lat),
    cellPolygon: (i) => {
      const polygon = voronoi.cellPolygon(i)
      if (!polygon) return null
      return polygon.map(([lon, lat]) => [lon, lat] as LonLat)
    }
  }
}
