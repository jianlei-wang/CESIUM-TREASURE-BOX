// ShadowResolveMaterial.ts
//
// M4 T3：three shadowResolve.frag（BSM temporal resolve）→ Cesium 单 cascade 组装器。
//
// shadowResolve.frag 是 three.js array RT resolve fragment：MRT out[CASCADE_COUNT] +
// unroll 循环逐 cascade（3×3 closest-fragment velocity reprojection + variance clipping +
// temporalAlpha 慢混合）。本项目 BSM 是 Texture3D 逐层（M3）——resolve 同款单 cascade 化：
//
// 手术（不动 glsl/shadowResolve.frag 原文，保持 three 版形态便于上游 diff）：
//   0. `in vec2 vUv;` → `in vec2 v_textureCoordinates;` + `#define vUv v_textureCoordinates`
//      （Cesium ViewportQuadVS 只输出 v_textureCoordinates——同 ShadowMaterial.ts 手法）
//   1. `uniform sampler2DArray inputBuffer;` / `historyBuffer` → `uniform sampler3D ...`
//   2. history 采样 z 归一化：z = (cascadeIndex+0.5)/CASCADE_COUNT（sampler3D z∈[0,1]
//      层中心——同 CloudsMaterial 手术 6 的 BSM 消费端语义）
//   3. MRT out 数组 → 单 out vec4；main unroll → cascade(u_cascadeIndex, outputColor)
//      （cascade 签名保留——参数 cascadeIndex 在单 cascade draw 时即 u_cascadeIndex 值）
//
// varianceClipping 宏（sampler3D 化）不在本函数做：varianceClipping.glsl 内部有自己的
// `#ifdef VARIANCE_SAMPLER_ARRAY → #define VARIANCE_SAMPLER sampler2DArray` 宏块，若在
// include 前重定义 VARIANCE_SAMPLER 会与之冲突（Macro redefined）——故原文保留
// `#define VARIANCE_SAMPLER_ARRAY 1`（coord 分支 ivec3 正确），在 resolveCloudsIncludes
// 展开后做后处理换 sampler 类型（见 buildShadowResolveFragmentShader，同 densityProfile
// const 注入的后处理模式）。
//
// texelFetch 路径（getClosestFragment / varianceClipping 的 ivec3 coord）不手术：
// texelFetch(sampler3D, ivec3, lod, ivec2 offset) 是合法 GLSL ES 3.0，velocity 层经
// coord + ivec3(0,0,CASCADE_COUNT) 寻址（bsmTexture depth=2N 的后半）与原文一致。
//
// uniform 清单（T5 uniformMap 依据）：inputBuffer/historyBuffer(sampler3D) + texelSize(vec2)
// + varianceGamma(float=1) + temporalAlpha(float=0.01，three 注释：BSM 单像素闪烁显眼，
// 极慢混合) + u_cascadeIndex(int，ShadowPass 注入)。

import { glslIndex } from './glslIndex'
import { resolveCloudsIncludes } from './resolveCloudsIncludes'

// M4 T3 桥接选项。
export interface ShadowResolveOptions {
  /** cascade 数（默认 3；须与 ShadowPass cascadeCount / 生成端 CASCADE_COUNT 一致）。 */
  cascadeCount?: number
}

type ResolvedShadowResolveOptions = Required<ShadowResolveOptions>

const DEFAULTS: ResolvedShadowResolveOptions = {
  cascadeCount: 3
}

