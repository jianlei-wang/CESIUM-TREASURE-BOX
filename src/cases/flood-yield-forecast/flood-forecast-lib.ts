import {
  cellCenter,
  cellIndexOf,
  colOf,
  rowOf,
  traceOuterRing,
  type HydGrid
} from '../hydro-analysis/hydro-lib'

export const DEG_METERS = 111320

export function cellMeters(grid: HydGrid): { w: number; h: number; area: number } {
  const midLat = ((grid.bounds.south + grid.bounds.north) / 2) * Math.PI / 180
  const w = grid.cellLon * DEG_METERS * Math.cos(midLat)
  const h = grid.cellLat * DEG_METERS
  return { w, h, area: w * h }
}

// ---------------------------------------------------------------------------
// 确定性随机数（供模拟数据生成，保证可复现）
// ---------------------------------------------------------------------------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// 模拟 DEM 合成参数与生成
// ---------------------------------------------------------------------------
export type SynthDemParams = {
  seed: number
  baseAlt: number // 模拟 DEM 基准高程(米)，用于贴附真实影像高程带
  southFall: number // 自北向南总落差(米)，主导流向
  eastFall: number // 自西向东总落差(米)
  waveAmp: number // 平行山脊/谷线波动幅度(米)
  waveFreq: number // 谷线周期数（沿山谷方向）
  waveAngle: number // 谷线方位角(弧度，0 指向正南谷线沿南北? 采用 u-v 波相角)
  noiseAmp: number // 随机噪声幅度(米)
  poolCount: number // 真实洼地(蓄水区)数量
  poolDepth: number // 洼地最大深度(米)
  poolSize: number // 洼地半径(占网格短边比例)
}

export const DEFAULT_SYNTH: SynthDemParams = {
  seed: 7,
  baseAlt: 560,
  southFall: 110,
  eastFall: 35,
  waveAmp: 46,
  waveFreq: 3,
  waveAngle: Math.PI / 4,
  noiseAmp: 3,
  poolCount: 3,
  poolDepth: 26,
  poolSize: 0.09
}

type SynthPool = { u: number; v: number; depth: number; sigmaCells: number }

function synthPools(rng: () => number, cols: number, rows: number, p: SynthDemParams): SynthPool[] {
  const minDim = Math.min(cols, rows)
  const sigma = Math.max(2, p.poolSize * minDim)
  const pools: SynthPool[] = []
  for (let i = 0; i < Math.max(0, Math.round(p.poolCount)); i += 1) {
    const u = 0.1 + rng() * 0.8
    const v = 0.1 + rng() * 0.75
    const depth = Math.max(1, p.poolDepth * (0.5 + rng() * 0.5))
    pools.push({ u, v, depth, sigmaCells: sigma })
  }
  return pools
}

