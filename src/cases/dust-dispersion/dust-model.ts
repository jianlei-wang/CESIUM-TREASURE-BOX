/**
 * 施工扬尘扩散模拟 — 核心计算引擎（与渲染解耦，纯数学）。
 *
 * 采用高斯烟羽（Gaussian Plume）扩散模型，支持点源 / 线源 / 面源 / 移动源四种
 * 施工扬尘源的离散化叠加，包含 Pasquill 大气稳定度分级、Briggs 扩散参数、
 * 城市下垫面修正、建筑物尾流简化修正、防控措施减排与围挡扩散折减。
 *
 * 所有几何均为场景局部 ENU 米坐标（x 向东、y 向北），浓度单位为 μg/m³，
 * 源强内部统一换算为 μg/s。
 */

export type StabilityClass = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export type SourceType = 'point' | 'line' | 'area' | 'mobile'

export type Vec2 = { x: number; y: number }

export type StageKey = 'foundation' | 'structure' | 'decoration'

export interface DustSource {
  id: string
  name: string
  type: SourceType
  /** 点源 / 移动源起终点在地面投影 */
  position?: Vec2
  /** 线源 / 移动源路径 */
  path?: Vec2[]
  /** 面源轴对齐矩形 */
  rect?: { minX: number; minY: number; maxX: number; maxY: number }
  /** 线源道路宽度（m），用于横向起尘宽度 */
  width?: number
  /** 源高（m） */
  height: number
  /** 基础源强：g/s（点/移动）、g/(m·s)（线）、g/(m²·s)（面） */
  emission: number
  /** 各施工阶段是否启用 */
  stages: Record<StageKey, boolean>
  color: string
}

export interface SensitivePoint {
  id: string
  name: string
  type: 'school' | 'hospital' | 'residential' | 'park' | 'other'
  position: Vec2
  height: number
  standard: { tsp: number; pm10: number; pm25: number }
}

export interface Measures {
  watering: { enabled: boolean; efficiency: number }
  cover: { enabled: boolean; efficiency: number }
  barrier: { enabled: boolean; height: number }
  fogCannon: { enabled: boolean; efficiency: number }
  vehicleWash: { enabled: boolean; efficiency: number }
  speedLimit: { enabled: boolean; efficiency: number }
}

export interface Weather {
  windSpeed: number
  /** 风向（来向，气象约定，0=北风） */
  windDirection: number
  stability: StabilityClass
  temperature: number
  humidity: number
}

export interface GridSpec {
  minX: number
  maxX: number
  minY: number
  maxY: number
  nx: number
  ny: number
}

export interface BuildingBoxLite {
  minX: number
  maxX: number
  minY: number
  maxY: number
  height: number
}

export interface BuildingEffectField {
  /** 风速折减系数（≤1） */
  speedFactor: Float32Array
  /** 扩散增强系数（≥1） */
  sigmaFactor: Float32Array
}

export interface TimeStep {
  index: number
  label: string
  hour: number
  stage: StageKey
  stageLabel: string
  windSpeed: number
  windDirection: number
  stability: StabilityClass
  temperature: number
  humidity: number
  /** 移动源相位 0~1 */
  mobilePhase: number
}

export interface SensitiveResult {
  id: string
  name: string
  type: SensitivePoint['type']
  position: Vec2
  tsp: number
  pm10: number
  pm25: number
  standardTsp: number
  isExceeding: boolean
  exceedRatio: number
}

export interface FieldResult {
  /** nx*ny，row*nx+col，row 对应 minY → maxY */
  field: Float32Array
  maxConcentration: number
  maxLocation: Vec2
  exceedArea: number
  sensitiveResults: SensitiveResult[]
  exceedCount: number
}

export interface Emitter {
  x: number
  y: number
  height: number
  /** μg/s */
  q: number
}

export const STABILITY_LABEL: Record<StabilityClass, string> = {
  A: 'A 极不稳定',
  B: 'B 不稳定',
  C: 'C 弱不稳定',
  D: 'D 中性',
  E: 'E 弱稳定',
  F: 'F 稳定'
}

export const STAGE_LABEL: Record<StageKey, string> = {
  foundation: '基础施工',
  structure: '主体施工',
  decoration: '装饰装修'
}

