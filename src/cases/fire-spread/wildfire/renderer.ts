import {
  ArcType,
  CallbackPositionProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  CircleEmitter,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  Event,
  GeographicTilingScheme,
  ImageryLayer,
  Material,
  Matrix4,
  ParticleSystem,
  PolylineCollection,
  PolylineDashMaterialProperty,
  Rectangle,
  ReferenceFrame,
  type Entity,
  type ImageryProvider,
  type Polyline,
  type Viewer
} from 'cesium'
import type { GridRing } from './contour'
import { WILDFIRE_LINE_TYPE, registerWildfireMaterials } from './materials'
import type { WildfireSimulation } from './model'
import { paintFireOverlay, type FireOverlayModeValue } from './overlay'
import { sampleElevation } from './terrain'
import { createFlameTexture, createIgnitionTexture, createSmokeTexture } from './textures'
import { WildfireWindField, type WildfireWindParams } from './wind'

const REFRESH_INTERVAL_MS = 260
const IMAGERY_INTERVAL_MS = 520
const FIELD_CANVAS_SIZE = 512
const METERS_PER_DEG_LAT = 111320
const DEG = Math.PI / 180
/** 火线/边界沿线加密采样的最大间隔（米），保证折线贴合地形起伏。 */
const LINE_SAMPLE_SPACING = 20
/** 火线/边界抬离地表的高度（米），避免与地表及彼此之间的深度冲突。 */
const BOUNDARY_HEIGHT = 2.5
const GLOW_HEIGHT = 3.6
const CORE_HEIGHT = 4.6
/** 火焰/烟雾发射器槽位：粒子分散到多个在燃点，覆盖整个燃烧区而非单一质心。 */
const FLAME_SLOTS = 6
const SMOKE_SLOTS = 4
/** 参与最远点采样的在燃格点上限，避免大火灾时每次刷新遍历过多格点。 */
const MAX_BURNING_SAMPLES = 640

export type WildfireRenderStyle = {
  innerColor: string
  borderColor: string
  glowColor: string
  innerAlpha: number
  glowAlpha: number
  lineWidth: number
  lineGlowWidth: number
  boundaryColor: string
  boundaryWidth: number
  boundaryAlpha: number
  boundaryDash: number
}

export type WildfireParticleParams = {
  /** 火焰发射率倍数 */
  flameEmission: number
  /** 火焰上升速度倍数 */
  flameSpeed: number
  /** 火焰粒子尺寸倍数 */
  flameSize: number
  /** 火焰粒子寿命倍数 */
  flameLife: number
  /** 烟雾发射率倍数 */
  smokeEmission: number
  /** 烟雾扩散尺寸倍数 */
  smokeSize: number
  /** 烟雾粒子寿命倍数 */
  smokeLife: number
  /** 烟雾不透明度 */
  smokeOpacity: number
}

export const DEFAULT_PARTICLE_PARAMS: WildfireParticleParams = {
  flameEmission: 1,
  flameSpeed: 1,
  flameSize: 1,
  flameLife: 1,
  smokeEmission: 1,
  smokeSize: 1,
  smokeLife: 1,
  smokeOpacity: 0.42
}

export type WildfireLayerFlags = {
  field: boolean
  burnedOutline: boolean
  fireLine: boolean
  flame: boolean
  smoke: boolean
  ignition: boolean
  hydro: boolean
  roads: boolean
  wind: boolean
}

export const DEFAULT_RENDER_STYLE: WildfireRenderStyle = {
  innerColor: '#c2410c',
  borderColor: '#ffe6a8',
  glowColor: '#ff6a1a',
  innerAlpha: 0.72,
  glowAlpha: 0.5,
  lineWidth: 3.2,
  lineGlowWidth: 16,
  boundaryColor: '#f4e7d2',
  boundaryWidth: 2,
  boundaryAlpha: 0.85,
  boundaryDash: 26
}

export const DEFAULT_LAYER_FLAGS: WildfireLayerFlags = {
  field: true,
  burnedOutline: true,
  fireLine: true,
  flame: true,
  smoke: false,
  ignition: true,
  hydro: true,
  roads: true,
  wind: true
}

function metersPerDegLon(lat: number): number {
  return Math.max(METERS_PER_DEG_LAT * Math.cos(lat * DEG), 1)
}

function createFieldCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = FIELD_CANVAS_SIZE
  canvas.height = FIELD_CANVAS_SIZE
  return canvas
}

/**
 * 每条折线必须独占一个 Material 实例：Cesium 的 Polyline 在销毁时会
 * 一并销毁自己的 material，多个折线共享同一实例会导致重复销毁并抛 DeveloperError。
 */
type LineKind = 'core' | 'glow' | 'boundary'

function createLineMaterial(kind: LineKind, style: WildfireRenderStyle): Material {
  if (kind === 'core') {
    return Material.fromType(WILDFIRE_LINE_TYPE, {
      coreColor: Color.fromCssColorString(style.borderColor).withAlpha(0.95),
      glowColor: Color.fromCssColorString(style.glowColor),
      speed: 1.6,
      pulse: 1,
      noiseScale: 42
    })
  }
  if (kind === 'glow') {
    return Material.fromType('PolylineGlow', {
      color: Color.fromCssColorString(style.glowColor).withAlpha(style.glowAlpha),
      glowPower: 0.32,
      taperPower: 1
    })
  }
  return Material.fromType('PolylineDash', {
    color: Color.fromCssColorString(style.boundaryColor).withAlpha(style.boundaryAlpha),
    dashLength: style.boundaryDash,
    dashPattern: 255
  })
}

/** 就地更新材质 uniform（不重建材质实例），用于配色/样式实时生效。 */
function updateLineMaterial(material: Material, kind: LineKind, style: WildfireRenderStyle): void {
  const uniforms = material.uniforms as Record<string, unknown>
  if (kind === 'core') {
    uniforms.coreColor = Color.fromCssColorString(style.borderColor).withAlpha(0.95)
    uniforms.glowColor = Color.fromCssColorString(style.glowColor)
  } else if (kind === 'glow') {
    uniforms.color = Color.fromCssColorString(style.glowColor).withAlpha(style.glowAlpha)
  } else {
    uniforms.color = Color.fromCssColorString(style.boundaryColor).withAlpha(style.boundaryAlpha)
    uniforms.dashLength = style.boundaryDash
  }
}


/** 就地在数组中做等步长抽稀，保留首元素，避免大火灾时采样点过多。 */
function strideCompact<T>(items: T[], maxCount: number): void {
  if (items.length <= maxCount) return
  const stride = Math.ceil(items.length / maxCount)
  let write = 0
  for (let read = 0; read < items.length; read += stride) {
    items[write] = items[read]
    write += 1
  }
  items.length = write
}

type BurningSite = { lon: number; lat: number }

function createFlameSystem(emitter: CircleEmitter, show: boolean): ParticleSystem {
  return new ParticleSystem({
    image: createFlameTexture(),
    startColor: Color.fromCssColorString('#ffe9b0').withAlpha(0.95),
    endColor: Color.fromCssColorString('#c2340c').withAlpha(0),
    startScale: 1,
    endScale: 0.32,
    minimumParticleLife: 0.6,
    maximumParticleLife: 1.25,
    minimumSpeed: 3,
    maximumSpeed: 8,
    sizeInMeters: true,
    minimumImageSize: new Cartesian2(30, 30),
    maximumImageSize: new Cartesian2(90, 90),
    emissionRate: 6,
    lifetime: Number.MAX_VALUE,
    emitter,
    modelMatrix: Matrix4.IDENTITY,
    show
  })
}

function createSmokeSystem(emitter: CircleEmitter, show: boolean): ParticleSystem {
  return new ParticleSystem({
    image: createSmokeTexture(),
    startColor: Color.fromCssColorString('#8d8d8d').withAlpha(0.4),
    endColor: Color.fromCssColorString('#545454').withAlpha(0),
    startScale: 1,
    endScale: 2.2,
    minimumParticleLife: 2.5,
    maximumParticleLife: 5,
    minimumSpeed: 4,
    maximumSpeed: 10,
    sizeInMeters: true,
    minimumImageSize: new Cartesian2(60, 60),
    maximumImageSize: new Cartesian2(150, 150),
    emissionRate: 4,
    lifetime: Number.MAX_VALUE,
    emitter,
    modelMatrix: Matrix4.IDENTITY,
    show
  })
}


/**
 * 火场渲染器：栅格专题层（影像图层叠加，随地形贴合）+ 火线/边界/水系/道路矢量层 + 火焰烟雾粒子。
 * 矢量与粒子逐帧刷新，栅格专题按较低频率重建影像图层以避免纹理更新抖动。
 */
