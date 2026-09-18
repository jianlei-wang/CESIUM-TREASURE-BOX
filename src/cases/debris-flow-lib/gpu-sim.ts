// 泥石流地形侵蚀 —— GPU 计算管线与 Cesium 集成（对应设计文档 §2.2 / §6 / 附录 C）
//
// 核心思路：
//   - 全部计算 Pass 渲染到 RGBA32F 状态纹理，使用 ping-pong 双缓冲；
//   - 依赖链（predictor→corrector→advect→erosion→source）在同一帧的 compute 命令列表内
//     按 push 顺序执行，ping-pong 的 swap 放在 postExecute / MRT 自定义命令内，
//     保证每个 Pass 执行时读取的都是当时的“当前”纹理；
//   - 侵蚀 Pass 需要 3 个颜色输出（MRT），ComputeCommand 只支持单输出，故封装一个
//     自定义命令对象（pass = COMPUTE），在 compute 调度阶段用 createViewportQuadCommand
//     渲染 MRT Framebuffer。

import {
  BillboardCollection,
  BoundingRectangle,
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  ComputeCommand,
  DrawCommand,
  Framebuffer,
  BlendEquation,
  BlendFunction,
  BufferUsage,
  NearFarScalar,
  Pass,
  PixelDatatype,
  PixelFormat,
  PrimitiveType,
  RenderState,
  Sampler,
  ShaderProgram,
  ShaderSource,
  Texture,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  TextureWrap,
  VertexArray,
  sampleTerrainMostDetailed,
  Cartographic,
  Color,
  Math as CesiumMath,
  type Scene,
  type TerrainProvider,
  type Viewer
} from 'cesium'
import { SimulationDomain } from './domain'
import {
  ADVECT_C_FS,
  ADVECT_SED_FS,
  BRUSH_FS,
  CLEAR_FS,
  CORRECTOR_FS,
  EROSION_FS,
  HISTORY_FS,
  OBSTACLE_CLEAR_FS,
  OBSTACLE_FS,
  OVERLAY_FS,
  OVERLAY_VS,
  PREDICTOR_FS,
  REDUCE_FS,
  SAMPLE_FLOW_FS,
  SLOPE_FS,
  SOURCE_DECAY_FS,
  SOURCE_FS,
  buildGridMesh,
  createArrowImage
} from './shaders'
import {
  DEFAULT_PARAMETERS,
  type BrushKind,
  type DebrisFlowParameters,
  type SimStats,
  type VisualMode
} from './types'

// ── Cesium 内部/半公开接口的最小类型（.d.ts 未完整声明）────────────────────────────

type RenderContext = {
  drawingBufferWidth: number
  drawingBufferHeight: number
  colorBufferFloat: boolean
  createViewportQuadCommand: (fs: unknown, overrides: Record<string, unknown>) => DrawCommand
  readPixels: (state: {
    framebuffer?: Framebuffer
    x?: number
    y?: number
    width?: number
    height?: number
  }) => ArrayLike<number>
}

type FrameStateLike = {
  context: RenderContext
  commandList: unknown[]
}

type UniformMap = Record<string, () => unknown>

type PingPong = {
  textures: [Texture, Texture]
  read: () => Texture
  write: () => Texture
  swap: () => void
}

type Stroke = {
  kind: BrushKind
  i: number
  j: number
  radius: number
  strength: number
}

type HistoryFrame = {
  time: number
  maxDepth: number
  maxSpeed: number
  erodedVolume: number
  depositedVolume: number
  terrain: Float32Array
  flux: Float32Array
  sed: Float32Array
}

export type HistoryInfo = {
  time: number
  maxDepth: number
  maxSpeed: number
  erodedVolume: number
  depositedVolume: number
}

const REDUCE_RES = 16
const SAMPLE_RES = 32
const HISTORY_RES = 128
const HISTORY_INTERVAL = 36
// 历史关键帧内存预算。每帧保存 terrain/flux/sed 三张 128×128 RGBA32F 纹理，
// 单帧约 HISTORY_RES*HISTORY_RES*4*4*3 ≈ 768 KB。以固定预算反推最大帧数，
// 采用滚动窗口持续记录：达到上限后自动丢弃最早帧，避免长时间运行内存无限增长导致卡死。
const HISTORY_MEMORY_BUDGET_BYTES = 192 * 1024 * 1024
const HISTORY_BYTES_PER_FRAME = HISTORY_RES * HISTORY_RES * 4 * 4 * 3
const HISTORY_MAX_FRAMES = Math.max(1, Math.floor(HISTORY_MEMORY_BUDGET_BYTES / HISTORY_BYTES_PER_FRAME))
const RAIN_GAIN = 1200
const EMPTY_STATS: SimStats = {
  frame: 0,
  simTime: 0,
  substeps: 0,
  maxDepth: 0,
  maxSpeed: 0,
  erodedVolume: 0,
  depositedVolume: 0,
  wetCells: 0,
  fps: 0
}

function createStateTexture(context: RenderContext, width: number, height: number, data?: Float32Array): Texture {
  return new Texture({
    context,
    width,
    height,
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype: PixelDatatype.FLOAT,
    flipY: false,
    sampler: new Sampler({
      minificationFilter: TextureMinificationFilter.LINEAR,
      magnificationFilter: TextureMagnificationFilter.LINEAR,
      wrapS: TextureWrap.CLAMP_TO_EDGE,
      wrapT: TextureWrap.CLAMP_TO_EDGE
    }),
    source: { width, height, arrayBufferView: data ?? new Float32Array(width * height * 4) }
  })
}