export function generateSyntheticDem(grid: HydGrid, p: SynthDemParams): Float32Array {
  const { cols, rows } = grid
  const total = cols * rows
  const out = new Float32Array(total)
  const rng = mulberry32(p.seed)
  const pools = synthPools(rng, cols, rows, p)
  const wavePhase = rng() * Math.PI * 2
  const cu = Math.cos(p.waveAngle)
  const sv = Math.sin(p.waveAngle)
  for (let r = 0; r < rows; r += 1) {
    const v = r / Math.max(1, rows - 1)
    for (let c = 0; c < cols; c += 1) {
      const u = c / Math.max(1, cols - 1)
      let h = p.baseAlt + p.southFall * (1 - v) + p.eastFall * (1 - u)
      // 与主坡向斜交的平行山谷（谷线相位沿 (cos,sin) 方向近似恒定）
      h += p.waveAmp * Math.sin(Math.PI * 2 * p.waveFreq * (u * cu - v * sv) + wavePhase)
      const dc = c - u * 0
      void dc
      for (const pool of pools) {
        const pu = pool.u * cols
        const pv = pool.v * rows
        const dd = Math.sqrt((c - pu) ** 2 + (r - pv) ** 2)
        const s = Math.exp(-(dd * dd) / (2 * pool.sigmaCells * pool.sigmaCells))
        h -= pool.depth * s
      }
      h += (rng() * 2 - 1) * p.noiseAmp
      out[r * cols + c] = h
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 洼地识别（真实洼地/蓄水区对象化）
// ---------------------------------------------------------------------------
export type Depression = {
  id: number
  cells: number[]
  ground: Float32Array // 洼地内各像元原始地面高程
  sorted: Float32Array // 地面高程升序（用于反算体积-水位）
  outletLevel: number // 蓄满(溢流)水位 = 洼地出水口高程
  capacity: number // 蓄满容量(m³)
  minGround: number
  maxGround: number
  cellArea: number
  centerCol: number
  centerRow: number
}

export type DepressionResult = {
  mask: Int32Array // 每格所属洼地 id（-1 表示非洼地）
  deps: Depression[]
  identified: number
  totalCapacity: number
}

function cellNeighbors4(grid: HydGrid, cell: number): number[] {
  const cols = grid.cols
  const rows = grid.rows
  const r = rowOf(grid, cell)
  const c = colOf(grid, cell)
  const out: number[] = []
  if (r > 0) out.push(cell - cols)
  if (r < rows - 1) out.push(cell + cols)
  if (c > 0) out.push(cell - 1)
  if (c < cols - 1) out.push(cell + 1)
  return out
}

export function identifyDepressions(grid: HydGrid, filled: Float32Array, minDepth: number): DepressionResult {
  const total = grid.cols * grid.rows
  const mask = new Int32Array(total)
  mask.fill(-1)
  const deps: Depression[] = []
  const { area } = cellMeters(grid)
  for (let start = 0; start < total; start += 1) {
    const raise = filled[start] - grid.dem[start]
    if (raise <= minDepth) continue
    if (mask[start] >= 0) continue
    const stack = [start]
    mask[start] = -2
    const cells: number[] = []
    while (stack.length > 0) {
      const cell = stack.pop() as number
      cells.push(cell)
      for (const next of cellNeighbors4(grid, cell)) {
        if (mask[next] !== -1) continue
        if (filled[next] - grid.dem[next] <= minDepth) continue
        mask[next] = -2
        stack.push(next)
      }
    }
    const id = deps.length
    let minG = Number.POSITIVE_INFINITY
    let maxG = Number.NEGATIVE_INFINITY
    let outlet = Number.POSITIVE_INFINITY
    const ground = new Float32Array(cells.length)
    let sumR = 0
    let sumC = 0
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i]
      ground[i] = grid.dem[cell]
      if (grid.dem[cell] < minG) minG = grid.dem[cell]
      if (grid.dem[cell] > maxG) maxG = grid.dem[cell]
      if (filled[cell] < outlet) outlet = filled[cell]
      mask[cell] = id
      sumR += rowOf(grid, cell)
      sumC += colOf(grid, cell)
    }
    let capacity = 0
    for (let i = 0; i < cells.length; i += 1) {
      capacity += (filled[cells[i]] - grid.dem[cells[i]]) * area
    }
    const sorted = new Float32Array(ground)
    sorted.sort((a, b) => a - b)
    deps.push({
      id,
      cells,
      ground,
      sorted,
      outletLevel: outlet,
      capacity,
      minGround: minG,
      maxGround: maxG,
      cellArea: area,
      centerCol: Math.round(sumC / cells.length),
      centerRow: Math.round(sumR / cells.length)
    })
  }
  let totalCapacity = 0
  for (const dep of deps) totalCapacity += dep.capacity
  return { mask, deps, identified: deps.length, totalCapacity }
}

// 洼地体积-水位反算：在 [minGround, outletLevel] 上求蓄水 volume 时的水面高程
export function depressionLevelAtVolume(dep: Depression, volume: number): number {
  if (volume <= 0) return dep.minGround
  if (volume >= dep.capacity) return dep.outletLevel
  const heights = dep.sorted
  const m = heights.length
  const A = dep.cellArea
  let lo = heights[0]
  let hi = dep.outletLevel
  for (let iter = 0; iter < 60; iter += 1) {
    const mid = (lo + hi) / 2
    let vol = 0
    for (let i = 0; i < m; i += 1) {
      if (heights[i] >= mid) break
      vol += (mid - heights[i]) * A
    }
    if (vol < volume) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// ---------------------------------------------------------------------------
// 下垫面（土地利用/CN 分区）模拟数据生成：Voronoi 图斑
// ---------------------------------------------------------------------------
export const ZONE_NAMES = ['林地', '草地', '耕地', '建设用地', '水域', '不透水面']

export const DEFAULT_CN = [72, 82, 62, 58, 78, 92]
export const DEFAULT_ALPHA = [0.2, 0.4, 0.6, 0.8, 0.9, 0.95]

export function generateZoneGrid(grid: HydGrid, classCount: number, seed: number): Uint8Array {
  const total = grid.cols * grid.rows
  const n = Math.max(1, Math.min(ZONE_NAMES.length, Math.round(classCount)))
  const rng = mulberry32(seed)
  const seeds: { u: number; v: number }[] = []
  for (let i = 0; i < n; i += 1) {
    seeds.push({ u: rng(), v: rng() })
  }
  const zone = new Uint8Array(total)
  for (let r = 0; r < grid.rows; r += 1) {
    const v = r / Math.max(1, grid.rows - 1)
    for (let c = 0; c < grid.cols; c += 1) {
      const u = c / Math.max(1, grid.cols - 1)
      let best = 0
      let bestD = Number.POSITIVE_INFINITY
      for (let i = 0; i < n; i += 1) {
        const d = (u - seeds[i].u) ** 2 + (v - seeds[i].v) ** 2
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      zone[r * grid.cols + c] = best
    }
  }
  return zone
}

export function zoneColor(index: number, count: number): string {
  const hues = [120, 90, 45, 330, 205, 270]
  const hue = hues[index % hues.length]
  const step = count > 1 ? 0 : 0
  const shift = (index * 14) % 40 - 20
  const sat = 52 + step * 0
  const lig = 38 + (index % 3) * 6
  void sat
  return `hsl(${hue + shift}, 55%, ${Math.min(78, Math.max(26, lig))}%)`
}

// ---------------------------------------------------------------------------
// 产流：SCS-CN / 径流系数法
// ---------------------------------------------------------------------------
export function runoffFromCn(cn: number, p: number): number {
  const cnC = Math.max(1, Math.min(100, cn))
  const s = 25400 / cnC - 254
  const ia = 0.2 * s
  if (p <= ia) return 0
  return ((p - ia) * (p - ia)) / (p - ia + s)
}

export function runoffFromAlpha(alpha: number, p: number): number {
  const a = Math.max(0, Math.min(1, alpha))
  return a * p
}

export function computeRunoffDepth(
  grid: HydGrid,
  model: 'cn' | 'alpha',
  precip: Float32Array,
  zones: Uint8Array,
  zoneValues: number[]
): Float32Array {
  const total = grid.cols * grid.rows
  const out = new Float32Array(total)
  for (let i = 0; i < total; i += 1) {
    const value = zoneValues[zones[i]] ?? zoneValues[0] ?? 70
    const q = model === 'cn' ? runoffFromCn(value, precip[i]) : runoffFromAlpha(value, precip[i])
    out[i] = q
  }
  return out
}

// ---------------------------------------------------------------------------
// 降水场
// ---------------------------------------------------------------------------
export function buildUniformPrecip(grid: HydGrid, mm: number): Float32Array {
  const total = grid.cols * grid.rows
  const out = new Float32Array(total)
  out.fill(Math.max(0, mm))
  return out
}

export type StormPrecipParams = {
  centerU: number // 雨核中心横向(0~1)
  centerV: number // 雨核中心纵向(0~1)
  peakMm: number // 中心峰值(mm)
  radiusFrac: number // 衰减半径(占短边比例)
  uneven: number // 空间不均匀噪声比例(0~0.5)
  seed: number
}

export function buildStormPrecip(grid: HydGrid, p: StormPrecipParams): Float32Array {
  const total = grid.cols * grid.rows
  const out = new Float32Array(total)
  const minDim = Math.min(grid.cols, grid.rows)
  const sigma = Math.max(2, p.radiusFrac * minDim)
  const cx = p.centerU * grid.cols
  const cy = p.centerV * grid.rows
  const rng = mulberry32(p.seed)
  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      const dd = Math.sqrt((c - cx) ** 2 + (r - cy) ** 2)
      let rain = p.peakMm * Math.exp(-(dd * dd) / (2 * sigma * sigma))
      rain += (rng() * 2 - 1) * p.peakMm * p.uneven
      out[r * grid.cols + c] = Math.max(0, rain)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 汇流演算（沿 D8 传递产水体积，m³/格）
// ---------------------------------------------------------------------------
export function routeFlowVolumes(
  grid: HydGrid,
  dir: Int8Array,
  localVolume: Float64Array
): { transit: Float64Array; outflow: number; drained: number } {
  const total = grid.cols * grid.rows
  const down = new Int32Array(total)
  down.fill(-1)
  const upCount = new Int32Array(total)
  for (let cell = 0; cell < total; cell += 1) {
    const d = dir[cell]
    if (d < 0) continue
    const r = rowOf(grid, cell)
    const c = colOf(grid, cell)
    const dr = [-1, -1, 0, 1, 1, 1, 0, -1][d]
    const dc = [0, 1, 1, 1, 0, -1, -1, -1][d]
    const nr = r + dr
    const nc = c + dc
    if (nr < 0 || nr >= grid.rows || nc < 0 || nc >= grid.cols) continue
    const next = cellIndexOf(grid, nr, nc)
    down[cell] = next
    upCount[next] += 1
  }
  const pass = new Float64Array(total)
  const transit = new Float64Array(total)
  const queue: number[] = []
  for (let cell = 0; cell < total; cell += 1) {
    if (upCount[cell] === 0) queue.push(cell)
  }
  let head = 0
  let drained = 0
  let outflow = 0
  while (head < queue.length) {
    const cell = queue[head]
    head += 1
    drained += 1
    const flow = pass[cell] + localVolume[cell]
    transit[cell] = flow
    const target = down[cell]
    if (target < 0) {
      outflow += flow
      continue
    }
    pass[target] += flow
    upCount[target] -= 1
    if (upCount[target] === 0) queue.push(target)
  }
  return { transit, outflow, drained }
}

// ---------------------------------------------------------------------------
// 淹没方案 A：等体积平面淹没（以区域边界为封闭围挡，从最低处逐级灌水）
// ---------------------------------------------------------------------------
export type InundationResult = {
  method: 'A' | 'B'
  depth: Float32Array
  level: number
  floodedCells: number
  floodedAreaKm2: number
  storedVolume: number
  outflowVolume: number
  precipVolume: number
  note: string
}

function cellStorageVolume(grid: HydGrid, level: number): number {
  const { area } = cellMeters(grid)
  const dem = grid.dem
  let volume = 0
  for (let i = 0; i < dem.length; i += 1) {
    if (dem[i] < level) volume += (level - dem[i]) * area
  }
  return volume
}

export function planAEqualVolumeFill(
  grid: HydGrid,
  runoffVolume: Float64Array,
  runoffDepthMm: Float32Array
): InundationResult {
  const total = grid.cols * grid.rows
  const { area } = cellMeters(grid)
  const precipVolume = runoffVolume.reduce((sum, v) => sum + v, 0)
  const depth = new Float32Array(total)
  let level = grid.demMin
  const dem = grid.dem
  let lo = grid.demMin
  let hi = grid.demMax
  let stored = 0
  const topVolume = cellStorageVolume(grid, hi)
  if (precipVolume > 0) {
    if (precipVolume <= topVolume) {
      for (let iter = 0; iter < 56; iter += 1) {
        const mid = (lo + hi) / 2
        const vol = cellStorageVolume(grid, mid)
        if (vol < precipVolume) lo = mid
        else hi = mid
      }
      level = (lo + hi) / 2
      stored = precipVolume
    } else {
      level = hi + (precipVolume - topVolume) / (area * total)
      stored = precipVolume
    }
    for (let i = 0; i < total; i += 1) {
      const d = level - dem[i]
      if (d > 0.001) depth[i] = d
    }
  }
  let floodedCells = 0
  let floodedArea = 0
  for (let i = 0; i < total; i += 1) {
    if (depth[i] > 0.001) {
      floodedCells += 1
      floodedArea += area
    }
  }
  void runoffDepthMm
  return {
    method: 'A',
    depth,
    level,
    floodedCells,
    floodedAreaKm2: floodedArea / 1e6,
    storedVolume: stored,
    outflowVolume: 0,
    precipVolume,
    note: '等体积平面淹没：将全区产水总量以水平面从最低处逐级灌入，以区域边界为围挡，未考虑地形连通性。'
  }
}

// ---------------------------------------------------------------------------
// 淹没方案 B：洼地蓄水 + 溢流（产水沿 D8 汇流，洼地蓄满后向出口溢流）
// ---------------------------------------------------------------------------
export function planBDepressionRouting(
  grid: HydGrid,
  dir: Int8Array,
  depRes: DepressionResult,
  localVolume: Float64Array
): InundationResult {
  const total = grid.cols * grid.rows
  const { area } = cellMeters(grid)
  const precipVolume = localVolume.reduce((sum, v) => sum + v, 0)
  const down = new Int32Array(total)
  down.fill(-1)
  const upCount = new Int32Array(total)
  for (let cell = 0; cell < total; cell += 1) {
    const d = dir[cell]
    if (d < 0) continue
    const r = rowOf(grid, cell)
    const c = colOf(grid, cell)
    const dr = [-1, -1, 0, 1, 1, 1, 0, -1][d]
    const dc = [0, 1, 1, 1, 0, -1, -1, -1][d]
    const nr = r + dr
    const nc = c + dc
    if (nr < 0 || nr >= grid.rows || nc < 0 || nc >= grid.cols) continue
    const next = cellIndexOf(grid, nr, nc)
    down[cell] = next
    upCount[next] += 1
  }
  const pass = new Float64Array(total)
  const captured = new Float64Array(depRes.deps.length)
  const fullFlags = new Uint8Array(depRes.deps.length)
  const queue: number[] = []
  for (let cell = 0; cell < total; cell += 1) {
    if (upCount[cell] === 0) queue.push(cell)
  }
  let head = 0
  let outflow = 0
  while (head < queue.length) {
    const cell = queue[head]
    head += 1
    const flow = pass[cell] + localVolume[cell]
    const depId = depRes.mask[cell]
    const target = down[cell]
    if (depId >= 0) {
      const dep = depRes.deps[depId]
      if (!fullFlags[depId]) {
        captured[depId] += flow
        if (captured[depId] >= dep.capacity) {
          fullFlags[depId] = 1
          const overflow = captured[depId] - dep.capacity
          captured[depId] = dep.capacity
          if (target >= 0) pass[target] += overflow
          else outflow += overflow
        }
      } else if (target >= 0) {
        pass[target] += flow
      } else {
        outflow += flow
      }
      void area
    } else if (target >= 0) {
      pass[target] += flow
    } else {
      outflow += flow
    }
    if (target >= 0) {
      upCount[target] -= 1
      if (upCount[target] === 0) queue.push(target)
    }
  }
  const depth = new Float32Array(total)
  let stored = 0
  let floodedCells = 0
  let floodedArea = 0
  const depCount = depRes.deps.length
  for (let i = 0; i < depCount; i += 1) {
    const dep = depRes.deps[i]
    const vol = captured[i]
    stored += vol
    const level = depressionLevelAtVolume(dep, vol)
    for (let j = 0; j < dep.cells.length; j += 1) {
      const cell = dep.cells[j]
      const d = level - grid.dem[cell]
      if (d > 0.001) {
        depth[cell] = d
        floodedCells += 1
        floodedArea += dep.cellArea
      }
    }
  }
  return {
    method: 'B',
    depth,
    level: 0,
    floodedCells,
    floodedAreaKm2: floodedArea / 1e6,
    storedVolume: stored,
    outflowVolume: outflow,
    precipVolume,
    note: `洼地蓄水+溢流：识别 ${depCount} 个真实洼地，产水沿 D8 汇流被逐级拦蓄，蓄满后经出水口向下游溢流，蓄满 ${fullFlags.reduce((s, f) => s + f, 0)} 个，溢出 ${outflow.toFixed(1)} m³。`
  }
}

// ---------------------------------------------------------------------------
// 淹没水深分级统计
// ---------------------------------------------------------------------------
export type DepthStatRow = {
  label: string
  cells: number
  areaKm2: number
  pct: number
  color: string
}

export type DepthStatResult = {
  rows: DepthStatRow[]
  totalCells: number
  totalAreaKm2: number
}

export const DEPTH_BREAKS = [0.3, 1, 2]

export const DEPTH_LEVEL_COLORS = ['#a9e6ff', '#3aa6ff', '#1b5fe0', '#1234a6', '#5c10c8']

export function classifyDepths(grid: HydGrid, depth: Float32Array, breaks: number[] = DEPTH_BREAKS): DepthStatResult {
  const { area } = cellMeters(grid)
  const total = grid.cols * grid.rows
  const buckets = breaks.length + 1
  const counts = new Array(buckets).fill(0)
  const labels = [
    `< ${breaks[0]} m`,
    ...breaks.slice(0, -1).map((v, i) => `${v} ~ ${breaks[i + 1]} m`),
    `> ${breaks[breaks.length - 1]} m`
  ]
  for (let i = 0; i < total; i += 1) {
    const d = depth[i]
    if (d <= 0.001) continue
    let bucket = buckets - 1
    for (let b = 0; b < breaks.length; b += 1) {
      if (d <= breaks[b]) {
        bucket = b
        break
      }
    }
    counts[bucket] += 1
  }
  const flooded = counts.reduce((s, c) => s + c, 0)
  const rows = counts.map((cells, i) => ({
    label: labels[i],
    cells,
    areaKm2: (cells * area) / 1e6,
    pct: flooded > 0 ? (cells / flooded) * 100 : 0,
    color: DEPTH_LEVEL_COLORS[i % DEPTH_LEVEL_COLORS.length]
  }))
  return { rows, totalCells: flooded, totalAreaKm2: (flooded * area) / 1e6 }
}

// 干湿掩膜连通分量（用于把淹没区拆成可导出的独立面）
export function floodComponents(grid: HydGrid, mask: Uint8Array): number[][] {
  const total = grid.cols * grid.rows
  const visited = new Uint8Array(total)
  const out: number[][] = []
  for (let start = 0; start < total; start += 1) {
    if (!mask[start] || visited[start]) continue
    const stack = [start]
    visited[start] = 1
    const comp: number[] = []
    while (stack.length > 0) {
      const cell = stack.pop() as number
      comp.push(cell)
      for (const next of cellNeighbors4(grid, cell)) {
        if (!mask[next] || visited[next]) continue
        visited[next] = 1
        stack.push(next)
      }
    }
    if (comp.length > 0) out.push(comp)
  }
  return out
}

export function componentRingLonLat(grid: HydGrid, comp: number[]): { lon: number; lat: number }[] {
  const mask = new Uint8Array(grid.cols * grid.rows)
  for (const cell of comp) mask[cell] = 1
  return traceOuterRing(grid, mask)
}

export function statsToCsv(result: DepthStatResult, title: string): string {
  const lines = [title, '水深分级,像元数,面积(km²),占淹没面积(%)']
  for (const row of result.rows) {
    lines.push(`${row.label},${row.cells},${row.areaKm2.toFixed(4)},${row.pct.toFixed(2)}`)
  }
  lines.push(`合计,${result.totalCells},${result.totalAreaKm2.toFixed(4)},100`)
  return lines.join('\n')
}

export function regionAreaKm2(grid: HydGrid): number {
  const { area } = cellMeters(grid)
  return (grid.cols * grid.rows * area) / 1e6
}

export function depthPeak(depth: Float32Array): number {
  let max = 0
  for (let i = 0; i < depth.length; i += 1) {
    if (depth[i] > max) max = depth[i]
  }
  return max
}

export function cellCenterOf(grid: HydGrid, cell: number): { lon: number; lat: number } {
  const r = rowOf(grid, cell)
  const c = colOf(grid, cell)
  return cellCenter(grid, r, c)
}

export { cellIndexOf, colOf, rowOf }
