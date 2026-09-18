import {
  BlendEquation,
  BlendFunction,
  BufferUsage,
  Cartesian2,
  Cartesian3,
  Cartographic,
  ClearCommand,
  Color,
  ComputeCommand,
  CullFace,
  defined,
  destroyObject,
  DrawCommand,
  EllipsoidGeodesic,
  Pass,
  PixelDatatype,
  PixelFormat,
  PrimitiveType,
  Rectangle,
  RenderState,
  Sampler,
  ShaderProgram,
  ShaderSource,
  Texture,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  TextureWrap,
  VertexArray,
  Math as CesiumMath,
  type Entity,
  type Viewer
} from 'cesium'
import {
  BUFFER_A_SHADER,
  BUFFER_B_SHADER,
  BUFFER_C_SHADER,
  BUFFER_D_SHADER,
  COMMAND_SHADER,
  RENDER_SHADER,
  generateModelMatrix,
  getBoxGeometry,
  getFullscreenQuad,
  type Extent
} from './shaders'

export type RenderContext = object
export type FrameStateLike = { commandList: unknown[]; context: RenderContext }

export type SimParams = {
  waterAddRate: number
  waterSourceRadius: number
  attenuation: number
  strenght: number
  minTotalFlow: number
  initialWaterLevel: number
  depth: number
  evaporationRate: number
  waterAlpha: number
  shallow: Color
  deep: Color
  gradientDepth: number
  minElevation: number
  maxElevation: number
  damHeight: number
  setDam: boolean
  waterSource: Cartesian2
  damStart: Cartesian2
  damEnd: Cartesian2
}

export type CustomPrimitiveOptions = {
  commandType: 'Compute' | 'Draw'
  geometry: ReturnType<typeof getFullscreenQuad>
  attributeLocations?: Record<string, number>
  primitiveType?: unknown
  uniformMap: Record<string, () => unknown>
  vertexShaderSource?: ShaderSource
  fragmentShaderSource: ShaderSource
  outputTexture?: Texture
  autoClear?: boolean
  preExecute?: () => void
  modelMatrix?: unknown
}

export class CustomPrimitive {
  commandType: 'Compute' | 'Draw'
  geometry: ReturnType<typeof getFullscreenQuad>
  attributeLocations: Record<string, number> | undefined
  primitiveType: unknown
  uniformMap: Record<string, () => unknown>
  vertexShaderSource: ShaderSource | undefined
  fragmentShaderSource: ShaderSource
  outputTexture: Texture | undefined
  autoClear: boolean
  preExecute: (() => void) | undefined
  modelMatrix: unknown
  show = true
  commandToExecute: ComputeCommand | DrawCommand | undefined
  clearCommand: ClearCommand | undefined

  constructor(options: CustomPrimitiveOptions) {
    this.commandType = options.commandType
    this.geometry = options.geometry
    this.attributeLocations = options.attributeLocations
    this.primitiveType = options.primitiveType
    this.uniformMap = options.uniformMap
    this.vertexShaderSource = options.vertexShaderSource
    this.fragmentShaderSource = options.fragmentShaderSource
    this.outputTexture = options.outputTexture
    this.autoClear = defined(options.autoClear) ? (options.autoClear as boolean) : false
    this.preExecute = options.preExecute
    this.modelMatrix = defined(options.modelMatrix)
      ? (options.modelMatrix as object)
      : undefined
    if (this.autoClear) {
      this.clearCommand = new ClearCommand({
        color: new Color(0.0, 0.0, 0.0, 0.0),
        depth: 1.0,
        pass: Pass.OPAQUE
      })
    }
  }