function createPingPong(context: RenderContext, width: number, height: number, data?: Float32Array): PingPong {
  const a = createStateTexture(context, width, height, data)
  const b = createStateTexture(context, width, height, data)
  let index = 0
  const state: PingPong = {
    textures: [a, b],
    read: () => state.textures[index],
    write: () => state.textures[(index + 1) % 2],
    swap: () => {
      index = (index + 1) % 2
    }
  }
  return state
}

export type DebrisFlowOptions = {
  viewer: Viewer
  domain: SimulationDomain
  terrainProvider: TerrainProvider
  parameters?: Partial<DebrisFlowParameters>
  /** 模拟网格分辨率（正方形），默认 512，自动对齐到 32 的倍数。 */
  gridRes?: number
  visualMode?: VisualMode
  /** 覆盖层网格细分，默认 96。 */
  overlaySegments?: number
  /** DEM 采样分辨率（每边采样点数），默认 65。 */
  demSamples?: number
  onStatus?: (message: string) => void
}

export class DebrisFlowSimulation {
  readonly domain: SimulationDomain
  readonly parameters: DebrisFlowParameters
  visualMode: VisualMode
  show = true
  private ghostCenter = new Cartesian2(0, 0)
  private ghostRadius = 0
  private ghostActive = false
  private ghostOpacity = 0.6
  private erosionRef = 0.0005

  private readonly viewer: Viewer
  private readonly scene: Scene
  private readonly terrainProvider: TerrainProvider
  private readonly onStatus?: (message: string) => void
  private readonly gridX: number
  private readonly gridY: number
  private readonly overlaySegments: number
  private readonly demSamples: number
  readonly cellDx: number
  readonly cellDy: number
  readonly cellArea: number

  private context?: RenderContext
  private gpuReady = false
  private disposed = false
  private demReady = false
  private baseHeights?: Float32Array

  private flux!: PingPong
  private terrain!: PingPong
  private sed!: PingPong
  private src!: PingPong
  private pred?: Texture
  private reduceTex?: Texture
  private sampleTex?: Texture

  private readonly fboCache = new Map<Texture, Framebuffer>()
  private readonly mrtCache = new Map<string, Framebuffer>()
  private readonly texIds = new WeakMap<Texture, number>()
  private texIdCounter = 1

  private commands!: {
    predictor: ComputeCommand
    corrector: ComputeCommand
    advectC: ComputeCommand
    advectSed: ComputeCommand
    source: ComputeCommand
    slope: ComputeCommand
    decay: ComputeCommand
    reduce: ComputeCommand
    sampleFlow: ComputeCommand
    clear: ComputeCommand
    obstacleClear: ComputeCommand
  }
  private mrtDraw?: DrawCommand
  private overlayCommand?: DrawCommand
  private arrows?: BillboardCollection

  private historyFrames: HistoryFrame[] = []
  private historyCaptureDraw?: DrawCommand
  private historyTargets?: { terrain: Texture; flux: Texture; sed: Texture }
  private historyActive = -1
  private historyDisplay?: { terrain: Texture; flux: Texture; sed: Texture }
  private historyCounter = 0
  private historyRecording = true

  private paused = false
  private timeScale = 1
  private pendingSteps = 0
  private lastNow = 0
  private subDt = 0
  private lastCflDt = 0.02
  private rainfall = 0
  private decay = 0.985
  private frameCounter = 0
  private arrowTimer = 0
  private strokes: Stroke[] = []
  private stats: SimStats = { ...EMPTY_STATS }
  private readonly resolution: Cartesian2
  private readonly reduceBlock: number
  private readonly sampleBlock: number
  private readonly lightDir = Cartesian3.normalize(new Cartesian3(0.45, 0.35, 0.82), new Cartesian3())

  constructor(options: DebrisFlowOptions) {
    this.viewer = options.viewer
    this.scene = options.viewer.scene
    this.domain = options.domain
    this.terrainProvider = options.terrainProvider
    this.parameters = { ...DEFAULT_PARAMETERS, ...(options.parameters ?? {}) }
    this.visualMode = options.visualMode ?? 0
    this.onStatus = options.onStatus

    const grid = Math.max(64, Math.round(options.gridRes ?? 512))
    this.gridX = Math.round(grid / 32) * 32
    this.gridY = this.gridX
    this.overlaySegments = options.overlaySegments ?? 192
    this.demSamples = options.demSamples ?? 65

    this.cellDx = this.domain.widthMeters / this.gridX
    this.cellDy = this.domain.heightMeters / this.gridY
    this.cellArea = this.cellDx * this.cellDy
    this.resolution = new Cartesian2(this.gridX, this.gridY)
    this.reduceBlock = Math.max(1, Math.floor(this.gridX / REDUCE_RES))
    this.sampleBlock = Math.max(1, Math.floor(this.gridX / SAMPLE_RES))
  }

  /** 采样地形并准备初始高度场（在加入 scene 前调用）。 */
  async initialize(): Promise<void> {
    if (this.demReady) return
    this.onStatus?.('正在采样模拟区域地形高程…')
    this.baseHeights = await sampleHeights(
      this.terrainProvider,
      this.domain,
      this.gridX,
      this.gridY,
      this.demSamples
    )
    this.demReady = true
  }

  // ── Cesium Primitive 接口 ──────────────────────────────────────────────

