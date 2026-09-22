import { Cartesian3, Color, Material, PolylineCollection, type Viewer } from 'cesium'
import { fbm2, valueNoise2 } from './noise'
import { sampleElevation, lonLatToIndex, type TerrainGrid } from './terrain'

export const WIND_SPEED_MAX = 16

export const WIND_SPEED_RAMP: Array<[number, number, number]> = [
  [92, 116, 214],
  [62, 154, 216],
  [58, 196, 198],
  [104, 212, 158],
  [196, 214, 118],
  [238, 176, 92],
  [226, 106, 78]
]

const DEG = Math.PI / 180
const METERS_PER_DEG_LAT = 111320

const PARTICLE_COUNT = 560
const TRAIL_SEGMENTS = 5
const TRAIL_BASE_METERS = 170
const TRAIL_PER_SPEED = 30
const MIN_AGL = 40
const MAX_AGL = 1400
const SIM_SPEEDUP = 55
const UPDATE_INTERVAL_MS = 66
const RESPAWN_INSET = 0.02
const MIN_WIDTH = 1.06
const MAX_WIDTH = 3.2
const GLOW_POWER = 0.62
const TAPER_POWER = 0.34
const BASE_ALPHA = 236

export type WildfireWindParams = {
  speed: number
  dir: number
  /** 活跃粒子占比（0.15-1），越低越省性能 */
  density: number
  /** 粒子亮度/不透明度（0-1） */
  opacity: number
  /** 拖尾长度倍数（0.4-2.4） */
  trail: number
  /** 粒子线宽倍数（0.5-2.2） */
  width: number
  /** 平流动画速度倍数（0.3-2.5） */
  flowSpeed: number
  /** 湍流/阵风强度倍数（0-2） */
  turbulence: number
}

export const DEFAULT_WIND_PARAMS: WildfireWindParams = {
  speed: 4.5,
  dir: 315,
  density: 0.8,
  opacity: 0.92,
  trail: 1,
  width: 1,
  flowSpeed: 1,
  turbulence: 1
}

type WindSample = { u: number; v: number; w: number }

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function metersPerDegLon(lat: number): number {
  return Math.max(METERS_PER_DEG_LAT * Math.cos(lat * DEG), 1)
}

/**
 * 三维风场可视化：近地粒子沿风场平流并保留发光拖尾。
 * 拖尾用 PolylineGlow（亮头、渐隐尾）绘制，风速映射颜色，粒子按生命周期淡入淡出。
 * 风场 = 设定风向风速 × 高度切变 × 地形绕流/上坡抬升 × 低频湍流，风向变化即时生效。
 */
export class WildfireWindField {
  private readonly viewer: Viewer
  private readonly terrain: TerrainGrid
  private readonly collection: PolylineCollection
  private readonly materials: Material[]
  private readonly rampColors: Color[]
  private readonly lons: Float64Array
  private readonly lats: Float64Array
  private readonly agls: Float32Array
  private readonly ages: Float32Array
  private readonly lifes: Float32Array
  private readonly widthScales: Float32Array
  private readonly lengthScales: Float32Array
  private readonly buckets: Int16Array
  private readonly trails: Cartesian3[][]
  private readonly scratchA: WindSample = { u: 0, v: 0, w: 0 }
  private readonly scratchB: WindSample = { u: 0, v: 0, w: 0 }

  private params: WildfireWindParams = { ...DEFAULT_WIND_PARAMS }
  private activeCount = PARTICLE_COUNT
  private phase = Math.random() * 500
  private lastUpdate = 0
  private destroyed = false

