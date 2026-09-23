export type GridPoint = { x: number; y: number }
export type GridRing = GridPoint[]

type Edge = { sx: number; sy: number; ex: number; ey: number }

function key(x: number, y: number): string {
  return `${x},${y}`
}

/**
 * 对二值掩膜做边界追踪：提取所有边界有向边并按端点串联成闭合环。
 * 坐标以「格点」为单位，(0,0) 为最西北角格点。
 */
export function extractRings(mask: Uint8Array, cols: number, rows: number): GridRing[] {
  const edges: Edge[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!mask[row * cols + col]) continue
      const c = col
      const r = row
      const northEmpty = r === 0 || !mask[(r - 1) * cols + c]
      const eastEmpty = c === cols - 1 || !mask[r * cols + c + 1]
      const southEmpty = r === rows - 1 || !mask[(r + 1) * cols + c]
      const westEmpty = c === 0 || !mask[r * cols + c - 1]
      if (northEmpty) edges.push({ sx: c + 1, sy: r, ex: c, ey: r })
      if (eastEmpty) edges.push({ sx: c + 1, sy: r, ex: c + 1, ey: r + 1 })
      if (southEmpty) edges.push({ sx: c, sy: r + 1, ex: c + 1, ey: r + 1 })
      if (westEmpty) edges.push({ sx: c, sy: r, ex: c, ey: r + 1 })
    }
  }

  const outgoing = new Map<string, Edge[]>()
  for (const edge of edges) {
    const bucket = outgoing.get(key(edge.sx, edge.sy))
    if (bucket) bucket.push(edge)
    else outgoing.set(key(edge.sx, edge.sy), [edge])
  }

  const rings: GridRing[] = []
  const used = new Set<Edge>()
  for (const edge of edges) {
    if (used.has(edge)) continue
    const ring: GridRing = []
    let current: Edge | undefined = edge
    let guard = 0
    while (current && guard < edges.length + 4) {
      guard += 1
      if (used.has(current)) break
      used.add(current)
      ring.push({ x: current.sx, y: current.sy })
      const bucket = outgoing.get(key(current.ex, current.ey))
      let next: Edge | undefined
      if (bucket) {
        for (let i = 0; i < bucket.length; i += 1) {
          if (!used.has(bucket[i])) {
            next = bucket[i]
            break
          }
        }
      }
      current = next
    }
    if (ring.length >= 3) rings.push(ring)
  }
  return rings
}

function pointSegmentDistance(point: GridPoint, a: GridPoint, b: GridPoint): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const apx = point.x - a.x
  const apy = point.y - a.y
  const len2 = abx * abx + aby * aby
  if (len2 === 0) return Math.hypot(apx, apy)
  let t = (apx * abx + apy * aby) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(apx - abx * t, apy - aby * t)
}

/** Douglas–Peucker 抽稀，避免火线顶点数随蔓延失控。 */
export function simplifyRing(ring: GridRing, tolerance: number): GridRing {
  if (ring.length <= 4 || tolerance <= 0) return ring
  const keep = new Uint8Array(ring.length)
  keep[0] = 1
  keep[ring.length - 1] = 1

  const stack: Array<[number, number]> = [[0, ring.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop() as [number, number]
    if (end <= start + 1) continue
    let maxDist = -1
    let index = -1
    for (let i = start + 1; i < end; i += 1) {
      const dist = pointSegmentDistance(ring[i], ring[start], ring[end])
      if (dist > maxDist) {
        maxDist = dist
        index = i
      }
    }
    if (maxDist > tolerance && index > 0) {
      keep[index] = 1
      stack.push([start, index])
      stack.push([index, end])
    }
  }

  const result: GridRing = []
  for (let i = 0; i < ring.length; i += 1) if (keep[i]) result.push(ring[i])
  return result
}

/**
 * 射线法判断点是否在闭合环内部（环以格点坐标表示，可含亚格点值）。
 * 用于等时线环的奇偶嵌套判定（外环 / 孔洞）。
 */
export function pointInRing(point: GridPoint, ring: GridRing): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > point.y !== b.y > point.y) {
      const t = (point.y - a.y) / (b.y - a.y)
      if (point.x < a.x + t * (b.x - a.x)) inside = !inside
    }
  }
  return inside
}

/** 环的有向面积（>0 逆时针，<0 顺时针），单位为平方格。 */
export function ringSignedArea(ring: GridRing): number {
  let area = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    area += ring[j].x * ring[i].y - ring[i].x * ring[j].y
  }
  return area / 2
}

type IsoEdge = { a: GridPoint; b: GridPoint }

