export type DemData = {
  width: number
  height: number
  values: Float32Array
  west: number
  east: number
  south: number
  north: number
  minHeight: number
  maxHeight: number
  meanHeight: number
  source: string
}

/** 折线顶点，[列索引, 行索引] */
export type Point = [number, number]

export type AnalysisParams = {
  focalWindow: number
  ridgeThreshold: number
  valleyThreshold: number
  fillDepressions: boolean
  minLineLength: number
  simplifyTolerance: number
}

export type StepTiming = {
  focal: number
  ridgeHydro: number
  valleyHydro: number
  vectorize: number
  total: number
}

export type AnalysisResult = {
  focalMean: Float32Array
  diff: Float32Array
  zdx: Uint8Array
  fdx: Uint8Array
  flowDir: Uint8Array
  flowAcc: Float32Array
  flowAccZero: Uint8Array
  neighborAcc: Float32Array
  inverseFlowDir: Uint8Array
  inverseFlowAcc: Float32Array
  inverseAccZero: Uint8Array
  inverseNeighborAcc: Float32Array
  ridgeMask: Uint8Array
  valleyMask: Uint8Array
  ridgeSkeleton: Uint8Array
  valleySkeleton: Uint8Array
  ridgeLines: Point[][]
  valleyLines: Point[][]
  ridgePixels: number
  valleyPixels: number
  ridgeLengthKm: number
  valleyLengthKm: number
  timing: StepTiming
}