// 文本手术。锚点唯一性（grep 验证 shadowResolve.frag）：vUv 声明 L16 / VARIANCE 宏 L3-4 /
// uniform L9-10 / out 数组 L19 / history 采样 L63 / main unroll 一段。
function surgeryShadowResolveFrag(source: string): string {
  let src = source
  // 0) varying 桥接（注释放声明上一行，保证精确串存在——防哑过用例依赖）
  src = src.replace(
    /in vec2 vUv;\n/,
    '// Cesium ViewportQuadVS 注入 v_textureCoordinates\n' +
      'in vec2 v_textureCoordinates;\n' +
      '#define vUv v_textureCoordinates\n'
  )
  // 1) uniform 类型
  src = src.replace('uniform sampler2DArray inputBuffer;', 'uniform sampler3D inputBuffer;')
  src = src.replace(
    'uniform sampler2DArray historyBuffer;',
    'uniform sampler3D historyBuffer;'
  )
  // 2) history 采样 z 归一化（层中心——sampler3D z 是归一化深度非 layer 索引）
  src = src.replace(
    'vec4 history = texture(historyBuffer, vec3(prevUv, float(cascadeIndex)));',
    'vec4 history = texture(historyBuffer, vec3(prevUv, (float(cascadeIndex) + 0.5) / float(CASCADE_COUNT)));'
  )
  // 3) MRT out 数组 → 单 out
  src = src.replace(
    /layout\(location = 0\) out vec4 outputColor\[CASCADE_COUNT\];\n/,
    'layout(location = 0) out vec4 outputColor;\n'
  )
  // 4) main unroll → 单 cascade（cascade 签名保留，传 u_cascadeIndex 实参）
  src = src.replace(
    /void main\(\) \{\n  #pragma unroll_loop_start\n[\s\S]*?#pragma unroll_loop_end\n\}/,
    'uniform int u_cascadeIndex;  // 每 draw 换值（同生成端模式）\n' +
      'void main() {\n' +
      '  cascade(u_cascadeIndex, outputColor);\n' +
      '}'
  )
  return src
}

/**
 * 组装 Cesium 运行时 BSM resolve fragment shader（three shadowResolve.frag → 单 cascade 桥接）。
 *
 * 结构：defines（CASCADE_COUNT）+ surgery 后 shadowResolve.frag（#include 内联 + unrollLoops
 * 由 resolveCloudsIncludes 处理）。不写 #version——由 Cesium ShaderProgram 注入；precision
 * 头部自带。
 */
export function buildShadowResolveFragmentShader(
  options: ShadowResolveOptions = {}
): string {
  const o: ResolvedShadowResolveOptions = { ...DEFAULTS, ...options }
  const defines = `#define CASCADE_COUNT ${o.cascadeCount}`
  const merged = [defines, surgeryShadowResolveFrag(glslIndex.shadowResolveFrag)].join('\n\n')
  let resolved = resolveCloudsIncludes(merged)

  // varianceClipping 宏后处理（include 展开后）：VARIANCE_SAMPLER_ARRAY 分支的 sampler2DArray
  // 换 sampler3D（coord 分支 ivec3 原文已对）。锚点唯一（varianceClipping.glsl 宏块一处，include 一次）。
  resolved = resolved.replace(
    '#define VARIANCE_SAMPLER sampler2DArray',
    '#define VARIANCE_SAMPLER sampler3D'
  )
  // texelFetchOffset(sampler3D, ...) 后处理：GLSL ES 3.0 无 sampler3D 的 texelFetchOffset
  // 重载（桌面 GL 才有；glslang ES profile 实测报 no matching overloaded function），换成
  // 显式 offset 加法 texelFetch(S, P + ivec3(off, 0), 0)——语义等价（offset 只作用于 xy）。
  // unrollLoops 展开后 offset 形如 neighborOffsets[0]/varianceOffsets[0]（ivec2 数组元素）；
  // 调用点两种排版（getClosestFragment 是 prettier 多行、varianceClipping 单行）——dotAll 跨行。
  // 锚点：uniform 名 inputBuffer + 两族 offset 数组名（非贪婪 + 回溯跨过 coord 参数嵌套逗号）。
  resolved = resolved.replace(
    /texelFetchOffset\(\s*inputBuffer,\s*(.+?),\s*0,\s*((?:neighborOffsets|varianceOffsets)\[\d+\])\s*\)/gs,
    'texelFetch(inputBuffer, $1 + ivec3($2, 0), 0)'
  )
  return resolved
}

/**
 * glslang 校验入口：补 #version 300 es + precision（sampler3D 覆盖 include 链）。
 * shadowResolve.frag 不引用 czm_*（纯纹理进纹理出），无需桩。
 */
export function buildStandaloneShadowResolveShaderForValidation(
  options: ShadowResolveOptions = {}
): string {
  const runtime = buildShadowResolveFragmentShader(options)
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'precision highp sampler2D;',
    'precision highp sampler3D;',
    runtime
  ].join('\n')
}
