export type HydBounds = {
  west: number
  east: number
  south: number
  north: number
}

export type HydGrid = {
  cols: number
  rows: number
  bounds: HydBounds
  cellLon: number
  cellLat: number
  dem: Float32Array
  demMin: number
  demMax: number
}

export type FillResult = {
  filled: Float32Array
  raisedCells: number
  maxRaise: number
}

export type DirResult = {
  dir: Int8Array
  sinks: number
}

export type AccResult = {
  acc: Float64Array
  maxAcc: number
  drainedCells: number
}

export type LinkSegment = {
  id: number
  cells: number[]
}

export type LinkResult = {
  links: LinkSegment[]
  linkOf: Int32Array
  streamOf: Uint8Array
}

export type VectorReach = {
  id: number
  lonlat: { lon: number; lat: number }[]
}

export type PourPoint = {
  lon: number
  lat: number
  col: number
  row: number
  cell: number
  snapped: number
  snappedLon: number
  snappedLat: number
}

export type WatershedResult = {
  mask: Uint8Array
  count: number
  ring: { lon: number; lat: number }[]
  pourCell: number
}

const DR = [-1, -1, 0, 1, 1, 1, 0, -1]
const DC = [0, 1, 1, 1, 0, -1, -1, -1]
const DIST = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2]

export const D8_NAMES = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']

export function buildHydroGrid(bounds: HydBounds, cols: number, rowsOverride?: number): HydGrid {
  const west = Math.min(bounds.west, bounds.east)
  const east = Math.max(bounds.west, bounds.east)
  const south = Math.min(bounds.south, bounds.north)
  const north = Math.max(bounds.south, bounds.north)
  const lonSpanM = Math.max(1e-6, east - west) * 111320 * Math.cos(((south + north) / 2) * Math.PI / 180)
  const latSpanM = Math.max(1e-6, north - south) * 111320
  const cellCount = Math.max(8, Math.round(cols))
  const rows = rowsOverride !== undefined
    ? Math.max(4, Math.min(3000, Math.round(rowsOverride)))
    : Math.max(4, Math.min(3000, Math.round((latSpanM * cellCount) / lonSpanM)))
  const cellLon = (east - west) / cellCount
  const cellLat = (north - south) / rows
  const dem = new Float32Array(cellCount * rows)
  return {
    cols: cellCount,
    rows,
    bounds: { west, east, south, north },
    cellLon,
    cellLat,
    dem,
    demMin: Number.POSITIVE_INFINITY,
    demMax: Number.NEGATIVE_INFINITY
  }
}

export function cellCenter(grid: HydGrid, row: number, col: number): { lon: number; lat: number } {
  return {
    lon: grid.bounds.west + (col + 0.5) * grid.cellLon,
    lat: grid.bounds.north - (row + 0.5) * grid.cellLat
  }
}

export function cellIndexOf(grid: HydGrid, row: number, col: number): number {
  return row * grid.cols + col
}

export function rowOf(grid: HydGrid, cell: number): number {
  return Math.floor(cell / grid.cols)
}

export function colOf(grid: HydGrid, cell: number): number {
  return cell % grid.cols
}

function heapPush(heap: number[][], value: number, cell: number): void {
  heap.push([value, cell])
  let index = heap.length - 1
  while (index > 0) {
    const parent = (index - 1) >> 1
    if (heap[parent][0] <= heap[index][0]) break
    const tmp = heap[parent]
    heap[parent] = heap[index]
    heap[index] = tmp
    index = parent
  }
}

function heapPop(heap: number[][]): [number, number] | undefined {
  if (heap.length === 0) return undefined
  const top = heap[0]
  const last = heap.pop() as number[]
  if (heap.length > 0) {
    heap[0] = last
    let index = 0
    for (;;) {
      const left = index * 2 + 1
      const right = left + 1
      let smallest = index
      if (left < heap.length && heap[left][0] < heap[smallest][0]) smallest = left
      if (right < heap.length && heap[right][0] < heap[smallest][0]) smallest = right
      if (smallest === index) break
      const tmp = heap[smallest]
      heap[smallest] = heap[index]
      heap[index] = tmp
      index = smallest
    }
  }
  return [top[0], top[1]]
}

function gridNeighbors(grid: HydGrid, cell: number): { next: number; d: number }[] {
  const { cols, rows } = grid
  const row = rowOf(grid, cell)
  const col = colOf(grid, cell)
  const out: { next: number; d: number }[] = []
  for (let d = 0; d < 8; d += 1) {
    const nr = row + DR[d]
    const nc = col + DC[d]
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
    out.push({ next: cellIndexOf(grid, nr, nc), d })
  }
  return out
}

