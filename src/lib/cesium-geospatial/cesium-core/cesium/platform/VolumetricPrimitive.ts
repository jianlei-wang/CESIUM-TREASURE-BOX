// VolumetricPrimitive.ts
//
// custom Primitive 封装（云主 march 入口）。参数化 spike CloudsSpikeMRT.ts 的 primitive 段。
// 这是 spec 附录 F3 的「新增基建」——封装「自定义 primitive 对象，update(frameState) 下发
// pass=VOXELS + 自带 MRT framebuffer 的 DrawCommand」。云主 march 走这里（FullscreenPass 用于
// BSM ShadowPass/resolve/blit，二者职责不同，见 spec 附录 F3）。
//
// 固化 spike 学到的 3 个 Cesium 接口坑：
//   #1 Destroyable 三件套：primitive 必须有 update/isDestroyed/destroy（PrimitiveCollection.add
//      → Scene.js:4134 调 primitive.isDestroyed 检查存活；缺则抛 "primitive.isDestroyed is not a
//      function" + 后续渲染 "reading 'id'" 崩）。
//   #2 pass 调度需 renderState：DrawCommand 进 pass（非 postRender 手动 execute）必须有 renderState
//      （RenderState.fromCache 返回带 id 的缓存实例），否则 DerivedCommand getDepthOnlyRenderState
//      （DerivedCommand.js:75）访问 renderState.id 炸 "reading 'id'"。MRT FBO 无 depth attachment
//      → depthTest off + depthMask false（与 spike 一致）。
//   #3 czm_* automatic uniforms 注入：Primitive 走 ShaderProgram 必注入（实测绿，本类不处理）。
//
// globe depth 访问（spec 附录 F5）：私有 API scene._view.globeDepth.depthStencilTexture。
// 调用方可通过 globeDepthTexture 闭包注入（隔离私有 API 访问，本类不直接耦合 scene._view）。

import { Framebuffer, RenderState, BoundingRectangle, BoundingSphere, Cartesian3 } from 'cesium'
import type { Context, DrawCommand, Texture } from 'cesium'

// Pass.VOXELS=10（Renderer/Pass.js:27）。@private 不在公开 .d.ts，用字面量常量 + 源码行号注释
// （与 spike CloudsSpikeMRT.ts:49 一致）。VOXELS(10) 在 GLOBE(2) 后、OPAQUE(8) 前执行
// （Scene.js:2756 performPass(GLOBE) → :2934 performVoxelsPass）→ globe depthTexture 在 VOXELS
// 执行时已就绪。
// Cesium Pass 枚举：TRANSLUCENT=10，VOXELS=11（2026-09-04 修正：误用 10 会让命令被当作
// 半透明走 OIT 派生 → 片元尾注入 out_FragData_0/1 MRT 输出与 layout out 冲突编译失败）
const PASS_VOXELS = 11

// voxels pass 的 backToFront 排序（Scene.js performVoxelsPass → mergeSort）读 command.
// boundingVolume——createViewportQuadCommand 不设它，单 command 时 mergeSort 不触发比较、
// 多 command（M4：march + resolve 两实例）时 undefined.distanceSquaredTo 炸（实测 M4 T8 smoke）。
// 共享排序球：所有 command 到相机距离相等 → 比较结果恒 0 → mergeSort 稳定保 push 顺序
//（march 先、resolve 后——本平台 add 顺序即渲染顺序的契约依据）。
//
// ⚠️ 球心必须每帧跟随相机（update 内写 center）：createPotentiallyVisibleSet 对**有**
// boundingVolume 的 command 用 computePlaneDistances 做 frustum 段区间分配（insertIntoBin：
// far < 段.near 即丢弃）——固定地心球在相机身后（plane distance 负）→ 与任何段不相交 →
// command 全灭（实测 M4：云整体消失，VOXELS 桶 indices 恒 0）。相机中心球（r=1）区间
// [-1,+1] 恒交第一段：恰好一次/帧（顺带消除 multi-frustum 每段重复执行的浪费），且
// march/resolve 共享同一球保持等距排序稳定。M2/M3 无 boundingVolume 走 else 分支
//（用相机 near/far 全段插入）——那时的「正常」是此差异的掩盖。
const VOXELS_SORT_BOUNDING_VOLUME = new BoundingSphere(Cartesian3.ZERO, 1.0)

export interface VolumetricPrimitiveOptions {
  /** Cesium Context（从 scene.context 取）。 */
  context: Context
  /** 云主 march fragment shader（MRT layout(location=0/1/2) out 三 attachment：color/depthVelocity/shadowLength）。
   *  不写 #version / precision / v_textureCoordinates / czm_* 声明——Cesium ShaderSource 自动注入。 */
  fragmentShaderSource: string
  /** uniform 闭包表（czm_* automatic uniforms 由 ShaderProgram 自动注入，不在此声明）。 */
  uniformMap: { [name: string]: () => unknown }
  /** MRT 3 attachment（color/depthVelocity/shadowLength）。texture 由调用方管理（resize 重建），
   *  本 primitive 的 FBO 用 destroyAttachments=false 不连带 destroy。 */
  mrtColorTextures: Texture[]
  /** 可选：globe depth 闭包（云 getRayDistanceToScene 用，spec 附录 F5）。
   *  调用方注入 `() => scene._view?.globeDepth?.depthStencilTexture`（隔离私有 API）。 */
  globeDepthTexture?: () => Texture | undefined
  /** 可选：pass 值（默认 VOXELS=10）。云主 march 走 VOXELS（globe 后 PostProcess 前执行）。 */
  pass?: number
  /**
   * 可选：FBO viewport（M4 T6）。**低分 FBO 必须设**——RenderState 不设 viewport 时 GL
   * viewport 保持当前值（= drawingBuffer 全分），低分 FBO 下 gl_FragCoord 越界写被裁。
   * 缺省 undefined = 不设（全分 FBO 恰与 drawingBuffer 相等，M2 行为）。
   */
  viewport?: BoundingRectangle
}

