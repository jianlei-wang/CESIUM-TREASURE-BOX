/**
 * 通用栅格水文/地形算子：焦点均值、洼地填充、D8 流向与汇流累积。
 * 逻辑与 ridge-valley-lib 保持一致，供各地形分析算法复用。
 */
export type Grid = {
  width: number
  height: number
  values: Float32Array
}

export const D8_DROW = [0, 1, 1, 1, 0, -1, -1, -1]
export const D8_DCOL = [1, 1, 0, -1, -1, -1, 0, 1]
export const D8_CODE = [1, 2, 4, 8, 16, 32, 64, 128]
export const DIAG = Math.SQRT2

export function isGridValid(v: number): boolean {
  return Number.isFinite(v)
}

export function buildIntegrals(values: Float32Array, width: number, height: number): { sum: Float64Array; count: Int32Array } {
  const w1 = width + 1
  const sum = new Float64Array(w1 * (height + 1))
  const count = new Int32Array(w1 * (height + 1))
  for (let r = 0; r < height; r += 1) {
    let rowSum = 0
    let rowCount = 0
    const rowBase = r * width
    const outBase = (r + 1) * w1
    const upBase = r * w1
    for (let c = 0; c < width; c += 1) {
      const v = values[rowBase + c]
      if (isGridValid(v)) {
        rowSum += v
        rowCount += 1
      }
      sum[outBase + c + 1] = sum[upBase + c + 1] + rowSum
      count[outBase + c + 1] = count[upBase + c + 1] + rowCount
    }
  }
  return { sum, count }
}

function rectSum(integral: Float64Array, w1: number, r0: number, c0: number, r1: number, c1: number): number {
  return integral[(r1 + 1) * w1 + (c1 + 1)] - integral[r0 * w1 + (c1 + 1)] - integral[(r1 + 1) * w1 + c0] + integral[r0 * w1 + c0]
}

function rectCount(integral: Int32Array, w1: number, r0: number, c0: number, r1: number, c1: number): number {
  return integral[(r1 + 1) * w1 + (c1 + 1)] - integral[r0 * w1 + (c1 + 1)] - integral[(r1 + 1) * w1 + c0] + integral[r0 * w1 + c0]
}

export function focalMean(values: Float32Array, width: number, height: number, window: number): Float32Array {
  const half = Math.max(0, Math.floor(window / 2))
  const out = new Float32Array(width * height)
  if (half === 0) {
    out.set(values)
    return out
  }
  const { sum, count } = buildIntegrals(values, width, height)
  const w1 = width + 1
  for (let r = 0; r < height; r += 1) {
    const r0 = Math.max(0, r - half)
    const r1 = Math.min(height - 1, r + half)
    for (let c = 0; c < width; c += 1) {
      const c0 = Math.max(0, c - half)
      const c1 = Math.min(width - 1, c + half)
      const n = rectCount(count, w1, r0, c0, r1, c1)
      out[r * width + c] = n > 0 ? rectSum(sum, w1, r0, c0, r1, c1) / n : Number.NaN
    }
  }
  return out
}

export function focalMeanBinary(mask: Uint8Array, width: number, height: number, window: number): Float32Array {
  const values = new Float32Array(mask.length)
  for (let i = 0; i < mask.length; i += 1) values[i] = mask[i]
  return focalMean(values, width, height, window)
}

/** 邻域均值（含中心），NaN 按窗口内有效值处理 */
export function focalMeanValid(values: Float32Array, width: number, height: number, window: number): Float32Array {
  return focalMean(values, width, height, window)
}

class MinHeap {
  private items: number[] = []
  private keys: number[] = []

  get size(): number {
    return this.items.length
  }

  push(item: number, key: number): void {
    this.items.push(item)
    this.keys.push(key)
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.keys[parent] <= this.keys[i]) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): number {
    const top = this.items[0]
    const lastItem = this.items.pop() as number
    const lastKey = this.keys.pop() as number
    if (this.items.length > 0) {
      this.items[0] = lastItem
      this.keys[0] = lastKey
      let i = 0
      const n = this.items.length
      while (true) {
        const left = i * 2 + 1
        const right = left + 1
        let smallest = i
        if (left < n && this.keys[left] < this.keys[smallest]) smallest = left
        if (right < n && this.keys[right] < this.keys[smallest]) smallest = right
        if (smallest === i) break
        this.swap(i, smallest)
        i = smallest
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    const ti = this.items[a]
    this.items[a] = this.items[b]
    this.items[b] = ti
    const tk = this.keys[a]
    this.keys[a] = this.keys[b]
    this.keys[b] = tk
  }
}

export function fillDepressions(values: Float32Array, width: number, height: number, epsilon = 1e-4): Float32Array {
  const n = width * height
  const filled = new Float32Array(values)
  const visited = new Uint8Array(n)
  const heap = new MinHeap()

  for (let c = 0; c < width; c += 1) {
    const top = c
    const bottom = (height - 1) * width + c
    if (isGridValid(filled[top]) && !visited[top]) {
      visited[top] = 1
      heap.push(top, filled[top])
    }
    if (isGridValid(filled[bottom]) && !visited[bottom]) {
      visited[bottom] = 1
      heap.push(bottom, filled[bottom])
    }
  }
  for (let r = 1; r < height - 1; r += 1) {
    const left = r * width
    const right = r * width + width - 1
    if (isGridValid(filled[left]) && !visited[left]) {
      visited[left] = 1
      heap.push(left, filled[left])
    }
    if (isGridValid(filled[right]) && !visited[right]) {
      visited[right] = 1
      heap.push(right, filled[right])
    }
  }

  while (heap.size > 0) {
    const idx = heap.pop()
    const r = (idx / width) | 0
    const c = idx - r * width
    const base = filled[idx]
    for (let dir = 0; dir < 8; dir += 1) {
      const nr = r + D8_DROW[dir]
      const nc = c + D8_DCOL[dir]
      if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue
      const nIdx = nr * width + nc
      if (visited[nIdx] || !isGridValid(filled[nIdx])) continue
      visited[nIdx] = 1
      const raised = filled[nIdx] < base ? base + epsilon : filled[nIdx]
      filled[nIdx] = raised
      heap.push(nIdx, raised)
    }
  }
  return filled
}

export function computeFlowDirection(surface: Float32Array, width: number, height: number): Uint8Array {
  const flow = new Uint8Array(width * height)
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const idx = r * width + c
      const base = surface[idx]
      if (!isGridValid(base)) continue
      let bestGradient = 0
      let bestCode = 0
      for (let dir = 0; dir < 8; dir += 1) {
        const nr = r + D8_DROW[dir]
        const nc = c + D8_DCOL[dir]
        if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue
        const nVal = surface[nr * width + nc]
        if (!isGridValid(nVal)) continue
        const dist = dir % 2 === 0 ? 1 : DIAG
        const gradient = (base - nVal) / dist
        if (gradient > bestGradient) {
          bestGradient = gradient
          bestCode = D8_CODE[dir]
        }
      }
      flow[idx] = bestCode
    }
  }
  return flow
}

