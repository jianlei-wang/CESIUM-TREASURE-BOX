/// <reference path="./cesium/cesium-augment.d.ts" />

export { resolveIncludes } from './resolveIncludes'
export { unrollLoops } from './unrollLoops'
export { glslIndex } from './glslIndex'
export {
  ATMOSPHERE_DEFAULT_GLSL,
  ATMOSPHERE_BOTTOM_RADIUS_M,
  ATMOSPHERE_TOP_RADIUS_M,
  SUN_ANGULAR_RADIUS
} from './math/atmosphereParameters'
export { getAltitudeCorrectionOffset } from './math/altitudeCorrection'
// 夜间光照月方向/月相单源（spec 2026-08-30 r2 §4）——AtmosphereStage 月盘与 clouds 月光照明共用
export {
  computeMoonDirectionECEF,
  computeMoonFixedToECEFMatrix,
  computeMoonIlluminatedFraction,
  computeMoonIlluminatedFractionFromDirections
} from './celestial/celestialDirections'
// Cesium 对数深度反演 GLSL（czm_reverseLogDepthDist/Window 等）——cesium-clouds 的
// getRayDistanceToScene（globe depth 截断 march）跨包复用，勿重命名 GLSL 内函数名。
export { LOG_DEPTH_GLSL } from './cesium/logDepth'
export { buildAtmospherePrefix } from './cesium/cesiumCore'
export { DEPTH_RECONSTRUCTION_GLSL } from './cesium/depthReconstruction'
export { loadAtmosphereLUTs, parseHalfFloatBin } from './cesium/lutLoader'
export type { AtmosphereLUTs } from './cesium/lutLoader'
export {
  buildAerialPerspectiveFragmentShader,
  buildStandaloneShaderForValidation,
  AERIAL_PERSPECTIVE_UNIFORM_NAMES
} from './cesium/aerialPerspective.frag'
export type { AerialPerspectiveFragOptions } from './cesium/aerialPerspective.frag'
export {
  createAtmosphereStage,
  validateAtmosphereOptions,
  buildAtmosphereUniforms,
  getEffectiveAtmosphereExposure
} from './cesium/AtmosphereStage'
export type {
  AtmosphereStageOptions,
  ResolvedAtmosphereStageOptions,
  AtmosphereStageHandle,
  AtmosphereFrameState
} from './cesium/AtmosphereStage'
// phase2b LensFlare 默认值常量（demo URL 参数 fallback 用，spec §5.10）
export {
  INTENSITY_DEFAULT,
  THRESHOLD_LEVEL_DEFAULT,
  GHOST_AMOUNT_DEFAULT,
  HALO_AMOUNT_DEFAULT
} from './cesium/lensFlare/lensFlareConstants'
// depthTemporal temporal* preset（Task 12 demo ?temporalQuality=low|high 用）
export {
  TEMPORAL_QUALITY_PRESETS,
  type TemporalQualityPreset
} from './cesium/depthTemporal/depthTemporalConstants'
// 性能 Phase 0：逐 stage GPU 计时（EXT_disjoint_timer_query_webgl2）
export { StageGpuTimer } from './cesium/profile/stageGpuTimer'
// phase3 平台基建（spec r2 C4）：FullscreenPass / VolumetricPrimitive / FramebufferManager
export { FullscreenPass } from './cesium/platform'
export type { FullscreenPassOptions } from './cesium/platform'
export { createVolumetricPrimitive } from './cesium/platform'
export type { VolumetricPrimitive, VolumetricPrimitiveOptions } from './cesium/platform'
export {
  createMRTFramebuffer,
  createPingPong,
  createArrayTextureBridge
} from './cesium/platform'
export type { PingPongState, ArrayTextureBridgeOptions } from './cesium/platform'