  update(frameState: FrameStateLike): void {
    if (this.disposed || !this.show) return
    if (!this.gpuReady) this.initializeGpu(frameState.context)
    if (!this.flux) return

    const now = performance.now()
    if (this.lastNow === 0) this.lastNow = now
    const realDt = Math.min((now - this.lastNow) / 1000, 0.1)
    this.lastNow = now

    if (this.historyActive < 0) this.readStats()
    this.queueInteraction(frameState)
    let substeps = 0
    let subDt = 0
    const frameDt = this.paused ? 0 : realDt * this.timeScale
    if (this.pendingSteps > 0) {
      substeps = this.pendingSteps
      this.pendingSteps = 0
      subDt = this.lastCflDt > 0 ? this.lastCflDt : 0.02
    } else if (!this.paused && frameDt > 0) {
      const cflDt = this.computeCflDt()
      this.lastCflDt = cflDt
      substeps = Math.min(Math.max(Math.ceil(frameDt / cflDt), 1), this.parameters.maxSubsteps)
      subDt = frameDt / substeps
    }
    this.subDt = subDt

    for (let s = 0; s < substeps; s += 1) this.queueSubstep(frameState)
    this.queueCompute(frameState, this.commands.slope, () => this.terrain.write(), () => this.terrain.swap())
    this.queueCompute(frameState, this.commands.reduce, () => this.reduceTex as Texture)
    this.queueCompute(frameState, this.commands.sampleFlow, () => this.sampleTex as Texture)

    if (this.historyCaptureDraw && this.historyRecording && this.historyActive < 0 && substeps > 0) {
      this.historyCounter += 1
      if (this.historyCounter >= HISTORY_INTERVAL) {
        this.historyCounter = 0
        this.queueHistoryCapture(frameState)
      }
    }

    if (this.overlayCommand) frameState.commandList.push(this.overlayCommand)

    this.frameCounter += 1
    this.arrowTimer += 1
    if (!this.paused && this.historyActive < 0 && this.arrowTimer >= 12) {
      this.arrowTimer = 0
      this.updateArrows()
    }
    this.stats.frame = this.frameCounter
    this.stats.substeps = substeps
    this.stats.simTime += subDt * substeps
  }

  isDestroyed(): boolean {
    return this.disposed
  }

  // ── 对外控制 API ───────────────────────────────────────────────────────

  play(): void {
    this.paused = false
    this.lastNow = 0
  }

  pause(): void {
    this.paused = true
  }

  isPaused(): boolean {
    return this.paused
  }

  setTimeScale(scale: number): void {
    this.timeScale = Math.max(0, scale)
  }

  getTimeScale(): number {
    return this.timeScale
  }

  step(steps = 1): void {
    this.paused = true
    this.pendingSteps += Math.max(1, Math.floor(steps))
  }

  reset(): void {
    if (!this.gpuReady || !this.context) return
    this.destroyTextures()
    this.createTextures()
    this.stats = { ...EMPTY_STATS }
    this.frameCounter = 0
    this.rainfall = 0
    this.strokes = []
    this.historyFrames = []
    this.historyActive = -1
    this.historyCounter = 0
    this.historyRecording = true
  }

  setParameter<K extends keyof DebrisFlowParameters>(name: K, value: DebrisFlowParameters[K]): void {
    this.parameters[name] = value
  }

  getParameter<K extends keyof DebrisFlowParameters>(name: K): DebrisFlowParameters[K] {
    return this.parameters[name]
  }

  setVisualMode(mode: VisualMode): void {
    this.visualMode = mode
  }

  /** 更新笔刷覆盖网格虚影：i/j 为连续网格坐标，radius 为格数，opacity 为虚影不透明度。 */
  setBrushGhost(i: number, j: number, radius: number, active: boolean, opacity?: number): void {
    this.ghostCenter.x = i
    this.ghostCenter.y = j
    this.ghostRadius = Math.max(0, radius)
    this.ghostActive = active
    if (opacity !== undefined) this.setGhostOpacity(opacity)
  }

  setGhostOpacity(opacity: number): void {
    this.ghostOpacity = Math.min(1, Math.max(0, opacity))
  }

  /** 降雨强度 mm/h → 有效下渗/汇流速率（带演示增益，保证可见的径流响应）。 */
  setRainfall(rateMmPerHour: number): void {
    this.rainfall = (Math.max(0, rateMmPerHour) / 1000 / 3600) * RAIN_GAIN
  }

  getRainfall(): number {
    return this.rainfall
  }

  /** 覆盖层侵蚀着色的归一化基准（米），通常取矢量检测阈值，使微小侵蚀也能显色。 */
  setErosionReference(value: number): void {
    this.erosionRef = Math.max(1e-6, value)
  }

  getErosionReference(): number {
    return this.erosionRef
  }

  injectWater(i: number, j: number, radiusCells: number, rate: number): void {
    this.strokes.push({ kind: 'water', i, j, radius: radiusCells, strength: rate })
  }

  injectSediment(i: number, j: number, radiusCells: number, rate: number): void {
    this.strokes.push({ kind: 'water', i, j, radius: radiusCells, strength: rate * 0.35 })
    this.strokes.push({ kind: 'sediment', i, j, radius: radiusCells, strength: rate })
  }

  breachDam(i: number, j: number, radiusCells: number, waterVolume: number, concentration: number): void {
    const water = Math.max(0.1, waterVolume / Math.max(radiusCells * radiusCells * this.cellArea, 1))
    this.strokes.push({ kind: 'water', i, j, radius: radiusCells, strength: water })
    this.strokes.push({ kind: 'sediment', i, j, radius: radiusCells, strength: water * concentration })
  }

  markObstacle(i: number, j: number, radiusCells: number): void {
    this.strokes.push({ kind: 'obstacle', i, j, radius: radiusCells, strength: 0 })
  }

  erase(): void {
    this.strokes.push({ kind: 'erase', i: 0, j: 0, radius: 0, strength: 0 })
  }

  getStats(): SimStats {
    return { ...this.stats }
  }

