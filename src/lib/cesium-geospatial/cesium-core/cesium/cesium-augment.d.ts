// cesium 公开 .d.ts 未声明 Texture3D / Context / Texture / Sampler / TextureWrap（内部 Renderer 类），
// 但运行时从 'cesium' 可导入（Cesium.js re-export @cesium/engine）。补充最小类型。
declare module 'cesium' {
  export class Texture3D {
    constructor(options: {
      context: Context
      source?: {
        width: number
        height: number
        depth: number
        arrayBufferView: ArrayBufferView
      }
      pixelFormat?: number
      pixelDatatype?: number
      sampler?: Sampler
      flipY?: boolean
    })
  }

  // Texture 构造支持两种变体：
  //   1) 数据纹理：source: { width, height, arrayBufferView }（LUT 路径）
  //   2) 空纹理（RT 目标）：width/height + sampler（history ping-pong 路径）
  export class Texture {
    constructor(options: {
      context: Context
      source?: {
        width: number
        height: number
        arrayBufferView: ArrayBufferView
      }
      width?: number
      height?: number
      pixelFormat?: number
      pixelDatatype?: number
      sampler?: Sampler
      flipY?: boolean
    })
    width: number
    height: number
    destroy(): void
  }

  // Sampler（@cesium/engine Renderer 内部类，Cesium.js re-export，公开 .d.ts 缺失）。
  // Texture 构造的 sampler 形参需 Sampler 实例（见 cesium-clouds-atmosphere/CloudShadowPass.js）。
  export class Sampler {
    constructor(options?: {
      wrapS?: TextureWrap
      wrapT?: TextureWrap
      wrapR?: TextureWrap
      minificationFilter?: TextureMinificationFilter
      magnificationFilter?: TextureMagnificationFilter
      maximumAnisotropy?: number
    })
  }

  // TextureWrap（@cesium/engine 冻结对象，值同 WebGLConstants）。
  export enum TextureWrap {
    CLAMP_TO_EDGE = 33071,
    REPEAT = 10497,
    MIRRORED_REPEAT = 33648,
  }

  // RenderState（@cesium/engine Renderer 内部类，Cesium.js re-export，公开 .d.ts 缺失）。
  // DrawCommand.renderState 须为 RenderState 实例（带 id）——cmd 进 pass 调度后，Cesium
  // updateDerivedCommands→createDepthOnlyDerivedCommand→getDepthOnlyRenderState（DerivedCommand.js:75）
  // 访问 renderState.id 做缓存查找；undefined renderState → "reading 'id'" 炸（spike 实测 2026-08-13）。
  // fromCache 返回带 id 的缓存实例（相同配置不重复创建 GL render state 对象）。
  export class RenderState {
    static fromCache(options?: {
      cull?: { enabled?: boolean; face?: number }
      lineWidth?: number
      polygonOffset?: { enabled?: boolean; factor?: number; units?: number }
      scissorTest?: { enabled?: boolean; rectangle?: unknown }
      depthRange?: { near?: number; far?: number }
      depthTest?: { enabled?: boolean; func?: number }
      colorMask?: { red?: boolean; green?: boolean; blue?: boolean; alpha?: boolean }
      depthMask?: boolean
      stencilTest?: unknown
      blending?: unknown
      [key: string]: unknown
    }): RenderState
    readonly id: number
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  export interface Context {}

  // DrawCommand（@cesium/engine Renderer 内部类，公开 .d.ts 缺失）。
  // createViewportQuadCommand 返回此类型；depthTemporal blit / Task 8 lifecycle 用。
  // 字段对应 DrawCommand 构造 opts + execute(context, options)。
  export interface DrawCommand {
    vertexArray?: unknown
    primitiveType?: number
    renderState?: unknown
    shaderProgram?: unknown
    uniformMap?: { [uniformName: string]: () => unknown }
    framebuffer?: unknown
    pass?: number
    owner?: unknown
    execute(context: Context, options?: { framebuffer?: unknown }): void
  }

  // Framebuffer（@cesium/engine Renderer 内部类，Cesium.js re-export，公开 .d.ts 缺失）。
  // depthTemporal history blit 用：绑定 write Tex 作 color attachment。destroyAttachments=false
  // （texture 由 historyState ping-pong 管理，FBO 不 own——避免 resize 时 FBO.destroy 连带 destroy
  // texture，与 historyState.textures.forEach destroy 双重 destroy）。
  export class Framebuffer {
    constructor(options: {
      context: Context
      colorTextures?: Texture[]
      depthTexture?: Texture
      depthStencilTexture?: Texture
      destroyAttachments?: boolean
    })
    destroy(): void
  }

  // PostProcessStage.outputTexture getter（私有，PostProcessStage.js:346-356，可返 undefined）。
  // depthTemporal history blit 用（Task 7/8 读 depthTemporal stage 输出纹理）。
  // declaration merging：augment 公开 PostProcessStage 类，补 outputTexture 成员类型。
  export interface PostProcessStage {
    readonly outputTexture: Texture | undefined
  }
}
