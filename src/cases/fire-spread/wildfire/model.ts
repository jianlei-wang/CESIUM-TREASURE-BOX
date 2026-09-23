import { extractRings, isoRings, ringPerimeterMeters, simplifyRing, type GridRing } from './contour'
import { FUEL_PROFILES, type FuelGrid } from './fuel'
import { fuseRings } from './fuse'
import { rasterizeBarriers, type Firebreak } from './firebreak'
import { cellCenter, lonLatToIndex, type TerrainGrid } from './terrain'
import type { LonLat } from './types'

export type FireParams = {
  /** 地表风速 (m/s) */
  windSpeed: number
  /** 风的去向方位角 (0=向北, 90=向东) */
  windDir: number
  /** 细死可燃物含水率 (0-1) */
  moisture: number
  /** 风速修正系数 */
  windFactor: number
  /** 坡度修正系数 */
  slopeFactor: number
  /** 推演时间步 (min) */
  cellMinutes: number
  /** 燃烧持续期缩放 */
  burnScale: number
  /** 推演总时长 (min) */
  maxMinutes: number
  /** 点燃延迟 (min) */
  ignitionDelay: number
}

export type FireMetrics = {
  burnedCells: number
  frontCells: number
  burnedAreaM2: number
  perimeterM: number
  headDistanceM: number
  meanRos: number
  maxRos: number
  meanElevation: number
  meanSlope: number
  meanAspect: number
  roadMatchPct: number
  erosionLengthM: number
  erosionAreaPct: number
  burningFuel: string
  /** 火线椭圆蔓延模板长宽比（顺风拉长，1 为圆形） */
  spreadLb: number
  /** 主导蔓延方向（火头方位角，0=北 90=东） */
  headAzimuth: number
}

export const DEFAULT_FIRE_PARAMS: FireParams = {
  windSpeed: 4.5,
  windDir: 315,
  moisture: 0.14,
  windFactor: 1,
  slopeFactor: 1,
  cellMinutes: 2,
  burnScale: 1,
  maxMinutes: 360,
  ignitionDelay: 0.2
}

const CELL_PHASE_UNBURNED = 0
const CELL_PHASE_BURNING = 1
const CELL_PHASE_BURNED = 2

const DEG = Math.PI / 180
const NEIGHBOR_OFFSETS: Array<{ dc: number; dr: number; dist: number; azimuth: number }> = []
for (let dr = -1; dr <= 1; dr += 1) {
  for (let dc = -1; dc <= 1; dc += 1) {
    if (dc === 0 && dr === 0) continue
    const azimuth = (Math.atan2(dc, -dr) / DEG + 360) % 360
    NEIGHBOR_OFFSETS.push({ dc, dr, dist: dc !== 0 && dr !== 0 ? Math.SQRT2 : 1, azimuth })
  }
}

/**
 * 椭圆蔓延模板系数：长宽比 L/B = 1 + LB_WIND·有效风速 + LB_SLOPE·tan(坡度)，
 * 风/坡越强顺风方向越拉长；收敛于 [1, LB_MAX]，避免退化为针状。
 */
const LB_WIND_COEF = 0.12
const LB_SLOPE_COEF = 3
const LB_MAX = 5
/** 元胞邻域引燃概率权重映射到点燃延迟的缩放区间（概率越高延迟越小）。 */
const PROB_DELAY_SCALE_MIN = 0.7
const PROB_DELAY_SCALE_MAX = 1.3

type SpreadEllipse = { head: number; back: number; flank: number; eccentricity: number; heading: number; lb: number }


export class WildfireSimulation {
  readonly terrain: TerrainGrid
  fuel: FuelGrid
  params: FireParams

  private arrival: Float32Array
  private rosIn: Float32Array
  private burnDuration: Float32Array
  private burningMask: Uint8Array
  private burnedMask: Uint8Array
  private scalarScratch: Float32Array
  private ignitionIndex = -1
  private currentTime = 0
  private solvedMax = 0
  /** 全部起火种子（格点索引 → 点燃时刻），追加火点后仍可在参数/隔离带变化时完整重解。 */
  private readonly seeds = new Map<number, number>()
  private firebreaks: Firebreak[] = []
  private barrierMask: Uint8Array

