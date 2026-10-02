/**
 * 地面叠加层贴图工具。
 *
 * Cesium 的 {@link ImageMaterialProperty} 走的是「先登记 loadedImages、下一帧再建纹理」的异步路径：
 * 每当把 image 换成一个新的 canvas，当前帧材质仍持有默认白色纹理，导致地面层闪现一帧白。
 * 这里直接在调用帧用 canvas 建好 GPU 纹理，交给材质后由 Material 在同一帧同步换绑，彻底消除白帧。
 */

import {
  Sampler,
  Texture,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  type TextureSourceOptions,
  type Viewer
} from 'cesium'

/** 取 WebGL 上下文（Scene.context 未在公开类型中声明，需窄化访问） */
function sceneContext(viewer: Viewer): object | undefined {
  return (viewer.scene as unknown as { context?: object }).context
}

/**
 * 把 canvas 同步上传为地面材质纹理。
 * 纹理随材质生命周期由 Cesium 托管，句柄仅用于销毁前兜底判断。
 */
export function canvasToGroundTexture(viewer: Viewer, canvas: HTMLCanvasElement): Texture | undefined {
  const context = sceneContext(viewer)
  if (!context) return undefined
  return new Texture({
    context,
    source: canvas as unknown as TextureSourceOptions,
    sampler: new Sampler({
      minificationFilter: TextureMinificationFilter.LINEAR,
      magnificationFilter: TextureMagnificationFilter.LINEAR
    })
  })
}

/** 初始透明纹理：地面层在首次数据返回前保持透明，避免默认白色纹理铺满体域底面 */
export function createEmptyGroundTexture(viewer: Viewer): Texture | undefined {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 2
  return canvasToGroundTexture(viewer, canvas)
}
