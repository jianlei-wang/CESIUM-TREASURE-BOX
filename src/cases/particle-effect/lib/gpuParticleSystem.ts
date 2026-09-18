import {
  Cartesian2,
  Cartesian3,
  Cartesian4,
  Color,
  ComponentDatatype,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  Matrix4,
  PixelDatatype,
  PixelFormat,
  PrimitiveType,
  Sampler,
  ShaderSource,
  Texture,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  TextureWrap,
  Transforms,
  type Scene,
  type Viewer
} from 'cesium'
import CustomPrimitive from './customPrimitive'
import {
  updateVelocityShader,
  updatePositionShader,
  renderParticlesVertexShader,
  renderParticlesFragmentShader
} from './shaders'
import type { ParticleEffectOptions, ParticleSystemTextures } from './types'

export const DefaultParticleOptions: Partial<ParticleEffectOptions> = {
  size: 128,
  colors: ['#ffffff', '#ff8c00', '#ff0000'],
  blendMode: 'additive',
  lifetime: [1.5, 3.0],
  initialSpeed: [8, 20],
  coneAngle: 0.35,
  gravity: 2.0,
  drag: 0.5,
  turbulence: 4.0,
  lift: 0.0,
  emissionRate: 0.03,
  continuous: true,
  pointSize: [4, 9],
  pointGrowth: 3.0,
  emitterRadius: 1.0,
  heightScale: 1.0,
  initializer: 'emitter',
  emitAll: true,
  displayRange: [0, 40],
  style: 'fire',
  noiseScale: 1.0,
  noiseDetail: 6,
  cloudDensity: 1.0,
  smokeAmount: 1.0,
  cloudRadius: 0.3,
  edgeSoftness: 0.05,
  colorFrequency: 5.5
}

export class GpuParticleSystem {
  viewer: Viewer
  scene: Scene
  context: object
  options: ParticleEffectOptions
  textures!: ParticleSystemTextures
  colorTable!: Texture
  primitives!: {
    updateVelocity: CustomPrimitive
    updatePosition: CustomPrimitive
    render: CustomPrimitive
  }
  private _lastTime: number
  private _deltaTime: number
  private _seedTime: number
  private _destroyed = false
  private _show = true
  private _paused = false
  private _timeScale = 1
  private _simulationTime = 0
  private _emitterOrigin = new Cartesian3()
  private _east = new Cartesian3(1, 0, 0)
  private _north = new Cartesian3(0, 1, 0)
  private _up = new Cartesian3(0, 0, 1)

  constructor(viewer: Viewer, options: Partial<ParticleEffectOptions>) {
    this.viewer = viewer
    this.scene = viewer.scene
    this.context = (this.scene as unknown as { context: object }).context
    this.options = { ...DefaultParticleOptions, ...options } as ParticleEffectOptions
    this._lastTime = performance.now()
    this._deltaTime = 1 / 60
    this._seedTime = Math.random()

    this.updateEmitter(this.options.emitter)
    this.colorTable = this.createColorTableTexture()
    this.textures = this.createParticleTextures()
    this.primitives = this.createPrimitives()
    this.add()
  }

  get show(): boolean {
    return this._show
  }

  set show(value: boolean) {
    if (this._show === value) return
    this._show = value
    this.primitives.updateVelocity.show = value
    this.primitives.updatePosition.show = value
    this.primitives.render.show = value
    this.viewer.scene.requestRender()
  }

  setPaused(paused: boolean): void {
    this._paused = paused
    this._lastTime = performance.now()
    this.viewer.scene.requestRender()
  }

  setTimeScale(scale: number): void {
    this._timeScale = Math.max(0, scale)
  }

  get simulationTime(): number {
    return this._simulationTime
  }

  updateEmitter(emitter: ParticleEffectOptions['emitter']): void {
    this.options.emitter = emitter
    const origin = Cartesian3.fromDegrees(emitter.lon, emitter.lat, emitter.height)
    Cartesian3.clone(origin, this._emitterOrigin)
    const m = Transforms.eastNorthUpToFixedFrame(origin)
    const east = Matrix4.getColumn(m, 0, new Cartesian4())
    const north = Matrix4.getColumn(m, 1, new Cartesian4())
    const up = Matrix4.getColumn(m, 2, new Cartesian4())
    this._east = new Cartesian3(east.x, east.y, east.z)
    this._north = new Cartesian3(north.x, north.y, north.z)
    this._up = new Cartesian3(up.x, up.y, up.z)
  }