  getStateAt(i: number, j: number): {
    h: number
    u: number
    v: number
    C: number
    zb: number
    base: number
    erosion: number
    deposit: number
    obstacle: number
  } | null {
    if (!this.gpuReady || !this.context) return null
    const x = Math.max(0, Math.min(this.gridX - 1, Math.floor(i)))
    const y = Math.max(0, Math.min(this.gridY - 1, Math.floor(j)))
    const f = this.context.readPixels({ framebuffer: this.getFB(this.flux.read()), x, y, width: 1, height: 1 })
    const t = this.context.readPixels({ framebuffer: this.getFB(this.terrain.read()), x, y, width: 1, height: 1 })
    const s = this.context.readPixels({ framebuffer: this.getFB(this.sed.read()), x, y, width: 1, height: 1 })
    const h = f[0]
    return {
      h,
      u: h > this.parameters.minDepth ? f[1] / h : 0,
      v: h > this.parameters.minDepth ? f[2] / h : 0,
      C: f[3],
      zb: t[0],
      base: t[1],
      erosion: s[2],
      deposit: s[3],
      obstacle: t[3]
    }
  }

  exportSnapshot(): {
    terrain: Float32Array
    flux: Float32Array
    sediment: Float32Array
    width: number
    height: number
  } | null {
    if (!this.gpuReady || !this.context) return null
    const size = { width: this.gridX, height: this.gridY }
    const read = (tex: Texture): Float32Array =>
      Float32Array.from(
        this.context!.readPixels({ framebuffer: this.getFB(tex), width: this.gridX, height: this.gridY })
      )
    return {
      terrain: read(this.terrain.read()),
      flux: read(this.flux.read()),
      sediment: read(this.sed.read()),
      width: size.width,
      height: size.height
    }
  }

  getHistoryInfo(): HistoryInfo[] {
    return this.historyFrames.map((frame) => ({
      time: frame.time,
      maxDepth: frame.maxDepth,
      maxSpeed: frame.maxSpeed,
      erodedVolume: frame.erodedVolume,
      depositedVolume: frame.depositedVolume
    }))
  }

  /** 历史关键帧滚动窗口容量上限（达到后自动覆盖最早帧）。 */
  getHistoryLimit(): number {
    return HISTORY_MAX_FRAMES
  }

  /** 当前历史关键帧数量（轻量，不做逐帧映射）。 */
  getHistoryCount(): number {
    return this.historyFrames.length
  }

  isHistoryMode(): boolean {
    return this.historyActive >= 0
  }

  /** 回溯到指定历史关键帧（仅切换显示，不改变物理状态）。 */
  setHistoryFrame(index: number): void {
    if (!this.context || !this.historyDisplay || this.historyFrames.length === 0) return
    const idx = Math.min(this.historyFrames.length - 1, Math.max(0, Math.floor(index)))
    const frame = this.historyFrames[idx]
    const size = { width: HISTORY_RES, height: HISTORY_RES }
    this.historyDisplay.terrain.copyFrom({ source: { ...size, arrayBufferView: frame.terrain } })
    this.historyDisplay.flux.copyFrom({ source: { ...size, arrayBufferView: frame.flux } })
    this.historyDisplay.sed.copyFrom({ source: { ...size, arrayBufferView: frame.sed } })
    this.historyActive = idx
    this.paused = true
    this.stats.maxDepth = frame.maxDepth
    this.stats.maxSpeed = frame.maxSpeed
    this.stats.erodedVolume = frame.erodedVolume
    this.stats.depositedVolume = frame.depositedVolume
    this.stats.simTime = frame.time
  }

  resumeLive(): void {
    this.historyActive = -1
    this.paused = false
    this.lastNow = 0
  }

  clearHistory(): void {
    this.historyFrames = []
    this.historyActive = -1
    this.historyCounter = 0
  }

  /** 是否正在持续记录历史关键帧。 */
  isHistoryRecording(): boolean {
    return this.historyRecording
  }

  /** 开启/停止历史关键帧记录；未停止时持续滚动记录（内存预算内自动覆盖最早帧，仅在 reset 时清空）。 */
  setHistoryRecording(on: boolean): void {
    if (on === this.historyRecording) return
    this.historyRecording = on
    this.historyCounter = 0
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    if (!this.scene.isDestroyed()) {
      if (this.arrows) this.scene.primitives.remove(this.arrows)
      this.scene.primitives.remove(this as never)
    }
    this.arrows = undefined
    this.overlayCommand?.shaderProgram?.destroy()
    this.mrtDraw?.shaderProgram?.destroy()
    this.historyCaptureDraw?.shaderProgram?.destroy()
    this.overlayCommand = undefined
    this.mrtDraw = undefined
    this.historyCaptureDraw = undefined
    this.destroyTextures()
    if (this.historyTargets) {
      for (const tex of Object.values(this.historyTargets)) if (!tex.isDestroyed()) tex.destroy()
      this.historyTargets = undefined
    }
    if (this.historyDisplay) {
      for (const tex of Object.values(this.historyDisplay)) if (!tex.isDestroyed()) tex.destroy()
      this.historyDisplay = undefined
    }
    this.historyFrames = []
    this.baseHeights = undefined
  }

  // ── GPU 初始化 ─────────────────────────────────────────────────────────

