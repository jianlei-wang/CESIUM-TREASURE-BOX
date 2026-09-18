// historyBlit.ts
// history Texture ping-pong 管理 + bridge（Cesium createUniform 兼容）+ adapter（私有 API 封装）。
//
// 两张 HALF_FLOAT RGBA NEAREST Texture 翻转：readIndex 指向当前 read（u_historyTexture 采样源），
// write = 1 - readIndex（EMA blit 目标）。swap 后 write 变 read。
//
// bridge：Cesium createUniform.js 读 _target / _texture 把 Cesium.Texture 包成 raw GL sampler
// 兼容对象（与 UniformSampler.set() 一致）。adapter：PostProcessStage.outputTexture 可返 undefined，
// 单独判空以触发 graceful degrade。
import {
  Texture,
  PixelFormat,
  PixelDatatype,
  Sampler,
  TextureMinificationFilter,
  TextureMagnificationFilter,
  TextureWrap,
  Framebuffer,
  defined,
} from 'cesium'
import type { Context, DrawCommand } from 'cesium'

export interface HistoryState {
  textures: Texture[]
  readIndex: number // 当前 read（u_historyTexture 指向），write = 1 - readIndex
  width: number
  height: number
  pixelDatatype: PixelDatatype | number
}

// history 用 NEAREST（depth 像素对齐，不插值——不同于 CloudShadowPass 的 LINEAR）+ CLAMP_TO_EDGE。
// 模块级常量：两张 Texture 共享同一 Sampler 实例（Sampler 无状态）。
const HISTORY_SAMPLER = new Sampler({
  minificationFilter: TextureMinificationFilter.NEAREST,
  magnificationFilter: TextureMagnificationFilter.NEAREST,
  wrapS: TextureWrap.CLAMP_TO_EDGE,
  wrapT: TextureWrap.CLAMP_TO_EDGE,
})

export function createHistoryState(
  context: unknown,
  width: number,
  height: number,
  pixelDatatype: number,
): HistoryState {
  const t0 = new Texture({
    context,
    width,
    height,
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype,
    sampler: HISTORY_SAMPLER,
  } as any)
  const t1 = new Texture({
    context,
    width,
    height,
    pixelFormat: PixelFormat.RGBA,
    pixelDatatype,
    sampler: HISTORY_SAMPLER,
  } as any)
  return { textures: [t0, t1], readIndex: 0, width, height, pixelDatatype }
}

export function swapHistory(state: HistoryState): void {
  state.readIndex = 1 - state.readIndex
}

// 当前 read Tex（u_historyTexture 指向）
export function getReadTexture(state: HistoryState): Texture {
  return state.textures[state.readIndex]
}

// 当前 write Tex（blit 目标，swap 后变 read）
export function getWriteTexture(state: HistoryState): Texture {
  return state.textures[1 - state.readIndex]
}

// bridge 对象（Cesium createUniform.js 读 _target/_texture，把 Cesium Texture 包成 raw GL sampler 兼容对象）
export function getHistoryBridge(state: HistoryState): { _texture: unknown; _target: number } {
  const tex = getReadTexture(state)
  return {
    _texture: (tex as unknown as { _texture: unknown })._texture,
    _target: (tex as unknown as { _target: number })._target,
  }
}

// adapter：outputTexture getter 判空（评审 minor，PostProcessStage.outputTexture 可返 undefined）
export function sanityCheckOutputTexture(tex: unknown): boolean {
  return defined(tex)
}

// blit shader：透传 vec4（rgb=scene color, a=smoothDepth）到 history framebuffer。
// raw DrawCommand（不经 PostProcessStage），用 Cesium createViewportQuadCommand 管理状态。
//
// #version 查证结论：Cesium ShaderSource 预处理（Renderer/ShaderSource.js:300）在 WebGL2 上下文
// 自动注入 `#version 300 es`；fragment shader 自动注入 precision（同文件 :233-242）；使用 out_FragColor
// 但未声明时自动注入 `layout(location = 0) out vec4 out_FragColor;`（:281-291）。
// 故此处不写 #version / precision / out 声明，与 @cesium/engine 内置 PassThrough.glsl
// （createViewportQuadCommand 的既有用例）形态完全一致。
const BLIT_SHADER = `uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
void main() {
  out_FragColor = texture(colorTexture, v_textureCoordinates);
}
`

// 构造透传 blit DrawCommand：把 srcTexture（scene color + smoothDepth 打包 RGBA）透传到 history framebuffer。
//
// Cesium Context.createViewportQuadCommand（@cesium/engine Source/Renderer/Context.js:1619）：
//   createViewportQuadCommand(fragmentShaderSource, overrides) → DrawCommand
//   自带 viewport quad vertexArray（ViewportQuadVS.glsl）+ TRIANGLES + ShaderProgram.fromCache +
//   传入的 uniformMap。framebuffer 可在 overrides 设或后续 cmd.framebuffer = ... 后设。
//
// 本函数只构造 cmd（uniformMap.colorTexture 闭包绑定 srcTexture）。framebuffer 由调用方
// （Task 8 lifecycle）后设并 execute：cmd.framebuffer = historyFBO; cmd.execute(context)。
//
// srcTexture: unknown —— depthTemporal.outputTexture（Task 8 决定是 Texture 还是 bridge 对象，
// 类型待定）。Cesium createUniform.js 读 _target / _texture 把 Cesium.Texture 包成 raw GL sampler
// 兼容对象（与 UniformSampler.set() 一致），故 bridge 与 Texture 均可。
export function buildBlitCommand(context: Context, srcTexture: unknown): DrawCommand {
  const cmd = (
    context as unknown as {
      createViewportQuadCommand: (
        fragmentShaderSource: string,
        overrides: {
          uniformMap: { colorTexture: () => unknown }
        },
      ) => DrawCommand
    }
  ).createViewportQuadCommand(BLIT_SHADER, {
    uniformMap: {
      colorTexture: () => srcTexture,
    },
  })
  return cmd
}

// 构造 history FBO：绑定 write Tex 作 color attachment。
//
// destroyAttachments=false 关键（@cesium/engine Source/Renderer/Framebuffer.js:84）：texture 由
// historyState ping-pong 管理（resize 时 historyState.textures.forEach destroy），FBO 不 own——
// 避免 FBO.destroy 连带 destroy texture 与 historyState 双重 destroy。
//
// 调用方（Task 8 lifecycle postRender）：cmd.framebuffer = buildHistoryFBO(ctx, writeTex); cmd.execute(ctx)。
// !!每帧 new Framebuffer() 泄漏 GL framebuffer handle：gl.createFramebuffer 是有限 GL 资源，仅
// Framebuffer.destroy()/gl.deleteFramebuffer 释放（JS GC 不触发 GL 释放）；60fps 长时累积 ~21.6万/h。
// 缓存优化（2 FBO ping-pong，各绑定 1 history Tex，与 historyState 同生命周期，resize 时 destroy 重建）
// 待后续 task，Task 14 results 记 ticket。
export function buildHistoryFBO(context: Context, colorTexture: Texture): Framebuffer {
  return new Framebuffer({
    context,
    colorTextures: [colorTexture],
    destroyAttachments: false,
  })
}
