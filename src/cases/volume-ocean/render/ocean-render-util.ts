/**
 * 按需渲染（requestRenderMode）下的跨帧重绘工具
 *
 * Cesium 的 requestRenderMode 只按需绘制；体图元 / 贴图 / 顶点缓冲上传存在一帧滞后，
 * 单次 requestRender 会先用上一帧资源绘制一帧且不再继续请求，表现为“改了参数画面不变、
 * 拖动视角才刷新”。跨帧连续请求若干次可确保最新资源立即显示。
 */

import type { Viewer } from 'cesium'

/** 跨帧请求渲染若干次，确保新上传的资源（体数据 / LUT / 几何）立即生效 */
export function settleRender(viewer: Viewer | undefined, frames = 3): void {
  if (!viewer || viewer.isDestroyed()) return
  let remaining = Math.max(1, Math.floor(frames))
  const tick = (): void => {
    if (!viewer || viewer.isDestroyed()) return
    viewer.scene.requestRender()
    remaining -= 1
    if (remaining > 0) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
