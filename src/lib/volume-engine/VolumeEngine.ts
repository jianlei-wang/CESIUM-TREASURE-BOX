/**
 * Volume Engine —— 主线程控制器
 *
 * 统一编排：Cesium 场景 / Web Worker / VoxelProvider + VoxelPrimitive / 传递函数 /
 * 任意方向剖切 / 剖切面采样 / 体素拾取 / 向量场粒子 / 时间步。
 * 每个体渲染案例只需给出 SceneSpec 与少量附加 UI，不再重复底座代码。
 */

import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  ClippingPlane,
  ClippingPlaneCollection,
  Color,
  ColorGeometryInstanceAttribute,
  ComponentDatatype,
  CustomShader,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  GeometryInstance,
  HeadingPitchRange,
  Material,
  Matrix4,
  PerInstanceColorAppearance,
  PointPrimitiveCollection,
  PolylineCollection,
  Primitive,
  PrimitiveType,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Transforms,
  VoxelPrimitive,
  Math as CesiumMath,
  type PointPrimitive,
  type Polyline,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery } from '../cesium-scene'
import { buildTransferLut, gradientCss, PALETTES } from './palette'
import { channelOf, type ChannelSpec, type SceneSpec } from './scenes'
import {
  createCategoricalShader,
  createScalarShader,
  createVolumeProvider,
  makeLutTexture,
  LUT_WIDTH,
  type Bounds
} from './voxel'
import { VOLUME_WORKER_SOURCE } from './volume-worker-source'
import { VOLUME_ANALYSIS_SOURCE } from './volume-analysis-source'

export type EngineStats = {
  tilesReady: number
  pending: number
  buildTime: number
}

export type PickedInfo = {
  value: number
  valid: boolean
  tileIndex: number
  sampleIndex: number
  channel: string
  categorical: boolean
  /** 拾取点对应的经纬度 / 高度（若可得） */
  lon?: number
  lat?: number
  height?: number
}

export type SliceResult = {
  values: Float32Array
  valid: Uint8Array
  size: number
}

export type StationsResult = {
  positions: Float32Array
  values: Float32Array
}

/** 分析请求：mode 决定分析类型，其余字段按 mode 传参 */
export type AnalyzeRequest = { mode: string } & Record<string, unknown>

/** 通用折线 / 箭头叠加结果（局部米坐标） */
export type LineOverlayResult = {
  positions: Float32Array
  offsets: Uint32Array
  speeds: Float32Array
}

const EMPTY_LINES: LineOverlayResult = {
  positions: new Float32Array(0),
  offsets: new Uint32Array([0]),
  speeds: new Float32Array(0)
}

export { EMPTY_LINES }

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

export type EngineCallbacks = {
  onStatus?: (message: string) => void
  onStats?: (stats: EngineStats) => void
  onSlice?: (result: SliceResult) => void
  onPicked?: (info: PickedInfo | null) => void
  onReady?: (buildTime: number) => void
  onStations?: (stations: StationsResult) => void
}

export type EngineOptions = {
  /** 初始分辨率预设 */
  tileSize?: number
  levels?: number
  /** 粒子平流速度系数（越大越慢，控制横穿体域的秒数） */
  particleFlow?: number
  /** 覆盖 SceneSpec.params 的场景生成参数 */
  params?: Record<string, number>
}

type ClipState = { enabled: boolean; azimuth: number; tilt: number; offset: number; flip: boolean }

export class VolumeEngine {
  readonly spec: SceneSpec
  readonly callbacks: EngineCallbacks

  viewer: Viewer | undefined
  channel: string
  timeStep = 0

  clip: ClipState = { enabled: false, azimuth: 45, tilt: 0, offset: 0, flip: false }
  /** 高度带裁剪（归一化 0~1 相对体域高度），用于回波顶/逆温层顶/地层顶底等分析 */
  clipHeight = { enabled: false, min: 0.15, max: 0.85 }

  tileSize: number
  levels: number
  sse: number
  stepSize: number
  nearest: boolean
  opacity: number
  alphaFloor: number
  thresholdData: number | undefined
  paletteKey: string
  valueMin: number
  valueMax: number

  hasSlice = false
  stations: StationsResult | undefined

  private container: HTMLElement
  private options: EngineOptions
  private sceneParams: Record<string, number>
  private worker: Worker | undefined
  private workerUrl: string | undefined
  private epoch = 0
  private requestSeq = 0
  private pendingTiles = new Map<number, { resolve: (data: Float32Array) => void; reject: (error: Error) => void }>()
  private tilesReady = 0
  private pendingCount = 0
  private buildTime = 0

  private shader: CustomShader | undefined
  private shaderMode: 'scalar' | 'categorical' | undefined
  private primitive: VoxelPrimitive | undefined
  private clipCollection: ClippingPlaneCollection | undefined
  private handler: ScreenSpaceEventHandler | undefined

  private analysisSeq = 0
  private pendingAnalysis = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>()
  private lineCollection: PolylineCollection | undefined
  private arrowCollection: PolylineCollection | undefined
  private isoPrimitive: Primitive | undefined
  private markerCollection: PointPrimitiveCollection | undefined