  private initializeGpu(context: RenderContext): void {
    if (this.gpuReady) return
    if (!context.colorBufferFloat) {
      throw new Error('当前 GPU/浏览器不支持 EXT_color_buffer_float，无法创建浮点渲染目标')
    }
    this.context = context
    this.createTextures()

    this.commands = {
      predictor: this.makeCompute(PREDICTOR_FS, this.baseUniforms()),
      corrector: this.makeCompute(CORRECTOR_FS, {
        ...this.baseUniforms(),
        u_pred: () => this.pred as Texture,
        u_tauY: () => this.parameters.yieldStress,
        u_K: () => this.parameters.consistencyK,
        u_nHB: () => this.parameters.flowIndexN,
        u_mP: () => this.parameters.papanastasiouM,
        u_rhoW: () => this.parameters.waterDensity,
        u_rhoS: () => this.parameters.sedimentDensity
      }),
      advectC: this.makeCompute(ADVECT_C_FS, {
        ...this.baseUniforms(),
        u_maxC: () => this.parameters.maxConcentration
      }),
      advectSed: this.makeCompute(ADVECT_SED_FS, {
        ...this.baseUniforms(),
        u_sed: () => this.sed.read(),
        u_maxC: () => this.parameters.maxConcentration
      }),
      source: this.makeCompute(SOURCE_FS, {
        ...this.baseUniforms(),
        u_src: () => this.src.read(),
        u_rainfall: () => this.rainfall,
        u_maxC: () => this.parameters.maxConcentration
      }),
      slope: this.makeCompute(SLOPE_FS, this.baseUniforms()),
      decay: this.makeCompute(SOURCE_DECAY_FS, {
        u_src: () => this.src.read(),
        u_decay: () => this.decay
      }),
      reduce: this.makeCompute(REDUCE_FS, {
        ...this.baseUniforms(),
        u_sed: () => this.sed.read(),
        u_block: () => this.reduceBlock
      }),
      sampleFlow: this.makeCompute(SAMPLE_FLOW_FS, {
        ...this.baseUniforms(),
        u_block: () => this.sampleBlock
      }),
      clear: this.makeCompute(CLEAR_FS, {}),
      obstacleClear: this.makeCompute(OBSTACLE_CLEAR_FS, {
        u_terrain: () => this.terrain.read()
      })
    }

    this.mrtDraw = context.createViewportQuadCommand(new ShaderSource({ sources: [EROSION_FS] }), {
      uniformMap: {
        ...this.baseUniforms(),
        u_sed: () => this.sed.read(),
        u_Er: () => this.parameters.erosionCoeff,
        u_Dr: () => this.parameters.depositionCoeff,
        u_tauC: () => this.parameters.criticalShear,
        u_tauY: () => this.parameters.yieldStress,
        u_K: () => this.parameters.consistencyK,
        u_nHB: () => this.parameters.flowIndexN,
        u_mP: () => this.parameters.papanastasiouM,
        u_rhoW: () => this.parameters.waterDensity,
        u_rhoS: () => this.parameters.sedimentDensity,
        u_maxC: () => this.parameters.maxConcentration
      },
      renderState: RenderState.fromCache({
        viewport: new BoundingRectangle(0, 0, this.gridX, this.gridY),
        depthTest: { enabled: false },
        depthMask: false,
        cull: { enabled: false }
      }),
      pass: Pass.COMPUTE
    })

    this.createOverlay(context)
    this.createHistory(context)
    this.createArrows()

    this.gpuReady = true
    this.onStatus?.('')
  }

  private createTextures(): void {
    const context = this.context as RenderContext
    const n = this.gridX * this.gridY * 4
    const base = this.baseHeights ?? new Float32Array(this.gridX * this.gridY)
    const terrainData = new Float32Array(n)
    for (let k = 0; k < this.gridX * this.gridY; k += 1) {
      const z = base[k]
      terrainData[k * 4] = z
      terrainData[k * 4 + 1] = z
      terrainData[k * 4 + 2] = 0
      terrainData[k * 4 + 3] = 0
    }
    this.flux = createPingPong(context, this.gridX, this.gridY)
    this.terrain = createPingPong(context, this.gridX, this.gridY, terrainData)
    this.sed = createPingPong(context, this.gridX, this.gridY)
    this.src = createPingPong(context, this.gridX, this.gridY)
    this.pred = createStateTexture(context, this.gridX, this.gridY)
    this.reduceTex = createStateTexture(context, REDUCE_RES, REDUCE_RES)
    this.sampleTex = createStateTexture(context, SAMPLE_RES, SAMPLE_RES)
  }

  private destroyTextures(): void {
    for (const fb of this.fboCache.values()) fb.destroy()
    this.fboCache.clear()
    for (const fb of this.mrtCache.values()) fb.destroy()
    this.mrtCache.clear()
    const textures: Texture[] = []
    if (this.flux) textures.push(...this.flux.textures)
    if (this.terrain) textures.push(...this.terrain.textures)
    if (this.sed) textures.push(...this.sed.textures)
    if (this.src) textures.push(...this.src.textures)
    if (this.pred) textures.push(this.pred)
    if (this.reduceTex) textures.push(this.reduceTex)
    if (this.sampleTex) textures.push(this.sampleTex)
    for (const tex of textures) {
      if (!tex.isDestroyed()) tex.destroy()
    }
    this.pred = undefined
    this.reduceTex = undefined
    this.sampleTex = undefined
  }

