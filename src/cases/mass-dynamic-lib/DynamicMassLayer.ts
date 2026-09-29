import {
  BufferUsage,
  Cartesian3,
  ComponentDatatype,
  DrawCommand,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  Matrix4,
  Pass,
  PixelDatatype,
  PixelFormat,
  RenderState,
  Sampler,
  ShaderProgram,
  ShaderSource,
  Texture,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  TextureWrap,
  Transforms,
  VertexArray,
  defined,
  destroyObject,
  type Viewer
} from 'cesium'

export type DynamicMassBaseOptions = {
  /** 位置纹理单元数量：每个单元存放一个锚点（点=点数，线=线数×2） */
  cellCount: number
  /** 运动区域边长（米），以拟合平面原点为中心 */
  extent: number
  /** 抬升高度（米），避免与地表 z-fighting */
  heightOffset: number
  /** 位置更新间隔（毫秒），即数据刷新频率 */
  interval: number
  /** 移动速度（米/秒） */
  speed: number
  /** 是否暂停位置更新 */
  paused: boolean
  /** 不透明度 */
  opacity: number
}

export type DynamicMassStats = {
  entityCount: number
  fps: number
  tickMs: number
  uploadBytes: number
  interval: number
}

export type MassDrawContent = {
  geometry: Geometry
  attributeLocations: Record<string, number>
  primitiveType: number
  renderState: unknown
  vertexShader: string
  fragmentShader: string
  uniformMap?: Record<string, () => unknown>
}

/** 单个 DrawCommand 的轻量 Primitive：持有位置纹理并在每帧上载最新数据 */
class MassDrawPrimitive {
  private geometry: Geometry
  private attributeLocations: Record<string, number>
  private primitiveType: number
  private renderState: unknown
  private vertexShader: string
  private fragmentShader: string
  private modelMatrix: Matrix4
  private uniformMap: Record<string, () => unknown>
  private preExecute?: () => void
  private command?: DrawCommand

  show = true

  constructor(options: {
    geometry: Geometry
    attributeLocations: Record<string, number>
    primitiveType: number
    renderState: unknown
    vertexShader: string
    fragmentShader: string
    modelMatrix: Matrix4
    uniformMap: Record<string, () => unknown>
    preExecute?: () => void
  }) {
    this.geometry = options.geometry
    this.attributeLocations = options.attributeLocations
    this.primitiveType = options.primitiveType
    this.renderState = options.renderState
    this.vertexShader = options.vertexShader
    this.fragmentShader = options.fragmentShader
    this.modelMatrix = options.modelMatrix
    this.uniformMap = options.uniformMap
    this.preExecute = options.preExecute
  }

  private createCommand(context: object): DrawCommand {
    const vertexArray = VertexArray.fromGeometry({
      context,
      geometry: this.geometry,
      attributeLocations: this.attributeLocations,
      bufferUsage: BufferUsage.STATIC_DRAW
    })
    const shaderProgram = ShaderProgram.fromCache({
      context,
      vertexShaderSource: new ShaderSource({ sources: [this.vertexShader] }),
      fragmentShaderSource: new ShaderSource({ sources: [this.fragmentShader] }),
      attributeLocations: this.attributeLocations
    })
    return new DrawCommand({
      owner: this,
      vertexArray,
      primitiveType: this.primitiveType,
      modelMatrix: this.modelMatrix,
      renderState: RenderState.fromCache(this.renderState),
      shaderProgram,
      uniformMap: this.uniformMap,
      pass: Pass.OPAQUE
    })
  }

  update(frameState: { context: object; commandList: unknown[] }): void {
    if (!this.show || !defined(frameState) || !frameState.commandList) return
    if (!defined(this.command)) {
      this.command = this.createCommand(frameState.context)
    }
    this.preExecute?.()
    frameState.commandList.push(this.command)
  }

