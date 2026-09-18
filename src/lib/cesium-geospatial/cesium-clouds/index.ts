// @cesium-geospatial/clouds — 体积云（Phase 3）
// spec: docs/superpowers/specs/2026-08-13-volumetric-clouds-design.md（r1）
// 依赖 @cesium-geospatial/core（Bruneton runtime + 基建 platform 层）
export { CLOUDS_DEFAULT_QUALITY, CLOUDS_LAYER_ALTITUDES_M } from './cloudsConstants'

// GLSL 资产 + 跨包 #include 解析（T7）
export { glslIndex } from './glslIndex'
export { resolveCloudsIncludes } from './resolveCloudsIncludes'
export {
  buildStandaloneCloudsShader,
  type CloudsStage,
  type CloudsDefineValue,
  type CloudsDefines,
  type CloudsStandaloneOptions
} from './cloudsShaderAssembler'

// weather 噪声纹理加载（T9）
export { loadWeatherTextures, type WeatherTextures } from './weatherTextures'

// M2 T1：three clouds.frag → Cesium 主 march fragment shader 桥接组装器（双入口：运行时 + glslang 校验）
export {
  buildCloudsMainFragmentShader,
  buildStandaloneCloudsShaderForValidation,
  type CloudsMainOptions
} from './CloudsMaterial'

// M2 T2：CloudsPass（custom Primitive pass=VOXELS + 3-attachment MRT + 全 business uniform 注入）
export {
  createCloudsPass,
  type CloudsPass,
  type CloudsFrameState,
  type CloudsPassOptions
} from './CloudsPass'
export {
  defaultCloudsParameters,
  type CloudsParameters,
  type CloudsShadowMarchParameters,
  type CloudsShadowFrameState
} from './cloudsDefaultParameters'

// M2 T3：createCloudsStage 顶层工厂（编排 CloudsPass + overlay → 接 PostProcess 链）
export {
  createCloudsStage,
  WEATHER_PRESETS,
  type CloudsStageHandle,
  type CloudsStageOptions,
  type CloudsWeatherPreset,
  type CloudsWeatherBakeOptions
} from './createCloudsStage'

// 云分布重设计 T5：WeatherAtlas 烘焙模块（T6 createCloudsStage 运行时消费；独立入口留给
// 对照实验/多 Viewer 共享计划）
export * from './WeatherAtlas'

// BSM world 锚定缺省设计值（T6 导出：demo ?cloudsShadowScale 派生用；类缺省同源）
export { WORLD_RADII_DEFAULT, WORLD_INTERVALS_DEFAULT } from './CascadedShadowMaps'

// 质量档位（spec 2026-08-29 §3/§4/§5）
export {
  cloudsQualityPresets,
  applyQualityPreset,
  type CloudsQualityPreset,
  type ResolvedCloudsQuality,
  type AppliedCloudsQuality
} from './qualityPresets'

// 云分布重设计 T2：层参数 → packed uniforms 纯函数派生（spec §6.3，云高度偏移前提）
export * from './cloudLayersPacking'
