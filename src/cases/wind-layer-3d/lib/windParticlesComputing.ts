import {
  Cartesian2,
  FrameRateMonitor,
  PixelDatatype,
  PixelFormat,
  Sampler,
  Texture,
  Texture3D,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  TextureWrap,
  type Scene
} from 'cesium'
import { ShaderManager } from './shaderManager'
import CustomPrimitive from './customPrimitive'
import { deepMerge } from './utils'
import type { ViewerParameters, WindData3D, WindLayerOptions } from './types'

type ParticlesTextures = {
  previousParticlesPosition: Texture
  currentParticlesPosition: Texture
  nextParticlesPosition: Texture
  postProcessingPosition: Texture
  particlesSpeed: Texture
}

type ComputingPrimitives = {
  calculateSpeed: CustomPrimitive
  updatePosition: CustomPrimitive
  postProcessingPosition: CustomPrimitive
}

export class WindParticlesComputing {
  context: object
  options: WindLayerOptions
  viewerParameters: ViewerParameters
  windData: WindData3D
  frameRate: number
  frameRateAdjustment: number
  frameRateMonitor: FrameRateMonitor
  windTexture?: Texture3D
  particlesTextures!: ParticlesTextures
  primitives!: ComputingPrimitives
  private _destroyed = false
  private _frameRateTimer?: ReturnType<typeof setInterval>

  constructor(context: object, windData: WindData3D, options: WindLayerOptions, viewerParameters: ViewerParameters, scene: Scene) {
    this.context = context
    this.options = options
    this.viewerParameters = viewerParameters
    this.windData = windData

    this.frameRate = 60
    this.frameRateAdjustment = 1

    this.frameRateMonitor = new FrameRateMonitor({
      scene,
      samplingWindow: 1.0,
      quietPeriod: 0.0
    })
    this.initFrameRate()
    this.createWindTexture()
    this.createParticlesTextures()
    this.createComputingPrimitives()
  }

  initFrameRate(): void {
    const updateFrameRate = () => {
      if (this._destroyed) return
      if (this.frameRateMonitor.lastFramesPerSecond > 20) {
        this.frameRate = this.frameRateMonitor.lastFramesPerSecond
        this.frameRateAdjustment = 60 / Math.max(this.frameRate, 1)
      }
    }

    updateFrameRate()

    const intervalId = setInterval(updateFrameRate, 1000)
    this._frameRateTimer = intervalId
  }

  createWindTexture(): void {
    const { nx, ny, nz, u, v, w } = this.windData
    const total = nx * ny * nz
    const data = new Float32Array(total * 4)
    for (let i = 0; i < total; i++) {
      data[i * 4 + 0] = u.array[i]
      data[i * 4 + 1] = v.array[i]
      data[i * 4 + 2] = w.array[i]
      data[i * 4 + 3] = 0.0
    }

    this.windTexture = new Texture3D({
      context: this.context,
      width: nx,
      height: ny,
      depth: nz,
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.FLOAT,
      flipY: this.options.flipY ?? false,
      sampler: new Sampler({
        minificationFilter: TextureMinificationFilter.LINEAR,
        magnificationFilter: TextureMagnificationFilter.LINEAR,
        wrapS: TextureWrap.CLAMP_TO_EDGE,
        wrapT: TextureWrap.CLAMP_TO_EDGE,
        wrapR: TextureWrap.CLAMP_TO_EDGE
      }),
      source: {
        width: nx,
        height: ny,
        depth: nz,
        arrayBufferView: data
      }
    })
  }

  createParticlesTextures(): void {
    const size = this.options.particlesTextureSize
    const total = size * size

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

    const randomData = this.createRandomParticlesData()
    const zeroData = new Float32Array(total * 4)

    this.particlesTextures = {
      previousParticlesPosition: new Texture({ ...baseOptions, source: { arrayBufferView: randomData } }),
      currentParticlesPosition: new Texture({ ...baseOptions, source: { arrayBufferView: randomData } }),
      nextParticlesPosition: new Texture({ ...baseOptions, source: { arrayBufferView: zeroData } }),
      postProcessingPosition: new Texture({ ...baseOptions, source: { arrayBufferView: randomData } }),
      particlesSpeed: new Texture({ ...baseOptions, source: { arrayBufferView: zeroData } })
    }
  }

  createRandomParticlesData(): Float32Array {
    const size = this.options.particlesTextureSize
    const { bounds } = this.windData
    const data = new Float32Array(size * size * 4)
    const lonSpan = bounds.east - bounds.west
    const latSpan = bounds.north - bounds.south

    for (let i = 0; i < size * size; i++) {
      data[i * 4 + 0] = bounds.west + Math.random() * lonSpan
      data[i * 4 + 1] = bounds.south + Math.random() * latSpan
      data[i * 4 + 2] = Math.random()
      data[i * 4 + 3] = 1.0
    }
    return data
  }