  destroy(): void {
    if (defined(this.command)) {
      this.command.shaderProgram?.destroy()
      this.command.vertexArray?.destroy()
      this.command = undefined
    }
    destroyObject(this)
  }

  isDestroyed(): boolean {
    return false
  }
}

/**
 * 海量动态元素渲染基类。
 *
 * 元素锚点存放于 RGBA FLOAT 双缓冲纹理：CPU 端按 interval 周期移动锚点并整批上载，
 * 顶点在 GPU 上按 `mix(prev, curr, u_mix)` 插值，全程单次 DrawCall。
 * 子类只需实现 `initCells()`（初始化锚点与速度）与 `createContent()`（几何/着色器/渲染状态）。
 */
export abstract class DynamicMassLayer<TOptions extends DynamicMassBaseOptions> {
  protected viewer: Viewer
  protected context: object
  protected options: TOptions

  protected data!: Float32Array
  protected velocities!: Float32Array
  protected cellsX = 1
  protected cellsY = 1
  protected cellCount = 0
  protected originMatrix = Matrix4.IDENTITY

  private onStats?: (stats: DynamicMassStats) => void
  private primitive?: MassDrawPrimitive
  private textures: Texture[] = []
  private currentIndex = 0
  private intervalTimer?: ReturnType<typeof setInterval>
  private rafId = 0
  private lastUploadAt = 0
  private lastTickDuration = 0
  private lastUploadBytes = 0
  private uploadPending = false
  private destroyed = false
  private fpsFrames = 0
  private fpsLastSample = 0
  private fps = 0