export function fillDepressions(grid: HydGrid): FillResult {
  const { cols, rows, dem } = grid
  const total = cols * rows
  const filled = new Float32Array(dem)
  const visited = new Uint8Array(total)
  const heap: number[][] = []
  const pushCell = (cell: number): void => {
    if (visited[cell]) return
    visited[cell] = 1
    heapPush(heap, dem[cell], cell)
  }
  for (let col = 0; col < cols; col += 1) {
    pushCell(cellIndexOf(grid, 0, col))
    pushCell(cellIndexOf(grid, rows - 1, col))
  }
  for (let row = 1; row < rows - 1; row += 1) {
    pushCell(cellIndexOf(grid, row, 0))
    pushCell(cellIndexOf(grid, row, cols - 1))
  }
  while (heap.length > 0) {
    const popped = heapPop(heap)
    if (!popped) break
    const level = popped[0]
    const cell = popped[1]
    for (const { next } of gridNeighbors(grid, cell)) {
      if (visited[next]) continue
      visited[next] = 1
      const nextLevel = Math.max(level, dem[next])
      filled[next] = nextLevel
      heapPush(heap, nextLevel, next)
    }
  }
  let raisedCells = 0
  let maxRaise = 0
  for (let cell = 0; cell < total; cell += 1) {
    const raise = filled[cell] - dem[cell]
    if (raise > 0.001) {
      raisedCells += 1
      if (raise > maxRaise) maxRaise = raise
    }
  }
  return { filled, raisedCells, maxRaise }
}

export function computeD8Direction(grid: HydGrid, filled: Float32Array): DirResult {
  const { cols, rows } = grid
  const total = cols * rows
  const dir = new Int8Array(total)
  dir.fill(-1)
  for (let cell = 0; cell < total; cell += 1) {
    const row = rowOf(grid, cell)
    const col = colOf(grid, cell)
    const h0 = filled[cell]
    let best = -1
    let bestValue = 0
    for (let d = 0; d < 8; d += 1) {
      const nr = row + DR[d]
      const nc = col + DC[d]
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
      const next = cellIndexOf(grid, nr, nc)
      const drop = (h0 - filled[next]) / DIST[d]
      if (drop > bestValue) {
        bestValue = drop
        best = d
      }
    }
    if (best >= 0) dir[cell] = best
  }
  const queue: number[] = []
  let head = 0
  for (let cell = 0; cell < total; cell += 1) {
    if (dir[cell] >= 0) queue.push(cell)
  }
  while (head < queue.length) {
    const cell = queue[head]
    head += 1
    const h = filled[cell]
    for (const { next, d } of gridNeighbors(grid, cell)) {
      if (dir[next] >= 0) continue
      if (Math.abs(filled[next] - h) > 1e-6) continue
      dir[next] = (d + 4) % 8
      queue.push(next)
    }
  }
  let sinks = 0
  for (let cell = 0; cell < total; cell += 1) {
    if (dir[cell] < 0) sinks += 1
  }
  return { dir, sinks }
}

export function computeAccumulation(grid: HydGrid, dir: Int8Array): AccResult {
  const { cols, rows } = grid
  const total = cols * rows
  const acc = new Float64Array(total)
  acc.fill(1)
  const down = new Int32Array(total)
  down.fill(-1)
  const upCount = new Int32Array(total)
  for (let cell = 0; cell < total; cell += 1) {
    const d = dir[cell]
    if (d < 0) continue
    const row = rowOf(grid, cell)
    const col = colOf(grid, cell)
    const nr = row + DR[d]
    const nc = col + DC[d]
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
    const next = cellIndexOf(grid, nr, nc)
    down[cell] = next
    upCount[next] += 1
  }
  const queue: number[] = []
  for (let cell = 0; cell < total; cell += 1) {
    if (upCount[cell] === 0) queue.push(cell)
  }
  let drained = 0
  while (queue.length > 0) {
    const cell = queue.pop() as number
    drained += 1
    const target = down[cell]
    if (target < 0) continue
    acc[target] += acc[cell]
    upCount[target] -= 1
    if (upCount[target] === 0) queue.push(target)
  }
  let maxAcc = 0
  for (let cell = 0; cell < total; cell += 1) {
    if (acc[cell] > maxAcc) maxAcc = acc[cell]
  }
  return { acc, maxAcc, drainedCells: drained }
}

