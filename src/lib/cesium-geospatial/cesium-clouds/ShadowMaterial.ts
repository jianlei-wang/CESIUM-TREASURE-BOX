// ShadowMaterial.ts
//
// M3 T2：three shadow.frag（BSM sun-POV march）→ Cesium 生成端 shader 桥接组装器。
//
// shadow.frag 是 three.js 生成端 fragment：MRT out 数组（outputColor[CASCADE_COUNT] +
// outputDepthVelocity[CASCADE_COUNT]）+ main unroll 循环逐 cascade 输出 + TEMPORAL_PASS
// velocity 出参。M3 Cesium 侧改为「单 draw 单 cascade」——每个 cascade 一次 viewport draw
// （u_cascadeIndex uniform 选 cascade，同 shader 复用 ShaderProgram 缓存），MRT/temporal
// 全部裁掉。本组装器在编排层做文本手术（不动 shadow.frag 原文，保持 three 版形态便于上游
// diff），surgery 决策（plan 决策 D5）：
//   1. `in vec2 vUv;` → `in vec2 v_textureCoordinates;` + `#define vUv v_textureCoordinates`
//      （Cesium ViewportQuadVS 只输出 v_textureCoordinates，声明需 shader 自带——同
//      CloudsMaterial.ts 桥接）
//   2. MRT out 数组 → 单 out vec4 outputColor（每 draw 一个 cascade，u_cascadeIndex uniform）
//   3. 删 outputDepthVelocity 声明块（#if CASCADE_COUNT == 1..4 冗余段，含注释行）
//   4. 删 reprojectionMatrices uniform + cascade() velocity 出参与 TEMPORAL_PASS 段
//      （M4 T3 已按 three 原文加回：temporalPass=true 默认——velocity 单 out loc1 +
//      reprojectionMatrices[CASCADE_COUNT] + velocity 段原文；false 时与 M3 相同）
//   5. main 的 unroll 循环 → 单 cascade(u_cascadeIndex, mipLevels[u_cascadeIndex], outputColor[, velocity])
// shadow.frag 不引用任何 czm_*（无需 CZM_STUBS）。
//
// 后处理（resolveCloudsIncludes 之后，非 surgery）：densityProfile struct uniform → const
// 注入（T5 补）——Cesium uniformMap 无 struct 注入，值与主 march（CloudsMaterial.ts）逐字
// 一致，保 BSM 生成端与主 march 消费端的云密度同分布。
//
// 双入口（仿 core aerialPerspective.frag.ts / CloudsMaterial.ts）：
//   - buildCloudsShadowFragmentShader()：Cesium 运行时（无 #version；由 ShaderProgram 注入）
//   - buildStandaloneCloudsShadowShaderForValidation()：glslang 校验（补 #version 300 es +
//     precision；v_textureCoordinates 的 in 声明已由 surgery 1 注入）

import { glslIndex } from './glslIndex'
import { resolveCloudsIncludes } from './resolveCloudsIncludes'

// M3 T2 桥接选项（同 CloudsMaterial.ts 的编译分支开关；默认全开）。
export interface ShadowMainOptions {
  /**
   * SHAPE_DETAIL 分支开关（sampleMedia 走 shapeDetailTexture 细节修饰）。默认 true。
   */
  shapeDetail?: boolean
  /**
   * TURBULENCE 分支开关（sampleMedia 走 turbulenceTexture 卷曲位移）。默认 true。
   */
  turbulence?: boolean
  /**
   * TEMPORAL_PASS 编译分支开关（默认 true，M4）：velocity 输出（out loc1，texel 单位）
   * + reprojectionMatrices uniform。false = M3 行为（单 out、无 velocity）——诊断基线。
   */
  temporalPass?: boolean
  /**
   * 级联数（→ #define CASCADE_COUNT，inverseShadowMatrices/reprojectionMatrices 数组长）。
   * 默认 3。档位路径由 createCloudsStage 传 applied.shadow.cascadeCount（spec §6）。
   */
  cascadeCount?: number
}