  constructor(viewer: Viewer, options: TOptions, onStats?: (stats: DynamicMassStats) => void) {
    this.viewer = viewer
    this.context = (viewer.scene as unknown as { context: object }).context
    this.options = { ...options }
    this.onStats = onStats
    const { lon, lat } = this.origin()
    this.originMatrix = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lon, lat, 0))
    this.build()
    this.startInterval()
    this.startStatsLoop()
  }

  /** 拟合平面原点经纬度，子类可覆盖 */
  protected origin(): { lon: number; lat: number } {
    return { lon: 116.391, lat: 39.907 }
  }

  /** 统计用的实体数量（默认等于单元数量） */
  protected entityCount(): number {
    return this.cellCount
  }

  protected halfExtent(): number {
    return this.options.extent / 2
  }

  protected cellToUv(cell: number): [number, number] {
    const col = cell % this.cellsX
    const row = Math.floor(cell / this.cellsX)
    return [(col + 0.5) / this.cellsX, (row + 0.5) / this.cellsY]
  }

  /** 在运动区域内随机放置一个锚点 */
  protected randomAnchor(cell: number): void {
    const half = this.halfExtent()
    this.data[cell * 4] = (Math.random() * 2 - 1) * half
    this.data[cell * 4 + 1] = (Math.random() * 2 - 1) * half
    this.data[cell * 4 + 2] = this.options.heightOffset
    this.data[cell * 4 + 3] = 1
  }

  /** 设置锚点（东向/北向/高度，单位米） */
  protected setAnchor(cell: number, east: number, north: number, height: number): void {
    this.data[cell * 4] = east
    this.data[cell * 4 + 1] = north
    this.data[cell * 4 + 2] = height
    this.data[cell * 4 + 3] = 1
  }

  /** 设置单位方向速度 */
  protected setVelocity(cell: number, angle: number): void {
    this.velocities[cell * 2] = Math.cos(angle)
    this.velocities[cell * 2 + 1] = Math.sin(angle)
  }

  protected randomVelocity(cell: number): void {
    this.setVelocity(cell, Math.random() * Math.PI * 2)
  }

  /** 子类实现：填充锚点与速度 */
  protected abstract initCells(): void

  /** 子类实现：构造几何、着色器、渲染状态（可访问 this.data / this.cellCount） */
  protected abstract createContent(): MassDrawContent

  private build(): void {
    const cells = Math.max(1, Math.floor(this.options.cellCount))
    this.cellsX = Math.max(1, Math.ceil(Math.sqrt(cells)))
    this.cellsY = Math.max(1, Math.ceil(cells / this.cellsX))
    this.cellCount = this.cellsX * this.cellsY
    this.data = new Float32Array(this.cellCount * 4)
    this.velocities = new Float32Array(this.cellCount * 2)
    this.initCells()

    const content = this.createContent()
    this.textures = [this.createTexture(this.data), this.createTexture(this.data)]
    this.currentIndex = 0
    this.uploadPending = false
    this.lastUploadAt = performance.now()
    this.lastUploadBytes = this.data.byteLength

    this.primitive = new MassDrawPrimitive({
      geometry: content.geometry,
      attributeLocations: content.attributeLocations,
      primitiveType: content.primitiveType,
      renderState: content.renderState,
      vertexShader: content.vertexShader,
      fragmentShader: content.fragmentShader,
      modelMatrix: this.originMatrix,
      uniformMap: {
        ...(content.uniformMap ?? {}),
        positionPrevTexture: () => this.textures[1 - this.currentIndex],
        positionCurrTexture: () => this.textures[this.currentIndex],
        u_mix: () => this.currentMix(),
        u_opacity: () => this.options.opacity
      },
      preExecute: () => this.flushUpload()
    })
    this.viewer.scene.primitives.add(this.primitive as unknown as object)
  }

  private createTexture(data: Float32Array): Texture {
    return new Texture({
      context: this.context,
      width: this.cellsX,
      height: this.cellsY,
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.FLOAT,
      flipY: false,
      sampler: new Sampler({
        minificationFilter: TextureMinificationFilter.NEAREST,
        magnificationFilter: TextureMagnificationFilter.NEAREST,
        wrapS: TextureWrap.CLAMP_TO_EDGE,
        wrapT: TextureWrap.CLAMP_TO_EDGE
      }),
      source: {
        width: this.cellsX,
        height: this.cellsY,
        arrayBufferView: data
      }
    })
  }

  protected currentMix(): number {
    if (this.options.paused) return 1
    const elapsed = (performance.now() - this.lastUploadAt) / this.options.interval
    return elapsed >= 1 ? 1 : elapsed
  }

  private flushUpload(): void {
    if (!this.uploadPending) return
    const nextIndex = 1 - this.currentIndex
    const texture = this.textures[nextIndex]
    if (texture && !texture.isDestroyed()) {
      texture.copyFrom({
        source: { width: this.cellsX, height: this.cellsY, arrayBufferView: this.data }
      })
      this.currentIndex = nextIndex
      this.lastUploadAt = performance.now()
      this.lastUploadBytes = this.data.byteLength
    }
    this.uploadPending = false
  }

  private tick(): void {
    if (this.destroyed || this.options.paused || !this.data) return
    const startedAt = performance.now()
    const half = this.halfExtent()
    const step = (this.options.interval / 1000) * this.options.speed
    const data = this.data
    const velocities = this.velocities
    for (let i = 0; i < this.cellCount; i++) {
      let x = data[i * 4] + velocities[i * 2] * step
      let y = data[i * 4 + 1] + velocities[i * 2 + 1] * step
      if (x < -half) {
        x = -half
        velocities[i * 2] = Math.abs(velocities[i * 2])
      } else if (x > half) {
        x = half
        velocities[i * 2] = -Math.abs(velocities[i * 2])
      }
      if (y < -half) {
        y = -half
        velocities[i * 2 + 1] = Math.abs(velocities[i * 2 + 1])
      } else if (y > half) {
        y = half
        velocities[i * 2 + 1] = -Math.abs(velocities[i * 2 + 1])
      }
      data[i * 4] = x
      data[i * 4 + 1] = y
    }
    this.lastTickDuration = performance.now() - startedAt
    this.uploadPending = true
  }

  private startInterval(): void {
    this.stopInterval()
    this.intervalTimer = setInterval(() => this.tick(), this.options.interval)
  }

  private stopInterval(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer)
      this.intervalTimer = undefined
    }
  }

  private startStatsLoop(): void {
    const loop = () => {
      if (this.destroyed) return
      const now = performance.now()
      this.fpsFrames += 1
      if (now - this.fpsLastSample >= 500) {
        this.fps = (this.fpsFrames * 1000) / (now - this.fpsLastSample)
        this.fpsFrames = 0
        this.fpsLastSample = now
        this.onStats?.({
          entityCount: this.entityCount(),
          fps: this.fps,
          tickMs: this.lastTickDuration,
          uploadBytes: this.lastUploadBytes,
          interval: this.options.interval
        })
      }
      this.rafId = requestAnimationFrame(loop)
    }
    this.fpsLastSample = performance.now()
    this.rafId = requestAnimationFrame(loop)
  }

  /** 更新动态参数，不重建几何与纹理 */
  setDynamic(options: Partial<Pick<DynamicMassBaseOptions, 'interval' | 'speed' | 'paused'>>): void {
    if (options.interval !== undefined && options.interval !== this.options.interval) {
      this.options.interval = options.interval
      this.startInterval()
    }
    if (options.speed !== undefined) {
      this.options.speed = options.speed
    }
    if (options.paused !== undefined) {
      this.options.paused = options.paused
      if (!options.paused) this.lastUploadAt = performance.now()
    }
  }

  setOpacity(opacity: number): void {
    this.options.opacity = opacity
  }

  /** 更新结构参数：重建几何与位置纹理 */
  rebuild(options: Partial<TOptions>): void {
    this.disposePrimitive()
    this.options = { ...this.options, ...options }
    this.build()
  }

  private disposePrimitive(): void {
    if (this.primitive) {
      if (!this.viewer.isDestroyed()) this.viewer.scene.primitives.remove(this.primitive as unknown as object)
      this.primitive.show = false
      this.primitive.destroy()
      this.primitive = undefined
    }
    this.textures.forEach((texture) => {
      if (!texture.isDestroyed()) texture.destroy()
    })
    this.textures = []
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.stopInterval()
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.rafId = 0
    this.disposePrimitive()
  }
}

