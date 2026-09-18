// weatherBake.frag 独立组装器——`#version` 头 + precision + #include 解析。
//
// 消费方（必须共用本函数，防两处组装漂移）：
//  - weatherBake.compile.test.ts（glslangValidator 离线编译验证）
//  - Task 5 WeatherAtlas 烘焙 pass（运行时真烘焙）
//
// include 解析复用 clouds 包统一管线 resolveCloudsIncludes（core resolveIncludes
// + 尖括号 compat + unrollLoops），嵌套索引树由调用方传入（默认 glslIndex）。

import { glslIndex } from './glslIndex'
import { resolveCloudsIncludes } from './resolveCloudsIncludes'

export function buildStandaloneWeatherBakeShader(
  index: typeof glslIndex = glslIndex
): string {
  // 烘焙 shader 是独立 entry（含 in varying vUv + MRT loc0 out），不经
  // CloudsMaterial 桥接手术——include 解析后直接可喂 glslangValidator 与运行时 pass。
  // 只补 #version 头不补 precision（评审 Minor 2：shader 本体自带 precision
  // highp float/int，头部再拼一遍属重复声明；#version 必须保持首行）。
  return `#version 300 es\n${resolveCloudsIncludes(index.weatherBakeFrag, index)}`
}