  createColorTableTexture(): Texture {
    const colorTableData = new Float32Array(
      this.options.colors.flatMap((color) => {
        const c = Color.fromCssColorString(color)
        return [c.red, c.green, c.blue, c.alpha]
      })
    )

    return new Texture({
      context: this.context,
      width: this.options.colors.length,
      height: 1,
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.FLOAT,
      sampler: new Sampler({
        minificationFilter: TextureMinificationFilter.LINEAR,
        magnificationFilter: TextureMagnificationFilter.LINEAR,
        wrapS: TextureWrap.CLAMP_TO_EDGE,
        wrapT: TextureWrap.CLAMP_TO_EDGE
      }),
      source: {
        width: this.options.colors.length,
        height: 1,
        arrayBufferView: colorTableData
      }
    })
  }

  createParticleData(): { position: Float32Array; velocity: Float32Array } {
    const size = this.options.size
    const total = size * size
    const { emitterRadius, coneAngle, initialSpeed, initializer, emitAll } = this.options

    const position = new Float32Array(total * 4)
    const velocity = new Float32Array(total * 4)

    for (let i = 0; i < total; i++) {
      if (initializer === 'sphere') {
        const z = 2 * Math.random() - 1
        const a = Math.random() * Math.PI * 2
        const r = Math.sqrt(Math.max(0, 1 - z * z))
        const speed = initialSpeed[0] + Math.random() * (initialSpeed[1] - initialSpeed[0])
        velocity[i * 4 + 0] = r * Math.cos(a) * speed
        velocity[i * 4 + 1] = r * Math.sin(a) * speed
        velocity[i * 4 + 2] = z * speed
      } else {
        const theta = Math.random() * coneAngle
        const phi = Math.random() * Math.PI * 2
        const speed = initialSpeed[0] + Math.random() * (initialSpeed[1] - initialSpeed[0])
        velocity[i * 4 + 0] = Math.sin(theta) * Math.cos(phi) * speed
        velocity[i * 4 + 1] = Math.sin(theta) * Math.sin(phi) * speed
        velocity[i * 4 + 2] = Math.cos(theta) * speed
      }
      velocity[i * 4 + 3] = Math.random()

      const rad = emitterRadius * Math.sqrt(Math.random())
      const ang = Math.random() * Math.PI * 2
      position[i * 4 + 0] = rad * Math.cos(ang)
      position[i * 4 + 1] = rad * Math.sin(ang)
      position[i * 4 + 2] = 0
      position[i * 4 + 3] = emitAll ? 1.0 : 0.0
    }

    return { position, velocity }
  }

  createParticleTextures(): ParticleSystemTextures {
    const size = this.options.size
    const { position, velocity } = this.createParticleData()

    const baseOptions = {
      context: this.context,
      width: size,
      height: size,
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.FLOAT,
      flipY: false,
      sampler: new Sampler({
        minificationFilter: TextureMinificationFilter.NEAREST,
        magnificationFilter: TextureMagnificationFilter.NEAREST
      })
    }

    return {
      currentPosition: new Texture({ ...baseOptions, source: { width: size, height: size, arrayBufferView: position } }),
      nextPosition: new Texture({ ...baseOptions, source: { width: size, height: size, arrayBufferView: position } }),
      currentVelocity: new Texture({ ...baseOptions, source: { width: size, height: size, arrayBufferView: velocity } }),
      nextVelocity: new Texture({ ...baseOptions, source: { width: size, height: size, arrayBufferView: velocity } })
    }
  }

  createGeometry(): Geometry {
    const size = this.options.size
    const st: number[] = []
    for (let s = 0; s < size; s++) {
      for (let t = 0; t < size; t++) {
        st.push(s / size)
        st.push(t / size)
      }
    }

    const attributes = new GeometryAttributes()
    attributes.st = new GeometryAttribute({
      componentDatatype: ComponentDatatype.FLOAT,
      componentsPerAttribute: 2,
      values: new Float32Array(st)
    })

    return new Geometry({
      attributes,
      primitiveType: PrimitiveType.POINTS
    })
  }

