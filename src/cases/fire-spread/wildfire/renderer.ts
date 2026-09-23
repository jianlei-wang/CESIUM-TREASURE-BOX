import {
  ArcType,
  BillboardCollection,
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
  type Entity,
  type ImageryProvider,
  type Polyline,
  type Viewer
} from 'cesium'
import type { GridRing } from './contour'
import { enumerateCells, type BeiDouCell } from './beidou'
import { computeBeiDouStats, type BeiDouCellStats } from './beidouStats'
import type { Firebreak } from './firebreak'
import { WILDFIRE_LINE_TYPE, registerWildfireMaterials } from './materials'
import type { WildfireSimulation } from './model'
import { paintFireOverlay, paintFuelClassification, type FireOverlayModeValue } from './overlay'
import { FUEL_PROFILES } from './fuel'
import { sampleElevation } from './terrain'
import { createFlameTexture, createIgnitionTexture, createSmokeTexture } from './textures'
import type { LonLat } from './types'
import { WildfireWindField, type WildfireWindParams } from './wind'

const REFRESH_INTERVAL_MS = 260
const IMAGERY_INTERVAL_MS = 520
const FIELD_CANVAS_SIZE = 512
const METERS_PER_DEG_LAT = 111320
const DEG = Math.PI / 180
/** 火线/边界沿线加密采样的最大间隔（米），保证折线贴合地形起伏。 */
const LINE_SAMPLE_SPACING = 20
/** 水系/道路沿线的加密间隔（米），兼顾走向平滑与顶点数。 */
const TRACE_SAMPLE_SPACING = 90
/** 火线/边界抬离地表的高度（米），避免与地表及彼此之间的深度冲突。 */
const BOUNDARY_HEIGHT = 2.5
const GLOW_HEIGHT = 3.6
const CORE_HEIGHT = 4.6
/** 水系/道路贴地线宽（米），按真实地物的物理尺度设置。 */
const HYDRO_BANK_WIDTH = 92
const HYDRO_BODY_WIDTH = 36
const ROAD_CASE_WIDTH = 15
const ROAD_SURFACE_WIDTH = 8.5
const ROAD_CENTER_WIDTH = 1.6
/** 火焰/烟雾发射器槽位：粒子分散到多个在燃点，覆盖整个燃烧区而非单一质心。 */
const FLAME_SLOTS = 6
const SMOKE_SLOTS = 4
/** 起火点初始火焰发射槽位：让每个火源始终显示引燃火焰。 */
const SEED_FLAME_SLOTS = 6
/** 参与最远点采样的在燃格点上限，避免大火灾时每次刷新遍历过多格点。 */
const MAX_BURNING_SAMPLES = 640
/** 北斗网格专题画布边长：高于模拟网格，保证高等级网格线清晰可辨。 */
const BEIDOU_CANVAS_SIZE = 2048
/** 隔离带中心线加密间隔（米）。 */
const FIREBREAK_SAMPLE_SPACING = 40

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
  flameSize: 0.4,
  flameLife: 1,
  smokeEmission: 1,
  smokeSize: 1,
  smokeLife: 1,
  smokeOpacity: 0.42
}

export type WildfireLayerFlags = {
  field: boolean
  fuel: boolean
  burnedOutline: boolean
  fireLine: boolean
  flame: boolean
  smoke: boolean
  ignition: boolean
  hydro: boolean
  roads: boolean
  wind: boolean
  beidouGrid: boolean
  firebreak: boolean
}

export type BeiDouRenderModeValue = 'lines' | 'burnRatio' | 'elevation' | 'slope' | 'fuel'

export type WildfireBeidouParams = {
  enabled: boolean
  level: number
  mode: BeiDouRenderModeValue
  lineColor: string
  lineAlpha: number
  fillAlpha: number
  /** 高亮选中的北斗单元键（level:row:col） */
  selectedKey: string
}

export const DEFAULT_BEIDOU_PARAMS: WildfireBeidouParams = {
  enabled: false,
  level: 9,
  mode: 'lines',
  lineColor: '#66d9ff',
  lineAlpha: 0.5,
  fillAlpha: 0.42,
  selectedKey: ''
}