  constructor(terrain: TerrainGrid, fuel: FuelGrid, params: Partial<FireParams> = {}) {
    this.terrain = terrain
    this.fuel = fuel
    this.params = { ...DEFAULT_FIRE_PARAMS, ...params }
    const cells = terrain.cols * terrain.rows
    this.arrival = new Float32Array(cells).fill(Infinity)
    this.rosIn = new Float32Array(cells)
    this.burnDuration = new Float32Array(cells)
    this.burningMask = new Uint8Array(cells)
    this.burnedMask = new Uint8Array(cells)
    this.scalarScratch = new Float32Array(cells)
    this.barrierMask = new Uint8Array(cells)
    this.refreshBurnDuration()
  }

  get ignitionCell(): number {
    return this.ignitionIndex
  }

  get time(): number {
    return this.currentTime
  }

  isFlammable(index: number): boolean {
    return this.barrierMask[index] === 0 && FUEL_PROFILES[this.fuel.kind[index]].flammable
  }

  /** 是否为隔离带（阻火）格点。 */
  isBarrier(index: number): boolean {
    return this.barrierMask[index] === 1
  }

  get firebreakCount(): number {
    return this.firebreaks.length
  }

  get firebreakList(): Firebreak[] {
    return this.firebreaks.map((item) => ({ ...item, path: item.path.map((point) => ({ ...point })) }))
  }

  phaseAt(index: number): number {
    const t = this.arrival[index]
    if (!Number.isFinite(t) || t > this.currentTime) return CELL_PHASE_UNBURNED
    return this.currentTime < t + this.burnDuration[index] ? CELL_PHASE_BURNING : CELL_PHASE_BURNED
  }

  arrivalAt(index: number): number {
    return this.arrival[index]
  }

  rosAt(index: number): number {
    return this.rosIn[index]
  }

  private refreshBurnDuration(): void {
    for (let i = 0; i < this.burnDuration.length; i += 1) {
      const profile = FUEL_PROFILES[this.fuel.kind[i]]
      this.burnDuration[i] = profile.flammable && this.barrierMask[i] === 0 ? profile.burnMinutes * this.params.burnScale : 0
    }
  }

  configure(patch: Partial<FireParams>): void {
    this.params = { ...this.params, ...patch }
    this.refreshBurnDuration()
    this.solve()
  }

  /** 地形重采样后替换可燃物栅格并重解到达时间场（保持起火点与隔离带不变）。 */
  setFuelGrid(fuel: FuelGrid): void {
    this.fuel = fuel
    this.refreshBurnDuration()
    this.solve()
    this.solvedMax = Math.max(this.solvedMax, this.params.maxMinutes)
  }

  /** 设置隔离带集合（阻火掩膜随参数变化实时重算并重新求解到达时间场）。 */
  setFirebreaks(firebreaks: Firebreak[]): void {
    this.firebreaks = firebreaks.map((item) => ({ ...item, path: item.path.map((point) => ({ ...point })) }))
    this.barrierMask = rasterizeBarriers(this.terrain, this.firebreaks)
    this.refreshBurnDuration()
    this.solve()
    this.solvedMax = Math.max(this.solvedMax, this.params.maxMinutes)
  }

  addFirebreak(firebreak: Firebreak): void {
    this.setFirebreaks([...this.firebreaks, firebreak])
  }

  clearFirebreaks(): void {
    this.setFirebreaks([])
  }

  reset(): void {
    this.arrival.fill(Infinity)
    this.rosIn.fill(0)
    this.burningMask.fill(0)
    this.burnedMask.fill(0)
    this.ignitionIndex = -1
    this.currentTime = 0
    this.solvedMax = 0
    this.seeds.clear()
  }

  setIgnition(lon: number, lat: number): boolean {
    const index = this.nearestFlammable(lon, lat)
    if (index < 0) return false
    this.reset()
    this.ignitionIndex = index
    this.seeds.set(index, 0)
    this.solve()
    return true
  }