  createPrimitives() {
    const updateVelocity = new CustomPrimitive({
      commandType: 'Compute',
      uniformMap: {
        positionTexture: () => this.textures.currentPosition,
        velocityTexture: () => this.textures.currentVelocity,
        deltaTime: () => this._deltaTime,
        gravity: () => this.options.gravity,
        turbulence: () => this.options.turbulence,
        drag: () => this.options.drag,
        lift: () => this.options.lift,
        initialSpeed: () => new Cartesian2(this.options.initialSpeed[0], this.options.initialSpeed[1]),
        lifetime: () => new Cartesian2(this.options.lifetime[0], this.options.lifetime[1]),
        coneAngle: () => this.options.coneAngle,
        emissionRate: () => this.options.emissionRate,
        continuous: () => this._paused ? false : this.options.continuous,
        seedTime: () => this._seedTime
      },
      fragmentShaderSource: new ShaderSource({ sources: [updateVelocityShader] }),
      outputTexture: this.textures.nextVelocity
    })

    const updatePosition = new CustomPrimitive({
      commandType: 'Compute',
      uniformMap: {
        positionTexture: () => this.textures.currentPosition,
        velocityTexture: () => this.textures.nextVelocity,
        deltaTime: () => this._deltaTime,
        lifetime: () => new Cartesian2(this.options.lifetime[0], this.options.lifetime[1]),
        emitterRadius: () => this.options.emitterRadius,
        emissionRate: () => this.options.emissionRate,
        continuous: () => this.options.continuous,
        seedTime: () => this._seedTime
      },
      fragmentShaderSource: new ShaderSource({ sources: [updatePositionShader] }),
      outputTexture: this.textures.nextPosition
    })

    const render = new CustomPrimitive({
      commandType: 'Draw',
      attributeLocations: { st: 0 },
      geometry: this.createGeometry(),
      primitiveType: PrimitiveType.POINTS,
      uniformMap: {
        // 静态云团不提交计算命令，直接读取初始化状态纹理，避免读写同一帧缓冲纹理。
        positionTexture: () =>
          this.options.style === 'noise-cloud' ? this.textures.currentPosition : this.textures.nextPosition,
        velocityTexture: () =>
          this.options.style === 'noise-cloud' ? this.textures.currentVelocity : this.textures.nextVelocity,
        emitterOrigin: () => this._emitterOrigin,
        east: () => this._east,
        north: () => this._north,
        up: () => this._up,
        pointSize: () => this.options.pointSize[0],
        pointGrowth: () => this.options.pointGrowth,
        heightScale: () => this.options.heightScale,
        colorTable: () => this.colorTable,
        displayRange: () => new Cartesian2(this.options.displayRange[0], this.options.displayRange[1]),
        particleStyle: () => this.options.style === 'noise-cloud' ? 1 : 0,
        noiseScale: () => this.options.noiseScale,
        noiseDetail: () => this.options.noiseDetail,
        cloudDensity: () => this.options.cloudDensity,
        smokeAmount: () => this.options.smokeAmount,
        cloudRadius: () => this.options.cloudRadius,
        edgeSoftness: () => this.options.edgeSoftness,
        colorFrequency: () => this.options.colorFrequency,
        cloudTime: () => this._simulationTime
      },
      vertexShaderSource: new ShaderSource({ sources: [renderParticlesVertexShader] }),
      fragmentShaderSource: new ShaderSource({ sources: [renderParticlesFragmentShader] }),
      rawRenderState: this.createRawRenderState(this.options.blendMode)
    })

    render.preExecute = () => {
      if (this.options.style !== 'noise-cloud') return
      const now = performance.now()
      this._deltaTime = this._paused ? 0 : Math.min((now - this._lastTime) / 1000, 0.1) * this._timeScale
      this._lastTime = now
      this._simulationTime += this._deltaTime
    }

    updateVelocity.preExecute = () => {
      const now = performance.now()
      this._deltaTime = this._paused ? 0 : Math.min((now - this._lastTime) / 1000, 0.1) * this._timeScale
      this._lastTime = now
      this._simulationTime += this._deltaTime
      this._seedTime = Math.random()

      const tmpP = this.textures.currentPosition
      this.textures.currentPosition = this.textures.nextPosition
      this.textures.nextPosition = tmpP
      const tmpV = this.textures.currentVelocity
      this.textures.currentVelocity = this.textures.nextVelocity
      this.textures.nextVelocity = tmpV

      if (updateVelocity.commandToExecute) {
        ;(updateVelocity.commandToExecute as { outputTexture: Texture }).outputTexture = this.textures.nextVelocity
      }
      if (updatePosition.commandToExecute) {
        ;(updatePosition.commandToExecute as { outputTexture: Texture }).outputTexture = this.textures.nextPosition
      }
    }

    return { updateVelocity, updatePosition, render }
  }

