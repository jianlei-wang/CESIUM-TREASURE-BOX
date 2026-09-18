// clouds shader 离线编译组装器（供 clouds.compile.test.ts 调用；T8+ Cesium 运行时
// assembler 会复用同一份 resolveCloudsIncludes + 类似 define 注入策略）。
//
// 输入：clouds 本地 entry shader 原始源（含 #include <common>/#include "core/math"/
// #include "atmosphere/bruneton/runtime"/#pragma unroll_loop 等）+ 一组编译期 #define。
// 输出：自洽的 `#version 300 es` shader 串，可喂给 glslangValidator 编译。
//
// 资产层铁律（spec §4.2）：本组装器只做文本拼接，绝不向 GLSL 注入 czm_* 或 Three 标识符。
// clouds shader 自声明全部 uniform/in/out；Three <common>/<packing> 由 compatCommon/compatPacking
// 兼容桩覆盖； bruneton 经跨包 atmosphere/bruneton/* 别名引用 core 资产。
//
// 注：这些 #define 在 three-geospatial 原生由 THREE.ShaderMaterial.defines 注入；Cesium 移植后
// 由运行时 assembler 提供。本组装器给的值仅供 glslang 编译验证——值的具体量级不影响编译合法性。

import { resolveCloudsIncludes } from './resolveCloudsIncludes'

export type CloudsStage = 'frag' | 'vert'

// define 值类型：string/number 直接展开；true → 无值宏（flag）；false/null/undefined → 跳过。
export type CloudsDefineValue = string | number | boolean | null | undefined
export type CloudsDefines = Record<string, CloudsDefineValue>

export interface CloudsStandaloneOptions {
  stage?: CloudsStage
  defines?: CloudsDefines
  /** 附加在解析后源末尾的 GLSL 片段（如给 cloudsEffect 库 shader 补 main() wrapper）。 */
  suffix?: string
}

function formatDefine(name: string, value: CloudsDefineValue): string | null {
  if (value === false || value === null || value === undefined) return null
  if (value === true) return `#define ${name}`
  return `#define ${name} ${value}`
}

export function buildStandaloneCloudsShader(
  source: string,
  options: CloudsStandaloneOptions = {}
): string {
  const { stage = 'frag', defines = {}, suffix = '' } = options

  // 1) 解析 include（Three <chunk> → compat 桩 + 双引号 core/atmosphere/clouds + unrollLoops）
  const resolved = resolveCloudsIncludes(source)

  // 2) define 注入（放在 #version 之后、源之前——源里的 #ifndef 守卫会跳过重复定义）
  const defineLines = Object.entries(defines)
    .map(([k, v]) => formatDefine(k, v))
    .filter((line): line is string => line !== null)
    .join('\n')

  // 3) 默认 precision：ESSL 3.00 fragment 无 float 默认精度，必须显式声明。多数 clouds
  //    shader 自带 precision，重复声明在 ESSL 合法（最后一次生效）；对缺 precision 的库
  //    shader（cloudsEffect.frag 经 wrapper 编译）提供兜底。与 core buildAtmospherePrefix
  //    注入 precision + shader 自带 precision 的模式一致。
  const precision = 'precision highp float;\nprecision highp int;'

  // #version 必须是文件第一行（前后不能有注释/空行），否则 glslang 报错。
  return ['#version 300 es', defineLines, precision, resolved, suffix]
    .filter(chunk => chunk.length > 0)
    .join('\n')
}