export function computeStreamLinks(grid: HydGrid, acc: Float64Array, threshold: number, dir: Int8Array): LinkResult {
  const total = grid.cols * grid.rows
  const streamOf = new Uint8Array(total)
  const upStream = new Int32Array(total)
  const linkOf = new Int32Array(total)
  linkOf.fill(-1)
  for (let cell = 0; cell < total; cell += 1) {
    if (acc[cell] >= threshold) streamOf[cell] = 1
  }
  for (let cell = 0; cell < total; cell += 1) {
    if (!streamOf[cell]) continue
    const myRow = rowOf(grid, cell)
    const myCol = colOf(grid, cell)
    for (const { next, d } of gridNeighbors(grid, cell)) {
      if (!streamOf[next]) continue
      const dNext = dir[next]
      if (dNext < 0) continue
      const srcRow = rowOf(grid, next) + DR[dNext]
      const srcCol = colOf(grid, next) + DC[dNext]
      if (srcRow === myRow && srcCol === myCol) upStream[cell] += 1
    }
  }
  const links: LinkSegment[] = []
  const started = new Uint8Array(total)
  for (let cell = 0; cell < total; cell += 1) {
    if (!streamOf[cell]) continue
    if (started[cell]) continue
    if (upStream[cell] !== 0 && upStream[cell] < 2) continue
    const cells: number[] = []
    let cursor = cell
    while (cursor >= 0 && streamOf[cursor]) {
      if (linkOf[cursor] >= 0 || started[cursor]) break
      cells.push(cursor)
      started[cursor] = 1
      const d = dir[cursor]
      if (d < 0) break
      const row = rowOf(grid, cursor)
      const col = colOf(grid, cursor)
      const nr = row + DR[d]
      const nc = col + DC[d]
      if (nr < 0 || nr >= grid.rows || nc < 0 || nc >= grid.cols) break
      const next = cellIndexOf(grid, nr, nc)
      if (!streamOf[next]) break
      if (upStream[next] >= 2) break
      cursor = next
    }
    if (cells.length === 0) continue
    const id = links.length + 1
    for (const c of cells) linkOf[c] = id
    links.push({ id, cells })
  }
  return { links, linkOf, streamOf }
}

export function vectorizeLinks(grid: HydGrid, links: LinkSegment[]): VectorReach[] {
  const reaches: VectorReach[] = []
  for (const link of links) {
    const lonlat = link.cells.map((cell) => {
      const row = rowOf(grid, cell)
      const col = colOf(grid, cell)
      return cellCenter(grid, row, col)
    })
    reaches.push({ id: link.id, lonlat })
  }
  return reaches
}

// 上下文缺失时退化为逐链段折线（保持旧行为/单测兼容）。
export function vectorizeLinksContinuous(
  grid: HydGrid,
  links: LinkSegment[],
  ctx: { dir: Int8Array; acc: Float64Array; linkOf: Int32Array; streamOf: Uint8Array }
): VectorReach[] {
  const { dir, acc, linkOf, streamOf } = ctx
  const visited = new Uint8Array(links.length)
  const reaches: VectorReach[] = []

  const downstreamStream = (cell: number): number => {
    const d = dir[cell]
    if (d < 0) return -1
    const r = rowOf(grid, cell) + DR[d]
    const c = colOf(grid, cell) + DC[d]
    if (r < 0 || r >= grid.rows || c < 0 || c >= grid.cols) return -1
    const n = cellIndexOf(grid, r, c)
    return streamOf[n] !== 0 ? n : -1
  }

  // 流向「cell」的入流邻居中累计量最大的一个（用于在汇流处判定续接主干）。
  const strongestInflow = (cell: number): number => {
    let best = -1
    let bestAcc = -1
    for (const { next, d } of gridNeighbors(grid, cell)) {
      const dn = dir[next]
      if (dn < 0 || dn !== (d + 4) % 8) continue
      if (acc[next] > bestAcc) {
        bestAcc = acc[next]
        best = next
      }
    }
    return best
  }

  for (let i = 0; i < links.length; i += 1) {
    if (visited[i]) continue
    visited[i] = 1
    const cells = links[i].cells.slice()
    let tail = cells[cells.length - 1]
    let guard = 0
    for (;;) {
      guard += 1
      if (guard > links.length + 2) break
      const nxt = downstreamStream(tail)
      if (nxt < 0) break
      const owner = linkOf[nxt]
      if (owner <= 0 || owner - 1 === i) break
      const li = owner - 1
      if (visited[li]) break
      const nextLink = links[li]
      if (nextLink.cells.length === 0 || nextLink.cells[0] !== nxt) break
      // 仅当 nxt 处汇入流量最大的一支正是本链，才视为干流续接，避免在分叉处重复描绘主槽。
      if (strongestInflow(nxt) !== tail) break
      cells.push(...nextLink.cells)
      visited[li] = 1
      tail = nextLink.cells[nextLink.cells.length - 1]
    }
    // 汇流结点端点吸附：支流若未续接主干，则把下游最近一个河道格（汇流结点）并入末点，
    // 使支流终点与干流起点重合，消除“一格空隙”造成的断裂。
    const ext = downstreamStream(tail)
    if (ext >= 0) cells.push(ext)
    if (cells.length === 0) continue
    const lonlat = cells.map((cell) => {
      const row = rowOf(grid, cell)
      const col = colOf(grid, cell)
      return cellCenter(grid, row, col)
    })
    reaches.push({ id: links[i].id, lonlat })
  }
  return reaches
}