  createRawRenderState(blendMode: ParticleEffectOptions['blendMode']): unknown {
    const isAdditive = blendMode === 'additive'
    return {
      depthTest: { enabled: true },
      depthMask: false,
      blending: {
        enabled: true,
        blendEquation: WebGLRenderingContext.FUNC_ADD,
        blendFuncSource: WebGLRenderingContext.SRC_ALPHA,
        blendFuncDestination: isAdditive
          ? WebGLRenderingContext.ONE
          : WebGLRenderingContext.ONE_MINUS_SRC_ALPHA
      }
    }
  }

  updateOptions(options: Partial<ParticleEffectOptions>): void {
    const sizeChanged =
      typeof options.size === 'number' && options.size !== this.options.size
    const colorsChanged = options.colors !== undefined && options.colors !== this.options.colors
    const prevEmitter = this.options.emitter
    this.options = { ...this.options, ...options } as ParticleEffectOptions
    if (options.emitter) this.updateEmitter(options.emitter)
    if (sizeChanged) {
      Object.values(this.textures).forEach((texture) => texture.destroy())
      this.textures = this.createParticleTextures()
      if (this.primitives.updateVelocity.commandToExecute) {
        ;(this.primitives.updateVelocity.commandToExecute as { outputTexture: Texture }).outputTexture =
          this.textures.nextVelocity
      }
      if (this.primitives.updatePosition.commandToExecute) {
        ;(this.primitives.updatePosition.commandToExecute as { outputTexture: Texture }).outputTexture =
          this.textures.nextPosition
      }
      this.primitives.render.setGeometry(this.context, this.createGeometry())
    }
    if (colorsChanged) {
      this.colorTable.destroy()
      this.colorTable = this.createColorTableTexture()
    }
    if (options.emitter && options.emitter !== prevEmitter) {
      this.viewer.scene.camera.flyTo({
        destination: Cartesian3.fromDegrees(
          this.options.emitter.lon,
          this.options.emitter.lat,
          this.options.emitter.height + 1200
        )
      })
    }
    this.viewer.scene.requestRender()
  }

  restart(): void {
    if (this._destroyed) return
    Object.values(this.textures).forEach((texture) => texture.destroy())
    this.textures = this.createParticleTextures()
    this._simulationTime = 0
    if (this.primitives.updateVelocity.commandToExecute) {
      ;(this.primitives.updateVelocity.commandToExecute as { outputTexture: Texture }).outputTexture =
        this.textures.nextVelocity
    }
    if (this.primitives.updatePosition.commandToExecute) {
      ;(this.primitives.updatePosition.commandToExecute as { outputTexture: Texture }).outputTexture =
        this.textures.nextPosition
    }
    this.viewer.scene.requestRender()
  }

  add(): void {
    if (this.options.style !== 'noise-cloud') {
      this.scene.primitives.add(this.primitives.updateVelocity)
      this.scene.primitives.add(this.primitives.updatePosition)
    }
    this.scene.primitives.add(this.primitives.render)
  }

  remove(): void {
    if (this.options.style !== 'noise-cloud') {
      this.scene.primitives.remove(this.primitives.updateVelocity)
      this.scene.primitives.remove(this.primitives.updatePosition)
    }
    this.scene.primitives.remove(this.primitives.render)
  }

  destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    this.remove()
    Object.values(this.textures).forEach((texture) => texture.destroy())
    this.colorTable.destroy()
    this.primitives.updateVelocity.destroy()
    this.primitives.updatePosition.destroy()
    this.primitives.render.destroy()
  }
}

export default GpuParticleSystem