export class WildfireRenderer {
  private readonly viewer: Viewer
  private readonly sim: WildfireSimulation
  private style: WildfireRenderStyle = { ...DEFAULT_RENDER_STYLE }
  private flags: WildfireLayerFlags = { ...DEFAULT_LAYER_FLAGS }
  private mode: FireOverlayModeValue = 'theme'

  private readonly hydroWide: Entity
  private readonly hydroCore: Entity
  private readonly roads: Entity
  private readonly ignition: Entity

  private readonly fireLineCollection: PolylineCollection
  private readonly glowCollection: PolylineCollection
  private readonly boundaryCollection: PolylineCollection
  private readonly fireLinePool: Polyline[] = []
  private readonly glowPool: Polyline[] = []
  private readonly boundaryPool: Polyline[] = []
  private particleParams: WildfireParticleParams = { ...DEFAULT_PARTICLE_PARAMS }
  private readonly scratchCarto = new Cartographic()

  private readonly flameSystems: ParticleSystem[] = []
  private readonly smokeSystems: ParticleSystem[] = []
  private readonly flameEmitters: CircleEmitter[] = []
  private readonly smokeEmitters: CircleEmitter[] = []
  private readonly burningSites: BurningSite[] = []
  private readonly wind: WildfireWindField

  private readonly canvases: [HTMLCanvasElement, HTMLCanvasElement]
  private canvasToggle = 0
  private fieldLayer: ImageryLayer | undefined

  private lastVectorRefresh = -Infinity
  private lastImageryRefresh = -Infinity
  private lastImagerySignature = ''
  private lastVectorTime = Number.NaN
  private vectorsDirty = true
  private fieldDirty = true
  private destroyed = false