  createCommand(context: RenderContext): ComputeCommand | DrawCommand {
    if (this.commandType === 'Draw') {
      const vertexArray = VertexArray.fromGeometry({
        context,
        geometry: this.geometry,
        attributeLocations: this.attributeLocations,
        bufferUsage: BufferUsage.STATIC_DRAW
      })
      const shaderProgram = ShaderProgram.fromCache({
        context,
        attributeLocations: this.attributeLocations,
        vertexShaderSource: this.vertexShaderSource,
        fragmentShaderSource: this.fragmentShaderSource
      })
      const renderState = RenderState.fromCache({
        cull: { enabled: true, face: CullFace.BACK },
        blending: {
          enabled: true,
          equationRgb: BlendEquation.ADD,
          equationAlpha: BlendEquation.ADD,
          functionSourceRgb: BlendFunction.SOURCE_ALPHA,
          functionSourceAlpha: BlendFunction.ONE,
          functionDestinationRgb: BlendFunction.ONE_MINUS_SOURCE_ALPHA,
          functionDestinationAlpha: BlendFunction.ONE_MINUS_SOURCE_ALPHA
        },
        depthTest: { enabled: true }
      })
      return new DrawCommand({
        owner: this,
        vertexArray,
        primitiveType: this.primitiveType as never,
        uniformMap: this.uniformMap,
        modelMatrix: this.modelMatrix as never,
        shaderProgram,
        framebuffer: undefined,
        renderState,
        pass: Pass.OPAQUE
      })
    }
    return new ComputeCommand({
      owner: this,
      fragmentShaderSource: this.fragmentShaderSource,
      uniformMap: this.uniformMap,
      outputTexture: this.outputTexture,
      persists: true
    })
  }

  update(frameState: FrameStateLike): void {
    if (!this.show) return
    if (!defined(this.commandToExecute)) {
      this.commandToExecute = this.createCommand(frameState.context)
    }
    if (defined(this.preExecute)) {
      this.preExecute?.()
    }
    if (defined(this.clearCommand)) {
      frameState.commandList.push(this.clearCommand as never)
    }
    frameState.commandList.push(this.commandToExecute as never)
  }

  isDestroyed(): boolean {
    return false
  }

  destroy(): void {
    if (defined(this.commandToExecute) && this.commandToExecute instanceof DrawCommand) {
      const sp = this.commandToExecute.shaderProgram
      if (defined(sp)) {
        ;(sp as unknown as { destroy: () => void }).destroy()
      }
    }
    return destroyObject(this) as never
  }
}

export class FluidDemo {
  viewer: Viewer
  opts: SimParams
  extent: Extent
  width = 1024
  height = 1024
  relativeToZ: number
  thickness: number
  image: HTMLImageElement | HTMLCanvasElement
  resolution: Cartesian2
  waterPos: Cartesian2
  time = 1.0
  frame = 0
  textures: Texture[] = []
  outlineOnly: Entity | undefined
  blueWall: Entity | undefined
  Buffer_A: CustomPrimitive | undefined
  Buffer_B: CustomPrimitive | undefined
  Buffer_C: CustomPrimitive | undefined
  Buffer_D: CustomPrimitive | undefined
  fluidCommand: CustomPrimitive | undefined

  constructor(
    viewer: Viewer,
    options: SimParams,
    image: HTMLImageElement | HTMLCanvasElement,
    extent: Extent
  ) {
    this.viewer = viewer
    this.opts = options
    this.extent = extent
    this.relativeToZ = (options.maxElevation - options.minElevation) / 2 + options.minElevation
    this.thickness = options.maxElevation - options.minElevation
    this.image = image
    this.resolution = new Cartesian2(this.width, this.height)
    this.waterPos = options.waterSource
    this.initShaderToy()
  }

  setWaterPos(pos: Cartesian2): void {
    this.waterPos = pos
  }

