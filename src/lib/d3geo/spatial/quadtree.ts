import { quadtree } from 'd3'

export type ScreenDatum = { index: number; x: number; y: number }

type QuadNode = {
  length?: number
  data?: ScreenDatum
  next?: QuadNode
  [index: number]: QuadNode
}

/** 屏幕空间网格聚类：把投影后的点按 cellSize 像素分桶。 */
export function screenGridCluster(xs: Float32Array, ys: Float32Array, cellSize: number): { assignments: Int32Array; cells: number } {
  const assignments = new Int32Array(xs.length).fill(-1)
  const buckets = new Map<string, number>()
  const size = Math.max(1, cellSize)
  let next = 0
  for (let i = 0; i < xs.length; i += 1) {
    const key = `${Math.floor(xs[i] / size)},${Math.floor(ys[i] / size)}`
    let id = buckets.get(key)
    if (id === undefined) {
      id = next++
      buckets.set(key, id)
    }
    assignments[i] = id
  }
  return { assignments, cells: next }
}

/** 构建 d3-quadtree 空间索引。 */
export function buildScreenQuadtree(datums: ScreenDatum[]): QuadNode {
  const tree = quadtree()
    .x((d: ScreenDatum) => d.x)
    .y((d: ScreenDatum) => d.y)
  tree.addAll(datums)
  return tree as unknown as QuadNode
}

/** 最近邻查询。 */
export function quadtreeNearest(tree: QuadNode, x: number, y: number): ScreenDatum | undefined {
  return (tree as unknown as { find(x: number, y: number): ScreenDatum | undefined }).find(x, y)
}

/** 矩形范围查询。 */
export function quadtreeRange(tree: QuadNode, x0: number, y0: number, x1: number, y1: number): ScreenDatum[] {
  const result: ScreenDatum[] = []
  const visit = (tree as unknown as {
    visit(cb: (node: QuadNode, x0: number, y0: number, x1: number, y1: number) => boolean | void): void
  }).visit
  visit.call(tree, (node, nx0, ny0, nx1, ny1) => {
    if (nx0 > x1 || ny0 > y1 || nx1 < x0 || ny1 < y0) return true
    if (!node.length) {
      let datum = node as QuadNode | undefined
      while (datum) {
        const point = datum.data
        if (point && point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1) result.push(point)
        datum = datum.next
      }
    }
    return false
  })
  return result
}