  private bounds: Bounds
  private modelMatrix: Matrix4
  private centerLocal: Cartesian3
  private volMin: [number, number, number]
  private volSize: [number, number, number]
  private halfDiag: number

  private particleCollection: PointPrimitiveCollection | undefined
  private surfacePoints: PointPrimitiveCollection | undefined
  private particlePoints: PointPrimitive[] = []
  private particleCount = 0
  private particleVisible = false
  private particleSize: number
  private particleLut: Uint8Array
  private particleTimer: ReturnType<typeof setInterval> | undefined
  private particleInitialized = false

  private destroyed = false

  constructor(container: HTMLElement, spec: SceneSpec, callbacks: EngineCallbacks = {}, options: EngineOptions = {}) {
    this.container = container
    this.spec = spec
    this.callbacks = callbacks
    this.options = options
    this.sceneParams = { ...spec.params, ...(options.params ?? {}) }
    this.channel = spec.defaultChannel
    this.tileSize = options.tileSize ?? spec.defaults.tileSize
    this.levels = options.levels ?? spec.defaults.levels
    this.sse = spec.defaults.sse
    this.stepSize = spec.defaults.stepSize
    this.nearest = spec.defaults.nearest
    this.opacity = spec.defaults.opacity
    this.alphaFloor = spec.defaults.alphaFloor
    const ch = channelOf(spec, this.channel)
    this.paletteKey = ch.palette
    this.valueMin = ch.min
    this.valueMax = ch.max
    this.particleSize = spec.vector?.defaultSize ?? 3
    this.particleLut = buildTransferLut(spec.vector?.palette ?? 'wind')

    const v = spec.volume
    this.bounds = {
      min: [-v.width / 2, -v.depth / 2, v.base],
      max: [v.width / 2, v.depth / 2, v.base + v.height]
    }
    this.modelMatrix = Transforms.eastNorthUpToFixedFrame(
      Cartesian3.fromDegrees(spec.center.lon, spec.center.lat, spec.center.height)
    )
    this.centerLocal = new Cartesian3(0, 0, v.base + v.height / 2)
    this.volMin = this.bounds.min
    this.volSize = [v.width, v.depth, v.height]
    this.halfDiag = 0.5 * Math.sqrt(v.width * v.width + v.depth * v.depth + v.height * v.height)
  }

  get activeChannel(): ChannelSpec {
    return channelOf(this.spec, this.channel)
  }

  get totalTiles(): number {
    return Math.round((8 ** this.levels - 1) / 7)
  }

  get fullDims(): number {
    return this.tileSize * 2 ** (this.levels - 1)
  }

  get displayMinMax(): { min: number; max: number } {
    const ch = this.activeChannel
    const min = ch.mode === 'categorical' ? ch.min : Math.max(ch.min, this.valueMin)
    const max = ch.mode === 'categorical' ? ch.max : Math.min(ch.max, this.valueMax)
    return { min, max }
  }

  gradientCss(): string {
    return gradientCss(this.paletteKey)
  }