export const DEFAULT_RENDER_STYLE: WildfireRenderStyle = {
  innerColor: '#c2410c',
  borderColor: '#ffe6a8',
  glowColor: '#ff6a1a',
  innerAlpha: 1,
  glowAlpha: 0.05,
  lineWidth: 1,
  lineGlowWidth: 16,
  boundaryColor: '#ffc457',
  boundaryWidth: 2.6,
  boundaryAlpha: 0.95,
  boundaryDash: 42
}

export const DEFAULT_LAYER_FLAGS: WildfireLayerFlags = {
  field: true,
  fuel: true,
  burnedOutline: true,
  fireLine: true,
  flame: true,
  smoke: false,
  ignition: true,
  hydro: true,
  roads: true,
  wind: true,
  beidouGrid: false,
  firebreak: true
}

function metersPerDegLon(lat: number): number {
  return Math.max(METERS_PER_DEG_LAT * Math.cos(lat * DEG), 1)
}

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  const value =
    clean.length === 3
      ? clean
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6)
  const int = Number.parseInt(value, 16)
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}

function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHexColor(hex)
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`
}

function rampColor(stops: Array<[number, number, number]>, t: number): { r: number; g: number; b: number } {
  const clamped = Math.max(0, Math.min(1, t))
  const scaled = clamped * (stops.length - 1)
  const index = Math.min(Math.floor(scaled), stops.length - 2)
  const f = scaled - index
  const a = stops[index]
  const b = stops[index + 1]
  return {
    r: Math.round(a[0] + (b[0] - a[0]) * f),
    g: Math.round(a[1] + (b[1] - a[1]) * f),
    b: Math.round(a[2] + (b[2] - a[2]) * f)
  }
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

/**
 * 水系与道路按「分层带状」渲染：宽而暗的河岸/路肩 + 窄而亮的水面/路面 + 道路中线。
 * 这些地物使用贴地图元（clampToGround）绘制，使线宽以米为单位并自动随真实地形起伏，
 * 既避免漂浮在半空，也让线宽随缩放保持真实的物理尺度。
 */
type HydroRoadSpec = {
  width: number
  color: string
  alpha: number
  dashed?: boolean
  dashLength?: number
}

const HYDRO_SPECS: HydroRoadSpec[] = [
  { width: HYDRO_BANK_WIDTH, color: '#15455f', alpha: 0.45 },
  { width: HYDRO_BODY_WIDTH, color: '#3d92c4', alpha: 0.72 }
]

const ROAD_SPECS: HydroRoadSpec[] = [
  { width: ROAD_CASE_WIDTH, color: '#3f382c', alpha: 0.88 },
  { width: ROAD_SURFACE_WIDTH, color: '#c7bca0', alpha: 0.95 },
  { width: ROAD_CENTER_WIDTH, color: '#fff3d6', alpha: 0.9, dashed: true, dashLength: 22 }
]

function createPathMaterial(spec: HydroRoadSpec): ColorMaterialProperty | PolylineDashMaterialProperty {
  const color = Color.fromCssColorString(spec.color).withAlpha(spec.alpha)
  return spec.dashed
    ? new PolylineDashMaterialProperty({ color, dashLength: spec.dashLength ?? 20 })
    : new ColorMaterialProperty(color)
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

  private readonly hydroEntities: Entity[] = []
  private readonly roadEntities: Entity[] = []
  private readonly ignitionBillboards: BillboardCollection

  private readonly fireLineCollection: PolylineCollection
  private readonly glowCollection: PolylineCollection
  private readonly boundaryCollection: PolylineCollection
  private readonly fireLinePool: Polyline[] = []
  private readonly glowPool: Polyline[] = []
  private readonly boundaryPool: Polyline[] = []
  private particleParams: WildfireParticleParams = { ...DEFAULT_PARTICLE_PARAMS }
  private readonly scratchCarto = new Cartographic()
  /** 单帧内贴地高程记忆化：火线/光晕/边界在相同顶点重复查询地球高程，缓存避免重复 ray-cast。 */
  private readonly drapeCache = new Map<string, number>()

  private readonly flameSystems: ParticleSystem[] = []
  private readonly smokeSystems: ParticleSystem[] = []
  private readonly flameEmitters: CircleEmitter[] = []
  private readonly smokeEmitters: CircleEmitter[] = []
  private readonly seedFlameSystems: ParticleSystem[] = []
  private readonly seedFlameEmitters: CircleEmitter[] = []
  private readonly burningSites: BurningSite[] = []
  private readonly wind: WildfireWindField

  private readonly canvases: [HTMLCanvasElement, HTMLCanvasElement]
  private canvasToggle = 0
  private fieldLayer: ImageryLayer | undefined

  /** 可燃物类型（下垫面/地表覆盖）底图，独立于专题模式的可开闭图层。 */
  private readonly fuelCanvas: HTMLCanvasElement
  private fuelLayer: ImageryLayer | undefined
  private fuelDirty = true

  private beidou: WildfireBeidouParams = { ...DEFAULT_BEIDOU_PARAMS }
  private readonly beidouCanvas: HTMLCanvasElement
  private beidouLayer: ImageryLayer | undefined
  private beidouDirty = true
  private lastBeidouSignature = ''
  private beidouCells: BeiDouCell[] = []
  private beidouCellLevel = -1

  private readonly firebreakEntities: Entity[] = []
  private firebreakPreview: Entity | undefined
  private readonly firebreakVertexEntities: Entity[] = []

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
    this.fuelCanvas = createFieldCanvas()
    this.beidouCanvas = document.createElement('canvas')
    this.beidouCanvas.width = BEIDOU_CANVAS_SIZE
    this.beidouCanvas.height = BEIDOU_CANVAS_SIZE

    this.fireLineCollection = new PolylineCollection()
    this.glowCollection = new PolylineCollection()
    this.boundaryCollection = new PolylineCollection()
    this.fireLineCollection.show = this.flags.fireLine
    this.glowCollection.show = this.flags.fireLine
    this.boundaryCollection.show = this.flags.burnedOutline
    viewer.scene.primitives.add(this.fireLineCollection)
    viewer.scene.primitives.add(this.glowCollection)
    viewer.scene.primitives.add(this.boundaryCollection)

    this.buildHydroRoads()
    this.setHydroRoadsVisible()
    this.refreshFuel()

    this.ignitionBillboards = new BillboardCollection({ scene: viewer.scene })
    this.ignitionBillboards.show = this.flags.ignition
    viewer.scene.primitives.add(this.ignitionBillboards)
    this.syncIgnitionBillboards()

    for (let i = 0; i < FLAME_SLOTS; i += 1) {
      const emitter = new CircleEmitter(60)
      const system = createFlameSystem(emitter, false)
      this.flameEmitters.push(emitter)
      this.flameSystems.push(system)
      viewer.scene.primitives.add(system)
    }
    for (let i = 0; i < SEED_FLAME_SLOTS; i += 1) {
      const emitter = new CircleEmitter(50)
      const system = createFlameSystem(emitter, false)
      this.seedFlameEmitters.push(emitter)
      this.seedFlameSystems.push(system)
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
    this.setHydroRoadsVisible()
    this.ignitionBillboards.show = this.flags.ignition
    this.wind.setVisible(this.flags.wind)
    if (this.fieldLayer) this.fieldLayer.show = this.flags.field
    if (this.fuelLayer) this.fuelLayer.show = this.flags.fuel
    for (const entity of this.firebreakEntities) entity.show = this.flags.firebreak
    if (this.firebreakPreview) this.firebreakPreview.show = this.flags.firebreak
    for (const entity of this.firebreakVertexEntities) entity.show = this.flags.firebreak
    if (this.beidouLayer) this.beidouLayer.show = this.beidou.enabled && this.flags.beidouGrid
    this.fieldDirty = true
    this.vectorsDirty = true
    this.beidouDirty = true
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
    for (const system of [...this.flameSystems, ...this.seedFlameSystems]) {
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

  private setHydroRoadsVisible(): void {
    for (const entity of this.hydroEntities) entity.show = this.flags.hydro
    for (const entity of this.roadEntities) entity.show = this.flags.roads
  }

  /** 水系与道路：贴地图元 + 米制线宽，自动沿真实地形起伏，绝不漂浮。 */
  private buildHydroRoads(): void {
    const add = (path: LonLat[], spec: HydroRoadSpec, sink: Entity[]): void => {
      const positions = this.pathToCartesians(path)
      if (positions.length < 2) return
      const entity = this.viewer.entities.add({
        show: true,
        polyline: {
          positions: new ConstantProperty(positions),
          width: spec.width,
          clampToGround: true,
          material: createPathMaterial(spec)
        }
      })
      sink.push(entity)
    }

    const river = this.sim.fuel.riverPath
    for (const spec of HYDRO_SPECS) add(river, spec, this.hydroEntities)
    for (const path of this.sim.fuel.roadPaths) {
      for (const spec of ROAD_SPECS) add(path, spec, this.roadEntities)
    }
  }

  setMode(mode: FireOverlayModeValue): void {
    if (this.mode === mode) return
    this.mode = mode
    this.fieldDirty = true
  }

  /** 火场状态（参数/起火点）变化但显示时刻未变时，用于强制重绘栅格专题。 */
  markFieldDirty(): void {
    this.fieldDirty = true
    this.fuelDirty = true
  }

  /** 起火点集合变化时，强制刷新矢量层与起火点标注/初始火焰粒子。 */
  markVectorsDirty(): void {
    this.vectorsDirty = true
  }

  get beidouParams(): WildfireBeidouParams {
    return { ...this.beidou }
  }

  /** 北斗网格参数（启用、层级、着色模式、选中单元）实时生效。 */
  setBeidou(patch: Partial<WildfireBeidouParams>): void {
    this.beidou = { ...this.beidou, ...patch }
    if (this.beidouLayer) this.beidouLayer.show = this.beidou.enabled && this.flags.beidouGrid
    this.beidouDirty = true
  }

  /** 提交隔离带：以贴地双层折线（阻火带填充 + 中心虚线）渲染。 */
  setFirebreaks(firebreaks: Firebreak[]): void {
    for (const entity of this.firebreakEntities) this.viewer.entities.remove(entity)
    this.firebreakEntities.length = 0
    for (const firebreak of firebreaks) {
      if (firebreak.path.length < 2 || firebreak.widthM <= 0) continue
      const positions = this.pathToCartesians(firebreak.path, FIREBREAK_SAMPLE_SPACING)
      if (positions.length < 2) continue
      const fill = this.viewer.entities.add({
        show: this.flags.firebreak,
        polyline: {
          positions: new ConstantProperty(positions),
          width: firebreak.widthM,
          clampToGround: true,
          material: new ColorMaterialProperty(Color.fromCssColorString('#0d5b57').withAlpha(0.55))
        }
      })
      const core = this.viewer.entities.add({
        show: this.flags.firebreak,
        polyline: {
          positions: new ConstantProperty(positions),
          width: Math.max(firebreak.widthM * 0.32, 3),
          clampToGround: true,
          material: new PolylineDashMaterialProperty({
            color: Color.fromCssColorString('#38e8c8').withAlpha(0.95),
            dashLength: 26
          })
        }
      })
      this.firebreakEntities.push(fill, core)
    }
  }

  /** 绘制中的隔离带预览（顶点 + 中心线）；空数组表示清除预览。 */
  setFirebreakPreview(path: LonLat[]): void {
    for (const entity of this.firebreakVertexEntities) this.viewer.entities.remove(entity)
    this.firebreakVertexEntities.length = 0
    if (path.length === 0) {
      if (this.firebreakPreview) this.firebreakPreview.show = false
      return
    }
    for (const point of path) {
      const entity = this.viewer.entities.add({
        show: this.flags.firebreak,
        position: Cartesian3.fromDegrees(point.lon, point.lat, this.drapedHeight(point.lon, point.lat) + 6),
        point: {
          pixelSize: 7,
          color: Color.fromCssColorString('#38e8c8'),
          outlineColor: Color.fromCssColorString('#05201c'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      })
      this.firebreakVertexEntities.push(entity)
    }
    if (path.length < 2) {
      if (this.firebreakPreview) this.firebreakPreview.show = false
      return
    }
    const positions = this.pathToCartesians(path, FIREBREAK_SAMPLE_SPACING)
    if (!this.firebreakPreview) {
      this.firebreakPreview = this.viewer.entities.add({
        show: this.flags.firebreak,
        polyline: {
          positions: new ConstantProperty(positions),
          width: 3,
          clampToGround: true,
          material: new PolylineDashMaterialProperty({
            color: Color.fromCssColorString('#7dfff0').withAlpha(0.95),
            dashLength: 18
          })
        }
      })
    } else {
      this.firebreakPreview.show = this.flags.firebreak
      const graphics = this.firebreakPreview.polyline
      if (graphics) graphics.positions = new ConstantProperty(positions)
    }
  }

  /** 北斗网格专题：按层级枚举单元，叠加统计着色与选中高亮，独立影像图层置顶。 */
  private refreshBeidou(): void {
    const active = this.beidou.enabled && this.flags.beidouGrid
    if (!active) {
      if (this.beidouLayer) this.beidouLayer.show = false
      return
    }
    // 仅「单元过火占比」依时间变化； elevations/slope/fuel 为静态专题，纳入时间会引发无谓重绘。
    const timeKey = this.beidou.mode === 'burnRatio' ? this.sim.time.toFixed(1) : 'static'
    const signature = `${this.beidou.level}|${this.beidou.mode}|${this.beidou.lineColor}|${this.beidou.lineAlpha}|${this.beidou.fillAlpha}|${this.beidou.selectedKey}|${timeKey}`
    if (!this.beidouDirty && signature === this.lastBeidouSignature) return
    this.lastBeidouSignature = signature
    this.beidouDirty = false

    if (this.beidouCellLevel !== this.beidou.level) {
      this.beidouCells = enumerateCells(this.sim.terrain, this.beidou.level)
      this.beidouCellLevel = this.beidou.level
    }
    const stats = this.beidou.mode === 'lines' ? undefined : computeBeiDouStats(this.sim, this.beidou.level, this.sim.terrain)
    this.paintBeidou(stats)

    const layer = new ImageryLayer(this.createCanvasProvider(this.beidouCanvas))
    const previous = this.beidouLayer
    this.viewer.imageryLayers.add(layer)
    this.beidouLayer = layer
    layer.show = true
    if (previous) {
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

  private paintBeidou(stats?: Map<string, BeiDouCellStats>): void {
    const canvas = this.beidouCanvas
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const size = canvas.width
    const { west, south, east, north } = this.sim.terrain
    const sx = size / Math.max(east - west, 1e-9)
    const sy = size / Math.max(north - south, 1e-9)
    const toX = (lon: number): number => (lon - west) * sx
    const toY = (lat: number): number => (north - lat) * sy

    let minElev = Infinity
    let maxElev = -Infinity
    if (this.beidou.mode === 'elevation') {
      for (let i = 0; i < this.sim.terrain.elevation.length; i += 1) {
        const value = this.sim.terrain.elevation[i]
        if (value < minElev) minElev = value
        if (value > maxElev) maxElev = value
      }
      if (!(maxElev > minElev)) maxElev = minElev + 1
    }

    ctx.clearRect(0, 0, size, size)
    const fillAlpha = Math.max(0, Math.min(1, this.beidou.fillAlpha))
    const lineRgba = withAlpha(this.beidou.lineColor, Math.max(0, Math.min(1, this.beidou.lineAlpha)))

    for (const cell of this.beidouCells) {
      const x0 = toX(cell.west)
      const x1 = toX(cell.east)
      const y0 = toY(cell.north)
      const y1 = toY(cell.south)
      const w = x1 - x0
      const h = y1 - y0
      if (w <= 0 || h <= 0) continue
      if (x1 < 0 || y1 < 0 || x0 > size || y0 > size) continue
      if (stats && this.beidou.mode !== 'lines') {
        const stat = stats.get(cell.key)
        const color = this.beidouCellColor(stat, minElev, maxElev)
        if (color && color.a > 0) {
          ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${(color.a * fillAlpha).toFixed(3)})`
          ctx.fillRect(x0, y0, w, h)
        }
      }
      ctx.strokeStyle = lineRgba
      ctx.lineWidth = 1
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(w - 1, 0.5), Math.max(h - 1, 0.5))
    }

    if (this.beidou.selectedKey) {
      const selected = this.beidouCells.find((cell) => cell.key === this.beidou.selectedKey)
      if (selected) {
        const x0 = toX(selected.west)
        const x1 = toX(selected.east)
        const y0 = toY(selected.north)
        const y1 = toY(selected.south)
        ctx.fillStyle = 'rgba(255,214,120,0.18)'
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
        ctx.strokeStyle = 'rgba(255,214,120,0.98)'
        ctx.lineWidth = 3
        ctx.strokeRect(x0 + 1.5, y0 + 1.5, Math.max(x1 - x0 - 3, 1), Math.max(y1 - y0 - 3, 1))
      }
    }
  }

  private beidouCellColor(
    stat: BeiDouCellStats | undefined,
    minElev: number,
    maxElev: number
  ): { r: number; g: number; b: number; a: number } | undefined {
    if (!stat || this.beidou.mode === 'lines') return undefined
    if (this.beidou.mode === 'fuel') {
      const profile = FUEL_PROFILES[stat.dominantFuelKind]
      if (!profile) return undefined
      const rgb = parseHexColor(profile.color)
      return { ...rgb, a: 0.72 }
    }
    if (this.beidou.mode === 'burnRatio') {
      const t = Math.max(0, Math.min(1, stat.burnedRatio))
      return { ...rampColor([[24, 42, 66], [232, 116, 32], [255, 226, 150]], t), a: t <= 0 ? 0 : 0.35 + 0.6 * t }
    }
    if (this.beidou.mode === 'elevation') {
      const t = Math.max(0, Math.min(1, (stat.meanElevation - minElev) / (maxElev - minElev)))
      return { ...rampColor([[22, 64, 122], [76, 158, 96], [238, 232, 196]], t), a: 0.7 }
    }
    const t = Math.max(0, Math.min(1, stat.meanSlope / 45))
    return { ...rampColor([[46, 110, 62], [232, 198, 74], [196, 52, 30]], t), a: 0.7 }
  }

  /** 由外部时钟逐帧调用：低频刷新矢量与栅格，逐帧更新粒子位置。 */
  update(): void {
    if (this.destroyed || this.viewer.isDestroyed()) return
    this.drapeCache.clear()
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
      this.refreshFuel()
      this.refreshImagery()
      this.refreshBeidou()
      this.syncIgnitionBillboards()
    }
  }

  private refreshVectors(): void {
    this.syncIgnitionBillboards()
    const { front: boundaryRings, burning: fireRings } = this.sim.frontAndBurningRings(0.6, 0.25)
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
   * 同步全部起火点标注：初始起火点与人工追加点火点同时显示，火源数量变化时增删复用。
   */
  private syncIgnitionBillboards(): void {
    const seeds = this.sim.seedLonLats()
    const collection = this.ignitionBillboards
    for (let i = collection.length; i < seeds.length; i += 1) {
      collection.add({
        image: createIgnitionTexture(),
        scale: 0.9,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        position: Cartesian3.ZERO
      })
    }
    for (let i = 0; i < collection.length; i += 1) {
      const billboard = collection.get(i)
      if (i < seeds.length) {
        const seed = seeds[i]
        billboard.position = Cartesian3.fromDegrees(seed.lon, seed.lat, this.drapedHeight(seed.lon, seed.lat) + 24)
        billboard.show = true
      } else {
        billboard.show = false
      }
    }
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

  /** 可燃物类型底图：静态分类图，仅在重采样或图层初始化时重绘一次。 */
  private refreshFuel(): void {
    if (!this.fuelDirty && this.fuelLayer) {
      this.fuelLayer.show = this.flags.fuel
      return
    }
    paintFuelClassification(this.fuelCanvas, this.sim)
    if (!this.fuelLayer) {
      const layer = new ImageryLayer(this.createCanvasProvider(this.fuelCanvas))
      this.viewer.imageryLayers.add(layer, Math.min(1, this.viewer.imageryLayers.length))
      this.fuelLayer = layer
    }
    this.fuelLayer.show = this.flags.fuel
    this.fuelDirty = false
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
    const index = Math.min(this.fuelLayer ? 2 : 1, this.viewer.imageryLayers.length)
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
    this.updateSeedFlames()
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
      2
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

  /** 起火点初始火焰：火焰图层开启时，在所有起火点（含人工追加）贴地持续喷发。 */
  private updateSeedFlames(): void {
    const seeds = this.sim.seedLonLats()
    const visible = this.flags.flame
    const emission = 4 * this.particleParams.flameEmission
    const radius = Math.max(this.sim.terrain.cellMeters * 1.2, 30)
    for (let i = 0; i < this.seedFlameSystems.length; i += 1) {
      const system = this.seedFlameSystems[i]
      if (!visible || i >= seeds.length) {
        system.show = false
        continue
      }
      const seed = seeds[i]
      const ground = this.drapedHeight(seed.lon, seed.lat)
      system.modelMatrix = Matrix4.fromTranslation(Cartesian3.fromDegrees(seed.lon, seed.lat, ground + 2))
      this.seedFlameEmitters[i].radius = radius
      if (Math.abs(system.emissionRate - emission) > 0.01) system.emissionRate = emission
      system.show = true
    }
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
      const ground = this.drapedHeight(site.lon, site.lat)
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
    return this.densifyPath(points, LINE_SAMPLE_SPACING).map((point) =>
      Cartesian3.fromDegrees(point.lon, point.lat, this.drapedHeight(point.lon, point.lat) + offset)
    )
  }

  /** 顶点高程优先取地球实际渲染地形，取不到时回退到本地解析高程。单帧内按坐标记忆化。 */
  private drapedHeight(lon: number, lat: number): number {
    const key = `${lon.toFixed(6)},${lat.toFixed(6)}`
    const cached = this.drapeCache.get(key)
    if (cached !== undefined) return cached
    let height: number
    const globe = this.viewer.scene.globe
    if (globe) {
      Cartographic.fromDegrees(lon, lat, 0, this.scratchCarto)
      const terrainHeight = globe.getHeight(this.scratchCarto)
      height = typeof terrainHeight === 'number' && Number.isFinite(terrainHeight)
        ? terrainHeight
        : sampleElevation(this.sim.terrain, lon, lat)
    } else {
      height = sampleElevation(this.sim.terrain, lon, lat)
    }
    if (this.drapeCache.size < 40000) this.drapeCache.set(key, height)
    return height
  }

  private densifyPath(points: LonLat[], spacing: number): LonLat[] {
    const out: LonLat[] = []
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i]
      const b = points[i + 1]
      out.push(a)
      const dx = (b.lon - a.lon) * metersPerDegLon((a.lat + b.lat) * 0.5)
      const dy = (b.lat - a.lat) * METERS_PER_DEG_LAT
      const steps = Math.min(Math.ceil(Math.hypot(dx, dy) / spacing), 240)
      for (let k = 1; k < steps; k += 1) {
        const t = k / steps
        out.push({ lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t })
      }
    }
    out.push(points[points.length - 1])
    return out
  }

  /** 水系/道路：沿程加密为贴地图元的顶点序列（高程由 clampToGround 自动贴合）。 */
  private pathToCartesians(path: LonLat[], spacing = TRACE_SAMPLE_SPACING): Cartesian3[] {
    return this.densifyPath(path, spacing).map((point) => Cartesian3.fromDegrees(point.lon, point.lat))
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.viewer.isDestroyed()) return
    this.viewer.scene.primitives.remove(this.ignitionBillboards)
    this.viewer.scene.primitives.remove(this.fireLineCollection)
    this.viewer.scene.primitives.remove(this.glowCollection)
    this.viewer.scene.primitives.remove(this.boundaryCollection)
    for (const entity of [...this.hydroEntities, ...this.roadEntities]) this.viewer.entities.remove(entity)
    for (const entity of this.firebreakEntities) this.viewer.entities.remove(entity)
    if (this.firebreakPreview) this.viewer.entities.remove(this.firebreakPreview)
    for (const entity of this.firebreakVertexEntities) this.viewer.entities.remove(entity)
    const beidouLayer = this.beidouLayer
    if (beidouLayer) {
      if (!beidouLayer.isDestroyed()) this.viewer.imageryLayers.remove(beidouLayer, true)
      this.beidouLayer = undefined
    }
    const fieldLayer = this.fieldLayer
    if (fieldLayer) {
      if (!fieldLayer.isDestroyed()) this.viewer.imageryLayers.remove(fieldLayer, true)
      this.fieldLayer = undefined
    }
    for (const system of this.flameSystems) this.viewer.scene.primitives.remove(system)
    for (const system of this.seedFlameSystems) this.viewer.scene.primitives.remove(system)
    for (const system of this.smokeSystems) this.viewer.scene.primitives.remove(system)
    this.wind.destroy()
  }
}
