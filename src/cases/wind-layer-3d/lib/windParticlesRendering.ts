import {
  Appearance,
  BufferUsage,
  Cartesian2,
  Color,
  ComponentDatatype,
  Framebuffer,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  PixelDatatype,
  PixelFormat,
  PrimitiveType,
  Sampler,
  SceneMode,
  Texture,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  TextureWrap,
  VertexArray
} from 'cesium'
import CustomPrimitive from './customPrimitive'
import { ShaderManager } from './shaderManager'
import { deepMerge } from './utils'
import type { ViewerParameters, WindData3D, WindLayerOptions } from './types'
import type { WindParticlesComputing } from './windParticlesComputing'

type RenderingTextures = {
  segmentsColor: Texture
  segmentsDepth: Texture
}

type RenderingFramebuffers = {
  segments: Framebuffer
}

type RenderingPrimitives = {
  segments: CustomPrimitive
}

export class WindParticlesRendering {
  context: object
  options: WindLayerOptions
  viewerParameters: ViewerParameters
  computing: WindParticlesComputing
  colorTable: Texture
  textures: RenderingTextures
  framebuffers: RenderingFramebuffers
  primitives: RenderingPrimitives

  constructor(context: object, options: WindLayerOptions, viewerParameters: ViewerParameters, computing: WindParticlesComputing) {
    this.context = context
    this.options = options
    this.viewerParameters = viewerParameters
    this.computing = computing

    if (typeof this.options.particlesTextureSize !== 'number' || this.options.particlesTextureSize <= 0) {
      console.error('Invalid particlesTextureSize. Using default value of 256.')
      this.options.particlesTextureSize = 256
    }

    this.colorTable = this.createColorTableTexture()
    this.textures = this.createRenderingTextures()
    this.framebuffers = this.createRenderingFramebuffers()
    this.primitives = this.createPrimitives()
  }

  createRenderingTextures(): RenderingTextures {
    const colorTextureOptions = {
      context: this.context,
      width: (this.context as { drawingBufferWidth: number }).drawingBufferWidth,
      height: (this.context as { drawingBufferHeight: number }).drawingBufferHeight,
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.UNSIGNED_BYTE
    }
    const depthTextureOptions = {
      context: this.context,
      width: (this.context as { drawingBufferWidth: number }).drawingBufferWidth,
      height: (this.context as { drawingBufferHeight: number }).drawingBufferHeight,
      pixelFormat: PixelFormat.DEPTH_COMPONENT,
      pixelDatatype: PixelDatatype.UNSIGNED_INT
    }

    return {
      segmentsColor: new Texture(colorTextureOptions),
      segmentsDepth: new Texture(depthTextureOptions)
    }
  }

  createRenderingFramebuffers(): RenderingFramebuffers {
    return {
      segments: new Framebuffer({
        context: this.context,
        colorTextures: [this.textures.segmentsColor],
        depthTexture: this.textures.segmentsDepth
      })
    }
  }

  destroyRenderingFramebuffers(): void {
    Object.values(this.framebuffers).forEach((framebuffer) => framebuffer.destroy())
  }