  constructor(viewer: Viewer, sim: WildfireSimulation) {
    this.viewer = viewer
    this.sim = sim
    registerWildfireMaterials()
    this.canvases = [createFieldCanvas(), createFieldCanvas()]

    this.fireLineCollection = new PolylineCollection()
    this.glowCollection = new PolylineCollection()
    this.boundaryCollection = new PolylineCollection()
    this.fireLineCollection.show = this.flags.fireLine
    this.glowCollection.show = this.flags.fireLine
    this.boundaryCollection.show = this.flags.burnedOutline
    viewer.scene.primitives.add(this.fireLineCollection)
    viewer.scene.primitives.add(this.glowCollection)
    viewer.scene.primitives.add(this.boundaryCollection)

    const ignitionAt = (): Cartesian3 | undefined => {
      const point = sim.ignitionLonLat()
      if (!point) return undefined
      return Cartesian3.fromDegrees(
        point.lon,
        point.lat,
        sampleElevation(sim.terrain, point.lon, point.lat) + 24
      )
    }

    this.hydroWide = viewer.entities.add({
      show: this.flags.hydro,
      polyline: {
        positions: new ConstantProperty(this.pathToPositions(sim.fuel.riverPath, 1)),
        width: 34,
        arcType: ArcType.GEODESIC,
        material: new ColorMaterialProperty(Color.fromCssColorString('#2b6ca3').withAlpha(0.28))
      }
    })

    this.hydroCore = viewer.entities.add({
      show: this.flags.hydro,
      polyline: {
        positions: new ConstantProperty(this.pathToPositions(sim.fuel.riverPath, 1.5)),
        width: 12,
        arcType: ArcType.GEODESIC,
        material: new ColorMaterialProperty(Color.fromCssColorString('#63b3e3').withAlpha(0.92))
      }
    })

    this.roads = viewer.entities.add({
      show: this.flags.roads,
      polyline: {
        positions: new ConstantProperty(this.roadsToPositions()),
        width: 3.4,
        arcType: ArcType.GEODESIC,
        material: new PolylineDashMaterialProperty({
          color: Color.fromCssColorString('#efe7d2').withAlpha(0.92),
          dashLength: 14
        })
      }
    })

    this.ignition = viewer.entities.add({
      show: this.flags.ignition,
      position: new CallbackPositionProperty(ignitionAt, false, ReferenceFrame.FIXED),
      billboard: {
        image: new ConstantProperty(createIgnitionTexture()),
        scale: new ConstantProperty(0.9),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })

    for (let i = 0; i < FLAME_SLOTS; i += 1) {
      const emitter = new CircleEmitter(60)
      const system = createFlameSystem(emitter, false)
      this.flameEmitters.push(emitter)
      this.flameSystems.push(system)
      viewer.scene.primitives.add(system)
    }
    for (let i = 0; i < SMOKE_SLOTS; i += 1) {
      const emitter = new CircleEmitter(80)
      const system = createSmokeSystem(emitter, false)
      this.smokeEmitters.push(emitter)
      this.smokeSystems.push(system)
      viewer.scene.primitives.add(system)
    }
    this.applyParticleParams()

    this.wind = new WildfireWindField(viewer, sim.terrain)
    this.wind.setVisible(this.flags.wind)
  }

  get layerFlags(): WildfireLayerFlags {
    return { ...this.flags }
  }

  get renderStyle(): WildfireRenderStyle {
    return { ...this.style }
  }

  setStyle(patch: Partial<WildfireRenderStyle>): void {
    this.style = { ...this.style, ...patch }
    this.applyLineMaterials()
    this.fieldDirty = true
  }

  setLayers(patch: Partial<WildfireLayerFlags>): void {
    this.flags = { ...this.flags, ...patch }
    this.fireLineCollection.show = this.flags.fireLine
    this.glowCollection.show = this.flags.fireLine
    this.boundaryCollection.show = this.flags.burnedOutline
    this.hydroWide.show = this.flags.hydro
    this.hydroCore.show = this.flags.hydro
    this.roads.show = this.flags.roads
    this.ignition.show = this.flags.ignition
    this.wind.setVisible(this.flags.wind)
    if (this.fieldLayer) this.fieldLayer.show = this.flags.field
    this.fieldDirty = true
    this.vectorsDirty = true
  }

  /** 粒子外观参数（火焰/烟雾的发射率、尺寸、寿命等）实时生效。 */
  setParticleParams(patch: Partial<WildfireParticleParams>): void {
    this.particleParams = { ...this.particleParams, ...patch }
    this.applyParticleParams()
    this.vectorsDirty = true
  }

  get particleAppearance(): WildfireParticleParams {
    return { ...this.particleParams }
  }

  private applyParticleParams(): void {
    const p = this.particleParams
    for (const system of this.flameSystems) {
      system.minimumSpeed = 2 * p.flameSpeed
      system.maximumSpeed = 7 * p.flameSpeed
      system.minimumImageSize = new Cartesian2(30 * p.flameSize, 30 * p.flameSize)
      system.maximumImageSize = new Cartesian2(90 * p.flameSize, 90 * p.flameSize)
      system.minimumParticleLife = 0.6 * p.flameLife
      system.maximumParticleLife = 1.25 * p.flameLife
    }
    for (const system of this.smokeSystems) {
      system.minimumImageSize = new Cartesian2(60 * p.smokeSize, 60 * p.smokeSize)
      system.maximumImageSize = new Cartesian2(150 * p.smokeSize, 150 * p.smokeSize)
      system.minimumParticleLife = 2.5 * p.smokeLife
      system.maximumParticleLife = 5 * p.smokeLife
      system.startColor = Color.fromCssColorString('#8d8d8d').withAlpha(p.smokeOpacity)
    }
  }

  /** 将当前样式（宽度与材质 uniform）应用到所有火线/光晕/边界折线。 */
  private applyLineMaterials(): void {
    for (const line of this.fireLinePool) {
      line.width = this.style.lineWidth
      updateLineMaterial(line.material, 'core', this.style)
    }
    for (const line of this.glowPool) {
      line.width = this.style.lineGlowWidth
      updateLineMaterial(line.material, 'glow', this.style)
    }
    for (const line of this.boundaryPool) {
      line.width = this.style.boundaryWidth
      updateLineMaterial(line.material, 'boundary', this.style)
    }
  }

  /** 风场参数（风速/风向/粒子密度/拖尾等）变化即时驱动三维风场。 */
  setWindParams(patch: WildfireWindParams): void {
    this.wind.setParams(patch)
  }

  setMode(mode: FireOverlayModeValue): void {
    if (this.mode === mode) return
    this.mode = mode
    this.fieldDirty = true
  }

  /** 火场状态（参数/起火点）变化但显示时刻未变时，用于强制重绘栅格专题。 */
  markFieldDirty(): void {
    this.fieldDirty = true
  }

  /** 由外部时钟逐帧调用：低频刷新矢量与栅格，逐帧更新粒子位置。 */
  update(): void {
    if (this.destroyed || this.viewer.isDestroyed()) return
    this.wind.update()
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    if (now - this.lastVectorRefresh >= REFRESH_INTERVAL_MS) {
      this.lastVectorRefresh = now
      if (this.vectorsDirty || this.sim.time !== this.lastVectorTime) {
        this.lastVectorTime = this.sim.time
        this.vectorsDirty = false
        this.refreshVectors()
        this.updateParticles()
      }
    }
    if (now - this.lastImageryRefresh >= IMAGERY_INTERVAL_MS) {
      this.lastImageryRefresh = now
      this.refreshImagery()
    }
  }

  private refreshVectors(): void {
    const fireRings = this.sim.burningRings(0.25)
    const boundaryRings = this.sim.frontRings(0.6)
    this.syncPolylines(
      this.fireLineCollection,
      this.fireLinePool,
      fireRings,
      CORE_HEIGHT,
      this.style.lineWidth,
      'core'
    )
    this.syncPolylines(
      this.glowCollection,
      this.glowPool,
      fireRings,
      GLOW_HEIGHT,
      this.style.lineGlowWidth,
      'glow'
    )
    this.syncPolylines(
      this.boundaryCollection,
      this.boundaryPool,
      boundaryRings,
      BOUNDARY_HEIGHT,
      this.style.boundaryWidth,
      'boundary'
    )
  }

  /**
   * 每个闭合环对应集合内一条独立折线（含独立材质实例），复用已有对象避免频繁增删重建。
   * 将多条环压入同一 positions 数组会使相邻环首尾相连，产生斜穿火场的对角线。
   */
  private syncPolylines(
    collection: PolylineCollection,
    pool: Polyline[],
    rings: GridRing[],
    height: number,
    width: number,
    kind: LineKind
  ): void {
    for (let i = 0; i < rings.length; i += 1) {
      const positions = this.ringToPositions(rings[i], height)
      if (positions.length < 2) continue
      let line = pool[i]
      if (!line) {
        line = collection.add({
          positions,
          width,
          material: createLineMaterial(kind, this.style),
          arcType: ArcType.GEODESIC
        })
        pool[i] = line
      } else {
        line.positions = positions
        line.width = width
      }
    }
    for (let i = rings.length; i < pool.length; i += 1) {
      const line = pool[i]
      if (line) line.show = false
    }
    for (let i = 0; i < rings.length; i += 1) {
      const line = pool[i]
      if (line) line.show = true
    }
  }

  private refreshImagery(): void {
    if (!this.flags.field) {
      if (this.fieldLayer) this.fieldLayer.show = false
      return
    }
    const signature = `${this.mode}|${this.style.innerColor}|${this.style.borderColor}|${this.style.glowColor}|${this.style.innerAlpha}|${this.style.glowAlpha}|${this.sim.time.toFixed(2)}`
    if (!this.fieldDirty && signature === this.lastImagerySignature) return
    this.lastImagerySignature = signature
    this.fieldDirty = false

    const canvas = this.canvases[this.canvasToggle]
    this.canvasToggle = 1 - this.canvasToggle
    paintFireOverlay(
      canvas,
      this.sim,
      {
        innerColor: this.style.innerColor,
        borderColor: this.style.borderColor,
        glowColor: this.style.glowColor,
        innerAlpha: this.style.innerAlpha,
        glowAlpha: this.style.glowAlpha
      },
      this.mode
    )

    const layer = new ImageryLayer(this.createCanvasProvider(canvas))
    const previous = this.fieldLayer
    const index = Math.min(1, this.viewer.imageryLayers.length)
    this.viewer.imageryLayers.add(layer, index)
    this.fieldLayer = layer
    layer.show = true
    if (previous) {
      // 新图层瓦片就绪前保留旧图层，避免出现短暂空档导致栅格专题闪烁
      const removePrevious = (): void => {
        if (this.destroyed || this.viewer.isDestroyed()) return
        if (!previous.isDestroyed()) this.viewer.imageryLayers.remove(previous, true)
      }
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(removePrevious))
      } else {
        removePrevious()
      }
    }
  }

  private createCanvasProvider(canvas: HTMLCanvasElement): ImageryProvider {
    const { west, south, east, north } = this.sim.terrain
    const rectangle = Rectangle.fromDegrees(west, south, east, north)
    const tilingScheme = new GeographicTilingScheme({
      rectangle,
      numberOfLevelZeroTilesX: 1,
      numberOfLevelZeroTilesY: 1
    })
    const provider = {
      rectangle,
      tileWidth: canvas.width,
      tileHeight: canvas.height,
      maximumLevel: 0,
      minimumLevel: 0,
      tilingScheme,
      tileDiscardPolicy: undefined,
      errorEvent: new Event(),
      credit: undefined,
      proxy: undefined,
      hasAlphaChannel: true,
      ready: true,
      getTileCredits: () => [],
      requestImage: () => Promise.resolve(canvas),
      pickFeatures: () => undefined
    }
    return provider as unknown as ImageryProvider
  }

  /**
   * 将火焰/烟雾发射器分配到多个在燃点，覆盖整个燃烧区。
   * 采样点为在燃格点，超过上限时按固定步长抽稀；再用最远点采样切成若干簇，
   * 每个簇一个发射器，发射器半径按该簇覆盖范围估算，发射率按簇数分摊总预算。
   */
  private updateParticles(): void {
    const count = this.gatherBurningSites()
    if (count === 0) {
      for (const system of this.flameSystems) system.show = false
      for (const system of this.smokeSystems) system.show = false
      return
    }

    const flameSlots = Math.min(Math.max(Math.ceil(Math.sqrt(count) / 2), 1), FLAME_SLOTS)
    const smokeSlots = Math.min(Math.max(Math.ceil(flameSlots * 0.7), 1), SMOKE_SLOTS)
    const flameSites = this.selectSites(flameSlots)
    const smokeSites = this.selectSites(smokeSlots)
    const p = this.particleParams
    const cellArea = this.sim.terrain.cellMeters * this.sim.terrain.cellMeters
    const flameTotal = Math.min(34 + count * 0.5, 160) * p.flameEmission
    const smokeTotal = Math.min(12 + count * 0.15, 36) * p.smokeEmission

    this.placeEmitters(
      this.flameSystems,
      this.flameEmitters,
      flameSites,
      this.flags.flame,
      cellArea,
      count,
      flameTotal,
      8
    )
    this.placeEmitters(
      this.smokeSystems,
      this.smokeEmitters,
      smokeSites,
      this.flags.smoke,
      cellArea,
      count,
      smokeTotal,
      26
    )
  }

  /** 收集在燃格点中心坐标，返回在燃格点总数（采样点已按上限抽稀）。 */
  private gatherBurningSites(): number {
    const { cols, rows, west, north, dLon, dLat } = this.sim.terrain
    const sites = this.burningSites
    sites.length = 0
    for (let i = 0; i < cols * rows; i += 1) {
      if (this.sim.phaseAt(i) !== 1) continue
      const row = Math.floor(i / cols)
      const col = i - row * cols
      sites.push({ lon: west + (col + 0.5) * dLon, lat: north - (row + 0.5) * dLat })
    }
    const count = sites.length
    strideCompact(sites, MAX_BURNING_SAMPLES)
    return count
  }

  /** 最远点采样：从采样点中挑选 k 个彼此尽可能分散的簇心。 */
  private selectSites(k: number): BurningSite[] {
    const sites = this.burningSites
    const n = sites.length
    if (k >= n) return sites.slice()
    const minDist = new Float64Array(n)
    const chosen: number[] = [0]
    const first = sites[0]
    for (let i = 0; i < n; i += 1) {
      const dx = sites[i].lon - first.lon
      const dy = sites[i].lat - first.lat
      minDist[i] = dx * dx + dy * dy
    }
    for (let c = 1; c < k; c += 1) {
      let best = 0
      let bestDist = -1
      for (let i = 0; i < n; i += 1) {
        if (minDist[i] > bestDist) {
          bestDist = minDist[i]
          best = i
        }
      }
      chosen.push(best)
      const center = sites[best]
      for (let i = 0; i < n; i += 1) {
        const dx = sites[i].lon - center.lon
        const dy = sites[i].lat - center.lat
        const dist = dx * dx + dy * dy
        if (dist < minDist[i]) minDist[i] = dist
      }
    }
    return chosen.map((index) => sites[index])
  }

  private placeEmitters(
    systems: ParticleSystem[],
    emitters: CircleEmitter[],
    sites: BurningSite[],
    visible: boolean,
    cellArea: number,
    count: number,
    totalRate: number,
    heightOffset: number
  ): void {
    const k = sites.length
    if (k === 0) {
      for (const system of systems) system.show = false
      return
    }
    const radius = Math.min(
      Math.max(Math.sqrt((cellArea * count) / (k * Math.PI)) * 1.15, this.sim.terrain.cellMeters * 1.2),
      900
    )
    const perSystem = Math.max(totalRate / k, 1)
    for (let i = 0; i < systems.length; i += 1) {
      const system = systems[i]
      if (i >= k) {
        system.show = false
        continue
      }
      const site = sites[i]
      const ground = sampleElevation(this.sim.terrain, site.lon, site.lat)
      system.modelMatrix = Matrix4.fromTranslation(
        Cartesian3.fromDegrees(site.lon, site.lat, ground + heightOffset)
      )
      emitters[i].radius = radius
      if (Math.abs(system.emissionRate - perSystem) > 0.01) system.emissionRate = perSystem
      system.show = visible
    }
  }

  private ringToPositions(ring: GridRing, offset: number): Cartesian3[] {
    if (ring.length < 3) return []
    const { west, north, dLon, dLat } = this.sim.terrain
    const points = ring.map((point) => ({ lon: west + point.x * dLon, lat: north - point.y * dLat }))
    points.push({ ...points[0] })
    return this.densifyRing(points).map((point) =>
      Cartesian3.fromDegrees(point.lon, point.lat, this.drapedHeight(point.lon, point.lat) + offset)
    )
  }

  /** 顶点高程优先取地球实际渲染地形，取不到时回退到本地解析高程。 */
  private drapedHeight(lon: number, lat: number): number {
    const globe = this.viewer.scene.globe
    if (globe) {
      Cartographic.fromDegrees(lon, lat, 0, this.scratchCarto)
      const terrainHeight = globe.getHeight(this.scratchCarto)
      if (typeof terrainHeight === 'number' && Number.isFinite(terrainHeight)) return terrainHeight
    }
    return sampleElevation(this.sim.terrain, lon, lat)
  }

  private densifyRing(points: Array<{ lon: number; lat: number }>): Array<{ lon: number; lat: number }> {
    const out: Array<{ lon: number; lat: number }> = []
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i]
      const b = points[i + 1]
      out.push(a)
      const dx = (b.lon - a.lon) * metersPerDegLon((a.lat + b.lat) * 0.5)
      const dy = (b.lat - a.lat) * METERS_PER_DEG_LAT
      const steps = Math.min(Math.ceil(Math.hypot(dx, dy) / LINE_SAMPLE_SPACING), 160)
      for (let k = 1; k < steps; k += 1) {
        const t = k / steps
        out.push({ lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t })
      }
    }
    out.push(points[points.length - 1])
    return out
  }

  private pathToPositions(path: Array<{ lon: number; lat: number }>, offset: number): Cartesian3[] {
    return path.map((point) =>
      Cartesian3.fromDegrees(point.lon, point.lat, sampleElevation(this.sim.terrain, point.lon, point.lat) + offset)
    )
  }

  private roadsToPositions(): Cartesian3[] {
    const positions: Cartesian3[] = []
    for (const path of this.sim.fuel.roadPaths) positions.push(...this.pathToPositions(path, 6))
    return positions
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.viewer.isDestroyed()) return
    const entities = [this.hydroWide, this.hydroCore, this.roads, this.ignition]
    for (const entity of entities) this.viewer.entities.remove(entity)
    this.viewer.scene.primitives.remove(this.fireLineCollection)
    this.viewer.scene.primitives.remove(this.glowCollection)
    this.viewer.scene.primitives.remove(this.boundaryCollection)
    const fieldLayer = this.fieldLayer
    if (fieldLayer) {
      if (!fieldLayer.isDestroyed()) this.viewer.imageryLayers.remove(fieldLayer, true)
      this.fieldLayer = undefined
    }
    for (const system of this.flameSystems) this.viewer.scene.primitives.remove(system)
    for (const system of this.smokeSystems) this.viewer.scene.primitives.remove(system)
    this.wind.destroy()
  }
}