export function computeFlowAccumulation(flow: Uint8Array, width: number, height: number): Float32Array {
  const n = width * height
  const down = new Int32Array(n).fill(-1)
  const indegree = new Int32Array(n)
  for (let i = 0; i < n; i += 1) {
    const code = flow[i]
    if (code === 0) continue
    const dir = D8_CODE.indexOf(code)
    if (dir < 0) continue
    const r = (i / width) | 0
    const c = i - r * width
    const nr = r + D8_DROW[dir]
    const nc = c + D8_DCOL[dir]
    if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue
    const j = nr * width + nc
    down[i] = j
    indegree[j] += 1
  }

  const acc = new Float32Array(n)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  for (let i = 0; i < n; i += 1) {
    if (indegree[i] === 0) queue[tail++] = i
  }
  const processed = new Uint8Array(n)
  while (head < tail) {
    const i = queue[head++]
    processed[i] = 1
    const j = down[i]
    if (j < 0) continue
    acc[j] += acc[i] + 1
    indegree[j] -= 1
    if (indegree[j] === 0) queue[tail++] = j
  }

  const pending: number[] = []
  for (let i = 0; i < n; i += 1) if (!processed[i] && flow[i] !== 0) pending.push(i)
  if (pending.length > 0) {
    const upCount = new Int32Array(n + 1)
    for (let i = 0; i < n; i += 1) {
      const j = down[i]
      if (j >= 0) upCount[j + 1] += 1
    }
    for (let i = 1; i <= n; i += 1) upCount[i] += upCount[i - 1]
    const upList = new Int32Array(upCount[n])
    const cursor = Int32Array.from(upCount.subarray(0, n))
    for (let i = 0; i < n; i += 1) {
      const j = down[i]
      if (j >= 0) upList[cursor[j]++] = i
    }
    for (let round = 0; round < 64; round += 1) {
      let changed = false
      for (let k = 0; k < pending.length; k += 1) {
        const i = pending[k]
        let sum = 0
        for (let e = upCount[i]; e < upCount[i + 1]; e += 1) sum += acc[upList[e]] + 1
        if (sum !== acc[i]) {
          acc[i] = sum
          changed = true
        }
      }
      if (!changed) break
    }
  }
  return acc
}

/** 单位换算：由经纬度范围计算地表像元尺寸（米） */
export function cellSizeMeters(
  west: number,
  east: number,
  south: number,
  north: number,
  width: number,
  height: number
): { cellX: number; cellY: number } {
  const latRad = ((south + north) * 0.5 * Math.PI) / 180
  const cellX = Math.max(1, ((((east - west) * Math.PI) / 180) * 6378137 * Math.cos(latRad)) / Math.max(1, width - 1))
  const cellY = Math.max(1, ((((north - south) * Math.PI) / 180) * 6378137) / Math.max(1, height - 1))
  return { cellX, cellY }
}

export function polygonMask(
  width: number,
  height: number,
  west: number,
  east: number,
  south: number,
  north: number,
  ring: { lon: number; lat: number }[]
): Uint8Array {
  const mask = new Uint8Array(width * height)
  if (ring.length < 3) {
    mask.fill(1)
    return mask
  }
  const n = ring.length
  for (let r = 0; r < height; r += 1) {
    const lat = north - ((r + 0.5) / height) * (north - south)
    for (let c = 0; c < width; c += 1) {
      const lon = west + ((c + 0.5) / width) * (east - west)
      let inside = false
      for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
        const xi = ring[i].lon
        const yi = ring[i].lat
        const xj = ring[j].lon
        const yj = ring[j].lat
        if (xi === xj && yi === yj) continue
        const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
        if (intersect) inside = !inside
      }
      mask[r * width + c] = inside ? 1 : 0
    }
  }
  return mask
}

export function countMask(mask: Uint8Array): number {
  let total = 0
  for (let i = 0; i < mask.length; i += 1) total += mask[i]
  return total
}

export function areaKm2(cells: number, cellX: number, cellY: number): number {
  return (cells * cellX * cellY) / 1e6
}
