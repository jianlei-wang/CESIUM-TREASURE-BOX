// FramebufferManager.ts
//
// 裸 WebGL2 FBO 工厂：MRT 多 attachment + TEXTURE_2D_ARRAY cascade + ping-pong。
// 参照 historyBlit.ts:40 createHistoryState（ping-pong）+ :80 getHistoryBridge（bridge）+
// :150 buildHistoryFBO（Framebuffer destroyAttachments:false）。
//
// 为什么需要自建（spec r2 §1 C4）：Cesium 无 MRT 封装（PostProcessStage 单输出）、无 2D_ARRAY 封装
// （Texture3D 是 3D，非 cascade 用的 2D_ARRAY）。云渲染需 MRT（color/depthVelocity/shadowLength 三输出）
// + BSM cascade shadow（2D_ARRAY）+ temporal ping-pong，故封装此工厂层供所有效果包复用。

import {
  Texture,
  PixelFormat,
  PixelDatatype,
  Sampler,
  TextureMinificationFilter,
  TextureMagnificationFilter,
  TextureWrap,
  Framebuffer,
} from 'cesium'
import type { Context } from 'cesium'

// WebGL TEXTURE_2D_ARRAY 常量（WebGLConstants.TEXTURE_2D_ARRAY = 0x871A）。Cesium 未导出此 enum，
// 用字面量 + 注释（与 plan T6 spec 一致：TEXTURE_2D_ARRAY = 0x871A）。
const TEXTURE_2D_ARRAY = 0x871a

// NEAREST + CLAMP_TO_EDGE（depth/数据纹理像素对齐，与 historyBlit HISTORY_SAMPLER 同：不插值）。
// 模块级常量：所有 ping-pong texture 共享同一 Sampler 实例（Sampler 无状态）。
const NEAREST_SAMPLER = new Sampler({
  minificationFilter: TextureMinificationFilter.NEAREST,
  magnificationFilter: TextureMagnificationFilter.NEAREST,
  wrapS: TextureWrap.CLAMP_TO_EDGE,
  wrapT: TextureWrap.CLAMP_TO_EDGE,
})

// ── ping-pong（参照 historyBlit.ts:40 createHistoryState + :65 swapHistory） ──

export interface PingPongState {
  /** ping-pong texture 数组（默认 2 张）。 */
  textures: Texture[]
  /** 当前 read 索引（getRead 指向）。write = (readIndex+1) % count。 */
  readIndex: number
  width: number
  height: number
  /** 翻转 readIndex：(readIndex+1) % count。 */
  swap(): void
  /** 当前 read Tex（采样源）。 */
  getRead(): Texture
  /** 当前 write Tex（渲染/写目标，swap 后变 read）。 */
  getWrite(): Texture
  /** 当前 read Tex 的 bridge（{_texture, _target}，Cesium createUniform 兼容，注入 PostProcessStage uniform）。
   *  与 historyBlit.ts:80 getHistoryBridge 同模式。 */
  getBridge(): { _texture: unknown; _target: number }
}

/**
 * 创建 ping-pong texture 状态（参照 historyBlit.ts:40 createHistoryState）。
 *
 * @param context Cesium Context。
 * @param opts.width/height texture 尺寸。
 * @param opts.count buffer 数（默认 2；>2 用于 triple-buffer 等）。
 * @param opts.pixelDatatype 像素数据类型（默认 HALF_FLOAT——云 MRT depthVelocity/shadowLength 需半精度）。
 */
export function createPingPong(
  context: Context,
  opts: { width: number; height: number; count?: number; pixelDatatype?: number },
): PingPongState {
  const count = opts.count ?? 2
  const pixelDatatype = opts.pixelDatatype ?? PixelDatatype.HALF_FLOAT
  const textures: Texture[] = []
  for (let i = 0; i < count; i++) {
    textures.push(
      new Texture({
        context,
        width: opts.width,
        height: opts.height,
        pixelFormat: PixelFormat.RGBA,
        pixelDatatype,
        sampler: NEAREST_SAMPLER,
      }),
    )
  }
  const state: PingPongState = {
    textures,
    readIndex: 0,
    width: opts.width,
    height: opts.height,
    swap(): void {
      state.readIndex = (state.readIndex + 1) % count
    },
    getRead(): Texture {
      return textures[state.readIndex]
    },
    getWrite(): Texture {
      return textures[(state.readIndex + 1) % count]
    },
    getBridge(): { _texture: unknown; _target: number } {
      const tex = state.getRead() as unknown as { _texture: unknown; _target: number }
      return { _texture: tex._texture, _target: tex._target }
    },
  }
  return state
}