/** Briggs 开阔地形扩散参数系数 */
const BRIGGS: Record<StabilityClass, { a: number; b: number; c: number; d: number }> = {
  A: { a: 0.22, b: 0.0001, c: 0.2, d: 0.0001 },
  B: { a: 0.16, b: 0.0001, c: 0.12, d: 0.0001 },
  C: { a: 0.11, b: 0.0001, c: 0.08, d: 0.0001 },
  D: { a: 0.08, b: 0.0001, c: 0.06, d: 0.0001 },
  E: { a: 0.06, b: 0.0001, c: 0.03, d: 0.0001 },
  F: { a: 0.04, b: 0.0001, c: 0.016, d: 0.0001 }
}

export function sigmaY(cls: StabilityClass, x: number): number {
  const p = BRIGGS[cls]
  return Math.max(0.5, p.a * x * Math.pow(1 + p.b * x, -0.5))
}

export function sigmaZ(cls: StabilityClass, x: number): number {
  const p = BRIGGS[cls]
  return Math.max(0.5, p.c * x * Math.pow(1 + p.d * x, -0.5))
}

/** Pasquill 稳定度自动分级：风速 + 日照等级 / 云量 */
export function autoStability(
  windSpeed: number,
  solar: 'strong' | 'moderate' | 'slight',
  cloudCover: number,
  isDay: boolean
): StabilityClass {
  const w = Math.max(0.5, windSpeed)
  if (isDay) {
    if (solar === 'strong') return w < 2 ? 'A' : w < 3 ? 'B' : w < 5 ? 'B' : w < 6 ? 'C' : 'D'
    if (solar === 'moderate') return w < 2 ? 'B' : w < 3 ? 'B' : w < 5 ? 'C' : 'D'
    return w < 2 ? 'C' : w < 3 ? 'C' : w < 5 ? 'D' : 'D'
  }
  if (cloudCover >= 0.5) return w < 2 ? 'E' : w < 3 ? 'E' : w < 5 ? 'D' : 'D'
  return w < 2 ? 'F' : w < 3 ? 'F' : w < 5 ? 'E' : 'D'
}

/** 下风向单位向量（x 东、y 北） */
export function windDownwindVector(direction: number): Vec2 {
  const toward = ((direction + 180) % 360) * (Math.PI / 180)
  return { x: Math.sin(toward), y: Math.cos(toward) }
}

export function windTowardDeg(direction: number): number {
  return (direction + 180) % 360
}

/** 面源矩形离散为微元点源 */
function discretizeArea(rect: NonNullable<DustSource['rect']>, cell: number): Emitter[] {
  const width = Math.max(1, rect.maxX - rect.minX)
  const depth = Math.max(1, rect.maxY - rect.minY)
  const nx = Math.max(1, Math.round(width / cell))
  const ny = Math.max(1, Math.round(depth / cell))
  const dx = width / nx
  const dy = depth / ny
  const out: Emitter[] = []
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      out.push({ x: rect.minX + dx * (i + 0.5), y: rect.minY + dy * (j + 0.5), height: 0, q: 0 })
    }
  }
  return out
}

export function pointOnPolyline(path: Vec2[], phase: number): Vec2 {
  if (path.length === 0) return { x: 0, y: 0 }
  if (path.length === 1) return path[0]
  let total = 0
  const segs: number[] = []
  for (let i = 1; i < path.length; i += 1) {
    const len = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
    segs.push(len)
    total += len
  }
  if (total <= 0) return path[0]
  let d = ((phase % 1) + 1) % 1 * total
  for (let i = 0; i < segs.length; i += 1) {
    if (d <= segs[i]) {
      const t = segs[i] > 0 ? d / segs[i] : 0
      return {
        x: path[i].x + (path[i + 1].x - path[i].x) * t,
        y: path[i].y + (path[i + 1].y - path[i].y) * t
      }
    }
    d -= segs[i]
  }
  return path[path.length - 1]
}

/** 计算某源在当前阶段 / 时刻的保留系数（措施削减后） */
export function sourceRetention(source: DustSource, measures: Measures): number {
  let keep = 1
  const apply = (m: { enabled: boolean; efficiency: number }) => {
    if (m.enabled) keep *= 1 - Math.max(0, Math.min(1, m.efficiency))
  }
  if (source.type === 'area') {
    apply(measures.watering)
    apply(measures.cover)
  } else if (source.type === 'point') {
    apply(measures.watering)
    apply(measures.fogCannon)
  } else {
    apply(measures.watering)
    apply(measures.vehicleWash)
    apply(measures.speedLimit)
  }
  return keep
}

/**
 * 将施工源离散为可用于高斯烟羽叠加的点源集合。
 * @param stageFactor 当前施工阶段源强倍率
 */