// shadow 生成管线固定 define（不含 options 分支）。SHADOW 让 sampleWeather 走
// shadowLayerMask 乘法（clouds.glsl L87——BSM 只算 shadow=true 的层，与主 march 共享语义）；
// CASCADE_COUNT 曾在此固定为 3，质量档位化（spec §6）后移至 buildDefines 按选项动态生成
// （决策 D4 保留：与主 march SHADOW_CASCADE_COUNT 命名区分、值同源）；TEMPORAL_JITTER 开
// STBN 起点抖动（frame=0 静态 jitter，M4 递增）；LOCAL_WEATHER_CHANNELS 对齐主 march 的
// sampleWeather swizzle 宏。
const SHADOW_DEFINES_BASE = [
  '#define SHADOW',                 // sampleWeather 走 shadowLayerMask（BSM 只算 shadow=true 的层）
  '#define TEMPORAL_JITTER',        // STBN 静态 jitter（frame=0；M4 递增）
  '#define LOCAL_WEATHER_CHANNELS rgba'
]

// 调试/断言用 define 清单（T3 ShadowPass 可对照核对 uniform/分支期望）。
// 基础段（不含 CASCADE_COUNT——按选项 cascadeCount 动态生成，非固定管线 define）。
export const SHADOW_PIPELINE_DEFINES: readonly string[] = SHADOW_DEFINES_BASE

type ResolvedShadowMainOptions = Required<ShadowMainOptions>

const DEFAULTS: ResolvedShadowMainOptions = {
  shapeDetail: true,
  turbulence: true,
  temporalPass: true,
  cascadeCount: 3
}

// 构造 M3 运行期 define 集（基础管线 define + options 编译分支开关）。
function buildDefines(o: ResolvedShadowMainOptions): string {
  return [
    ...SHADOW_DEFINES_BASE,
    // CASCADE_COUNT：质量档位化（spec §6）自 SHADOW_DEFINES_BASE 移入——按选项动态生成，
    // low 档 2 级联（生成端 Texture3D 深度/uniform 数组长与其一致，ShadowPass 透传同值）
    '#define CASCADE_COUNT ' + o.cascadeCount,
    o.shapeDetail ? '#define SHAPE_DETAIL' : '',
    o.turbulence ? '#define TURBULENCE' : '',
    o.temporalPass ? '#define TEMPORAL_PASS' : ''
  ].filter((s) => s.length > 0).join('\n')
}