  /** 人工修正：在当前位置追加起火点，只降低到达时间，不重置已推演结果。 */
  addIgnition(lon: number, lat: number): boolean {
    const index = this.nearestFlammable(lon, lat)
    if (index < 0) return false
    const seed = Math.max(this.currentTime, 0)
    const previous = this.seeds.get(index)
    this.seeds.set(index, previous === undefined ? seed : Math.min(previous, seed))
    if (seed < this.arrival[index]) this.arrival[index] = seed
    if (this.ignitionIndex < 0) this.ignitionIndex = index
    this.relaxFrom([index])
    this.solvedMax = Math.max(this.solvedMax, this.params.maxMinutes)
    return true
  }

  setTime(minutes: number): void {
    this.currentTime = Math.min(Math.max(minutes, 0), this.params.maxMinutes)
  }

  advance(minutes: number): void {
    this.setTime(this.currentTime + minutes)
  }

  private nearestFlammable(lon: number, lat: number): number {
    const index = lonLatToIndex(this.terrain, lon, lat)
    if (index >= 0 && this.isFlammable(index)) return index
    const { cols, rows } = this.terrain
    const row0 = index >= 0 ? Math.floor(index / cols) : Math.floor(rows / 2)
    const col0 = index >= 0 ? index - row0 * cols : Math.floor(cols / 2)
    let best = -1
    let bestDist = Infinity
    for (let radius = 1; radius <= 24 && best < 0; radius += 1) {
      for (let dr = -radius; dr <= radius; dr += 1) {
        for (let dc = -radius; dc <= radius; dc += 1) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue
          const r = row0 + dr
          const c = col0 + dc
          if (r < 0 || r >= rows || c < 0 || c >= cols) continue
          const candidate = r * cols + c
          if (!this.isFlammable(candidate)) continue
          const d = dr * dr + dc * dc
          if (d < bestDist) {
            bestDist = d
            best = candidate
          }
        }
      }
    }
    return best
  }

  /** Rothermel 基准速率：基准速率 × 含水率阻尼。 */
  private baseRos(index: number): number {
    const profile = FUEL_PROFILES[this.fuel.kind[index]]
    const moistureRatio = this.params.moisture / Math.max(profile.moistureOfExtinction, 0.01)
    const damping = Math.max(0, Math.min(1, 1 - moistureRatio))
    return profile.baseRos * Math.pow(damping, 1.4)
  }

  private ellipseLb(windSpeed: number, slopeTan: number): number {
    const effective =
      Math.max(windSpeed, 0) * Math.max(this.params.windFactor, 0) +
      LB_SLOPE_COEF * Math.max(this.params.slopeFactor, 0) * slopeTan
    const lb = 1 + LB_WIND_COEF * effective
    return lb < 1 ? 1 : lb > LB_MAX ? LB_MAX : lb
  }

  /** 风矢量 + 坡向矢量合成的有效蔓延方向与椭圆模板（顺风拉长、逆风收缩）。 */
  private spreadEllipse(index: number): SpreadEllipse {
    const base = this.baseRos(index)
    const slopeTan = Math.tan(this.terrain.slope[index] * DEG)
    const windPhi = Math.max(this.params.windFactor, 0) * Math.pow(Math.max(this.params.windSpeed, 0), 1.35) * 0.06
    const slopePhi = Math.max(this.params.slopeFactor, 0) * slopeTan * 2.2

    const windAz = this.params.windDir * DEG
    const slopeAz = this.terrain.upslope[index] * DEG
    const ex = windPhi * Math.sin(windAz) + slopePhi * Math.sin(slopeAz)
    const ey = windPhi * Math.cos(windAz) + slopePhi * Math.cos(slopeAz)
    const phi = Math.hypot(ex, ey)
    const heading = (Math.atan2(ex, ey) / DEG + 360) % 360

    const head = Math.max(base * (1 + phi), 0.05)
    const lb = this.ellipseLb(this.params.windSpeed, slopeTan)
    // 极坐标火速椭圆 ROS(θ)=head·(1−e)/(1−e·cosθ) 的长宽比满足 L/B = 1/(1−e²)，
    // 故 e = sqrt(1 − 1/LB²)；侧翼速率 head·(1−e)，逆风 head·(1−e)/(1+e)。
    const eccentricity = lb > 1 ? Math.sqrt(1 - 1 / (lb * lb)) : 0
    const flank = head * (1 - eccentricity)
    const back = head * ((1 - eccentricity) / (1 + eccentricity))
    return { head, back, flank, eccentricity, heading, lb }
  }

  /** 椭圆模板在指定方位角的蔓延速率：ROS(θ)=head·(1−e)/(1−e·cos(θ−heading))。 */
  private rosFromEllipse(ellipse: SpreadEllipse, azimuth: number): number {
    const denom = 1 - ellipse.eccentricity * Math.cos((azimuth - ellipse.heading) * DEG)
    return Math.max((ellipse.head * (1 - ellipse.eccentricity)) / Math.max(denom, 1e-3), 0.05)
  }

  /**
   * 椭圆蔓延模板：θ=heading 得火头速率，θ=heading+180° 得逆风/下坡速率，侧翼介于两者之间。
   * 取代旧式「顺风即最大、其余等于基准」的均匀扩散假设。
   */
  private directionalRos(index: number, azimuth: number): number {
    return this.rosFromEllipse(this.spreadEllipse(index), azimuth)
  }

  /**
   * 元胞自动机邻域引燃概率权重：将校准后的 Rothermel 蔓延速率归一到 [0,1]，
   * 作为向该方位邻居点燃的权重（火头方向概率最高，逆风/侧翼最低）。
   */
  ignitionProbability(index: number, azimuth: number): number {
    const ellipse = this.spreadEllipse(index)
    const ros = this.rosFromEllipse(ellipse, azimuth)
    return Math.max(0, Math.min(1, ros / Math.max(ellipse.head, 1e-3)))
  }

  /** 当前参数下的火线椭圆模板（用于指标展示与外部查询）。 */
  spreadTemplateAt(lon: number, lat: number): SpreadEllipse | undefined {
    const index = lonLatToIndex(this.terrain, lon, lat)
    if (index < 0) return undefined
    return this.spreadEllipse(index)
  }

  private relaxFrom(seeds: number[]): void {
    const { cols, rows, cellMeters } = this.terrain
    const queue = seeds.slice()
    let head = 0
    let guard = 0
    const guardMax = cols * rows * 40
    while (head < queue.length && guard < guardMax) {
      guard += 1
      const index = queue[head]
      head += 1
      const row = Math.floor(index / cols)
      const col = index - row * cols
      const base = this.arrival[index]
      if (!Number.isFinite(base)) continue
      const ellipse = this.spreadEllipse(index)
      for (let n = 0; n < NEIGHBOR_OFFSETS.length; n += 1) {
        const offset = NEIGHBOR_OFFSETS[n]
        const r = row + offset.dr
        const c = col + offset.dc
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue
        const target = r * cols + c
        if (!this.isFlammable(target)) continue
        const ros = this.rosFromEllipse(ellipse, offset.azimuth)
        const probability = Math.max(0, Math.min(1, ros / Math.max(ellipse.head, 1e-3)))
        const delayScale = PROB_DELAY_SCALE_MAX - (PROB_DELAY_SCALE_MAX - PROB_DELAY_SCALE_MIN) * probability
        const candidate = base + (cellMeters * offset.dist) / ros + this.params.ignitionDelay * delayScale
        if (candidate > this.params.maxMinutes) continue
        if (candidate < this.arrival[target] - 1e-4) {
          this.arrival[target] = candidate
          this.rosIn[target] = ros
          queue.push(target)
        }
      }
    }
  }

  /** 依据当前参数求全时段到达时间场（到达时间与显示时刻无关）。 */
  solve(): void {
    this.arrival.fill(Infinity)
    this.rosIn.fill(0)
    if (this.seeds.size === 0) {
      this.solvedMax = 0
      return
    }
    const seeds: number[] = []
    for (const [index, seed] of this.seeds) {
      this.arrival[index] = seed
      seeds.push(index)
    }
    this.relaxFrom(seeds)
    this.solvedMax = this.params.maxMinutes
  }

  private refreshMasks(): void {
    const cells = this.burningMask.length
    this.burnedMask.fill(0)
    this.burningMask.fill(0)
    const elapsed = this.currentTime
    for (let i = 0; i < cells; i += 1) {
      const t = this.arrival[i]
      if (!Number.isFinite(t) || t > elapsed) continue
      if (elapsed < t + this.burnDuration[i]) this.burningMask[i] = 1
      else this.burnedMask[i] = 1
    }
  }

  /** 火场外边界：到达时间场在显示时刻的亚格点等时线，经 jsts 布尔融合修复拓扑并消除栅格锯齿。 */
  frontRings(tolerance = 0.6): GridRing[] {
    return this.isoRingsAt(this.arrival, tolerance)
  }

  /** 活跃火线：与边界同源（蔓延火场的活动火线即过火区周界），独立方法便于样式/容差区分。 */
  burningRings(tolerance = 0.3): GridRing[] {
    return this.isoRingsAt(this.arrival, tolerance)
  }

  /** 烧毁区边界：到达时间 + 燃烧持续期 的等时线，即火线退火后的内缘。 */
  burnedRings(tolerance = 0.6): GridRing[] {
    for (let i = 0; i < this.scalarScratch.length; i += 1) {
      this.scalarScratch[i] = this.arrival[i] + this.burnDuration[i]
    }
    return this.isoRingsAt(this.scalarScratch, tolerance)
  }

  private isoRingsAt(field: Float32Array, tolerance: number): GridRing[] {
    if (this.ignitionIndex < 0 || this.currentTime <= 0) return []
    const { cols, rows } = this.terrain
    const rings = isoRings(field, cols, rows, this.currentTime)
    if (!rings.length) return []
    return fuseRings(rings).map((ring) => simplifyRing(ring, tolerance))
  }

  /**
   * 一次性产出火场边界与活跃火线：两者同源（同一到达时间场、同一显示时刻），
   * 仅简化容差不同。共享一次等值线提取与 jsts 布尔融合，避免重复计算造成的周期性卡顿。
   */
  frontAndBurningRings(frontTolerance = 0.6, burningTolerance = 0.3): { front: GridRing[]; burning: GridRing[] } {
    if (this.ignitionIndex < 0 || this.currentTime <= 0) return { front: [], burning: [] }
    const { cols, rows } = this.terrain
    const rings = isoRings(this.arrival, cols, rows, this.currentTime)
    if (!rings.length) return { front: [], burning: [] }
    const fused = fuseRings(rings)
    return {
      front: fused.map((ring) => simplifyRing(ring, frontTolerance)),
      burning: fused.map((ring) => simplifyRing(ring, burningTolerance))
    }
  }

  get metrics(): FireMetrics {
    this.refreshMasks()
    const { cols, rows, cellMeters } = this.terrain
    const cellArea = cellMeters * cellMeters
    let burnedCells = 0
    let frontCells = 0
    let elevationSum = 0
    let slopeSum = 0
    let aspectSin = 0
    let aspectCos = 0
    let roadAdjacent = 0
    let steepBurned = 0
    let steepBoundary = 0
    let ellipseSin = 0
    let ellipseCos = 0
    let lbSum = 0
    const fuelCount = new Map<number, number>()

    const isBoundary = (row: number, col: number): boolean => {
      for (let n = 0; n < NEIGHBOR_OFFSETS.length; n += 1) {
        const r = row + NEIGHBOR_OFFSETS[n].dr
        const c = col + NEIGHBOR_OFFSETS[n].dc
        if (r < 0 || r >= rows || c < 0 || c >= cols) return true
        if (!this.burnedMask[r * cols + c] && !this.burningMask[r * cols + c]) return true
      }
      return false
    }

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col
        const burning = this.burningMask[index] === 1
        const burned = this.burnedMask[index] === 1
        if (!burning && !burned) continue
        burnedCells += 1
        const aspect = (this.terrain.upslope[index] + 180) % 360
        aspectSin += Math.sin(aspect * DEG)
        aspectCos += Math.cos(aspect * DEG)
        if (burning) {
          elevationSum += this.terrain.elevation[index]
          slopeSum += this.terrain.slope[index]
          frontCells += 1
          const template = this.spreadEllipse(index)
          ellipseSin += Math.sin(template.heading * DEG)
          ellipseCos += Math.cos(template.heading * DEG)
          lbSum += template.lb
        }
        for (let n = 0; n < NEIGHBOR_OFFSETS.length; n += 1) {
          const r = row + NEIGHBOR_OFFSETS[n].dr
          const c = col + NEIGHBOR_OFFSETS[n].dc
          if (r < 0 || r >= rows || c < 0 || c >= cols) continue
          if (this.fuel.road[r * cols + c]) {
            roadAdjacent += 1
            break
          }
        }
        if (this.terrain.slope[index] > 25) {
          steepBurned += 1
          if (isBoundary(row, col)) steepBoundary += 1
        }
        const fuelKind = this.fuel.kind[index]
        fuelCount.set(fuelKind, (fuelCount.get(fuelKind) ?? 0) + 1)
      }
    }

    let headDistanceM = 0
    if (this.ignitionIndex >= 0) {
      const iRow = Math.floor(this.ignitionIndex / cols)
      const iCol = this.ignitionIndex - iRow * cols
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const index = row * cols + col
          if (!this.burnedMask[index] && !this.burningMask[index]) continue
          const distance = Math.hypot(col - iCol, row - iRow) * cellMeters
          if (distance > headDistanceM) headDistanceM = distance
        }
      }
    }

    let perimeterM = 0
    const combined = new Uint8Array(cols * rows)
    for (let i = 0; i < combined.length; i += 1) {
      combined[i] = this.burningMask[i] || this.burnedMask[i] ? 1 : 0
    }
    for (const ring of extractRings(combined, cols, rows)) perimeterM += ringPerimeterMeters(ring, cellMeters)

    let topFuel = 5
    let topCount = -1
    for (const [kind, count] of fuelCount) {
      if (count > topCount) {
        topCount = count
        topFuel = kind
      }
    }

    const elapsed = Math.max(this.currentTime, 1e-3)
    let maxRos = 0
    for (let i = 0; i < this.rosIn.length; i += 1) {
      if (this.burningMask[i] && this.rosIn[i] > maxRos) maxRos = this.rosIn[i]
    }

    const spreadLb = frontCells > 0 ? lbSum / frontCells : 1
    const headAzimuth =
      frontCells > 0 ? (((Math.atan2(ellipseSin, ellipseCos) / DEG) % 360) + 360) % 360 : this.params.windDir

    return {
      burnedCells,
      frontCells,
      burnedAreaM2: burnedCells * cellArea,
      perimeterM,
      headDistanceM,
      meanRos: headDistanceM / elapsed,
      maxRos,
      meanElevation: frontCells > 0 ? elevationSum / frontCells : 0,
      meanSlope: frontCells > 0 ? slopeSum / frontCells : 0,
      meanAspect: burnedCells > 0 ? (((Math.atan2(aspectSin, aspectCos) / DEG) % 360) + 360) % 360 : 0,
      roadMatchPct: frontCells > 0 ? Math.min((roadAdjacent / frontCells) * 100, 100) : 0,
      erosionLengthM: steepBoundary * cellMeters,
      erosionAreaPct: burnedCells > 0 ? (steepBurned / burnedCells) * 100 : 0,
      burningFuel: FUEL_PROFILES[topFuel].name,
      spreadLb,
      headAzimuth
    }
  }

  ignitionLonLat(): LonLat | undefined {
    if (this.ignitionIndex < 0) return undefined
    return cellCenter(this.terrain, this.ignitionIndex)
  }

  /** 全部起火点（初始设置 + 人工追加）的格心坐标，用于同时标注所有火源。 */
  seedLonLats(): LonLat[] {
    const out: LonLat[] = []
    for (const index of this.seeds.keys()) out.push(cellCenter(this.terrain, index))
    return out
  }
}
