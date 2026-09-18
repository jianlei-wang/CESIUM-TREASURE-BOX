// FullscreenPass.ts
//
// 通用全屏 pass 封装：基于 Cesium `Context.createViewportQuadCommand`（自带 viewport quad
// vertexArray + TRIANGLES + ShaderProgram.fromCache）。参照 historyBlit.ts:121 buildBlitCommand
// 的 createViewportQuadCommand 范式。
//
// 用途（spec 附录 F3 区分职责）：
//   - BSM ShadowPass、cloudsResolve、history blit 等「postRender 手动 execute」场景（不走 pass 派生，
//     故 renderState/pass 可不传）。
//   - 「云主 march」不走本类——那是 VolumetricPrimitive 的职责（custom Primitive pass=VOXELS + MRT FBO）。
//
// 设计：command 用 getter（destroy 后置 undefined，只读无 setter = readonly 语义）。
// 进 pass 调度时调用方自行把 pass.command 推入 primitive.update（本类不包 primitive）。

import type { Context, DrawCommand, Framebuffer, RenderState } from 'cesium'

export interface FullscreenPassOptions {
  /** fragment shader 源码（不含 #version/precision/v_textureCoordinates——Cesium ShaderSource 自动注入）。 */
  fragmentShaderSource: string
  /** uniform 闭包表（Cesium createViewportQuadCommand 透传）。 */
  uniformMap: { [name: string]: () => unknown }
  /** 可选：写入自管 FBO（off-screen render target）。postRender blit 场景设。 */
  framebuffer?: Framebuffer
  /** 可选：进 pass 调度时必须设（RenderState.fromCache 返回带 id 的缓存实例，
   *  DerivedCommand getDepthOnlyRenderState 访问 renderState.id 做缓存查找；缺则炸 "reading 'id'"）。
   *  postRender 手动 execute 可不传。 */
  renderState?: RenderState
  /** 可选：进 pass 调度时设（如 VOXELS=10）。postRender 手动 execute 可不传。 */
  pass?: number
}

// Cesium Context 公开 .d.ts 缺 createViewportQuadCommand（cesium-augment.d.ts Context 为空 interface）。
// 局部补最小形状（参照 historyBlit.ts:122 cast 模式 + spike SpikeContext）。
interface CesiumContext {
  createViewportQuadCommand: (
    fragmentShaderSource: string,
    overrides: {
      uniformMap?: { [uniformName: string]: () => unknown }
      framebuffer?: Framebuffer
      pass?: number
      renderState?: RenderState
      owner?: unknown
    },
  ) => DrawCommand
}

/**
 * 全屏 fragment pass 封装。一个 FullscreenPass 持一个 DrawCommand（createViewportQuadCommand 装配）。
 *
 * 用法：
 *   - postRender 手动 execute：`pass.execute(context)`（renderState/pass 可不传）
 *   - 进 pass 调度：调用方读 `pass.command` 推入 primitive.update 的 commandList
 */
export class FullscreenPass {
  // 内部 mutable holder；getter 暴露只读视图（destroy 后置 undefined）。
  #command: DrawCommand | undefined

  constructor(context: Context, options: FullscreenPassOptions) {
    const ctx = context as unknown as CesiumContext
    this.#command = ctx.createViewportQuadCommand(options.fragmentShaderSource, {
      uniformMap: options.uniformMap,
      framebuffer: options.framebuffer,
      renderState: options.renderState,
      pass: options.pass,
    })
  }

  /** 装配的 DrawCommand（destroy 后 undefined）。只读——无 setter。 */
  get command(): DrawCommand | undefined {
    return this.#command
  }

  /** 手动 execute（postRender 场景，如 history blit）。destroy 后 no-op。 */
  execute(context: Context): void {
    this.#command?.execute(context)
  }

  /** 释放 command 引用。幂等。注：ShaderProgram 由 Cesium ShaderCache 管理，不在此显式 destroy。 */
  destroy(): void {
    this.#command = undefined
  }
}