export function buildEmitters(
  source: DustSource,
  timeStep: { stage: StageKey; mobilePhase: number },
  measures: Measures,
  stageFactor: number
): Emitter[] {
  if (!source.stages[timeStep.stage]) return []
  const retention = sourceRetention(source, measures)
  const factor = stageFactor * retention
  const out: Emitter[] = []
  if (source.type === 'point') {
    if (source.position) out.push({ x: source.position.x, y: source.position.y, height: source.height, q: source.emission * 1e6 * factor })
  } else if (source.type === 'line' && source.path) {
    const spacing = 8
    for (let i = 1; i < source.path.length; i += 1) {
      const a = source.path[i - 1]
      const b = source.path[i]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const n = Math.max(1, Math.round(len / spacing))
      const q = (source.emission * (len / n)) * 1e6 * factor
      for (let k = 0; k < n; k += 1) {
        const t = (k + 0.5) / n
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, height: source.height, q })
      }
    }
  } else if (source.type === 'area' && source.rect) {
    const cells = discretizeArea(source.rect, 8)
    const cellArea = ((source.rect.maxX - source.rect.minX) * (source.rect.maxY - source.rect.minY)) / cells.length
    for (const cell of cells) {
      out.push({ x: cell.x, y: cell.y, height: source.height, q: source.emission * cellArea * 1e6 * factor })
    }
  } else if (source.type === 'mobile' && source.path && source.path.length > 1) {
    const vehicleCount = 3
    for (let v = 0; v < vehicleCount; v += 1) {
      const p = pointOnPolyline(source.path, timeStep.mobilePhase + v / vehicleCount)
      out.push({ x: p.x, y: p.y, height: source.height, q: source.emission * 1e6 * factor })
    }
  }
  return out
}

/** 单点建筑物尾流修正：返回风速折减系数（≤1）与扩散增强系数（≥1） */
export function buildingEffectAtPoint(
  x: number,
  y: number,
  z: number,
  buildings: BuildingBoxLite[],
  dir: Vec2
): { speed: number; sigma: number } {
  let speed = 1
  let sigma = 1
  for (const b of buildings) {
    if (z > b.height * 1.5) continue
    const cx = (b.minX + b.maxX) / 2
    const cy = (b.minY + b.maxY) / 2
    const dx = x - cx
    const dy = y - cy
    const xd = dx * dir.x + dy * dir.y
    const yd = dx * dir.y - dy * dir.x
    if (xd <= 0 || xd > b.height * 5) continue
    const half = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2
    if (Math.abs(yd) > half + xd * 0.4) continue
    const wake = xd / (b.height * 5)
    if (wake < 0.4) speed = Math.min(speed, 0.4)
    else if (wake < 1) speed = Math.min(speed, 0.6)
    sigma = Math.max(sigma, 1.35)
  }
  return { speed, sigma }
}

/**
 * 预计算建筑物尾流修正场（与切片高度相关）。简化工程近似：
 * 建筑下风向 5 倍楼高、横向扩展的阴影区内风速折减、扩散增强。
 */
export function computeBuildingEffect(
  grid: GridSpec,
  sliceHeight: number,
  buildings: BuildingBoxLite[],
  windDirection: number
): BuildingEffectField {
  const dir = windDownwindVector(windDirection)
  const n = grid.nx * grid.ny
  const speedFactor = new Float32Array(n).fill(1)
  const sigmaFactor = new Float32Array(n).fill(1)
  const spanX = grid.maxX - grid.minX
  const spanY = grid.maxY - grid.minY
  const denX = Math.max(1, grid.nx - 1)
  const denY = Math.max(1, grid.ny - 1)
  for (let row = 0; row < grid.ny; row += 1) {
    const y = grid.minY + (spanY * row) / denY
    for (let col = 0; col < grid.nx; col += 1) {
      const x = grid.minX + (spanX * col) / denX
      const idx = row * grid.nx + col
      const eff = buildingEffectAtPoint(x, y, sliceHeight, buildings, dir)
      speedFactor[idx] = eff.speed
      sigmaFactor[idx] = eff.sigma
    }
  }
  return { speedFactor, sigmaFactor }
}

/** 围挡对下风向浓度的分段折减系数 */
function barrierFactor(distanceFromBarrier: number, barrierHeight: number): number {
  const h = Math.max(0.5, barrierHeight)
  const d = Math.max(0, distanceFromBarrier)
  if (d < 2 * h) return 0.5
  if (d < 5 * h) return 0.8
  return 1
}

