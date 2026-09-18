// clouds 包 GLSL 资产汇聚（?raw 导入）。
//
// 设计（spec §4 跨包 #include 机制）：
// - clouds 本地 21 shader + 2 个 Three <common>/<packing> 兼容桩，顶层按 include 名注册。
// - `core/*`：跨包引用 @cesium-geospatial/core 的 glslIndex.core（clouds shader 源写
//   `#include "core/math"` 等，core 包已含 math/depth/raySphereIntersection/cascadedShadowMaps/
//   generators/interleavedGradientNoise/turbo/vogelDisk 全部 8 个，无需拷贝）。
// - `atmosphere/bruneton/*`：路径前缀别名。clouds 源写 `atmosphere/bruneton/runtime`
//   （three-geospatial 惯例），本项目 core 暴露在 `bruneton/*` 下；此处把 core 的 bruneton
//   子树挂到 atmosphere.bruneton，clouds shader 源一字不改即可 resolve。
//
// resolveIncludes（复用 core）按路径分量（split('/')）walk 这棵嵌套对象树，故顶层 key 直接
// 对应裸 include 名（perlin / clouds / types ...），二级 key 对应前缀（core.math / atmosphere.bruneton.runtime）。

import { glslIndex as coreIndex } from '../cesium-core'

// Three <common>/<packing> 兼容桩
import _compatCommon from './glsl/compatCommon.glsl?raw'
import _compatPacking from './glsl/compatPacking.glsl?raw'

// clouds 本地库 shader（被 #include 的 8 个）
import _catmullRomSampling from './glsl/catmullRomSampling.glsl?raw'
import _clouds from './glsl/clouds.glsl?raw'
import _parameters from './glsl/parameters.glsl?raw'
import _perlin from './glsl/perlin.glsl?raw'
import _structuredSampling from './glsl/structuredSampling.glsl?raw'
import _tileableNoise from './glsl/tileableNoise.glsl?raw'
import _types from './glsl/types.glsl?raw'
import _varianceClipping from './glsl/varianceClipping.glsl?raw'

// clouds entry shader（含 main()，直接喂给 compile test / 未来 Cesium assembler）
import _cloudShapeFrag from './glsl/cloudShape.frag?raw'
import _cloudShapeDetailFrag from './glsl/cloudShapeDetail.frag?raw'
import _cloudsFrag from './glsl/clouds.frag?raw'
import _cloudsVert from './glsl/clouds.vert?raw'
import _cloudsEffectFrag from './glsl/cloudsEffect.frag?raw'
import _cloudsResolveFrag from './glsl/cloudsResolve.frag?raw'
import _cloudsResolveVert from './glsl/cloudsResolve.vert?raw'
import _localWeatherFrag from './glsl/localWeather.frag?raw'
import _shadowFrag from './glsl/shadow.frag?raw'
import _shadowVert from './glsl/shadow.vert?raw'
import _shadowResolveFrag from './glsl/shadowResolve.frag?raw'
import _shadowResolveVert from './glsl/shadowResolve.vert?raw'
import _turbulenceFrag from './glsl/turbulence.frag?raw'
import _weatherBakeFrag from './glsl/weatherBake.frag?raw'

export const glslIndex = {
  // —— Three chunk 兼容桩 ——
  compatCommon: _compatCommon,
  compatPacking: _compatPacking,

  // —— 跨包引用 core 通用 GLSL ——
  core: coreIndex.core,

  // —— Bruneton 大气（atmosphere/bruneton/* → core bruneton/* 路径别名）——
  atmosphere: { bruneton: coreIndex.bruneton },

  // —— clouds 本地库（include 目标，顶层 key = include 名）——
  catmullRomSampling: _catmullRomSampling,
  clouds: _clouds,
  parameters: _parameters,
  perlin: _perlin,
  structuredSampling: _structuredSampling,
  tileableNoise: _tileableNoise,
  types: _types,
  varianceClipping: _varianceClipping,

  // —— clouds entry shader（compile test / 运行时 assembler 直接读）——
  cloudShapeFrag: _cloudShapeFrag,
  cloudShapeDetailFrag: _cloudShapeDetailFrag,
  cloudsFrag: _cloudsFrag,
  cloudsVert: _cloudsVert,
  cloudsEffectFrag: _cloudsEffectFrag,
  cloudsResolveFrag: _cloudsResolveFrag,
  cloudsResolveVert: _cloudsResolveVert,
  localWeatherFrag: _localWeatherFrag,
  shadowFrag: _shadowFrag,
  shadowVert: _shadowVert,
  shadowResolveFrag: _shadowResolveFrag,
  shadowResolveVert: _shadowResolveVert,
  turbulenceFrag: _turbulenceFrag,
  weatherBakeFrag: _weatherBakeFrag
} as const