  private createOverlay(context: RenderContext): void {
    const geometry = buildGridMesh(this.overlaySegments, this.domain.widthMeters, this.domain.heightMeters)
    const attributeLocations = { position: 0, st: 1 }
    const vertexArray = VertexArray.fromGeometry({
      context,
      geometry,
      attributeLocations,
      bufferUsage: BufferUsage.STATIC_DRAW
    })
    const shaderProgram = ShaderProgram.fromCache({
      context,
      vertexShaderSource: new ShaderSource({ sources: [OVERLAY_VS] }),
      fragmentShaderSource: new ShaderSource({ sources: [OVERLAY_FS] }),
      attributeLocations
    })
    const renderState = RenderState.fromCache({
      depthTest: { enabled: false },
      depthMask: false,
      cull: { enabled: false },
      blending: {
        enabled: true,
        equationRgb: BlendEquation.ADD,
        equationAlpha: BlendEquation.ADD,
        functionSourceRgb: BlendFunction.SOURCE_ALPHA,
        functionSourceAlpha: BlendFunction.ONE,
        functionDestinationRgb: BlendFunction.ONE_MINUS_SOURCE_ALPHA,
        functionDestinationAlpha: BlendFunction.ONE_MINUS_SOURCE_ALPHA
      }
    })
    const centerHeight = this.averageHeight()
    const center = this.domain.enuToCartesian(0, 0, centerHeight)
    const radius = 0.75 * Math.hypot(this.domain.widthMeters, this.domain.heightMeters) + 500
    this.overlayCommand = new DrawCommand({
      owner: this,
      vertexArray,
      primitiveType: PrimitiveType.TRIANGLES,
      modelMatrix: this.domain.enuMatrix,
      renderState,
      shaderProgram,
      uniformMap: {
        u_terrain: () => (this.historyActive >= 0 && this.historyDisplay ? this.historyDisplay.terrain : this.terrain.read()),
        u_flux: () => (this.historyActive >= 0 && this.historyDisplay ? this.historyDisplay.flux : this.flux.read()),
        u_sed: () => (this.historyActive >= 0 && this.historyDisplay ? this.historyDisplay.sed : this.sed.read()),
        u_mode: () => this.visualMode,
        u_maxDepth: () => Math.max(this.stats.maxDepth, 0.5),
        u_maxSpeed: () => Math.max(this.stats.maxSpeed, 0.5),
        u_lightDir: () => this.lightDir,
        u_erosionScale: () => this.parameters.erosionVertexScale,
        u_gridDim: () => this.gridX,
        u_ghostCenter: () => this.ghostCenter,
        u_ghostRadius: () => this.ghostRadius,
        u_ghostActive: () => (this.ghostActive ? 1 : 0),
        u_ghostOpacity: () => this.ghostOpacity,
        u_erosionRef: () => this.erosionRef
      },
      pass: Pass.TRANSLUCENT,
      boundingVolume: new BoundingSphere(center, radius)
    })
  }

  private createHistory(context: RenderContext): void {
    this.historyTargets = {
      terrain: createStateTexture(context, HISTORY_RES, HISTORY_RES),
      flux: createStateTexture(context, HISTORY_RES, HISTORY_RES),
      sed: createStateTexture(context, HISTORY_RES, HISTORY_RES)
    }
    this.historyDisplay = {
      terrain: createStateTexture(context, HISTORY_RES, HISTORY_RES),
      flux: createStateTexture(context, HISTORY_RES, HISTORY_RES),
      sed: createStateTexture(context, HISTORY_RES, HISTORY_RES)
    }
    const block = Math.max(1, Math.floor(this.gridX / HISTORY_RES))
    this.historyCaptureDraw = context.createViewportQuadCommand(new ShaderSource({ sources: [HISTORY_FS] }), {
      uniformMap: {
        ...this.baseUniforms(),
        u_sed: () => this.sed.read(),
        u_block: () => block
      },
      renderState: RenderState.fromCache({
        viewport: new BoundingRectangle(0, 0, HISTORY_RES, HISTORY_RES),
        depthTest: { enabled: false },
        depthMask: false,
        cull: { enabled: false }
      }),
      pass: Pass.COMPUTE
    })
  }

  private createArrows(): void {
    this.arrows = new BillboardCollection()
    this.scene.primitives.add(this.arrows as never)
  }

  private averageHeight(): number {
    const base = this.baseHeights
    if (!base || base.length === 0) return 0
    let sum = 0
    for (let k = 0; k < base.length; k += 1) sum += base[k]
    return sum / base.length
  }

  // ── 命令与队列 ─────────────────────────────────────────────────────────

  private makeCompute(fragmentSource: string, uniformMap: UniformMap): ComputeCommand {
    return new ComputeCommand({
      fragmentShaderSource: new ShaderSource({ sources: [fragmentSource] }),
      uniformMap,
      persists: true
    })
  }

  private baseUniforms(): UniformMap {
    return {
      u_res: () => this.resolution,
      u_dx: () => this.cellDx,
      u_dy: () => this.cellDy,
      u_dt: () => this.subDt,
      u_g: () => this.parameters.gravity,
      u_minH: () => this.parameters.minDepth,
      u_flux: () => this.flux.read(),
      u_terrain: () => this.terrain.read()
    }
  }

  private queueCompute(frameState: FrameStateLike, command: ComputeCommand, output: () => Texture, onDone?: () => void): void {
    command.preExecute = () => {
      command.outputTexture = output()
    }
    command.postExecute = () => {
      onDone?.()
    }
    frameState.commandList.push(command)
  }

  private queueSubstep(frameState: FrameStateLike): void {
    this.queueCompute(frameState, this.commands.predictor, () => this.pred as Texture)
    this.queueCompute(
      frameState,
      this.commands.corrector,
      () => this.flux.write(),
      () => this.flux.swap()
    )
    this.queueCompute(
      frameState,
      this.commands.advectC,
      () => this.flux.write(),
      () => this.flux.swap()
    )
    this.queueCompute(
      frameState,
      this.commands.advectSed,
      () => this.sed.write(),
      () => this.sed.swap()
    )
    this.queueErosion(frameState)
    this.queueCompute(
      frameState,
      this.commands.source,
      () => this.flux.write(),
      () => this.flux.swap()
    )
  }