export interface FieldComputeInput {
  grid: GridSpec
  sliceHeight: number
  weather: Weather
  sources: DustSource[]
  measures: Measures
  buildings: BuildingBoxLite[]
  timeStep: TimeStep
  stageFactor: number
  siteRect: { minX: number; minY: number; maxX: number; maxY: number }
  cityFactor: number
  sensitivePoints: SensitivePoint[]
}

interface Prepared {
  emitters: Emitter[]
  dir: Vec2
}

function prepareEmitters(input: FieldComputeInput): Prepared {
  const emitters: Emitter[] = []
  for (const source of input.sources) {
    emitters.push(...buildEmitters(source, input.timeStep, input.measures, input.stageFactor))
  }
  return { emitters, dir: windDownwindVector(input.weather.windDirection) }
}

function gaussianPlume(q: number, u: number, xd: number, yd: number, z: number, h: number, cls: StabilityClass, sy: number, sz: number): number {
  if (xd <= 0 || u <= 0.1) return 0
  const c1 = Math.exp(-(yd * yd) / (2 * sy * sy))
  const c2 = Math.exp(-((z - h) * (z - h)) / (2 * sz * sz))
  const c3 = Math.exp(-((z + h) * (z + h)) / (2 * sz * sz))
  return (q / (2 * Math.PI * u * sy * sz)) * c1 * (c2 + c3)
}

/** 让出主线程，保持界面在长计算期间可交互 */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 计算某点到场地围挡下风边缘的距离（沿下风方向，仅当位于下风侧） */
function distanceBehindBarrier(x: number, y: number, siteRect: FieldComputeInput['siteRect'], dir: Vec2): number {
  const cx = (siteRect.minX + siteRect.maxX) / 2
  const cy = (siteRect.minY + siteRect.maxY) / 2
  const halfX = (siteRect.maxX - siteRect.minX) / 2
  const halfY = (siteRect.maxY - siteRect.minY) / 2
  const xd = (x - cx) * dir.x + (y - cy) * dir.y
  const yd = (x - cx) * dir.y - (y - cy) * dir.x
  if (Math.abs(yd) > halfX + halfY) return -1
  const edge = halfX * Math.abs(dir.x) + halfY * Math.abs(dir.y)
  return xd - edge
}

/** 将微元点源集合累加到指定高度的水平浓度场 */
function fillLayer(
  field: Float32Array,
  grid: GridSpec,
  emitters: Emitter[],
  dir: Vec2,
  weather: Weather,
  z: number,
  cityFactor: number,
  effect: BuildingEffectField
): void {
  const spanX = grid.maxX - grid.minX
  const spanY = grid.maxY - grid.minY
  for (const e of emitters) {
    for (let row = 0; row < grid.ny; row += 1) {
      const y = grid.minY + (spanY * row) / (grid.ny - 1)
      const dy = y - e.y
      for (let col = 0; col < grid.nx; col += 1) {
        const x = grid.minX + (spanX * col) / (grid.nx - 1)
        const dx = x - e.x
        const xd = dx * dir.x + dy * dir.y
        if (xd <= 0) continue
        const yd = dx * dir.y - dy * dir.x
        const idx = row * grid.nx + col
        const sy = sigmaY(weather.stability, xd) * effect.sigmaFactor[idx] * cityFactor
        const sz = sigmaZ(weather.stability, xd) * effect.sigmaFactor[idx]
        const u = Math.max(0.4, weather.windSpeed * effect.speedFactor[idx])
        field[idx] += gaussianPlume(e.q, u, xd, yd, z, e.height, weather.stability, sy, sz)
      }
    }
  }
}

/** 对水平浓度场应用围挡下风向折减 */
function applyBarrier(
  field: Float32Array,
  grid: GridSpec,
  siteRect: FieldComputeInput['siteRect'],
  dir: Vec2,
  measures: Measures
): void {
  if (!measures.barrier.enabled) return
  const spanX = grid.maxX - grid.minX
  const spanY = grid.maxY - grid.minY
  for (let row = 0; row < grid.ny; row += 1) {
    const y = grid.minY + (spanY * row) / (grid.ny - 1)
    for (let col = 0; col < grid.nx; col += 1) {
      const x = grid.minX + (spanX * col) / (grid.nx - 1)
      const d = distanceBehindBarrier(x, y, siteRect, dir)
      if (d > 0) field[row * grid.nx + col] *= barrierFactor(d, measures.barrier.height)
    }
  }
}