const D8_DROW = [0, 1, 1, 1, 0, -1, -1, -1]
const D8_DCOL = [1, 1, 0, -1, -1, -1, 0, 1]
const D8_CODE = [1, 2, 4, 8, 16, 32, 64, 128]
const DIAG = Math.SQRT2

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function isValid(v: number): boolean {
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
      if (isValid(v)) {
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
  const half = Math.max(0, Math.floor(window / 2))
  const out = new Float32Array(width * height)
  if (half === 0) {
    for (let i = 0; i < mask.length; i += 1) out[i] = mask[i]
    return out
  }
  const values = new Float32Array(mask.length)
  for (let i = 0; i < mask.length; i += 1) values[i] = mask[i]
  const { sum } = buildIntegrals(values, width, height)
  const w1 = width + 1
  for (let r = 0; r < height; r += 1) {
    const r0 = Math.max(0, r - half)
    const r1 = Math.min(height - 1, r + half)
    for (let c = 0; c < width; c += 1) {
      const c0 = Math.max(0, c - half)
      const c1 = Math.min(width - 1, c + half)
      const n = (r1 - r0 + 1) * (c1 - c0 + 1)
      out[r * width + c] = n > 0 ? rectSum(sum, w1, r0, c0, r1, c1) / n : 0
    }
  }
  return out
}

export function elevationDifference(dem: Float32Array, mean: Float32Array): Float32Array {
  const out = new Float32Array(dem.length)
  for (let i = 0; i < dem.length; i += 1) {
    const a = dem[i]
    const b = mean[i]
    out[i] = isValid(a) && isValid(b) ? a - b : Number.NaN
  }
  return out
}

export function classifyTerrain(diff: Float32Array): { zdx: Uint8Array; fdx: Uint8Array } {
  const zdx = new Uint8Array(diff.length)
  const fdx = new Uint8Array(diff.length)
  for (let i = 0; i < diff.length; i += 1) {
    const d = diff[i]
    if (!isValid(d)) continue
    if (d > 0) zdx[i] = 1
    else if (d < 0) fdx[i] = 1
  }
  return { zdx, fdx }
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
    if (isValid(filled[top]) && !visited[top]) {
      visited[top] = 1
      heap.push(top, filled[top])
    }
    if (isValid(filled[bottom]) && !visited[bottom]) {
      visited[bottom] = 1
      heap.push(bottom, filled[bottom])
    }
  }
  for (let r = 1; r < height - 1; r += 1) {
    const left = r * width
    const right = r * width + width - 1
    if (isValid(filled[left]) && !visited[left]) {
      visited[left] = 1
      heap.push(left, filled[left])
    }
    if (isValid(filled[right]) && !visited[right]) {
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
      if (visited[nIdx] || !isValid(filled[nIdx])) continue
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
      if (!isValid(base)) continue
      let bestGradient = 0
      let bestCode = 0
      for (let dir = 0; dir < 8; dir += 1) {
        const nr = r + D8_DROW[dir]
        const nc = c + D8_DCOL[dir]
        if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue
        const nVal = surface[nr * width + nc]
        if (!isValid(nVal)) continue
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

export function extractZeroAccumulation(acc: Float32Array): Uint8Array {
  const out = new Uint8Array(acc.length)
  for (let i = 0; i < acc.length; i += 1) out[i] = acc[i] <= 0 ? 1 : 0
  return out
}

export function extractLineMask(neighbor: Float32Array, terrainMask: Uint8Array, threshold: number): Uint8Array {
  const out = new Uint8Array(neighbor.length)
  for (let i = 0; i < neighbor.length; i += 1) {
    out[i] = neighbor[i] > threshold && terrainMask[i] === 1 ? 1 : 0
  }
  return out
}

export function createInverseTerrain(dem: Float32Array, maxHeight: number): Float32Array {
  const out = new Float32Array(dem.length)
  for (let i = 0; i < dem.length; i += 1) {
    const v = dem[i]
    out[i] = isValid(v) ? maxHeight - v : Number.NaN
  }
  return out
}

export function computeSlopeAspect(dem: Float32Array, width: number, height: number, cellX: number, cellY: number): { slope: Float32Array; aspect: Float32Array } {
  const slope = new Float32Array(dem.length)
  const aspect = new Float32Array(dem.length)
  const twoPi = Math.PI * 2
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const i = r * width + c
      const cL = c > 0 ? c - 1 : c
      const cR = c < width - 1 ? c + 1 : c
      const rU = r > 0 ? r - 1 : r
      const rD = r < height - 1 ? r + 1 : r
      const zL = dem[r * width + cL]
      const zR = dem[r * width + cR]
      const zU = dem[rU * width + c]
      const zD = dem[rD * width + c]
      const dzdx = (zR - zL) / (2 * cellX)
      const dzdy = (zU - zD) / (2 * cellY)
      slope[i] = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI)
      let asp = Math.atan2(dzdy, -dzdx)
      if (asp < 0) asp += twoPi
      aspect[i] = asp
    }
  }
  return { slope, aspect }
}

function pipeline(
  surface: Float32Array,
  width: number,
  height: number,
  window: number,
  terrainMask: Uint8Array,
  threshold: number,
  doFill: boolean
): { flowDir: Uint8Array; flowAcc: Float32Array; zero: Uint8Array; neighbor: Float32Array; mask: Uint8Array } {
  const conditioned = doFill ? fillDepressions(surface, width, height) : surface
  const flowDir = computeFlowDirection(conditioned, width, height)
  const flowAcc = computeFlowAccumulation(flowDir, width, height)
  const zero = extractZeroAccumulation(flowAcc)
  const neighbor = focalMeanBinary(zero, width, height, 3)
  const mask = extractLineMask(neighbor, terrainMask, threshold)
  return { flowDir, flowAcc, zero, neighbor, mask }
}

export function analyzeDem(
  dem: DemData,
  params: AnalysisParams,
  vectorize: (
    ridgeMask: Uint8Array,
    valleyMask: Uint8Array,
    width: number,
    height: number,
    minLineLength: number,
    simplifyTolerance: number
  ) => {
    ridgeSkeleton: Uint8Array
    valleySkeleton: Uint8Array
    ridgeLines: Point[][]
    valleyLines: Point[][]
  }
): AnalysisResult {
  const totalStart = now()
  const { width, height, values } = dem

  const focalStart = now()
  const focal = focalMean(values, width, height, params.focalWindow)
  const diff = elevationDifference(values, focal)
  const { zdx, fdx } = classifyTerrain(diff)
  const focalTime = now() - focalStart

  const ridgeStart = now()
  const ridge = pipeline(values, width, height, params.focalWindow, zdx, params.ridgeThreshold, params.fillDepressions)
  const ridgeTime = now() - ridgeStart

  const valleyStart = now()
  const inverse = createInverseTerrain(values, dem.maxHeight)
  const valley = pipeline(inverse, width, height, params.focalWindow, fdx, params.valleyThreshold, params.fillDepressions)
  const valleyTime = now() - valleyStart

  const vectorStart = now()
  const vectors = vectorize(ridge.mask, valley.mask, width, height, params.minLineLength, params.simplifyTolerance)
  const vectorTime = now() - vectorStart

  const cellX = ((dem.east - dem.west) * Math.PI / 180) * 6378137 * Math.cos((dem.south + dem.north) * 0.5 * Math.PI / 180) / Math.max(1, width - 1)
  const cellY = ((dem.north - dem.south) * Math.PI / 180) * 6378137 / Math.max(1, height - 1)

  let ridgePixels = 0
  for (let i = 0; i < ridge.mask.length; i += 1) ridgePixels += ridge.mask[i]
  let valleyPixels = 0
  for (let i = 0; i < valley.mask.length; i += 1) valleyPixels += valley.mask[i]

  return {
    focalMean: focal,
    diff,
    zdx,
    fdx,
    flowDir: ridge.flowDir,
    flowAcc: ridge.flowAcc,
    flowAccZero: ridge.zero,
    neighborAcc: ridge.neighbor,
    inverseFlowDir: valley.flowDir,
    inverseFlowAcc: valley.flowAcc,
    inverseAccZero: valley.zero,
    inverseNeighborAcc: valley.neighbor,
    ridgeMask: ridge.mask,
    valleyMask: valley.mask,
    ridgeSkeleton: vectors.ridgeSkeleton,
    valleySkeleton: vectors.valleySkeleton,
    ridgeLines: vectors.ridgeLines,
    valleyLines: vectors.valleyLines,
    ridgePixels,
    valleyPixels,
    ridgeLengthKm: polylineLengthKm(vectors.ridgeLines, cellX, cellY),
    valleyLengthKm: polylineLengthKm(vectors.valleyLines, cellX, cellY),
    timing: {
      focal: focalTime,
      ridgeHydro: ridgeTime,
      valleyHydro: valleyTime,
      vectorize: vectorTime,
      total: now() - totalStart
    }
  }
}

export function polylineLengthKm(lines: Point[][], cellX: number, cellY: number): number {
  let meters = 0
  for (let l = 0; l < lines.length; l += 1) {
    const line = lines[l]
    for (let i = 1; i < line.length; i += 1) {
      const dc = (line[i][0] - line[i - 1][0]) * cellX
      const dr = (line[i][1] - line[i - 1][1]) * cellY
      meters += Math.hypot(dc, dr)
    }
  }
  return meters / 1000
}