  destroyParticlesTextures(): void {
    Object.values(this.particlesTextures).forEach((texture) => texture.destroy())
  }

  createComputingPrimitives(): void {
    const windData = this.windData
    this.primitives = {
      calculateSpeed: new CustomPrimitive({
        commandType: 'Compute',
        uniformMap: {
          windTexture: () => this.windTexture,
          currentParticlesPosition: () => this.particlesTextures.currentParticlesPosition,
          minimum: () => new Cartesian2(windData.bounds.west, windData.bounds.south),
          maximum: () => new Cartesian2(windData.bounds.east, windData.bounds.north),
          minHeight: () => windData.levels[0],
          maxHeight: () => windData.levels[windData.levels.length - 1],
          speedRange: () => new Cartesian2(windData.speed!.min, windData.speed!.max),
          speedScaleFactor: () => (this.viewerParameters.pixelSize + 50) * this.options.speedFactor,
          frameRateAdjustment: () => this.frameRateAdjustment
        },
        fragmentShaderSource: ShaderManager.getCalculateSpeedShader(),
        outputTexture: this.particlesTextures.particlesSpeed,
        preExecute: () => {
          const temp = this.particlesTextures.previousParticlesPosition
          this.particlesTextures.previousParticlesPosition = this.particlesTextures.currentParticlesPosition
          this.particlesTextures.currentParticlesPosition = this.particlesTextures.postProcessingPosition
          this.particlesTextures.postProcessingPosition = temp
          if (this.primitives.calculateSpeed.commandToExecute) {
            ;(this.primitives.calculateSpeed.commandToExecute as { outputTexture?: object }).outputTexture =
              this.particlesTextures.particlesSpeed
          }
        },
        isDynamic: () => this.options.dynamic
      }),

      updatePosition: new CustomPrimitive({
        commandType: 'Compute',
        uniformMap: {
          currentParticlesPosition: () => this.particlesTextures.currentParticlesPosition,
          particlesSpeed: () => this.particlesTextures.particlesSpeed
        },
        fragmentShaderSource: ShaderManager.getUpdatePositionShader(),
        outputTexture: this.particlesTextures.nextParticlesPosition,
        preExecute: () => {
          if (this.primitives.updatePosition.commandToExecute) {
            ;(this.primitives.updatePosition.commandToExecute as { outputTexture?: object }).outputTexture =
              this.particlesTextures.nextParticlesPosition
          }
        },
        isDynamic: () => this.options.dynamic
      }),

      postProcessingPosition: new CustomPrimitive({
        commandType: 'Compute',
        uniformMap: {
          nextParticlesPosition: () => this.particlesTextures.nextParticlesPosition,
          particlesSpeed: () => this.particlesTextures.particlesSpeed,
          lonRange: () => this.viewerParameters.lonRange,
          latRange: () => this.viewerParameters.latRange,
          dataLonRange: () => new Cartesian2(windData.bounds.west, windData.bounds.east),
          dataLatRange: () => new Cartesian2(windData.bounds.south, windData.bounds.north),
          speedRange: () => new Cartesian2(windData.speed!.min, windData.speed!.max),
          randomCoefficient: () => Math.random(),
          dropRate: () => this.options.dropRate,
          dropRateBump: () => this.options.dropRateBump,
          useViewerBounds: () => this.options.useViewerBounds
        },
        fragmentShaderSource: ShaderManager.getPostProcessingPositionShader(),
        outputTexture: this.particlesTextures.postProcessingPosition,
        preExecute: () => {
          if (this.primitives.postProcessingPosition.commandToExecute) {
            ;(this.primitives.postProcessingPosition.commandToExecute as { outputTexture?: object }).outputTexture =
              this.particlesTextures.postProcessingPosition
          }
        },
        isDynamic: () => this.options.dynamic
      })
    }
  }

  reCreateWindTexture(): void {
    this.windTexture?.destroy()
    this.createWindTexture()
  }

  updateWindData(data: WindData3D): void {
    this.windData = data
    this.reCreateWindTexture()
  }

  updateOptions(options: Partial<WindLayerOptions>): void {
    const needUpdateWindTexture =
      options.flipY !== undefined && options.flipY !== this.options.flipY
    this.options = deepMerge(options, this.options)
    if (needUpdateWindTexture) {
      this.reCreateWindTexture()
    }
  }

  destroy(): void {
    this._destroyed = true
    if (this._frameRateTimer) {
      clearInterval(this._frameRateTimer)
      this._frameRateTimer = undefined
    }
    if (this.windTexture) this.windTexture.destroy()
    Object.values(this.particlesTextures).forEach((texture) => texture.destroy())
    Object.values(this.primitives).forEach((primitive) => primitive.destroy())
    this.frameRateMonitor.destroy()
  }
}
