declare module 'cesium' {
  export namespace Appearance {
    function getDefaultRenderState(translucent: boolean, closed: boolean, existingRenderState?: unknown): unknown
  }

  export class TextureWrap {
    static CLAMP_TO_EDGE: number
    static REPEAT: number
    static MIRRORED_REPEAT: number
    static validate: (value: unknown) => boolean
  }

  export class BufferUsage {
    static STATIC_DRAW: number
    static STREAM_DRAW: number
    static DYNAMIC_DRAW: number
  }

  export class Pass {
    static ENVIRONMENT: number
    static COMPUTE: number
    static GLOBE: number
    static TERRAIN_CLASSIFICATION: number
    static CESIUM_3D_TILE: number
    static OPAQUE: number
    static TRANSLUCENT: number
    static VOXELS: number
    static OVERLAY: number
  }

  export class ShaderSource {
    constructor(options?: {
      defines?: string[]
      sources?: string[]
      pickColorQualifier?: string
      includeBuiltIns?: boolean
    })
    defines: string[]
    sources: string[]
    includeBuiltIns: boolean
  }

  export interface SamplerConstructorOptions {
    wrapS?: number
    wrapT?: number
    wrapR?: number
    minificationFilter?: number
    magnificationFilter?: number
    maximumAnisotropy?: number
  }

  export class Sampler {
    constructor(options?: SamplerConstructorOptions)
    static NEAREST: Sampler
    static equals: (a: Sampler | undefined, b: Sampler | undefined) => boolean
  }

  export interface TextureSourceOptions {
    width?: number
    height?: number
    depth?: number
    arrayBufferView?: Float32Array | Uint8Array | Uint16Array | Uint32Array
    image?: HTMLImageElement | HTMLCanvasElement
  }

  export interface TextureConstructorOptions {
    context: object
    source?: TextureSourceOptions
    pixelFormat?: PixelFormat
    pixelDatatype?: PixelDatatype
    flipY?: boolean
    skipColorSpaceConversion?: boolean
    sampler?: Sampler
    width?: number
    height?: number
    depth?: number
    preMultiplyAlpha?: boolean
    id?: string
  }

  export class Texture {
    constructor(options: TextureConstructorOptions)
    copyFrom(options: { xOffset?: number; yOffset?: number; source: TextureSourceOptions }): void
    destroy(): void
    isDestroyed(): boolean
  }

  export class Texture3D {
    constructor(options: TextureConstructorOptions)
    destroy(): void
    isDestroyed(): boolean
  }

  export class Framebuffer {
    constructor(options: {
      context: object
      colorTextures?: Texture[]
      depthTexture?: Texture
      depthStencilTexture?: Texture
      destroyAttachments?: boolean
    })
    destroy(): void
    isDestroyed(): boolean
  }

  export class ShaderProgram {
    static fromCache(options: {
      context: object
      vertexShaderSource?: ShaderSource
      fragmentShaderSource?: ShaderSource
      attributeLocations?: Record<string, number>
    }): ShaderProgram
    destroy(): void
    isDestroyed(): boolean
  }

  export class VertexArray {
    static fromGeometry(options: {
      context: object
      geometry?: Geometry
      attributeLocations?: Record<string, number>
      bufferUsage?: number
    }): VertexArray
    destroy(): void
    isDestroyed(): boolean
  }

  export class RenderState {
    static fromCache(renderState: unknown): RenderState
  }

  export class ComputeCommand {
    constructor(options?: {
      vertexArray?: VertexArray
      fragmentShaderSource?: ShaderSource
      shaderProgram?: ShaderProgram
      uniformMap?: Record<string, () => unknown>
      outputTexture?: Texture
      preExecute?: () => void
      postExecute?: () => void
      canceled?: boolean
      persists?: boolean
      pass?: number
      owner?: unknown
    })
    vertexArray?: VertexArray
    fragmentShaderSource?: ShaderSource
    shaderProgram?: ShaderProgram
    uniformMap?: Record<string, () => unknown>
    outputTexture?: Texture
    preExecute?: () => void
    postExecute?: () => void
    canceled?: boolean
    persists?: boolean
    pass?: number
    owner?: unknown
  }

  export class DrawCommand {
    constructor(options?: {
      owner?: unknown
      vertexArray?: VertexArray
      primitiveType?: number
      modelMatrix?: Matrix4
      renderState?: RenderState
      shaderProgram?: ShaderProgram
      framebuffer?: Framebuffer
      uniformMap?: Record<string, () => unknown>
      pass?: number
      count?: number
      offset?: number
      instanceCount?: number
      cull?: boolean
      occlude?: boolean
      boundingVolume?: unknown
    })
    owner?: unknown
    vertexArray?: VertexArray
    primitiveType?: number
    modelMatrix?: Matrix4
    renderState?: RenderState
    shaderProgram?: ShaderProgram
    framebuffer?: Framebuffer
    uniformMap?: Record<string, () => unknown>
    pass?: number
    count?: number
    offset?: number
    instanceCount?: number
    cull?: boolean
    occlude?: boolean
    boundingVolume?: unknown
  }

  export class ClearCommand {
    constructor(options?: {
      color?: Color
      depth?: number
      stencil?: number
      framebuffer?: Framebuffer
      pass?: number
      owner?: unknown
    })
    color?: Color
    depth?: number
    stencil?: number
    framebuffer?: Framebuffer
    pass?: number
    owner?: unknown
    execute: (context: object) => void
  }

  export interface Cesium3DTilesetStatistics {
    tilesVisited?: number
    tilesRendered?: number
    tilesCulled?: number
    trianglesLength?: number
    pointsLength?: number
    numberOfPendingRequests?: number
    numberOfTilesWithContentReady?: number
  }

  export interface Cesium3DTileset {
    statistics: Cesium3DTilesetStatistics
  }
}