export function lonLatToCell(grid: HydGrid, lon: number, lat: number): number {
  const col = Math.min(grid.cols - 1, Math.max(0, Math.floor((lon - grid.bounds.west) / grid.cellLon)))
  const row = Math.min(grid.rows - 1, Math.max(0, Math.floor((grid.bounds.north - lat) / grid.cellLat)))
  return cellIndexOf(grid, row, col)
}

export function snapPourPoint(grid: HydGrid, acc: Float64Array, cell: number, radius: number): number {
  const centerRow = rowOf(grid, cell)
  const centerCol = colOf(grid, cell)
  const radiusCells = Math.max(0, Math.round(radius))
  let best = cell
  let bestAcc = -1
  for (let row = centerRow - radiusCells; row <= centerRow + radiusCells; row += 1) {
    for (let col = centerCol - radiusCells; col <= centerCol + radiusCells; col += 1) {
      if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) continue
      const candidate = cellIndexOf(grid, row, col)
      if (acc[candidate] > bestAcc) {
        bestAcc = acc[candidate]
        best = candidate
      }
    }
  }
  return best
}

export function computeWatershed(grid: HydGrid, dir: Int8Array, pourCell: number): WatershedResult {
  const total = grid.cols * grid.rows
  const mask = new Uint8Array(total)
  const stack = [pourCell]
  mask[pourCell] = 1
  let count = 0
  while (stack.length > 0) {
    const cell = stack.pop() as number
    count += 1
    const myRow = rowOf(grid, cell)
    const myCol = colOf(grid, cell)
    for (const { next } of gridNeighbors(grid, cell)) {
      if (mask[next]) continue
      const dNext = dir[next]
      if (dNext < 0) continue
      const srcRow = rowOf(grid, next) + DR[dNext]
      const srcCol = colOf(grid, next) + DC[dNext]
      if (srcRow === myRow && srcCol === myCol) {
        mask[next] = 1
        stack.push(next)
      }
    }
  }
  const ring = traceOuterRing(grid, mask)
  return { mask, count, ring, pourCell }
}

export function traceOuterRing(grid: HydGrid, mask: Uint8Array): { lon: number; lat: number }[] {
  const cols = grid.cols
  const rows = grid.rows
  const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const vkey = (c: number, r: number): string => `${c},${r}`
  const adj = new Map<string, string[]>()
  const edgeSet = new Set<string>()
  const addEdge = (c1: number, r1: number, c2: number, r2: number): void => {
    const a = vkey(c1, r1)
    const b = vkey(c2, r2)
    const key = edgeKey(a, b)
    if (edgeSet.has(key)) return
    edgeSet.add(key)
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push(b)
    adj.get(b)!.push(a)
  }
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = cellIndexOf(grid, r, c)
      if (!mask[cell]) continue
      if (r === 0 || !mask[cellIndexOf(grid, r - 1, c)]) addEdge(c, r, c + 1, r)
      if (r === rows - 1 || !mask[cellIndexOf(grid, r + 1, c)]) addEdge(c, r + 1, c + 1, r + 1)
      if (c === 0 || !mask[cellIndexOf(grid, r, c - 1)]) addEdge(c, r, c, r + 1)
      if (c === cols - 1 || !mask[cellIndexOf(grid, r, c + 1)]) addEdge(c + 1, r, c + 1, r + 1)
    }
  }
  const usedEdges = new Set<string>()
  const allKeys = [...edgeSet]
  const loops: string[][] = []
  for (const startKey of allKeys) {
    if (usedEdges.has(startKey)) continue
    const start = startKey.split('|')[0]
    const loop = [start]
    let cur = start
    let from: string | undefined
    let closed = false
    for (;;) {
      const neighbors = adj.get(cur) ?? []
      let chosen: string | undefined
      for (const n of neighbors) {
        if (n === from) continue
        const k = edgeKey(cur, n)
        if (usedEdges.has(k)) continue
        chosen = n
        break
      }
      if (chosen === undefined) break
      usedEdges.add(edgeKey(cur, chosen))
      if (chosen === start) {
        if (loop.length > 2) closed = true
        break
      }
      from = cur
      cur = chosen
      loop.push(cur)
    }
    if (closed) loops.push(loop)
  }
  let best: string[] = []
  for (const loop of loops) {
    if (loop.length > best.length) best = loop
  }
  if (best.length === 0) return []
  return best.map((v) => {
    const parts = v.split(',')
    const c = Number(parts[0])
    const r = Number(parts[1])
    return {
      lon: grid.bounds.west + c * grid.cellLon,
      lat: grid.bounds.north - r * grid.cellLat
    }
  })
}
