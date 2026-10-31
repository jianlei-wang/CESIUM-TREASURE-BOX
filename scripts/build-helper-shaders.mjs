#!/usr/bin/env node
/**
 * 将 cesium-helpers-lib 内 vendored 包的 .glsl 着色器编译为同名 .js 模块（与上游 build-shaders.js 一致）。
 *
 * 上游仓库在 npm install / dev 时生成这些模块，本项目直接提交生成结果，避免额外构建步骤。
 * 运行方式：node scripts/build-helper-shaders.mjs
 */
import { glob, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pattern = join(root, 'src/cases/cesium-helpers-lib/packages/*/src/shaders/*.glsl')

let count = 0
for await (const glslFile of glob(pattern)) {
  const contents = (await readFile(glslFile, 'utf8')).replace(/\r\n/g, '\n')
  const jsFile = glslFile.replace(/\.glsl$/, '.js')
  await writeFile(
    jsFile,
    `// AUTO-GENERATED from ${glslFile.split('/').pop()} by scripts/build-helper-shaders.mjs\n/* eslint-disable */\nexport default ${JSON.stringify(contents)}\n`
  )
  count += 1
}
console.log(`build-helper-shaders: generated ${count} modules`)