/** 计算单个时刻的完整浓度场（同步）。网格规模建议 ≤ 160×160 以保证交互。 */
export function computeField(input: FieldComputeInput): FieldResult {
  const { grid, sliceHeight, weather, cityFactor } = input
  const dir = windDownwindVector(weather.windDirection)
  const effect = computeBuildingEffect(grid, sliceHeight, input.buildings, weather.windDirection)
  const field = new Float32Array(grid.nx * grid.ny)
  const prepared = prepareEmitters(input)
  fillLayer(field, grid, prepared.emitters, dir, weather, sliceHeight, cityFactor, effect)
  applyBarrier(field, grid, input.siteRect, dir, input.measures)
  return summarize(input, field)
}

/** 异步分块版本：逐源计算，每处理一个源让出主线程并回报进度 */
export async function computeFieldAsync(
  input: FieldComputeInput,
  onProgress?: (ratio: number) => void,
  shouldAbort?: () => boolean
): Promise<FieldResult | null> {
  const { grid, sliceHeight, weather, cityFactor } = input
  const dir = windDownwindVector(weather.windDirection)
  const effect = computeBuildingEffect(grid, sliceHeight, input.buildings, weather.windDirection)
  const field = new Float32Array(grid.nx * grid.ny)
  const prepared = prepareEmitters(input)
  const spanX = grid.maxX - grid.minX
  const spanY = grid.maxY - grid.minY
  const total = Math.max(1, prepared.emitters.length)
  let lastYield = performance.now()
  for (let ei = 0; ei < prepared.emitters.length; ei += 1) {
    if (shouldAbort?.()) return null
    const e = prepared.emitters[ei]
    for (let row = 0; row < grid.ny; row += 1) {
      const y = grid.minY + (spanY * row) / (grid.ny - 1)
      const dy = y - e.y
      for (let col = 0; col < grid.nx; col += 1) {
        const x = grid.minX + (spanX * col) / (grid.nx - 1)
        const dx = x - e.x
        const xd = dx * dir.x + dy * dir.y
        if (xd <= 0) continue
        const yd = dx * dir.y - dy * dir.x
        const idx = row * grid.nx + col
        const sy = sigmaY(weather.stability, xd) * effect.sigmaFactor[idx] * cityFactor
        const sz = sigmaZ(weather.stability, xd) * effect.sigmaFactor[idx]
        const u = Math.max(0.4, weather.windSpeed * effect.speedFactor[idx])
        field[idx] += gaussianPlume(e.q, u, xd, yd, sliceHeight, e.height, weather.stability, sy, sz)
      }
      if (performance.now() - lastYield > 32) {
        onProgress?.((ei + row / grid.ny) / total)
        await yieldToMain()
        lastYield = performance.now()
        if (shouldAbort?.()) return null
      }
    }
    onProgress?.((ei + 1) / total)
  }
  if (input.measures.barrier.enabled) {
    for (let row = 0; row < grid.ny; row += 1) {
      const y = grid.minY + (spanY * row) / (grid.ny - 1)
      for (let col = 0; col < grid.nx; col += 1) {
        const x = grid.minX + (spanX * col) / (grid.nx - 1)
        const d = distanceBehindBarrier(x, y, input.siteRect, dir)
        if (d > 0) field[row * grid.nx + col] *= barrierFactor(d, input.measures.barrier.height)
      }
    }
  }
  onProgress?.(1)
  return summarize(input, field)
}

function summarize(input: FieldComputeInput, field: Float32Array): FieldResult {
  const { grid } = input
  let maxConcentration = 0
  let maxLocation: Vec2 = { x: 0, y: 0 }
  const spanX = grid.maxX - grid.minX
  const spanY = grid.maxY - grid.minY
  const cellArea = (spanX / (grid.nx - 1)) * (spanY / (grid.ny - 1))
  const tspLimit = input.sensitivePoints[0]?.standard.tsp ?? 300
  let exceedArea = 0
  for (let row = 0; row < grid.ny; row += 1) {
    for (let col = 0; col < grid.nx; col += 1) {
      const v = field[row * grid.nx + col]
      if (v > maxConcentration) {
        maxConcentration = v
        maxLocation = {
          x: grid.minX + (spanX * col) / (grid.nx - 1),
          y: grid.minY + (spanY * row) / (grid.ny - 1)
        }
      }
      if (v > tspLimit) exceedArea += cellArea
    }
  }
  const pm10Ratio = 0.55
  const pm25Ratio = 0.18
  const sensitiveResults: SensitiveResult[] = input.sensitivePoints.map((sp) => {
    const { tsp, pm10, pm25 } = concentrationAtPoint(input, sp.position, input.sliceHeight)
    const ratio = sp.standard.tsp > 0 ? tsp / sp.standard.tsp : 0
    return {
      id: sp.id,
      name: sp.name,
      type: sp.type,
      position: sp.position,
      tsp,
      pm10: pm10 || tsp * pm10Ratio,
      pm25: pm25 || tsp * pm25Ratio,
      standardTsp: sp.standard.tsp,
      isExceeding: tsp > sp.standard.tsp,
      exceedRatio: ratio
    }
  })
  return {
    field,
    maxConcentration,
    maxLocation,
    exceedArea,
    sensitiveResults,
    exceedCount: sensitiveResults.filter((r) => r.isExceeding).length
  }
}