  initShaderToy(): void {
    const context = (this.viewer.scene as unknown as { context: RenderContext }).context
    const createFloatTexture = (): Texture => {
      const tex = new Texture({
        context,
        width: this.width,
        height: this.height,
        pixelFormat: PixelFormat.RGBA,
        pixelDatatype: PixelDatatype.FLOAT,
        source: { arrayBufferView: new Float32Array(this.width * this.height * 4) }
      })
      this.textures.push(tex)
      return tex
    }
    const texA = createFloatTexture()
    const texB = createFloatTexture()
    const texC = createFloatTexture()
    const texD = createFloatTexture()

    const quadGeometry = getFullscreenQuad()

    const heightMap = new Texture({
      context,
      width: this.width,
      height: this.height,
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
      flipY: false,
      sampler: new Sampler({
        minificationFilter: TextureMinificationFilter.LINEAR,
        magnificationFilter: TextureMagnificationFilter.LINEAR,
        wrapS: TextureWrap.REPEAT,
        wrapT: TextureWrap.REPEAT
      }),
      source: this.image as unknown as never
    })
    this.textures.push(heightMap)

    const self = this
    this.Buffer_A = new CustomPrimitive({
      commandType: 'Compute',
      uniformMap: {
        iTime: () => self.time,
        iFrame: () => self.frame,
        resolution: () => self.resolution,
        iChannel0: () => texC,
        iChannel1: () => texD,
        heightMap: () => heightMap,
        waterSource: () => self.waterPos,
        waterAddRate: () => self.opts.waterAddRate,
        waterSourceRadius: () => self.opts.waterSourceRadius,
        initialWaterLevel: () => self.opts.initialWaterLevel,
        damStart: () => self.opts.damStart,
        damEnd: () => self.opts.damEnd,
        damHeight: () => self.opts.damHeight,
        evaporationRate: () => self.opts.evaporationRate
      },
      fragmentShaderSource: new ShaderSource({
        sources: [COMMAND_SHADER, BUFFER_A_SHADER]
      }),
      geometry: quadGeometry,
      outputTexture: texA,
      preExecute: () => {
        if (self.Buffer_A && self.Buffer_A.commandToExecute instanceof ComputeCommand) {
          self.Buffer_A.commandToExecute.outputTexture = texA
        }
      }
    })

    this.Buffer_B = new CustomPrimitive({
      commandType: 'Compute',
      uniformMap: {
        iTime: () => self.time,
        iFrame: () => self.frame,
        resolution: () => self.resolution,
        iChannel0: () => texA,
        iChannel1: () => texD,
        waterSource: () => self.waterPos,
        waterSourceRadius: () => self.opts.waterSourceRadius,
        attenuation: () => self.opts.attenuation,
        strenght: () => self.opts.strenght,
        minTotalFlow: () => self.opts.minTotalFlow
      },
      fragmentShaderSource: new ShaderSource({
        sources: [COMMAND_SHADER, BUFFER_B_SHADER]
      }),
      geometry: quadGeometry,
      outputTexture: texB,
      preExecute: () => {
        if (self.Buffer_B && self.Buffer_B.commandToExecute instanceof ComputeCommand) {
          self.Buffer_B.commandToExecute.outputTexture = texB
        }
      }
    })

    this.Buffer_C = new CustomPrimitive({
      commandType: 'Compute',
      uniformMap: {
        iTime: () => self.time,
        iFrame: () => self.frame,
        resolution: () => self.resolution,
        iChannel0: () => texA,
        iChannel1: () => texB,
        waterSource: () => self.waterPos,
        waterAddRate: () => self.opts.waterAddRate,
        waterSourceRadius: () => self.opts.waterSourceRadius,
        initialWaterLevel: () => self.opts.initialWaterLevel,
        evaporationRate: () => self.opts.evaporationRate
      },
      fragmentShaderSource: new ShaderSource({
        sources: [COMMAND_SHADER, BUFFER_C_SHADER]
      }),
      geometry: quadGeometry,
      outputTexture: texC,
      preExecute: () => {
        if (self.Buffer_C && self.Buffer_C.commandToExecute instanceof ComputeCommand) {
          self.Buffer_C.commandToExecute.outputTexture = texC
        }
      }
    })

    this.Buffer_D = new CustomPrimitive({
      commandType: 'Compute',
      uniformMap: {
        iTime: () => self.time,
        iFrame: () => self.frame,
        resolution: () => self.resolution,
        iChannel0: () => texC,
        iChannel1: () => texB,
        waterSource: () => self.waterPos,
        waterSourceRadius: () => self.opts.waterSourceRadius,
        attenuation: () => self.opts.attenuation,
        strenght: () => self.opts.strenght,
        minTotalFlow: () => self.opts.minTotalFlow
      },
      fragmentShaderSource: new ShaderSource({
        sources: [COMMAND_SHADER, BUFFER_D_SHADER]
      }),
      geometry: quadGeometry,
      outputTexture: texD,
      preExecute: () => {
        if (self.Buffer_D && self.Buffer_D.commandToExecute instanceof ComputeCommand) {
          self.Buffer_D.commandToExecute.outputTexture = texD
        }
      }
    })

    const [west, south, east, north] = this.extent
    const rectangle = Rectangle.fromDegrees(west, south, east, north)
    const center = Rectangle.center(rectangle)

    const verticalGeodesic = new EllipsoidGeodesic(
      new Cartographic(center.longitude, rectangle.south),
      new Cartographic(center.longitude, rectangle.north)
    )
    const boxHeight = verticalGeodesic.surfaceDistance

    const horizontalGeodesic = new EllipsoidGeodesic(
      new Cartographic(rectangle.west, center.latitude),
      new Cartographic(rectangle.east, center.latitude)
    )
    const boxWidth = horizontalGeodesic.surfaceDistance

    const centerLongitude = CesiumMath.toDegrees(center.longitude)
    const centerLatitude = CesiumMath.toDegrees(center.latitude)
    const modelMatrix = generateModelMatrix(
      [centerLongitude, centerLatitude, this.relativeToZ],
      [90, 0, 0],
      [boxWidth, this.thickness, boxHeight]
    )

    this.outlineOnly = this.viewer.entities.add({
      name: 'Flood simulation extent',
      position: Cartesian3.fromDegrees(centerLongitude, centerLatitude, this.relativeToZ),
      box: {
        dimensions: new Cartesian3(boxWidth, boxHeight, this.thickness),
        fill: false,
        outline: true,
        outlineColor: Color.YELLOW
      }
    })

    const geometry = getBoxGeometry()
    const attributeLocations: Record<string, number> = { position: 0, st: 1 }

    this.fluidCommand = new CustomPrimitive({
      commandType: 'Draw',
      uniformMap: {
        iTime: () => self.time,
        iFrame: () => self.frame,
        iResolution: () => self.resolution,
        iChannel0: () => texC,
        waterSource: () => self.waterPos,
        depth: () => self.opts.depth,
        shallow: () => self.opts.shallow,
        deep: () => self.opts.deep,
        gradientDepth: () => self.opts.gradientDepth,
        waterAlpha: () => self.opts.waterAlpha,
        damStart: () => self.opts.damStart,
        damEnd: () => self.opts.damEnd,
        damHeight: () => self.opts.damHeight
      },
      geometry,
      modelMatrix,
      attributeLocations,
      primitiveType: PrimitiveType.TRIANGLES as never,
      vertexShaderSource: new ShaderSource({
        sources: [
          `
in vec3 position;
in vec2 st;

out vec3 vo;
out vec3 vd;
out vec2 v_st;
void main()
{
    vo = czm_encodedCameraPositionMCHigh + czm_encodedCameraPositionMCLow;
    vd = position - vo;
    v_st = st;
    gl_Position = czm_modelViewProjection * vec4(position,1.0);
}
`
        ]
      }),
      fragmentShaderSource: new ShaderSource({
        sources: [COMMAND_SHADER, RENDER_SHADER]
      })
    })

    this.viewer.scene.postRender.addEventListener(this.onPostRender)
    this.viewer.scene.primitives.add(this.Buffer_A)
    this.viewer.scene.primitives.add(this.Buffer_B)
    this.viewer.scene.primitives.add(this.Buffer_C)
    this.viewer.scene.primitives.add(this.Buffer_D)
    this.viewer.scene.primitives.add(this.fluidCommand)
  }

  onPostRender = (): void => {
    this.time = performance.now() / 1000
    this.frame += 1
  }

  destroy(): void {
    if (!this.viewer.isDestroyed()) {
      this.viewer.scene.postRender.removeEventListener(this.onPostRender)
      if (this.fluidCommand) this.viewer.scene.primitives.remove(this.fluidCommand)
      if (this.Buffer_D) this.viewer.scene.primitives.remove(this.Buffer_D)
      if (this.Buffer_C) this.viewer.scene.primitives.remove(this.Buffer_C)
      if (this.Buffer_B) this.viewer.scene.primitives.remove(this.Buffer_B)
      if (this.Buffer_A) this.viewer.scene.primitives.remove(this.Buffer_A)
      if (this.outlineOnly) this.viewer.entities.remove(this.outlineOnly)
      if (this.blueWall) this.viewer.entities.remove(this.blueWall)
    }
    for (const tex of this.textures) {
      if (!tex.isDestroyed()) tex.destroy()
    }
    this.textures = []
    this.Buffer_A = undefined
    this.Buffer_B = undefined
    this.Buffer_C = undefined
    this.Buffer_D = undefined
    this.fluidCommand = undefined
    this.outlineOnly = undefined
    this.blueWall = undefined
  }
}
