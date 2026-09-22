import { extractRings, ringPerimeterMeters, simplifyRing, type GridRing } from './contour'
import { FUEL_PROFILES, type FuelGrid } from './fuel'
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

export class WildfireSimulation {
  readonly terrain: TerrainGrid
  readonly fuel: FuelGrid
  params: FireParams

  private arrival: Float32Array
  private rosIn: Float32Array
  private burnDuration: Float32Array
  private burningMask: Uint8Array
  private burnedMask: Uint8Array
  private ignitionIndex = -1
  private currentTime = 0
  private solvedMax = 0

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
    this.refreshBurnDuration()
  }

  get ignitionCell(): number {
    return this.ignitionIndex
  }

  get time(): number {
    return this.currentTime
  }

  isFlammable(index: number): boolean {
    return FUEL_PROFILES[this.fuel.kind[index]].flammable
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
      this.burnDuration[i] = profile.flammable ? profile.burnMinutes * this.params.burnScale : 0
    }
  }

  configure(patch: Partial<FireParams>): void {
    this.params = { ...this.params, ...patch }
    this.refreshBurnDuration()
    this.solve()
  }

  reset(): void {
    this.arrival.fill(Infinity)
    this.rosIn.fill(0)
    this.burningMask.fill(0)
    this.burnedMask.fill(0)
    this.ignitionIndex = -1
    this.currentTime = 0
    this.solvedMax = 0
  }

  setIgnition(lon: number, lat: number): boolean {
    const index = this.nearestFlammable(lon, lat)
    if (index < 0) return false
    this.reset()
    this.ignitionIndex = index
    this.arrival[index] = 0
    this.solve()
    return true
  }

  /** 人工修正：在当前位置追加起火点，只降低到达时间，不重置已推演结果。 */
  addIgnition(lon: number, lat: number): boolean {
    const index = this.nearestFlammable(lon, lat)
    if (index < 0) return false
    const seed = Math.max(this.currentTime, 0)
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

  /** Rothermel 简化式：基准速率 × 含水率阻尼 ×（1 + 风速修正 + 坡度修正）。 */
  private directionalRos(index: number, azimuth: number): number {
    const profile = FUEL_PROFILES[this.fuel.kind[index]]
    const moistureRatio = this.params.moisture / Math.max(profile.moistureOfExtinction, 0.01)
    const damping = Math.max(0, Math.min(1, 1 - moistureRatio))
    const base = profile.baseRos * Math.pow(damping, 1.4)

    const windPhi = this.params.windFactor * Math.pow(Math.max(this.params.windSpeed, 0), 1.35) * 0.06
    const windAlign = Math.max(0, Math.cos((azimuth - this.params.windDir) * DEG))
    const slopePhi = this.params.slopeFactor * Math.tan(this.terrain.slope[index] * DEG) * 2.2
    const slopeAlign = Math.max(0, Math.cos((azimuth - this.terrain.upslope[index]) * DEG))

    return Math.max(base * (1 + windPhi * windAlign + slopePhi * slopeAlign), 0.05)
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
      for (let n = 0; n < NEIGHBOR_OFFSETS.length; n += 1) {
        const offset = NEIGHBOR_OFFSETS[n]
        const r = row + offset.dr
        const c = col + offset.dc
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue
        const target = r * cols + c
        if (!this.isFlammable(target)) continue
        const ros = this.directionalRos(index, offset.azimuth)
        const candidate = base + (cellMeters * offset.dist) / ros + this.params.ignitionDelay
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
    if (this.ignitionIndex < 0) {
      this.solvedMax = 0
      return
    }
    this.arrival[this.ignitionIndex] = 0
    this.relaxFrom([this.ignitionIndex])
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

  frontRings(tolerance = 0.6): GridRing[] {
    this.refreshMasks()
    const { cols, rows } = this.terrain
    const combined = new Uint8Array(cols * rows)
    for (let i = 0; i < combined.length; i += 1) {
      combined[i] = this.burningMask[i] || this.burnedMask[i] ? 1 : 0
    }
    return extractRings(combined, cols, rows).map((ring) => simplifyRing(ring, tolerance))
  }

  burningRings(tolerance = 0.3): GridRing[] {
    this.refreshMasks()
    const { cols, rows } = this.terrain
    return extractRings(this.burningMask, cols, rows).map((ring) => simplifyRing(ring, tolerance))
  }

  burnedRings(tolerance = 0.6): GridRing[] {
    this.refreshMasks()
    const { cols, rows } = this.terrain
    return extractRings(this.burnedMask, cols, rows).map((ring) => simplifyRing(ring, tolerance))
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
    for (const ring of this.frontRings(0.6)) perimeterM += ringPerimeterMeters(ring, cellMeters)

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
      burningFuel: FUEL_PROFILES[topFuel].name
    }
  }

  ignitionLonLat(): LonLat | undefined {
    if (this.ignitionIndex < 0) return undefined
    return cellCenter(this.terrain, this.ignitionIndex)
  }
}