// ── MRT Framebuffer（参照 historyBlit.ts:150 buildHistoryFBO） ──

/**
 * 创建 MRT（多 color attachment）Framebuffer。Context.bindFramebuffer 自动 glDrawBuffers
 * （Context.js:1230-1239），shader 用 layout(location=0/1/2) out 即可写多 attachment。
 *
 * destroyAttachments=false（关键，同 historyBlit.ts:155）：texture 由调用方管理（ping-pong/resize 重建），
 * FBO.destroy 仅释放 GL framebuffer handle，不连带 destroy texture，避免双重 destroy。
 *
 * @param context Cesium Context。
 * @param colorTextures MRT attachment 数组（如云 color/depthVelocity/shadowLength 三 attachment）。
 */
export function createMRTFramebuffer(context: Context, colorTextures: Texture[]): Framebuffer {
  return new Framebuffer({
    context,
    colorTextures,
    destroyAttachments: false,
  })
}

// ── TEXTURE_2D_ARRAY bridge（BSM cascade shadow 用） ──
//
// 裸 WebGL TEXTURE_2D_ARRAY（Cesium 无 2D_ARRAY 封装——Texture3D 是 TEXTURE_3D 0x806F，非 cascade 用）。
// bridge {_texture, _target: 0x871A} 注入 PostProcessStage uniform（Cesium createUniform.js 读
// _target/_texture，与 UniformSampler.set() 一致），sampler2DArray 在 shader 采样。
//
// 访问 Cesium Context._gl（私有，公开 .d.ts 不暴露）：cast 取 _gl（WebGL2RenderingContext）。

export interface ArrayTextureBridgeOptions {
  width: number
  height: number
  layers: number
  /** internalFormat（默认 RGBA8=0x8858）。BSM cascade shadow / 数据纹理典型 RGBA8。 */
  internalFormat?: number
  /** format（默认 RGBA=0x1908）。 */
  format?: number
  /** type（默认 UNSIGNED_BYTE=0x1401）。 */
  type?: number
}

// WebGL 常量（WebGL2RenderingContext enum 值，避免依赖 lib.dom 全 enum 命名）
const GL_RGBA8 = 0x8858
const GL_RGBA = 0x1908
const GL_UNSIGNED_BYTE = 0x1401

/**
 * 创建裸 WebGL TEXTURE_2D_ARRAY texture + bridge（BSM cascade shadow 用）。
 *
 * @param context Cesium Context（取 _gl 做 raw WebGL2 调用）。
 * @param opts.width/height/layers 尺寸（layers = cascade 数）。
 * @returns bridge {_texture, _target: 0x871A}——注入 PostProcessStage uniform。
 */
export function createArrayTextureBridge(
  context: Context,
  opts: ArrayTextureBridgeOptions,
): { _texture: unknown; _target: number } {
  const gl = (context as unknown as { _gl: WebGL2RenderingContext })._gl
  const internalFormat = opts.internalFormat ?? GL_RGBA8
  const format = opts.format ?? GL_RGBA
  const type = opts.type ?? GL_UNSIGNED_BYTE

  const tex = gl.createTexture()
  gl.bindTexture(TEXTURE_2D_ARRAY, tex)
  // texImage3D(target, level, internalFormat, width, height, depth, border, format, type, pixels)
  // pixels=null：空纹理（render target，后续 renderpass 填充）。
  gl.texImage3D(
    TEXTURE_2D_ARRAY,
    0,
    internalFormat,
    opts.width,
    opts.height,
    opts.layers,
    0,
    format,
    type,
    null,
  )
  return { _texture: tex, _target: TEXTURE_2D_ARRAY }
}