  constructor(viewer: Viewer, terrain: TerrainGrid) {
    this.viewer = viewer
    this.terrain = terrain
    this.lons = new Float64Array(PARTICLE_COUNT)
    this.lats = new Float64Array(PARTICLE_COUNT)
    this.agls = new Float32Array(PARTICLE_COUNT)
    this.ages = new Float32Array(PARTICLE_COUNT)
    this.lifes = new Float32Array(PARTICLE_COUNT)
    this.widthScales = new Float32Array(PARTICLE_COUNT)
    this.lengthScales = new Float32Array(PARTICLE_COUNT)
    this.buckets = new Int16Array(PARTICLE_COUNT).fill(-1)
    this.trails = []
    this.rampColors = WIND_SPEED_RAMP.map(([r, g, b]) => Color.fromBytes(r, g, b, 236))
    this.materials = this.createMaterials()

    this.collection = new PolylineCollection()
    viewer.scene.primitives.add(this.collection)

    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const points: Cartesian3[] = []
      for (let s = 0; s < TRAIL_SEGMENTS; s += 1) points.push(new Cartesian3())
      this.trails.push(points)
      this.widthScales[i] = 0.82 + Math.random() * 0.42
      this.lengthScales[i] = 0.72 + Math.random() * 0.62
      this.respawn(i)
      this.collection.add({
        show: true,
        positions: points,
        width: 1.6,
        material: this.materials[i]
      })
    }
    this.applyParams()
    this.refreshAll()
  }

  /**
   * 每条折线独占一个 Material：Polyline 销毁时会连带销毁自己的 material，
   * 多条折线共享实例会触发重复销毁（DeveloperError）。颜色变化通过就地更新 uniform 实现。
   */
  private createMaterials(): Material[] {
    const materials: Material[] = []
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      materials.push(
        Material.fromType('PolylineGlow', {
          color: this.rampColors[0].clone(),
          glowPower: GLOW_POWER,
          taperPower: TAPER_POWER
        })
      )
    }
    return materials
  }

  setParams(patch: Partial<WildfireWindParams>): void {
    this.params = { ...this.params, ...patch }
    this.params.speed = Math.max(this.params.speed, 0)
    this.params.dir = ((this.params.dir % 360) + 360) % 360
    this.params.density = Math.min(Math.max(this.params.density, 0.15), 1)
    this.params.opacity = Math.min(Math.max(this.params.opacity, 0), 1)
    this.params.trail = Math.min(Math.max(this.params.trail, 0.4), 2.4)
    this.params.width = Math.min(Math.max(this.params.width, 0.5), 2.2)
    this.params.flowSpeed = Math.min(Math.max(this.params.flowSpeed, 0.3), 2.5)
    this.params.turbulence = Math.min(Math.max(this.params.turbulence, 0), 2)
    this.applyParams()
  }

  private applyParams(): void {
    this.activeCount = Math.max(1, Math.round(PARTICLE_COUNT * this.params.density))
    const alpha = Math.round(BASE_ALPHA * Math.max(this.params.opacity, 0.05))
    for (let i = 0; i < this.rampColors.length; i += 1) {
      const [r, g, b] = WIND_SPEED_RAMP[i]
      this.rampColors[i] = Color.fromBytes(r, g, b, alpha)
    }
    this.buckets.fill(-1)
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const line = this.collection.get(i)
      if (line) line.show = i < this.activeCount
    }
  }

  setVisible(visible: boolean): void {
    if (this.collection.isDestroyed()) return
    this.collection.show = visible
  }

  update(): void {
    if (this.destroyed || this.viewer.isDestroyed() || this.collection.isDestroyed()) return
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    if (now - this.lastUpdate < UPDATE_INTERVAL_MS) return
    const dt = Math.min((now - this.lastUpdate) / 1000, 0.12)
    this.lastUpdate = now
    this.phase += dt
    this.step(dt)
  }

  private sample(lon: number, lat: number, agl: number, out: WindSample): void {
    const { terrain, params } = this
    const azimuth = params.dir * DEG
    const shear = 0.58 + 0.42 * clamp01(agl / 850)
    let flowAz = azimuth
    let vertical = 0

    const index = lonLatToIndex(terrain, lon, lat)
    if (index >= 0) {
      const slopeRad = terrain.slope[index] * DEG
      const upslope = terrain.upslope[index] * DEG
      const align = Math.cos(azimuth - upslope)
      vertical = params.speed * 0.6 * align * Math.sin(slopeRad) * shear
      flowAz += (upslope - azimuth) * 0.3 * Math.max(align, 0) * Math.sin(slopeRad)
    }

    const x = (lon - terrain.west) / Math.max(terrain.east - terrain.west, 1e-6)
    const y = (terrain.north - lat) / Math.max(terrain.north - terrain.south, 1e-6)
    const swirl = valueNoise2(x * 1.9 + this.phase * 0.05, y * 1.9 - this.phase * 0.04, 1337) - 0.5
    const gust = fbm2(x * 4.2 - this.phase * 0.08, y * 4.2 + this.phase * 0.07, 7331, 2)
    const turbulence = params.turbulence

    flowAz += swirl * 26 * DEG * turbulence
    const magnitude = params.speed * shear * (0.8 + 0.4 * gust * turbulence)
    out.u = magnitude * Math.sin(flowAz)
    out.v = magnitude * Math.cos(flowAz)
    out.w = vertical * (0.72 + 0.56 * gust * turbulence) + swirl * params.speed * 0.1 * turbulence
  }

  private respawn(index: number): void {
    const { terrain } = this
    const insetLon = (terrain.east - terrain.west) * RESPAWN_INSET
    const insetLat = (terrain.north - terrain.south) * RESPAWN_INSET
    this.lons[index] = terrain.west + insetLon + Math.random() * (terrain.east - terrain.west - insetLon * 2)
    this.lats[index] = terrain.south + insetLat + Math.random() * (terrain.north - terrain.south - insetLat * 2)
    this.agls[index] = MIN_AGL + Math.random() * 260
    this.ages[index] = Math.random() * 1.6
    this.lifes[index] = 8 + Math.random() * 10
    this.buckets[index] = -1
    this.widthScales[index] = 0.82 + Math.random() * 0.42
    this.lengthScales[index] = 0.72 + Math.random() * 0.62
  }

  private lifeEnvelope(index: number): number {
    const ratio = clamp01(this.ages[index] / this.lifes[index])
    return Math.sin(Math.PI * ratio)
  }

  private step(dt: number): void {
    const sim = dt * SIM_SPEEDUP * this.params.flowSpeed
    const half = sim * 0.5
    const widthScale = this.params.width
    const { terrain, scratchA, scratchB } = this
    const insetLon = (terrain.east - terrain.west) * RESPAWN_INSET
    const insetLat = (terrain.north - terrain.south) * RESPAWN_INSET

    for (let i = 0; i < this.activeCount; i += 1) {
      const lon = this.lons[i]
      const lat = this.lats[i]
      const agl = this.agls[i]

      this.sample(lon, lat, agl, scratchA)
      const midLon = lon + (scratchA.u * half) / metersPerDegLon(lat)
      const midLat = lat + (scratchA.v * half) / METERS_PER_DEG_LAT
      this.sample(midLon, midLat, agl + scratchA.w * half, scratchB)

      const nextLon = lon + (scratchB.u * sim) / metersPerDegLon(midLat)
      const nextLat = lat + (scratchB.v * sim) / METERS_PER_DEG_LAT
      const nextAgl = agl + scratchB.w * sim
      const age = this.ages[i] + dt

      if (
        nextLon < terrain.west + insetLon ||
        nextLon > terrain.east - insetLon ||
        nextLat < terrain.south + insetLat ||
        nextLat > terrain.north - insetLat ||
        nextAgl > MAX_AGL ||
        nextAgl < 0 ||
        age > this.lifes[i]
      ) {
        this.respawn(i)
      } else {
        this.lons[i] = nextLon
        this.lats[i] = nextLat
        this.agls[i] = nextAgl
        this.ages[i] = age
      }

      const speed = Math.hypot(scratchB.u, scratchB.v)
      const ratio = clamp01(speed / WIND_SPEED_MAX)
      const bucket = Math.min(Math.round(Math.sqrt(ratio) * (this.rampColors.length - 1)), this.rampColors.length - 1)
      const polyline = this.collection.get(i)
      if (this.buckets[i] !== bucket) {
        this.buckets[i] = bucket
        this.materials[i].uniforms.color = this.rampColors[bucket]
      }
      const env = this.lifeEnvelope(i)
      const width = Math.min(
        Math.max((MIN_WIDTH + ratio * 1.1) * this.widthScales[i] * (0.58 + 0.42 * env) * widthScale, MIN_WIDTH * widthScale),
        MAX_WIDTH * widthScale
      )
      polyline.width = width
      this.buildTrail(i, speed, env, scratchB.w)
      polyline.positions = this.trails[i]
    }
  }

  private buildTrail(index: number, speed: number, env: number, vertical: number): void {
    const points = this.trails[index]
    const total =
      (TRAIL_BASE_METERS + speed * TRAIL_PER_SPEED) *
      this.lengthScales[index] *
      (0.5 + 0.5 * env) *
      this.params.trail
    const stepMeters = Math.max(total / (TRAIL_SEGMENTS - 1), 7)
    let lon = this.lons[index]
    let lat = this.lats[index]
    let agl = this.agls[index]
    const speed3d = Math.hypot(speed, vertical)
    const rise = speed3d > 1e-3 ? vertical / speed3d : 0

    for (let s = TRAIL_SEGMENTS - 1; s >= 0; s -= 1) {
      const height = sampleElevation(this.terrain, lon, lat) + agl
      Cartesian3.fromDegrees(lon, lat, height, undefined, points[s])
      this.sample(lon, lat, agl, this.scratchA)
      const norm = Math.hypot(this.scratchA.u, this.scratchA.v) || 1
      lon -= ((this.scratchA.u / norm) * stepMeters) / metersPerDegLon(lat)
      lat -= ((this.scratchA.v / norm) * stepMeters) / METERS_PER_DEG_LAT
      agl = Math.max(agl - rise * stepMeters, MIN_AGL * 0.35)
    }
  }

  private refreshAll(): void {
    for (let i = 0; i < this.activeCount; i += 1) {
      this.buildTrail(i, this.params.speed, 0.5, 0)
      this.collection.get(i).positions = this.trails[i]
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.viewer.isDestroyed()) return
    if (!this.collection.isDestroyed()) this.viewer.scene.primitives.remove(this.collection)
    for (const material of this.materials) {
      if (!material.isDestroyed()) material.destroy()
    }
  }
}