/** 单点浓度（敏感点直算，不依赖网格插值） */
export function concentrationAtPoint(input: FieldComputeInput, point: Vec2, z: number): { tsp: number; pm10: number; pm25: number } {
  const dir = windDownwindVector(input.weather.windDirection)
  const effect = computeBuildingEffect(
    { minX: point.x, maxX: point.x, minY: point.y, maxY: point.y, nx: 1, ny: 1 },
    z,
    input.buildings,
    input.weather.windDirection
  )
  const prepared = prepareEmitters(input)
  let value = 0
  for (const e of prepared.emitters) {
    const dx = point.x - e.x
    const dy = point.y - e.y
    const xd = dx * dir.x + dy * dir.y
    if (xd <= 0) continue
    const yd = dx * dir.y - dy * dir.x
    const sy = sigmaY(input.weather.stability, xd) * effect.sigmaFactor[0] * input.cityFactor
    const sz = sigmaZ(input.weather.stability, xd) * effect.sigmaFactor[0]
    const u = Math.max(0.4, input.weather.windSpeed * effect.speedFactor[0])
    value += gaussianPlume(e.q, u, xd, yd, z, e.height, input.weather.stability, sy, sz)
  }
  if (input.measures.barrier.enabled) {
    const d = distanceBehindBarrier(point.x, point.y, input.siteRect, dir)
    if (d > 0) value *= barrierFactor(d, input.measures.barrier.height)
  }
  return { tsp: value, pm10: value * 0.55, pm25: value * 0.18 }
}

export interface VolumeOptions {
  /** 体数据水平分辨率（nx = ny） */
  resolution: number
  /** 垂直层数 */
  layers: number
  /** 体数据最大高度（m） */
  maxHeight: number
}

export interface VolumeResult {
  nx: number
  ny: number
  nz: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  heights: number[]
  layers: Float32Array[]
  maxValue: number
}

/** 一次性计算三维浓度体数据：各高度层复用同一批微元点源，避免重复离散 */
export function computeVolume(input: FieldComputeInput, options: VolumeOptions): VolumeResult {
  const base = input.grid
  const nx = Math.max(16, Math.min(128, Math.round(options.resolution)))
  const ny = nx
  const nz = Math.max(2, Math.min(24, Math.round(options.layers)))
  const grid: GridSpec = { minX: base.minX, maxX: base.maxX, minY: base.minY, maxY: base.maxY, nx, ny }
  const { weather, cityFactor } = input
  const dir = windDownwindVector(weather.windDirection)
  const prepared = prepareEmitters(input)
  const heights: number[] = []
  const layerFields: Float32Array[] = []
  let maxValue = 0
  for (let l = 0; l < nz; l += 1) {
    const z = (options.maxHeight * l) / (nz - 1)
    heights.push(z)
    const effect = computeBuildingEffect(grid, z, input.buildings, weather.windDirection)
    const field = new Float32Array(nx * ny)
    fillLayer(field, grid, prepared.emitters, dir, weather, z, cityFactor, effect)
    applyBarrier(field, grid, input.siteRect, dir, input.measures)
    for (let i = 0; i < field.length; i += 1) if (field[i] > maxValue) maxValue = field[i]
    layerFields.push(field)
  }
  return { nx, ny, nz, minX: grid.minX, maxX: grid.maxX, minY: grid.minY, maxY: grid.maxY, heights, layers: layerFields, maxValue }
}