/**
 * Marching Squares 亚格点等值线：对连续标量场在 `level` 处提取闭合等值环。
 * 采样点约定为格心，坐标为 (col + 0.5, row + 0.5)，与 ringToPositions 的贴图约定一致。
 * 非有限值（Infinity/NaN，如不可燃格点或超出可达范围）按「远大于 level」处理，
 * 使火线自然停在可燃物边界；边交点按端点序号规范化后缓存，保证相邻单元共边交点完全一致，
 * 便于拓扑拼接为闭合环。相比逐格二值边界，可从根本上消除栅格锯齿。
 */
export function isoRings(field: Float32Array, cols: number, rows: number, level: number): GridRing[] {
  if (cols < 2 || rows < 2) return []
  const far = level + 1e7
  const at = (col: number, row: number): number => {
    const value = field[row * cols + col]
    return Number.isFinite(value) ? value : far
  }
  const inside = (col: number, row: number): boolean => at(col, row) < level

  const hCache = new Map<number, GridPoint | null>()
  const vCache = new Map<number, GridPoint | null>()
  // 水平边：(col,row)-(col+1,row)，交点在 x∈(col,col+1)、y=row+0.5
  const hPoint = (col: number, row: number): GridPoint | null => {
    const key = row * cols + col
    const cached = hCache.get(key)
    if (cached !== undefined) return cached
    const v0 = at(col, row)
    const v1 = at(col + 1, row)
    let point: GridPoint | null = null
    if ((v0 < level) !== (v1 < level)) {
      const t = (level - v0) / (v1 - v0)
      point = { x: col + 0.5 + t, y: row + 0.5 }
    }
    hCache.set(key, point)
    return point
  }
  // 垂直边：(col,row)-(col,row+1)，交点在 x=col+0.5、y∈(row,row+1)
  const vPoint = (col: number, row: number): GridPoint | null => {
    const key = row * cols + col
    const cached = vCache.get(key)
    if (cached !== undefined) return cached
    const v0 = at(col, row)
    const v1 = at(col, row + 1)
    let point: GridPoint | null = null
    if ((v0 < level) !== (v1 < level)) {
      const t = (level - v0) / (v1 - v0)
      point = { x: col + 0.5, y: row + 0.5 + t }
    }
    vCache.set(key, point)
    return point
  }

  const segments: IsoEdge[] = []
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const tl = inside(col, row)
      const tr = inside(col + 1, row)
      const br = inside(col + 1, row + 1)
      const bl = inside(col, row + 1)
      const crossings: GridPoint[] = []
      if (tl !== tr) {
        const p = hPoint(col, row)
        if (p) crossings.push(p)
      }
      if (tr !== br) {
        const p = vPoint(col + 1, row)
        if (p) crossings.push(p)
      }
      if (bl !== br) {
        const p = hPoint(col, row + 1)
        if (p) crossings.push(p)
      }
      if (tl !== bl) {
        const p = vPoint(col, row)
        if (p) crossings.push(p)
      }
      if (crossings.length === 2) {
        segments.push({ a: crossings[0], b: crossings[1] })
      } else if (crossings.length === 4) {
        // 鞍点：按环绕顺序(T,R,B,L)相邻配对，保证不产生交叉
        segments.push({ a: crossings[0], b: crossings[1] })
        segments.push({ a: crossings[2], b: crossings[3] })
      }
    }
  }
  if (!segments.length) return []

  const keyOf = (p: GridPoint): string => `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)}`
  const outgoing = new Map<string, IsoEdge[]>()
  for (const seg of segments) {
    const bucket = outgoing.get(keyOf(seg.a))
    if (bucket) bucket.push(seg)
    else outgoing.set(keyOf(seg.a), [seg])
  }

  const used = new Set<IsoEdge>()
  const rings: GridRing[] = []
  for (const seg of segments) {
    if (used.has(seg)) continue
    const ring: GridRing = []
    let current: IsoEdge | undefined = seg
    let guard = 0
    while (current && guard < segments.length + 4) {
      guard += 1
      if (used.has(current)) break
      used.add(current)
      ring.push(current.a)
      const bucket = outgoing.get(keyOf(current.b))
      let next: IsoEdge | undefined
      if (bucket) {
        for (const candidate of bucket) {
          if (!used.has(candidate)) {
            next = candidate
            break
          }
        }
      }
      current = next
    }
    if (ring.length >= 3) rings.push(ring)
  }
  return rings
}

export function ringPerimeterMeters(ring: GridRing, cellMeters: number): number {
  let total = 0
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total * cellMeters
}
