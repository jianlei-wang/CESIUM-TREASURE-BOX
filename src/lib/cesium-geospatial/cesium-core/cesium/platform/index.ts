// platform/index.ts
//
// core 平台基建层（spec r2 §1 C4）：封装 Cesium 渲染入口的通用机制，供所有效果包（clouds 等）复用。
//   - FullscreenPass：通用全屏 pass（createViewportQuadCommand），postRender 手动 execute 场景。
//   - VolumetricPrimitive：custom Primitive pass=VOXELS + MRT FBO（云主 march 入口）。
//   - FramebufferManager：MRT / TEXTURE_2D_ARRAY / ping-pong 工厂。

export { FullscreenPass } from './FullscreenPass'
export type { FullscreenPassOptions } from './FullscreenPass'
export { createVolumetricPrimitive } from './VolumetricPrimitive'
export type { VolumetricPrimitive, VolumetricPrimitiveOptions } from './VolumetricPrimitive'
export {
  createMRTFramebuffer,
  createPingPong,
  createArrayTextureBridge,
} from './FramebufferManager'
export type { PingPongState, ArrayTextureBridgeOptions } from './FramebufferManager'