  createColorTableTexture(): Texture {
    const colorTableData = new Float32Array(
      this.options.colors.flatMap((color) => {
        const cesiumColor = Color.fromCssColorString(color)
        return [cesiumColor.red, cesiumColor.green, cesiumColor.blue, cesiumColor.alpha]
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

  createSegmentsGeometry(): Geometry {
    const repeatVertex = 4
    const textureSize = this.options.particlesTextureSize

    let st: number[] = []
    for (let s = 0; s < textureSize; s++) {
      for (let t = 0; t < textureSize; t++) {
        for (let i = 0; i < repeatVertex; i++) {
          st.push(s / textureSize)
          st.push(t / textureSize)
        }
      }
    }
    const stArray = new Float32Array(st)

    const particlesCount = this.options.particlesTextureSize ** 2

    let normal: number[] = []
    for (let i = 0; i < particlesCount; i++) {
      normal.push(-1, -1, 0, -1, 1, 0, 1, -1, 0, 1, 1, 0)
    }
    const normalArray = new Float32Array(normal)

    let vertexIndexes: number[] = []
    for (let i = 0, vertex = 0; i < particlesCount; i++) {
      vertexIndexes.push(vertex + 0, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3)
      vertex += repeatVertex
    }
    const indexArray = new Uint32Array(vertexIndexes)

    const attributes = new GeometryAttributes()
    attributes.st = new GeometryAttribute({
      componentDatatype: ComponentDatatype.FLOAT,
      componentsPerAttribute: 2,
      values: stArray
    })
    attributes.normal = new GeometryAttribute({
      componentDatatype: ComponentDatatype.FLOAT,
      componentsPerAttribute: 3,
      values: normalArray
    })

    return new Geometry({
      attributes,
      indices: indexArray
    })
  }

  createRawRenderState(options: Record<string, unknown>): unknown {
    return Appearance.getDefaultRenderState(true, false, {
      viewport: undefined,
      depthTest: undefined,
      depthMask: undefined,
      blending: undefined,
      ...options
    })
  }

  createPrimitives(): RenderingPrimitives {
    const windData: WindData3D = this.computing.windData
    const segments = new CustomPrimitive({
      commandType: 'Draw',
      attributeLocations: {
        st: 0,
        normal: 1
      },
      geometry: this.createSegmentsGeometry(),
      primitiveType: PrimitiveType.TRIANGLES,
      uniformMap: {
        previousParticlesPosition: () => this.computing.particlesTextures.previousParticlesPosition,
        currentParticlesPosition: () => this.computing.particlesTextures.currentParticlesPosition,
        postProcessingPosition: () => this.computing.particlesTextures.postProcessingPosition,
        particlesSpeed: () => this.computing.particlesTextures.particlesSpeed,
        frameRateAdjustment: () => this.computing.frameRateAdjustment,
        colorTable: () => this.colorTable,
        domain: () =>
          new Cartesian2(
            this.options.domain?.min ?? windData.speed!.min,
            this.options.domain?.max ?? windData.speed!.max
          ),
        displayRange: () =>
          new Cartesian2(
            this.options.displayRange?.min ?? windData.speed!.min,
            this.options.displayRange?.max ?? windData.speed!.max
          ),
        minHeight: () => windData.levels[0],
        maxHeight: () => windData.levels[windData.levels.length - 1],
        heightScale: () => this.options.heightScale ?? 1,
        aspect: () =>
          (this.context as { drawingBufferWidth: number }).drawingBufferWidth /
          (this.context as { drawingBufferHeight: number }).drawingBufferHeight,
        pixelSize: () => this.viewerParameters.pixelSize,
        lineWidth: () =>
          new Cartesian2(this.options.lineWidth?.min ?? 1, this.options.lineWidth?.max ?? 2),
        lineLength: () =>
          new Cartesian2(this.options.lineLength?.min ?? 20, this.options.lineLength?.max ?? 100),
        is3D: () => this.viewerParameters.sceneMode === SceneMode.SCENE3D,
        segmentsDepthTexture: () => this.textures.segmentsDepth
      },
      vertexShaderSource: ShaderManager.getSegmentDrawVertexShader(),
      fragmentShaderSource: ShaderManager.getSegmentDrawFragmentShader(),
      rawRenderState: this.createRawRenderState({
        viewport: undefined,
        depthTest: { enabled: true },
        depthMask: true,
        blending: {
          enabled: true,
          blendEquation: WebGLRenderingContext.FUNC_ADD,
          blendFuncSource: WebGLRenderingContext.SRC_ALPHA,
          blendFuncDestination: WebGLRenderingContext.ONE_MINUS_SRC_ALPHA
        }
      })
    })

    return { segments }
  }

  onParticlesTextureSizeChange(): void {
    const geometry = this.createSegmentsGeometry()
    this.primitives.segments.geometry = geometry
    const vertexArray = VertexArray.fromGeometry({
      context: this.context,
      geometry,
      attributeLocations: this.primitives.segments.attributeLocations,
      bufferUsage: BufferUsage.STATIC_DRAW
    })
    if (this.primitives.segments.commandToExecute) {
      ;(this.primitives.segments.commandToExecute as { vertexArray: unknown }).vertexArray = vertexArray
    }
  }

  onColorTableChange(): void {
    this.colorTable.destroy()
    this.colorTable = this.createColorTableTexture()
  }

  updateOptions(options: Partial<WindLayerOptions>): void {
    const needUpdateColorTable =
      options.colors && JSON.stringify(options.colors) !== JSON.stringify(this.options.colors)

    this.options = deepMerge(options, this.options)

    if (needUpdateColorTable) {
      this.onColorTableChange()
    }
  }

  destroy(): void {
    Object.values(this.framebuffers).forEach((framebuffer) => framebuffer.destroy())
    Object.values(this.primitives).forEach((primitive) => primitive.destroy())
    this.colorTable.destroy()
  }
}