  private queueErosion(frameState: FrameStateLike): void {
    const draw = this.mrtDraw
    if (!draw) return
    frameState.commandList.push({
      pass: Pass.COMPUTE,
      owner: this,
      execute: () => {
        draw.framebuffer = this.getMrtFB(this.terrain.write(), this.sed.write(), this.flux.write())
        draw.execute(this.context as never)
        this.terrain.swap()
        this.sed.swap()
        this.flux.swap()
      }
    })
  }

  private queueHistoryCapture(frameState: FrameStateLike): void {
    const draw = this.historyCaptureDraw
    const targets = this.historyTargets
    if (!draw || !targets) return
    frameState.commandList.push({
      pass: Pass.COMPUTE,
      owner: this,
      execute: () => {
        draw.framebuffer = this.getMrtFB(targets.terrain, targets.flux, targets.sed)
        draw.execute(this.context as never)
        this.readHistoryFrame()
      }
    })
  }

  private readHistoryFrame(): void {
    const targets = this.historyTargets
    if (!targets || !this.context) return
    const read = (tex: Texture): Float32Array => {
      const pixels = this.context!.readPixels({
        framebuffer: this.getFB(tex),
        width: HISTORY_RES,
        height: HISTORY_RES
      })
      return pixels instanceof Float32Array ? pixels : Float32Array.from(pixels)
    }
    this.historyFrames.push({
      time: this.stats.simTime,
      maxDepth: this.stats.maxDepth,
      maxSpeed: this.stats.maxSpeed,
      erodedVolume: this.stats.erodedVolume,
      depositedVolume: this.stats.depositedVolume,
      terrain: read(targets.terrain),
      flux: read(targets.flux),
      sed: read(targets.sed)
    })
    if (this.historyFrames.length > HISTORY_MAX_FRAMES) this.historyFrames.shift()
  }

  private queueInteraction(frameState: FrameStateLike): void {
    for (const stroke of this.strokes) {
      this.queueStroke(frameState, stroke)
    }
    this.strokes = []

    this.queueCompute(frameState, this.commands.decay, () => this.src.write(), () => this.src.swap())
  }

  private queueStroke(frameState: FrameStateLike, stroke: Stroke): void {
    const center = new Cartesian2(stroke.i + 0.5, stroke.j + 0.5)
    const radius = Math.max(1, stroke.radius)
    if (stroke.kind === 'water' || stroke.kind === 'sediment' || stroke.kind === 'breach') {
      const channel = stroke.kind === 'sediment' ? 1 : 0
      const command = this.makeCompute(BRUSH_FS, {
        u_src: () => this.src.read(),
        u_center: () => center,
        u_radius: () => radius,
        u_strength: () => stroke.strength,
        u_channel: () => channel
      })
      this.queueCompute(frameState, command, () => this.src.write(), () => this.src.swap())
      return
    }
    if (stroke.kind === 'obstacle') {
      const command = this.makeCompute(OBSTACLE_FS, {
        u_terrain: () => this.terrain.read(),
        u_center: () => center,
        u_radius: () => radius,
        u_value: () => 1
      })
      this.queueCompute(frameState, command, () => this.terrain.write(), () => this.terrain.swap())
      return
    }
    if (stroke.kind === 'erase') {
      this.queueCompute(frameState, this.commands.clear, () => this.src.write(), () => this.src.swap())
      this.queueCompute(
        frameState,
        this.commands.obstacleClear,
        () => this.terrain.write(),
        () => this.terrain.swap()
      )
    }
  }

  // ── 统计与时间步 ───────────────────────────────────────────────────────

  private readStats(): void {
    if (!this.context || !this.reduceTex) return
    const data = this.context.readPixels({
      framebuffer: this.getFB(this.reduceTex),
      width: REDUCE_RES,
      height: REDUCE_RES
    })
    let maxH = 0
    let maxS = 0
    let ero = 0
    let dep = 0
    let wet = 0
    const count = REDUCE_RES * REDUCE_RES
    for (let k = 0; k < count; k += 1) {
      const h = data[k * 4]
      const s = data[k * 4 + 1]
      ero += data[k * 4 + 2]
      dep += data[k * 4 + 3]
      if (h > maxH) maxH = h
      if (s > maxS) maxS = s
      if (h > this.parameters.minDepth) wet += this.reduceBlock * this.reduceBlock
    }
    const area = this.cellArea
    const stats = this.stats
    stats.maxDepth = maxH
    stats.maxSpeed = maxS
    stats.erodedVolume = ero * area
    stats.depositedVolume = dep * area
    stats.wetCells = wet
  }

  private computeCflDt(): number {
    const wave =
      this.stats.maxSpeed + Math.sqrt(this.parameters.gravity * Math.max(this.stats.maxDepth, 0.02))
    let dt = (this.parameters.cflNumber * Math.min(this.cellDx, this.cellDy)) / Math.max(wave, 1e-3)
    if (!Number.isFinite(dt) || dt <= 0) dt = 0.02
    return Math.min(Math.max(dt, 1e-4), 0.2)
  }

