// CloudsResolveMaterial.ts
//
// M4 T2：three cloudsResolve.frag（temporal upscale resolve）→ Cesium fragment 组装器。
//
// cloudsResolve.frag 是 three.js 全分 resolve fragment：TEMPORAL_UPSCALE 分支（1/4 分 march →
// Bayer 4×4 全分重建：1/16 texel 直通 current，其余 velocity reprojection + variance clipping）
// 或 temporalAntialiasing 分支（同分 TAA）。本项目 M4 用 upscale 分支（plan D3 march 1/4 分）。
//
// 手术（不动 glsl/cloudsResolve.frag 原文，保持 three 版形态便于上游 diff）：
//   1. `in vec2 vUv;` → `in vec2 v_textureCoordinates;` + `#define vUv v_textureCoordinates`
//      （Cesium ViewportQuadVS 只输出 v_textureCoordinates——同 ShadowMaterial.ts 手法）
//   2. 删 `uniform vec2 jitterOffset;`（three 原文声明但 frag 未消费；删掉免绑空 uniform）
//
// 非 surgery：`#include "core/turbo" / "catmullRomSampling" / "varianceClipping"` 经
// resolveCloudsIncludes 内联（glslIndex 已注册）；`#pragma unroll_loop_*` 由其内 unrollLoops 展开。
// precision：cloudsResolve.frag 头部自带 highp float/sampler2DArray。
// uniform 清单（T4 uniformMap 依据）：colorBuffer/depthVelocityBuffer/colorHistoryBuffer
// (sampler2D) + texelSize(vec2) + frame(int) + varianceGamma(float=2) + temporalAlpha(float=0.1)。
//
// 双入口（仿 CloudsMaterial.ts）：运行时无 #version（Cesium ShaderProgram 注入）；
// 校验入口补 #version 300 es + precision（sampler2DArray 覆盖 include 链）。

import { glslIndex } from './glslIndex'
import { resolveCloudsIncludes } from './resolveCloudsIncludes'

// M4 T2 桥接选项。
export interface CloudsResolveOptions {
  /**
   * TEMPORAL_UPSCALE 编译分支开关（默认 true）：1/4 分 march → Bayer 4×4 全分重建。
   * false 走 temporalAntialiasing（同分 TAA）分支——M4 不用，编译分支保留对齐 three。
   */
  temporalUpscale?: boolean
  /**
   * upscale 降采样分母（涂抹修复 T1，2026-09-02）：注入 #define UPSCALE_DIVISOR N，
   * frag 据此选低分坐标除法与直通 Bayer 映射（2 → 2×2 块 4 相位；4 → 4×4 块 16 相位
   * three 原文）。须与 CloudsPass options.upscaleDivisor 传同值。缺省 1（2026-09-02
   * 用户定稿全分 TAA 档；T1 合并时缺省 4）。
   */
  upscaleDivisor?: 1 | 2 | 4
}

type ResolvedCloudsResolveOptions = Required<CloudsResolveOptions>

const DEFAULTS: ResolvedCloudsResolveOptions = {
  temporalUpscale: true,
  upscaleDivisor: 1
}

// 文本手术：vUv 桥接 + 删 jitterOffset。锚点唯一性：`in vec2 vUv;` 一处、
// `uniform vec2 jitterOffset;` 一处（grep 验证 cloudsResolve.frag L23/L21）。
function surgeryCloudsResolveFrag(source: string): string {
  let src = source
  // 1) varying 桥接（注释放声明上一行，保证精确串存在——防哑过用例依赖）
  src = src.replace(
    /in vec2 vUv;\n/,
    '// Cesium ViewportQuadVS 注入 v_textureCoordinates\n' +
      'in vec2 v_textureCoordinates;\n' +
      '#define vUv v_textureCoordinates\n'
  )
  // 2) 删 jitterOffset（three 声明未消费）
  src = src.replace(/uniform vec2 jitterOffset;\n/, '')
  return src
}

/**
 * 组装 Cesium 运行时云 resolve fragment shader（three cloudsResolve.frag → Cesium 桥接）。
 *
 * 结构：defines + surgery 后 cloudsResolve.frag（#include 内联 + unrollLoops 由
 * resolveCloudsIncludes 处理）。不写 #version——由 Cesium ShaderProgram 注入。
 */
export function buildCloudsResolveFragmentShader(
  options: CloudsResolveOptions = {}
): string {
  const o: ResolvedCloudsResolveOptions = { ...DEFAULTS, ...options }
  const defines = [
    o.temporalUpscale ? '#define TEMPORAL_UPSCALE' : '',
    `#define UPSCALE_DIVISOR ${o.upscaleDivisor}`
  ]
    .filter((s) => s.length > 0)
    .join('\n')
  const merged = [defines, surgeryCloudsResolveFrag(glslIndex.cloudsResolveFrag)].join('\n\n')
  return resolveCloudsIncludes(merged)
}

/**
 * glslang 校验入口：补 #version 300 es + precision。
 *
 * cloudsResolve.frag 不引用任何 czm_*（纯纹理进纹理出），无需 CZM_STUBS。precision 覆盖
 * include 链 sampler 类型（sampler2D/sampler2DArray）。
 */
export function buildStandaloneCloudsResolveShaderForValidation(
  options: CloudsResolveOptions = {}
): string {
  const runtime = buildCloudsResolveFragmentShader(options)
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'precision highp sampler2D;',
    'precision highp sampler2DArray;',
    runtime
  ].join('\n')
}