export interface VolumetricPrimitive {
  /** Cesium Destroyable 接口：update 压 command 到 frameState.commandList（Cesium 按 pass 调度执行）。
   *  PrimitiveCollection.update 遍历 primitives[i].update(frameState)（同 CloudCollection.js:761 模式）。 */
  update(frameState: unknown): void
  /** Cesium Destroyable 接口（spike 坑#1）：PrimitiveCollection.add → Scene.js:4134 调 isDestroyed 检查存活。 */
  isDestroyed(): boolean
  /** 释放 MRT FBO（GL framebuffer handle）。texture 由调用方管理，不在此 destroy。幂等。 */
  destroy(): void
}

// Cesium Context 公开 .d.ts 缺 createViewportQuadCommand。局部补最小形状（与 FullscreenPass.ts 一致）。
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
 * 创建体积云 custom Primitive（云主 march 渲染入口）。
 *
 * 内部装配（参照 spike CloudsSpikeMRT.ts:179-237）：
 *   1. MRT Framebuffer（colorTextures=options.mrtColorTextures, destroyAttachments:false）
 *   2. createViewportQuadCommand（pass=VOXELS + framebuffer=MRT + renderState=RenderState.fromCache
 *      {depthTest.enabled:false, depthMask:false}——MRT FBO 无 depth attachment）
 *   3. primitive 对象三件套（update/isDestroyed/destroy）
 */
export function createVolumetricPrimitive(
  options: VolumetricPrimitiveOptions,
): VolumetricPrimitive {
  const context = options.context as unknown as CesiumContext

  // ── MRT Framebuffer：多 attachment（Context.bindFramebuffer 自动 glDrawBuffers，Context.js:1230-1239）。
  //    destroyAttachments=false（spike CloudsSpikeMRT.ts:182）：texture 由调用方管理，FBO.destroy 仅释放
  //    GL framebuffer handle，不连带 destroy texture。
  const mrtFBO = new Framebuffer({
    context: options.context,
    colorTextures: options.mrtColorTextures,
    destroyAttachments: false,
  })

  // ── DrawCommand：createViewportQuadCommand 自带 viewport quad + TRIANGLES + ShaderProgram.fromCache。
  //    pass=VOXELS → globe 后执行（globe depthTexture 已就绪）；framebuffer=mrtFBO → 写 3 attachment
  //    （Context.js:1412 cmd._framebuffer 优先 passState.framebuffer）。
  //    renderState 必须显式设（spike 坑#2）：cmd 进 pass 调度后，DerivedCommand getDepthOnlyRenderState
  //    访问 renderState.id 做缓存查找；undefined → "reading 'id'" 炸。MRT FBO 无 depth attachment
  //    → depthTest off + depthMask false。viewport：M4 T6 低分 FBO 必须显式（undefined = 不动
  //    GL viewport，全分 FBO 的 M2 行为）。
  //    globeDepthTexture 闭包透传到 uniformMap（调用方通过 options 注入私有 API 隔离）。
  const renderState = RenderState.fromCache({
    viewport: options.viewport,
    depthTest: { enabled: false },
    depthMask: false,
  })
  const uniformMap: { [name: string]: () => unknown } = { ...options.uniformMap }
  if (options.globeDepthTexture) {
    uniformMap.u_globeDepth = options.globeDepthTexture
  }
  const cmd = context.createViewportQuadCommand(options.fragmentShaderSource, {
    uniformMap,
    framebuffer: mrtFBO,
    pass: options.pass ?? PASS_VOXELS,
    renderState,
  })
  // backToFront 排序护甲（见 VOXELS_SORT_BOUNDING_VOLUME 注释）：等距共享球 → 多 command
  // 稳定排序保 push 顺序（march 先 resolve 后）
  ;(cmd as { boundingVolume?: BoundingSphere }).boundingVolume = VOXELS_SORT_BOUNDING_VOLUME

  // ── Destroyable 三件套（spike 坑#1）。destroy 幂等（防 PrimitiveCollection.remove 内部 destroy
  //    + 本 primitive.destroy 双调）。
  let destroyed = false
  const primitive: VolumetricPrimitive = {
    update(frameState: unknown): void {
      if (destroyed) return
      // 排序球心跟随相机（见 VOXELS_SORT_BOUNDING_VOLUME 注释——固定球心会被段区间分配剔除）
      const fs = frameState as {
        commandList: { push: (c: DrawCommand) => void }
        camera?: { positionWC: Cartesian3 }
      }
      if (fs.camera != null) {
        Cartesian3.clone(fs.camera.positionWC, VOXELS_SORT_BOUNDING_VOLUME.center)
      }
      fs.commandList.push(cmd)
    },
    isDestroyed(): boolean {
      return destroyed
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      mrtFBO.destroy() // destroyAttachments=false → 仅释放 GL framebuffer handle
    },
  }
  return primitive
}