/** 构造顶点色属性（归一化 UNSIGNED_BYTE） */
export function makeColorAttribute(colors: number[]): GeometryAttribute {
  return new GeometryAttribute({
    componentDatatype: ComponentDatatype.UNSIGNED_BYTE,
    componentsPerAttribute: 4,
    normalize: true,
    values: new Uint8Array(colors)
  })
}

export function makeFloatAttribute(values: number[], componentsPerAttribute: number): GeometryAttribute {
  return new GeometryAttribute({
    componentDatatype: ComponentDatatype.FLOAT,
    componentsPerAttribute,
    values: new Float32Array(values)
  })
}

export function makeAttributes(entries: Record<string, GeometryAttribute>): GeometryAttributes {
  const attributes = new GeometryAttributes() as GeometryAttributes & Record<string, GeometryAttribute | undefined>
  for (const [key, attribute] of Object.entries(entries)) attributes[key] = attribute
  return attributes
}

/** 标准 alpha 混合渲染状态（可选是否写入深度） */
export function createAlphaRenderState(depthMask = true): unknown {
  return {
    depthTest: { enabled: true },
    depthMask,
    cull: { enabled: false },
    blending: {
      enabled: true,
      equationRgb: WebGLRenderingContext.FUNC_ADD,
      equationAlpha: WebGLRenderingContext.FUNC_ADD,
      functionSourceRgb: WebGLRenderingContext.SRC_ALPHA,
      functionSourceAlpha: WebGLRenderingContext.SRC_ALPHA,
      functionDestinationRgb: WebGLRenderingContext.ONE_MINUS_SRC_ALPHA,
      functionDestinationAlpha: WebGLRenderingContext.ONE_MINUS_SRC_ALPHA
    }
  }
}