// 文本手术：单 cascade 化 shadow.frag 源（不改原 .glsl 文件）。锚点唯一性已核实（grep 验证）：
// `in vec2 vUv;` / out 数组 / velocity 块 / reprojectionMatrices 各一处；cascade 签名与
// TEMPORAL_PASS 段、main unroll 循环各一段。正则不匹配时应打印手术前后源对照调试（改正则，
// 不改 .glsl）。
//
// M4 T3：temporalPass=true（默认）时 velocity 相关段按 three 原文保留（单 cascade 化）：
//   - reprojectionMatrices[CASCADE_COUNT] uniform 保留（velocity 投影到上帧 cascade 矩阵）
//   - cascade() 签名保留 velocity 出参（单 draw 双 out：BSM 值 loc0 + velocity loc1）
//   - TEMPORAL_PASS 段保留（velocity 数学原文——`reprojectionMatrices[cascadeIndex]` 的
//     参数在单 cascade draw 时即 u_cascadeIndex 值，无需改写）
//   - main 调用带 velocity 出参 + loc1 out 单声明注入（替代原文 out 数组）
function surgeryShadowFrag(source: string, temporalPass: boolean): string {
  let src = source
  // 1) varying 桥接。注释放声明上一行——保证 `in vec2 v_textureCoordinates;\n` 逐字存在
  //    （shadowMain.compile.test.ts 防哑过用例以该精确串删声明验证 glslang 真抓错）。
  src = src.replace(
    /in vec2 vUv;\n/,
    '// Cesium ViewportQuadVS 注入 v_textureCoordinates\nin vec2 v_textureCoordinates;\n#define vUv v_textureCoordinates\n'
  )
  // 2) MRT out 数组 → 单 out
  src = src.replace(
    /layout\(location = 0\) out vec4 outputColor\[CASCADE_COUNT\];\n/,
    'layout(location = 0) out vec4 outputColor;\n'
  )
  // 3) 删 outputDepthVelocity 声明块（#if CASCADE_COUNT == 1..4 冗余段，含注释行）——
  //    temporalPass 时由手术 6 注入单 out 声明替代（velocity 是 vec3 非 vec4 数组）
  src = src.replace(/\n\/\/ Redundant notation for prettier\.\n#if CASCADE_COUNT == 1\n[\s\S]*?#endif \/\/ CASCADE_COUNT\n/, '\n')
  // 4) 删 reprojectionMatrices uniform（TEMPORAL_PASS 专用；temporalPass 时保留）
  if (!temporalPass) {
    src = src.replace(/uniform mat4 reprojectionMatrices\[CASCADE_COUNT\];\n/, '')
  }
  // 5) cascade() 签名：temporalPass 保留 velocity 出参（原文），否则去掉（M3 行为）
  src = src.replace(
    /  const float mipLevel,\n  out vec4 outputColor,\n  out vec3 outputDepthVelocity\n\) \{/,
    temporalPass
      ? '  const float mipLevel,\n  out vec4 outputColor,\n  out vec3 outputDepthVelocity\n) {'
      : '  const float mipLevel,\n  out vec4 outputColor\n) {'
  )
  if (!temporalPass) {
    // M3 删法：TEMPORAL_PASS 段整体移除
    src = src.replace(/\n  #ifdef TEMPORAL_PASS\n[\s\S]*?#else \/\/ TEMPORAL_PASS\n  outputDepthVelocity = vec3\(0\.0\);\n  #endif \/\/ TEMPORAL_PASS\n/, '\n')
  }
  // 6) main 单 cascade 调用（unroll 循环 → u_cascadeIndex）。main 内 `#pragma unroll_loop_*`
  //    随整段替换消失；marchClouds 内普通 for 循环不受 unrollLoops 影响。
  //    temporalPass 时：loc1 out 单声明（velocity）+ 调用带出参。
  src = src.replace(
    /void main\(\) \{\n  #pragma unroll_loop_start\n[\s\S]*?#pragma unroll_loop_end\n\}/,
    (temporalPass ? 'layout(location = 1) out vec3 outputDepthVelocity;\n' : '') +
      'uniform int u_cascadeIndex;  // 每 draw 换值（同 shader 复用 ShaderProgram 缓存）\n' +
      'void main() {\n' +
      (temporalPass
        ? '  cascade(u_cascadeIndex, mipLevels[u_cascadeIndex], outputColor, outputDepthVelocity);\n'
        : '  cascade(u_cascadeIndex, mipLevels[u_cascadeIndex], outputColor);\n') +
      '}'
  )
  return src
}

/**
 * 组装 Cesium 运行时 BSM 生成端 fragment shader（three shadow.frag → 单 cascade 桥接）。
 *
 * 结构：defines + surgery 后 shadow.frag 文本（#include 由 resolveCloudsIncludes 内联，
 * 含 Three <chunk> 兼容桩与 unrollLoops）。不写 #version / precision 兜底——shadow.frag
 * 原文 L1-2 已含 precision；#version 由 Cesium ShaderProgram 注入。
 */
export function buildCloudsShadowFragmentShader(options: ShadowMainOptions = {}): string {
  const o: ResolvedShadowMainOptions = { ...DEFAULTS, ...options }
  const merged = [buildDefines(o), surgeryShadowFrag(glslIndex.shadowFrag, o.temporalPass)].join('\n\n')
  let resolved = resolveCloudsIncludes(merged)

  // densityProfile struct uniform → const 注入（T5 补，与 CloudsMaterial.ts:391-395 同款）：
  // Cesium uniformMap 不支持 struct 注入（GL 链接后拆成 densityProfile.expTerms 等点分名，
  // uniformMap 按名查找不命中 → 全 0），而 getLayerDensity 消费它（clouds.glsl L103-109）——
  // 留 uniform 则云密度恒 0 → BSM 全 0 光深 → Beer=1（自阴影静默失效）。值 = CloudLayers.DEFAULT
  // packDensityProfiles（每层 (0,0,0.75,0.25) pack 成 vec4），与主 march 逐字一致——生成端/
  // 消费端密度分布不同会造成阴影与云形错位。
  resolved = resolved.replace(
    /uniform CloudDensityProfile densityProfile;\n/,
    `const CloudDensityProfile densityProfile = CloudDensityProfile(\n` +
      `  vec4(0.0), vec4(0.0), vec4(0.75), vec4(0.25));\n`
  )

  return resolved
}

/**
 * glslang 校验入口：补 #version 300 es + precision。
 *
 * v_textureCoordinates 的 in 声明已由 surgery 1 注入，无需额外桩（shadow.frag 不引用
 * czm_*）。precision 覆盖 include 链全部 sampler 类型（sampler2D/sampler3D；shadow 生成
 * 端不消费 shadowBuffer，无 sampler2DArray）。
 */
export function buildStandaloneCloudsShadowShaderForValidation(
  options: ShadowMainOptions = {}
): string {
  const runtime = buildCloudsShadowFragmentShader(options)
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'precision highp sampler2D;',
    'precision highp sampler3D;',
    runtime
  ].join('\n')
}