  private updateArrows(): void {
    if (!this.context || !this.sampleTex || !this.arrows || !this.baseHeights) return
    const data = this.context.readPixels({
      framebuffer: this.getFB(this.sampleTex),
      width: SAMPLE_RES,
      height: SAMPLE_RES
    })
    // 复用 Billboard 池：流场每帧都在变，若反复 removeAll + add 会不断创建/销毁
    // 纹理与对象，长时间运行会造成明显的 GC 与 GPU 抖动。这里改为按需扩容、
    // 更新已有 billboard，并把多余的隐藏，避免重复创建贴图。
    const arrows = this.arrows
    const threshold = 0.25
    const scratchColor = arrowColorScratch
    let used = 0
    for (let j = 0; j < SAMPLE_RES; j += 1) {
      for (let i = 0; i < SAMPLE_RES; i += 1) {
        const k = (j * SAMPLE_RES + i) * 4
        const u = data[k]
        const v = data[k + 1]
        const h = data[k + 2]
        const speed = data[k + 3]
        if (h <= this.parameters.minDepth || speed < threshold) continue
        const gi = Math.min(this.gridX - 1, Math.floor(i * this.sampleBlock + this.sampleBlock / 2))
        const gj = Math.min(this.gridY - 1, Math.floor(j * this.sampleBlock + this.sampleBlock / 2))
        const enu = this.domain.gridToENU(gi, gj)
        const z = this.baseHeights[gj * this.gridX + gi] + 8
        const position = this.domain.enuToCartesian(enu.e, enu.n, z)
        const color = debrisColor(Math.min(speed / Math.max(this.stats.maxSpeed, 0.5), 1))
        scratchColor.red = color[0]
        scratchColor.green = color[1]
        scratchColor.blue = color[2]
        scratchColor.alpha = 0.95
        const rotation = Math.atan2(u, v)
        if (used < arrows.length) {
          const billboard = arrows.get(used)
          billboard.position = position
          billboard.rotation = rotation
          billboard.color = scratchColor
          billboard.show = true
        } else {
          arrows.add({
            position,
            image: arrowCanvas(),
            width: 16,
            height: 16,
            rotation,
            color: scratchColor,
            scaleByDistance: new NearFarScalar(200, 1.2, 20000, 0.4)
          })
        }
        used += 1
      }
    }
    for (let i = used; i < arrows.length; i += 1) arrows.get(i).show = false
  }

  // ── Framebuffer 缓存 ───────────────────────────────────────────────────

  private texId(tex: Texture): number {
    let id = this.texIds.get(tex)
    if (id === undefined) {
      id = this.texIdCounter
      this.texIdCounter += 1
      this.texIds.set(tex, id)
    }
    return id
  }

  private getFB(tex: Texture): Framebuffer {
    let fb = this.fboCache.get(tex)
    if (!fb) {
      fb = new Framebuffer({ context: this.context as never, colorTextures: [tex], destroyAttachments: false })
      this.fboCache.set(tex, fb)
    }
    return fb
  }

  private getMrtFB(a: Texture, b: Texture, c: Texture): Framebuffer {
    const key = `${this.texId(a)},${this.texId(b)},${this.texId(c)}`
    let fb = this.mrtCache.get(key)
    if (!fb) {
      fb = new Framebuffer({
        context: this.context as never,
        colorTextures: [a, b, c],
        destroyAttachments: false
      })
      this.mrtCache.set(key, fb)
    }
    return fb
  }
}

// ── 辅助函数 ─────────────────────────────────────────────────────────────

let cachedArrow: HTMLCanvasElement | undefined
const arrowColorScratch = new Color()

function arrowCanvas(): HTMLCanvasElement {
  if (!cachedArrow) cachedArrow = createArrowImage(64)
  return cachedArrow
}

function debrisColor(t: number): [number, number, number] {
  const tt = Math.max(0, Math.min(1, t))
  const blue: [number, number, number] = [0.1, 0.45, 0.95]
  const green: [number, number, number] = [0.15, 0.9, 0.4]
  const red: [number, number, number] = [0.98, 0.2, 0.1]
  if (tt < 0.5) {
    const f = tt * 2
    return [blue[0] + (green[0] - blue[0]) * f, blue[1] + (green[1] - blue[1]) * f, blue[2] + (green[2] - blue[2]) * f]
  }
  const f = (tt - 0.5) * 2
  return [green[0] + (red[0] - green[0]) * f, green[1] + (red[1] - green[1]) * f, green[2] + (red[2] - green[2]) * f]
}

async function sampleHeights(
  terrainProvider: TerrainProvider,
  domain: SimulationDomain,
  gridX: number,
  gridY: number,
  samples: number
): Promise<Float32Array> {
  const n = Math.max(2, Math.floor(samples))
  const rectangle = domain.rectangle
  const west = CesiumMath.toDegrees(rectangle.west)
  const east = CesiumMath.toDegrees(rectangle.east)
  const south = CesiumMath.toDegrees(rectangle.south)
  const north = CesiumMath.toDegrees(rectangle.north)

  const requests: Cartographic[] = []
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const lon = west + ((east - west) * i) / (n - 1)
      const lat = south + ((north - south) * j) / (n - 1)
      requests.push(Cartographic.fromDegrees(lon, lat))
    }
  }

  let sampled: Cartographic[] = requests
  try {
    sampled = await sampleTerrainMostDetailed(terrainProvider, requests)
  } catch {
    sampled = requests
  }

  const heightAt = (i: number, j: number): number => {
    const h = sampled[j * n + i]?.height
    return Number.isFinite(h) ? (h as number) : 0
  }

  const out = new Float32Array(gridX * gridY)
  for (let jj = 0; jj < gridY; jj += 1) {
    const gy = (jj / (gridY - 1)) * (n - 1)
    const j0 = Math.min(n - 2, Math.floor(gy))
    const tj = gy - j0
    for (let ii = 0; ii < gridX; ii += 1) {
      const gx = (ii / (gridX - 1)) * (n - 1)
      const i0 = Math.min(n - 2, Math.floor(gx))
      const ti = gx - i0
      const h00 = heightAt(i0, j0)
      const h10 = heightAt(i0 + 1, j0)
      const h01 = heightAt(i0, j0 + 1)
      const h11 = heightAt(i0 + 1, j0 + 1)
      const a = h00 + (h10 - h00) * ti
      const b = h01 + (h11 - h01) * ti
      out[jj * gridX + ii] = a + (b - a) * tj
    }
  }
  return out
}