  async start(): Promise<void> {
    if (!this.container) return
    this.callbacks.onStatus?.('正在加载 Bing 地图…')
    const webgl2 = (() => {
      const canvas = document.createElement('canvas')
      return !!(canvas.getContext('webgl2') || canvas.getContext('experimental-webgl2'))
    })()
    if (!webgl2) {
      this.callbacks.onStatus?.('当前浏览器/显卡没有可用的 WebGL2，Cesium VoxelPrimitive 需要 WebGL2')
      return
    }
    try {
      this.viewer = createMapScene(this.container, {
        onStatus: (message) => this.callbacks.onStatus?.(message),
        onBasemapReady: () => this.callbacks.onStatus?.('')
      })
      loadBingImagery(this.viewer, {})
      if (!this.viewer || this.viewer.isDestroyed()) return
      this.viewer.scene.requestRenderMode = true
      this.viewer.scene.maximumRenderTimeChange = Infinity
      this.resetCamera(0)
      this.handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas)
      this.handler.setInputAction(
        (movement: { endPosition: Cartesian2 }) => this.pick(movement.endPosition),
        ScreenSpaceEventType.MOUSE_MOVE
      )
      this.createWorker()
      this.postInit()
    } catch (error) {
      this.callbacks.onStatus?.(error instanceof Error ? error.message : String(error))
    }
  }

  /* ----------------------------- Worker ----------------------------- */

  private createWorker(): void {
    const blob = new Blob([VOLUME_WORKER_SOURCE, VOLUME_ANALYSIS_SOURCE], { type: 'application/javascript' })
    this.workerUrl = URL.createObjectURL(blob)
    const worker = new Worker(this.workerUrl)
    worker.onmessage = (event: MessageEvent) => this.onWorkerMessage(event)
    worker.onerror = (event) => this.callbacks.onStatus?.('体数据 Worker 异常：' + (event.message || 'unknown'))
    this.worker = worker
  }

  private postInit(): void {
    this.worker?.postMessage({ type: 'init', epoch: this.epoch, scene: this.spec.kind, params: { ...this.sceneParams } })
  }

  private onWorkerMessage(event: MessageEvent): void {
    const message = event.data as {
      type: string
      epoch?: number
      requestId?: number
      metadata?: Float32Array
      values?: Float32Array
      valid?: Uint8Array
      size?: number
      buildTime?: number
      stations?: StationsResult
      positions?: Float32Array
      speeds?: Float32Array
      result?: unknown
    }
    if (!message || (message.epoch !== undefined && message.epoch !== this.epoch)) return
    if (message.type === 'analysisDone') {
      const pending = this.pendingAnalysis.get(message.requestId as number)
      if (pending) {
        this.pendingAnalysis.delete(message.requestId as number)
        pending.resolve(message.result)
      }
      return
    }
    if (message.type === 'initDone') {
      this.buildTime = Math.round(message.buildTime ?? 0)
      if (message.stations) {
        this.stations = message.stations
        this.callbacks.onStations?.(message.stations)
      }
      this.callbacks.onReady?.(this.buildTime)
      this.createPrimitive()
      this.updateClipPlane()
      this.requestSlice(false)
      this.emitStats()
      this.callbacks.onStatus?.(this.readyMessage())
      this.viewer?.scene.requestRender()
      return
    }
    if (message.type === 'tileDone') {
      const pending = this.pendingTiles.get(message.requestId as number)
      if (pending) {
        this.pendingTiles.delete(message.requestId as number)
        pending.resolve(message.metadata as Float32Array)
      }
      this.viewer?.scene.requestRender()
      return
    }
    if (message.type === 'sliceDone') {
      this.hasSlice = true
      this.callbacks.onSlice?.({
        values: message.values as Float32Array,
        valid: message.valid as Uint8Array,
        size: message.size as number
      })
      return
    }
    if (message.type === 'particleTickDone') {
      this.updateParticles(message.positions as Float32Array, message.speeds as Float32Array)
      return
    }
  }

  private requestTile = (request: { tileLevel: number; tileX: number; tileY: number; tileZ: number }): Promise<Float32Array> => {
    const worker = this.worker
    const dim = this.tileSize + 2
    if (!worker) return Promise.resolve(new Float32Array(dim * dim * dim * 4))
    return new Promise<Float32Array>((resolve, reject) => {
      const requestId = (this.requestSeq += 1)
      this.pendingTiles.set(requestId, { resolve, reject })
      this.pendingCount += 1
      worker.postMessage({
        type: 'tile',
        epoch: this.epoch,
        requestId,
        tileLevel: request.tileLevel,
        tileX: request.tileX,
        tileY: request.tileY,
        tileZ: request.tileZ,
        tileSize: this.tileSize,
        channel: this.channel,
        mode: this.activeChannel.mode,
        timeStep: this.timeStep,
        timeSteps: this.spec.timeSteps
      })
    })
  }

  /* --------------------------- Primitive ---------------------------- */

  private ensureShader(): CustomShader {
    const mode = this.activeChannel.mode
    if (!this.shader || this.shaderMode !== mode) {
      this.shader = mode === 'categorical'
        ? createCategoricalShader(this.spec.categories ?? [])
        : createScalarShader(buildTransferLut(this.paletteKey, { alphaFloor: this.alphaFloor }))
      this.shaderMode = mode
    }
    return this.shader
  }

  private createPrimitive(): void {
    if (!this.viewer || this.viewer.isDestroyed()) return
    this.disposePrimitive()
    const shader = this.ensureShader()
    const provider = createVolumeProvider({
      tileSize: this.tileSize,
      levels: this.levels,
      bounds: this.bounds,
      requestTile: this.requestTile,
      fallbackTile: () => new Float32Array((this.tileSize + 2) ** 3 * 4)
    })
    const primitive = new VoxelPrimitive({
      provider,
      modelMatrix: this.modelMatrix,
      customShader: shader,
      calculateStatistics: false
    })
    primitive.screenSpaceError = this.sse
    primitive.stepSize = this.stepSize
    primitive.nearestSampling = this.nearest
    primitive.minBounds = new Cartesian3(...this.bounds.min)
    primitive.maxBounds = new Cartesian3(...this.bounds.max)
    primitive.show = true
    primitive.loadProgress.addEventListener((pending: number, processing: number) => {
      this.pendingCount = pending + processing
      const statistics = (primitive as unknown as { statistics?: { numberOfTilesWithContentReady: number } }).statistics
      if (statistics) this.tilesReady = statistics.numberOfTilesWithContentReady
      this.emitStats()
      this.viewer?.scene.requestRender()
    })
    this.clipCollection = new ClippingPlaneCollection({
      modelMatrix: this.modelMatrix,
      enabled: false,
      planes: []
    })
    primitive.clippingPlanes = this.clipCollection
    this.viewer.scene.primitives.add(primitive)
    this.primitive = primitive
    this.refreshShader()
    this.refreshLut()
  }

  private disposePrimitive(): void {
    if (this.primitive && this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.primitive)
    }
    this.primitive = undefined
    this.clipCollection = undefined
    this.tilesReady = 0
  }

  private readyMessage(): string {
    const ch = this.activeChannel
    return `✓ ${this.spec.title} · ${ch.label} · ${this.fullDims}³ 等效分辨率（${this.tileSize}³/瓦片 · ${this.levels} 级 LOD）· 生成 ${this.buildTime} ms`
  }

  private emitStats(): void {
    this.callbacks.onStats?.({ tilesReady: this.tilesReady, pending: this.pendingCount, buildTime: this.buildTime })
  }

  /* --------------------------- Rendering ---------------------------- */

  setChannel(key: string): void {
    if (key === this.channel) return
    this.channel = key
    const ch = this.activeChannel
    this.paletteKey = ch.palette
    this.valueMin = ch.min
    this.valueMax = ch.max
    this.thresholdData = undefined
    this.hasSlice = false
    this.createPrimitive()
    this.updateClipPlane()
    this.requestSlice(false)
    this.viewer?.scene.requestRender()
  }

  setTimeStep(step: number): void {
    const clamped = Math.max(0, Math.min(this.spec.timeSteps - 1, step))
    if (clamped === this.timeStep) return
    this.timeStep = clamped
    this.reloadTiles()
  }

  setPalette(paletteKey: string): void {
    this.paletteKey = paletteKey
    if (this.activeChannel.mode === 'scalar') this.refreshLut()
  }

  setOpacity(value: number): void {
    this.opacity = value
    this.refreshShader()
    this.viewer?.scene.requestRender()
  }

  setAlphaFloor(value: number): void {
    this.alphaFloor = value
    if (this.activeChannel.mode === 'scalar') this.refreshLut()
  }

  setValueRange(min: number, max: number): void {
    this.valueMin = min
    this.valueMax = max
    this.refreshShader()
    if (this.activeChannel.mode === 'scalar') this.refreshLut()
    this.viewer?.scene.requestRender()
  }

  /** 阈值以数据单位传入（如 dBZ 35），< 说明不显示 */
  setThreshold(value: number | undefined): void {
    this.thresholdData = value
    if (this.activeChannel.mode === 'scalar') this.refreshLut()
  }

  setSse(value: number): void {
    this.sse = value
    if (this.primitive) this.primitive.screenSpaceError = value
    this.viewer?.scene.requestRender()
  }

  setStepSize(value: number): void {
    this.stepSize = value
    if (this.primitive) this.primitive.stepSize = value
    this.viewer?.scene.requestRender()
  }

  setNearest(value: boolean): void {
    this.nearest = value
    if (this.primitive) this.primitive.nearestSampling = value
    this.viewer?.scene.requestRender()
  }

  setVolumeVisible(visible: boolean): void {
    if (this.primitive) this.primitive.show = visible
    this.viewer?.scene.requestRender()
  }

  private refreshShader(): void {
    if (!this.shader) return
    if (this.shaderMode === 'scalar') {
      this.shader.uniforms.uValueMin.value = this.valueMin
      this.shader.uniforms.uValueMax.value = this.valueMax
      this.shader.uniforms.uOpacity.value = this.opacity
    } else {
      this.shader.uniforms.uOpacity.value = this.opacity
    }
  }

  private refreshLut(): void {
    if (!this.shader || this.shaderMode !== 'scalar') return
    const span = this.valueMax - this.valueMin || 1
    const thresholdNorm = this.thresholdData !== undefined ? (this.thresholdData - this.valueMin) / span : 0
    const lut = buildTransferLut(this.paletteKey, {
      alphaFloor: this.alphaFloor,
      threshold: thresholdNorm,
      alphaGamma: 1
    })
    this.shader.setUniform('uTransferFunction', makeLutTexture(lut))
    this.viewer?.scene.requestRender()
  }

  /** 供案例在剖切面预览 canvas 上映射颜色时使用 */
  scalarLut(): Uint8Array {
    const span = this.valueMax - this.valueMin || 1
    const thresholdNorm = this.thresholdData !== undefined ? (this.thresholdData - this.valueMin) / span : 0
    return buildTransferLut(this.paletteKey, { alphaFloor: this.alphaFloor, threshold: thresholdNorm, alphaGamma: 1 })
  }

  paletteStops(): [number, number, number][] {
    return (PALETTES[this.paletteKey] ?? PALETTES.viridis).stops
  }

  reloadTiles(): void {
    if (!this.viewer || this.viewer.isDestroyed()) return
    this.createPrimitive()
    this.updateClipPlane()
    this.requestSlice(false)
    this.viewer.scene.requestRender()
  }

  /** 合并场景生成参数并整体重建（对流单体数、污染源数、涡旋数等） */
  setParams(partial: Record<string, number>): void {
    Object.assign(this.sceneParams, partial)
    this.rebuild()
  }

  rebuild(): void {
    if (!this.viewer || this.viewer.isDestroyed()) return
    this.callbacks.onStatus?.('正在重建体数据…')
    this.disposePrimitive()
    this.disposeParticles()
    this.clearLines()
    this.clearOverlayPoints()
    this.clearIsosurface()
    this.pendingTiles.forEach((pending) => pending.reject(new Error('rebuild')))
    this.pendingTiles.clear()
    this.pendingAnalysis.forEach((pending) => pending.reject(new Error('rebuild')))
    this.pendingAnalysis.clear()
    if (this.worker) {
      this.worker.terminate()
      this.worker = undefined
    }
    if (this.workerUrl) {
      URL.revokeObjectURL(this.workerUrl)
      this.workerUrl = undefined
    }
    this.epoch += 1
    this.createWorker()
    this.postInit()
  }

  /* ----------------------------- Clip ------------------------------- */

  private clipNormal(): { x: number; y: number; z: number } {
    const az = CesiumMath.toRadians(this.clip.azimuth)
    const tilt = CesiumMath.toRadians(this.clip.tilt)
    return { x: Math.cos(tilt) * Math.cos(az), y: Math.cos(tilt) * Math.sin(az), z: Math.sin(tilt) }
  }

  private clipPlanePoint(n: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const v = this.spec.volume
    const half = 0.5 * (Math.abs(n.x) * v.width + Math.abs(n.y) * v.depth + Math.abs(n.z) * v.height)
    const s = (this.clip.offset / 100) * half
    return { x: n.x * s, y: n.y * s, z: v.base + v.height / 2 + n.z * s }
  }

  private clipBasis(n: { x: number; y: number; z: number }): { e1: [number, number, number]; e2: [number, number, number] } {
    const upX = Math.abs(n.z) > 0.9 ? 1 : 0
    const upZ = Math.abs(n.z) > 0.9 ? 0 : 1
    let e1x = -upZ * n.y
    let e1y = upZ * n.x - upX * n.z
    let e1z = upX * n.y
    const len = Math.hypot(e1x, e1y, e1z) || 1
    e1x /= len
    e1y /= len
    e1z /= len
    return {
      e1: [e1x, e1y, e1z],
      e2: [n.y * e1z - n.z * e1y, n.z * e1x - n.x * e1z, n.x * e1y - n.y * e1x]
    }
  }

  setClip(partial: Partial<ClipState>, requestPreview = true): void {
    Object.assign(this.clip, partial)
    this.updateClipPlane()
    if (requestPreview) this.requestSlice(false)
  }

  /** 高度带裁剪：normalized min/max 相对体域高度（0~1），截去带外体元素 */
  setHeightClip(min: number, max: number, enabled = true): void {
    this.clipHeight.min = Math.max(0, Math.min(1, Math.min(min, max)))
    this.clipHeight.max = Math.max(0, Math.min(1, Math.max(min, max)))
    this.clipHeight.enabled = enabled
    this.updateClipPlane()
  }

  updateClipPlane(): void {
    if (!this.clipCollection || !this.viewer || this.viewer.isDestroyed()) return
    const collection = this.clipCollection
    collection.removeAll()
    if (this.clip.enabled) {
      const n = this.clipNormal()
      const p = this.clipPlanePoint(n)
      let nx = n.x
      let ny = n.y
      let nz = n.z
      if (this.clip.flip) {
        nx = -nx
        ny = -ny
        nz = -nz
      }
      collection.add(new ClippingPlane(new Cartesian3(nx, ny, nz), -(nx * p.x + ny * p.y + nz * p.z)))
    }
    if (this.clipHeight.enabled) {
      const v = this.spec.volume
      const zMin = v.base + this.clipHeight.min * v.height
      const zMax = v.base + this.clipHeight.max * v.height
      // 保留 z ∈ [zMin, zMax]：法线 +z 裁掉下方，法线 -z 裁掉上方
      collection.add(new ClippingPlane(new Cartesian3(0, 0, 1), -zMin))
      collection.add(new ClippingPlane(new Cartesian3(0, 0, -1), zMax))
    }
    collection.enabled = this.clip.enabled || this.clipHeight.enabled
    this.viewer.scene.requestRender()
  }

  clipInfo(): { normal: string; perspective: string } {
    const n = this.clipNormal()
    return {
      normal: `${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}`,
      perspective: this.clip.flip ? '反向' : '正向'
    }
  }

  /* ----------------------------- Slice ------------------------------ */

  requestSlice(high: boolean): void {
    const worker = this.worker
    if (!worker) return
    const size = high ? 256 : 120
    const n = this.clipNormal()
    const p = this.clipPlanePoint(n)
    const { e1, e2 } = this.clipBasis(n)
    worker.postMessage({
      type: 'slice',
      epoch: this.epoch,
      requestId: (this.requestSeq += 1),
      size,
      channel: this.channel,
      mode: this.activeChannel.mode,
      timeStep: this.timeStep,
      timeSteps: this.spec.timeSteps,
      normal: [n.x, n.y, n.z],
      point: [p.x, p.y, p.z],
      e1,
      e2,
      halfDiag: this.halfDiag,
      volMin: this.volMin,
      volSize: this.volSize
    })
  }

  /* ---------------------------- Analysis ---------------------------- */

  /** 向 Worker 提交一次领域分析请求（统计 / 回波顶高 / 廓线 / 剖面箭头 / 流线 / 等值面） */
  analyze<T = unknown>(request: AnalyzeRequest): Promise<T> {
    const worker = this.worker
    if (!worker) return Promise.resolve(undefined as unknown as T)
    return new Promise<T>((resolve, reject) => {
      const requestId = (this.analysisSeq += 1)
      this.pendingAnalysis.set(requestId, { resolve: resolve as (result: unknown) => void, reject })
      worker.postMessage({
        type: 'analyze',
        epoch: this.epoch,
        requestId,
        timeStep: this.timeStep,
        timeSteps: this.spec.timeSteps,
        channel: this.channel,
        ...request
      })
    })
  }

  /* ---------------------------- Overlays ---------------------------- */

  private ensureLineCollection(): PolylineCollection | undefined {
    if (!this.viewer || this.viewer.isDestroyed()) return undefined
    if (!this.lineCollection) {
      this.lineCollection = new PolylineCollection({ modelMatrix: this.modelMatrix })
      this.viewer.scene.primitives.add(this.lineCollection)
    }
    return this.lineCollection
  }

  private ensureMarkerCollection(): PointPrimitiveCollection | undefined {
    if (!this.viewer || this.viewer.isDestroyed()) return undefined
    if (!this.markerCollection) {
      this.markerCollection = new PointPrimitiveCollection({ modelMatrix: this.modelMatrix })
      this.viewer.scene.primitives.add(this.markerCollection)
    }
    return this.markerCollection
  }

  /** 叠加折线 / 箭头（positions 为局部米坐标，offsets 为各折线起止索引） */
  setLines(
    result: LineOverlayResult | undefined,
    options: { color?: string; width?: number; speedPalette?: string; speedMin?: number; speedMax?: number } = {}
  ): void {
    const collection = this.ensureLineCollection()
    if (!collection) return
    collection.removeAll()
    if (!result || !result.positions.length || result.offsets.length < 2) {
      this.viewer?.scene.requestRender()
      return
    }
    const lut = options.speedPalette ? buildTransferLut(options.speedPalette) : undefined
    const min = options.speedMin ?? 0
    const max = options.speedMax ?? 1
    const fallback = Color.fromCssColorString(options.color ?? '#67e8f9')
    const offsets = result.offsets
    for (let s = 0; s + 1 < offsets.length; s += 1) {
      const start = offsets[s]
      const end = offsets[s + 1]
      if (end - start < 2) continue
      const positions: Cartesian3[] = []
      for (let i = start; i < end; i += 1) {
        positions.push(new Cartesian3(result.positions[i * 3], result.positions[i * 3 + 1], result.positions[i * 3 + 2]))
      }
      let material = Material.fromType('Color', { color: fallback })
      if (lut) {
        const t = clamp01((result.speeds[start] - min) / (max - min || 1))
        const idx = Math.round(t * 255)
        material = Material.fromType('Color', {
          color: new Color(lut[idx * 4] / 255, lut[idx * 4 + 1] / 255, lut[idx * 4 + 2] / 255, 0.95)
        })
      }
      collection.add({ positions, material, width: options.width ?? 1.6 })
    }
    this.viewer?.scene.requestRender()
  }

  setLineOverlaysVisible(visible: boolean): void {
    if (this.lineCollection) this.lineCollection.show = visible
    this.viewer?.scene.requestRender()
  }

  clearLines(): void {
    if (this.lineCollection && this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.lineCollection)
    }
    this.lineCollection = undefined
  }

  /** 叠加标记点（局部米坐标），用于强对流核心 / 钻孔 / 监测站等 */
  setOverlayPoints(points: { position: Cartesian3; color: Color; pixelSize?: number }[]): void {
    const collection = this.ensureMarkerCollection()
    if (!collection) return
    collection.removeAll()
    for (const point of points) {
      collection.add({
        position: point.position,
        pixelSize: point.pixelSize ?? 9,
        color: point.color,
        outlineColor: Color.fromCssColorString('#081428'),
        outlineWidth: 2,
        disableDepthTestDistance: 0
      })
    }
    this.viewer?.scene.requestRender()
  }

  clearOverlayPoints(): void {
    if (this.markerCollection && this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.markerCollection)
    }
    this.markerCollection = undefined
  }

  /** 渲染等值面三角网（输入为归一化体域坐标 0~1，内部换算为局部米坐标） */
  setIsosurface(positions: Float32Array, normals: Float32Array, color: [number, number, number], opacity = 0.6): void {
    this.clearIsosurface()
    if (!this.viewer || this.viewer.isDestroyed() || !positions.length) return
    const local = new Float32Array(positions.length)
    const min = this.bounds.min
    const v = this.spec.volume
    for (let i = 0; i < positions.length; i += 3) {
      local[i] = min[0] + positions[i] * v.width
      local[i + 1] = min[1] + positions[i + 1] * v.depth
      local[i + 2] = min[2] + positions[i + 2] * v.height
    }
    const attributes = {
      position: new GeometryAttribute({
        componentDatatype: ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: local
      })
    } as unknown as GeometryAttributes
    if (normals.length === positions.length) {
      attributes.normal = new GeometryAttribute({
        componentDatatype: ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: normals
      })
    }
    const geometry = new Geometry({
      attributes,
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: new BoundingSphere(this.centerLocal, this.halfDiag)
    })
    const instance = new GeometryInstance({
      geometry,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(color[0], color[1], color[2], opacity))
      }
    })
    const primitive = new Primitive({
      geometryInstances: instance,
      appearance: new PerInstanceColorAppearance({ translucent: true, closed: false, flat: normals.length !== positions.length }),
      asynchronous: false
    })
    this.viewer.scene.primitives.add(primitive)
    this.isoPrimitive = primitive
    this.viewer.scene.requestRender()
  }

  clearIsosurface(): void {
    if (this.isoPrimitive && this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.isoPrimitive)
    }
    this.isoPrimitive = undefined
  }

  /** 将归一化坐标（x/y 水平、z 垂直）换算为局部米坐标 */
  localFromNormalized(x: number, y: number, z: number): Cartesian3 {
    const min = this.bounds.min
    const v = this.spec.volume
    return new Cartesian3(min[0] + x * v.width, min[1] + y * v.depth, min[2] + z * v.height)
  }

  /* ----------------------------- Pick ------------------------------- */

  private pick(position: Cartesian2): void {
    if (!this.primitive || !this.viewer || this.viewer.isDestroyed()) {
      this.callbacks.onPicked?.(null)
      return
    }
    const cell = this.viewer.scene.pickVoxel(position) as unknown as {
      primitive: unknown
      tileIndex: number
      sampleIndex: number
      getProperty: (name: string) => Float32Array | number[] | undefined
    } | undefined
    if (!cell || cell.primitive !== this.primitive) {
      this.callbacks.onPicked?.(null)
      return
    }
    const property = cell.getProperty('color') as Float32Array | number[] | undefined
    const geo = this.pickGeographic(position)
    this.callbacks.onPicked?.({
      value: property ? Number(property[0]) : 0,
      valid: property ? Number(property[1]) > 0.5 : false,
      tileIndex: cell.tileIndex,
      sampleIndex: cell.sampleIndex,
      channel: this.channel,
      categorical: this.activeChannel.mode === 'categorical',
      lon: geo?.lon,
      lat: geo?.lat,
      height: geo?.height
    })
  }

  private pickGeographic(position: Cartesian2): { lon: number; lat: number; height: number } | undefined {
    if (!this.viewer || this.viewer.isDestroyed()) return undefined
    const scene = this.viewer.scene
    let world: Cartesian3 | undefined
    try {
      world = scene.pickPosition(position)
    } catch {
      world = undefined
    }
    if (!world || !this.viewer) return undefined
    const carto = scene.globe.ellipsoid.cartesianToCartographic(world)
    if (!carto) return undefined
    return {
      lon: CesiumMath.toDegrees(carto.longitude),
      lat: CesiumMath.toDegrees(carto.latitude),
      height: carto.height
    }
  }

  /* --------------------------- Particles ---------------------------- */

  setParticlesVisible(visible: boolean): void {
    this.particleVisible = visible
    if (visible) {
      if (!this.particleCollection && this.viewer && !this.viewer.isDestroyed()) {
        this.particleCollection = new PointPrimitiveCollection({ modelMatrix: this.modelMatrix })
        this.viewer.scene.primitives.add(this.particleCollection)
      }
      if (!this.particleInitialized) {
        this.particleInitialized = true
        this.worker?.postMessage({ type: 'particleInit', epoch: this.epoch, count: this.particleCount || this.spec.vector?.defaultCount || 3000 })
        this.particleCount = this.particleCount || this.spec.vector?.defaultCount || 3000
      }
      this.startParticleLoop()
    } else {
      this.stopParticleLoop()
    }
    if (this.particleCollection) this.particleCollection.show = visible
    this.viewer?.scene.requestRender()
  }

  setParticleCount(count: number): void {
    this.particleCount = count
    this.particleInitialized = false
    this.disposeParticles()
    if (this.particleVisible) this.setParticlesVisible(true)
  }

  setParticleSize(size: number): void {
    this.particleSize = size
    for (let i = 0; i < this.particlePoints.length; i += 1) this.particlePoints[i].pixelSize = size
    this.viewer?.scene.requestRender()
  }

  /** 切换分辨率预设（瓦片边长 / LOD 层级），触发整体重建 */
  setPreset(tileSize: number, levels: number): void {
    if (tileSize === this.tileSize && levels === this.levels) return
    this.tileSize = tileSize
    this.levels = levels
    this.rebuild()
  }

  private startParticleLoop(): void {
    if (this.particleTimer) return
    let last = performance.now()
    this.particleTimer = setInterval(() => {
      if (!this.particleVisible || !this.worker) return
      const now = performance.now()
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const v = this.spec.volume
      const flow = this.options.particleFlow ?? 60
      this.worker.postMessage({
        type: 'particleTick',
        epoch: this.epoch,
        dt,
        timeStep: this.timeStep,
        timeSteps: this.spec.timeSteps,
        scale: [flow / v.width, flow / v.depth, flow / v.height]
      })
    }, 40)
  }

  private stopParticleLoop(): void {
    if (this.particleTimer) {
      clearInterval(this.particleTimer)
      this.particleTimer = undefined
    }
  }

  private updateParticles(positions: Float32Array, speeds: Float32Array): void {
    const collection = this.particleCollection
    if (!collection) return
    const v = this.spec.volume
    const vector = this.spec.vector
    const count = positions.length / 3
    while (this.particlePoints.length < count) {
      this.particlePoints.push(
        collection.add({ position: new Cartesian3(0, 0, 0), pixelSize: this.particleSize, color: Color.WHITE })
      )
    }
    const min = this.bounds.min
    const span = vector ? vector.max - vector.min || 1 : 1
    const lut = this.particleLut
    for (let i = 0; i < count; i += 1) {
      const point = this.particlePoints[i]
      point.position = new Cartesian3(
        min[0] + positions[i * 3] * v.width,
        min[1] + positions[i * 3 + 1] * v.depth,
        min[2] + positions[i * 3 + 2] * v.height
      )
      const t = Math.max(0, Math.min(1, (speeds[i] - (vector?.min ?? 0)) / span))
      const idx = Math.round(t * (LUT_WIDTH - 1))
      point.color = new Color(lut[idx * 4] / 255, lut[idx * 4 + 1] / 255, lut[idx * 4 + 2] / 255, 0.92)
    }
    this.viewer?.scene.requestRender()
  }

  private disposeParticles(): void {
    this.stopParticleLoop()
    if (this.particleCollection && this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.particleCollection)
    }
    this.particleCollection = undefined
    this.particlePoints = []
    this.particleInitialized = false
  }

  /* ------------------------- Surface markers ------------------------ */

  /** 在地表叠加监测点等标记：positions 为归一化 x/y（z=0），颜色按值映射 */
  addSurfacePoints(positions: Float32Array, colorFn: (index: number) => Color, pixelSize = 6): void {
    if (!this.viewer || this.viewer.isDestroyed()) return
    this.clearSurfacePoints()
    const v = this.spec.volume
    const min = this.bounds.min
    const collection = new PointPrimitiveCollection({ modelMatrix: this.modelMatrix })
    const count = positions.length / 2
    for (let i = 0; i < count; i += 1) {
      collection.add({
        position: new Cartesian3(min[0] + positions[i * 2] * v.width, min[1] + positions[i * 2 + 1] * v.depth, min[2] + 4),
        pixelSize,
        color: colorFn(i),
        disableDepthTestDistance: 0,
        outlineColor: Color.fromCssColorString('#0b1f3a'),
        outlineWidth: 1
      })
    }
    this.viewer.scene.primitives.add(collection)
    this.surfacePoints = collection
    this.viewer.scene.requestRender()
  }

  setSurfacePointsVisible(visible: boolean): void {
    if (this.surfacePoints) this.surfacePoints.show = visible
    this.viewer?.scene.requestRender()
  }

  clearSurfacePoints(): void {
    if (this.surfacePoints && this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.surfacePoints)
    }
    this.surfacePoints = undefined
  }

  /* ----------------------------- Camera ----------------------------- */
  resetCamera(duration: number): void {
    if (!this.viewer || this.viewer.isDestroyed()) return
    const worldCenter = Matrix4.multiplyByPoint(this.modelMatrix, this.centerLocal, new Cartesian3())
    const v = this.spec.volume
    const radius = 0.5 * Math.sqrt(v.width * v.width + v.depth * v.depth + v.height * v.height)
    this.viewer.camera.flyToBoundingSphere(new BoundingSphere(worldCenter, radius), {
      offset: new HeadingPitchRange(CesiumMath.toRadians(24), CesiumMath.toRadians(-32), radius * 2.1),
      duration
    })
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.handler && !this.handler.isDestroyed()) this.handler.destroy()
    this.handler = undefined
    this.pendingTiles.forEach((pending) => pending.reject(new Error('dispose')))
    this.pendingTiles.clear()
    this.pendingAnalysis.forEach((pending) => pending.reject(new Error('dispose')))
    this.pendingAnalysis.clear()
    this.disposeParticles()
    this.clearSurfacePoints()
    this.clearLines()
    this.clearOverlayPoints()
    this.clearIsosurface()
    if (this.worker) {
      this.worker.terminate()
      this.worker = undefined
    }
    if (this.workerUrl) {
      URL.revokeObjectURL(this.workerUrl)
      this.workerUrl = undefined
    }
    this.disposePrimitive()
    destroyScene(this.viewer)
    this.viewer = undefined
  }
}

export { LUT_WIDTH }