/** 异步分块的三维体数据计算，按高度层让出主线程 */
export async function computeVolumeAsync(
  input: FieldComputeInput,
  options: VolumeOptions,
  shouldAbort?: () => boolean
): Promise<VolumeResult | null> {
  const base = input.grid
  const nx = Math.max(16, Math.min(128, Math.round(options.resolution)))
  const ny = nx
  const nz = Math.max(2, Math.min(24, Math.round(options.layers)))
  const grid: GridSpec = { minX: base.minX, maxX: base.maxX, minY: base.minY, maxY: base.maxY, nx, ny }
  const { weather, cityFactor } = input
  const dir = windDownwindVector(weather.windDirection)
  const prepared = prepareEmitters(input)
  const heights: number[] = []
  const layerFields: Float32Array[] = []
  let maxValue = 0
  let lastYield = performance.now()
  for (let l = 0; l < nz; l += 1) {
    const z = (options.maxHeight * l) / (nz - 1)
    heights.push(z)
    const effect = computeBuildingEffect(grid, z, input.buildings, weather.windDirection)
    const field = new Float32Array(nx * ny)
    fillLayer(field, grid, prepared.emitters, dir, weather, z, cityFactor, effect)
    applyBarrier(field, grid, input.siteRect, dir, input.measures)
    for (let i = 0; i < field.length; i += 1) if (field[i] > maxValue) maxValue = field[i]
    layerFields.push(field)
    if (performance.now() - lastYield > 32) {
      await yieldToMain()
      lastYield = performance.now()
      if (shouldAbort?.()) return null
    }
  }
  return { nx, ny, nz, minX: grid.minX, maxX: grid.maxX, minY: grid.minY, maxY: grid.maxY, heights, layers: layerFields, maxValue }
}

export interface SectionOptions {
  /** 沿下风向采样点数 */
  samples: number
  /** 垂直层数 */
  layers: number
  /** 剖面最大高度（m） */
  maxHeight: number
  /** 剖面中心相对网格中心的顺风向偏移（m，正值向下风向） */
  offsetAlong?: number
  /** 剖面中心相对网格中心的横风向偏移（m，正值朝下风向左侧） */
  offsetCross?: number
}

export interface SectionResult {
  /** 按 row=高度层、col=下风向距离排列 */
  values: Float32Array
  samples: number
  layers: number
  maxHeight: number
  maxValue: number
  dir: Vec2
  cx: number
  cy: number
  halfLength: number
}

/** 沿下风向过场地中心计算垂直剖面（下风向距离 × 高度） */
export function computeVerticalSection(input: FieldComputeInput, options: SectionOptions): SectionResult {
  const grid = input.grid
  const baseCx = (grid.minX + grid.maxX) / 2
  const baseCy = (grid.minY + grid.maxY) / 2
  const dir = windDownwindVector(input.weather.windDirection)
  const along = options.offsetAlong ?? 0
  const cross = options.offsetCross ?? 0
  const cx = baseCx + dir.x * along - dir.y * cross
  const cy = baseCy + dir.y * along + dir.x * cross
  const halfLength = Math.max(grid.maxX - grid.minX, grid.maxY - grid.minY) / 2
  const samples = Math.max(24, Math.min(256, Math.round(options.samples)))
  const layers = Math.max(2, Math.min(48, Math.round(options.layers)))
  const values = new Float32Array(samples * layers)
  const prepared = prepareEmitters(input)
  const stable = input.weather.stability
  let maxValue = 0
  for (let li = 0; li < layers; li += 1) {
    const z = (options.maxHeight * li) / (layers - 1)
    for (let si = 0; si < samples; si += 1) {
      const s = -halfLength + (2 * halfLength * si) / (samples - 1)
      const px = cx + dir.x * s
      const py = cy + dir.y * s
      const eff = buildingEffectAtPoint(px, py, z, input.buildings, dir)
      let value = 0
      for (const e of prepared.emitters) {
        const dx = px - e.x
        const dy = py - e.y
        const xd = dx * dir.x + dy * dir.y
        if (xd <= 0) continue
        const yd = dx * dir.y - dy * dir.x
        const sy = sigmaY(stable, xd) * eff.sigma * input.cityFactor
        const sz = sigmaZ(stable, xd) * eff.sigma
        const u = Math.max(0.4, input.weather.windSpeed * eff.speed)
        value += gaussianPlume(e.q, u, xd, yd, z, e.height, stable, sy, sz)
      }
      if (input.measures.barrier.enabled) {
        const d = distanceBehindBarrier(px, py, input.siteRect, dir)
        if (d > 0) value *= barrierFactor(d, input.measures.barrier.height)
      }
      values[li * samples + si] = value
      if (value > maxValue) maxValue = value
    }
  }
  return { values, samples, layers, maxHeight: options.maxHeight, maxValue, dir, cx, cy, halfLength }
}

