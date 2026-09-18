// clouds 包 #include 解析器（跨包机制核心）。
//
// 结论（记录到 T7 报告）：core 的 resolveIncludes 本身与"包"无关——它只对一个嵌套对象树
// 按路径分量（split('/')）walk 取字符串，不读文件系统。因此跨包 #include 无需改 core：
// clouds 从 @cesium-geospatial/core import glslIndex（core 已 export），在 clouds 的
// glslIndex.ts 里合并成超级索引（core/* 直引 + atmosphere/bruneton/* 路径别名 + clouds
// 本地 shader 顶层注册），再喂给同一份 resolveIncludes。
//
// 本文件在 core resolveIncludes 之上只补两件事：
// 1) 尖括号 Three chunk include：clouds 源里有 `#include <common>` / `#include <packing>`
//    （Three.js 运行时注入的 chunk 约定）。core 的 resolveIncludes 只匹配双引号形式
//    （正则 `#include +"..."`），尖括号原样残留会喂爆 glslang。此处先把已知 Three chunk
//    名映射到 clouds 本地兼容桩（compatCommon/compatPacking）的双引号形式，再走统一解析。
// 2) unrollLoops：`#pragma unroll_loop_start`（Three 的 GLSL 循环展开约定）需在 include
//    全部内联后做文本展开——顺序必须是 resolveIncludes 先、unrollLoops 后。

import { resolveIncludes, unrollLoops } from '../cesium-core'

import { glslIndex } from './glslIndex'

// 尖括号 include（Three.js chunk 形式）→ 双引号（本项目 resolveIncludes 形式）
const angleIncludePattern = /^[ \t]*#include\s+<(\w+)>/gm

// Three chunk 名 → clouds 兼容桩 key（见 glslIndex.ts）。
// 未登记的 chunk 名保持原样——resolveIncludes 会在双引号阶段抛清晰错误，而非静默丢弃。
const THREE_CHUNK_COMPAT: Record<string, string> = {
  common: 'compatCommon',
  packing: 'compatPacking'
}

export function resolveCloudsIncludes(
  source: string,
  includes: Record<string, unknown> = glslIndex as unknown as Record<string, unknown>
): string {
  const rewritten = source.replace(angleIncludePattern, (match, name: string) => {
    const stub = THREE_CHUNK_COMPAT[name]
    return stub ? `#include "${stub}"` : match
  })
  return unrollLoops(resolveIncludes(rewritten, includes as never))
}