/** 异步分块的垂直剖面计算，按高度层让出主线程 */
export async function computeVerticalSectionAsync(
  input: FieldComputeInput,
  options: SectionOptions,
  shouldAbort?: () => boolean
): Promise<SectionResult | null> {
  const grid = input.grid
  const baseCx = (grid.minX + grid.maxX) / 2
  const baseCy = (grid.minY + grid.maxY) / 2
  const dir = windDownwindVector(input.weather.windDirection)
  const along = options.offsetAlong ?? 0
  const cross = options.offsetCross ?? 0
  const cx = baseCx + dir.x * along - dir.y * cross
  const cy = baseCy + dir.y * along + dir.x * cross
  const halfLength = Math.max(grid.maxX - grid.minX, grid.maxY - grid.minY) / 2
  const samples = Math.max(24, Math.min(256, Math.round(options.samples)))
  const layers = Math.max(2, Math.min(48, Math.round(options.layers)))
  const values = new Float32Array(samples * layers)
  const prepared = prepareEmitters(input)
  const stable = input.weather.stability
  let maxValue = 0
  let lastYield = performance.now()
  for (let li = 0; li < layers; li += 1) {
    const z = (options.maxHeight * li) / (layers - 1)
    for (let si = 0; si < samples; si += 1) {
      const s = -halfLength + (2 * halfLength * si) / (samples - 1)
      const px = cx + dir.x * s
      const py = cy + dir.y * s
      const eff = buildingEffectAtPoint(px, py, z, input.buildings, dir)
      let value = 0
      for (const e of prepared.emitters) {
        const dx = px - e.x
        const dy = py - e.y
        const xd = dx * dir.x + dy * dir.y
        if (xd <= 0) continue
        const yd = dx * dir.y - dy * dir.x
        const sy = sigmaY(stable, xd) * eff.sigma * input.cityFactor
        const sz = sigmaZ(stable, xd) * eff.sigma
        const u = Math.max(0.4, input.weather.windSpeed * eff.speed)
        value += gaussianPlume(e.q, u, xd, yd, z, e.height, stable, sy, sz)
      }
      if (input.measures.barrier.enabled) {
        const d = distanceBehindBarrier(px, py, input.siteRect, dir)
        if (d > 0) value *= barrierFactor(d, input.measures.barrier.height)
      }
      values[li * samples + si] = value
      if (value > maxValue) maxValue = value
    }
    if (performance.now() - lastYield > 32) {
      await yieldToMain()
      lastYield = performance.now()
      if (shouldAbort?.()) return null
    }
  }
  return { values, samples, layers, maxHeight: options.maxHeight, maxValue, dir, cx, cy, halfLength }
}

/**
 * 生成模拟时间步：施工阶段随工程进度推进，气象按日内规律小幅变化，
 * 移动源相位随时间前进，形成完整的时间轴数据。
 */
export function buildTimeSteps(
  base: Weather,
  hours: number[],
  stageByRatio: StageKey[],
  varyWeather: boolean
): TimeStep[] {
  return hours.map((hour, index) => {
    const ratio = hours.length > 1 ? index / (hours.length - 1) : 0
    const stage = stageByRatio[Math.min(stageByRatio.length - 1, Math.floor(ratio * stageByRatio.length))]
    const dayWave = Math.sin(((hour - 6) / 12) * Math.PI)
    const windSpeed = varyWeather ? Math.max(0.8, base.windSpeed * (0.75 + 0.5 * dayWave)) : base.windSpeed
    const windDirection = varyWeather ? (base.windDirection + (hour - 12) * 1.6 + 360) % 360 : base.windDirection
    const temperature = base.temperature + (varyWeather ? (hour - 12) * 0.6 : 0)
    const stability = base.stability
    return {
      index,
      label: `${String(hour).padStart(2, '0')}:00`,
      hour,
      stage,
      stageLabel: STAGE_LABEL[stage],
      windSpeed,
      windDirection,
      stability,
      temperature,
      humidity: base.humidity,
      mobilePhase: hour / 24
    }
  })
}

export const STAGE_FACTOR: Record<StageKey, number> = {
  foundation: 1.25,
  structure: 1,
  decoration: 0.6
}

/** 将施工阶段进度按比例映射为阶段序列 */
export function stageSequence(count: number): StageKey[] {
  const keys: StageKey[] = ['foundation', 'structure', 'decoration']
  return Array.from({ length: count }, (_, i) => keys[Math.min(keys.length - 1, Math.floor((i / count) * keys.length))])
}
