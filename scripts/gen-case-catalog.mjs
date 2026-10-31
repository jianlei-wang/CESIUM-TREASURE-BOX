#!/usr/bin/env node
/**
 * 生成运营后台与浏览量服务使用的案例目录 public/data/cases.json。
 * 数据来源：scripts/sync-cases.mjs 生成的 src/cases/manifest.ts 与 src/cases/index.ts 的分类定义。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'src/cases/manifest.ts')
const indexPath = join(root, 'src/cases/index.ts')
const outputPath = join(root, 'public/data/cases.json')

const manifest = readFileSync(manifestPath, 'utf8')
const index = readFileSync(indexPath, 'utf8')

const categories = [...index.matchAll(/\{\s*id:\s*'([\w-]+)'\s*,\s*label:\s*'([^']*)'/g)].map((match) => ({
  id: match[1],
  label: match[2]
}))
const categoryLabels = new Map(categories.map((item) => [item.id, item.label]))

const entries = []
for (const line of manifest.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{ id:')) continue
  const read = (field) => {
    const match = trimmed.match(new RegExp(`${field}:\\s*("(?:[^"\\\\]|\\\\.)*")`))
    if (!match) return ''
    try {
      return JSON.parse(match[1])
    } catch {
      return ''
    }
  }
  const id = read('id')
  if (!id) continue
  const category = read('category') || 'unknown'
  entries.push({
    id,
    title: read('title') || id,
    category,
    categoryLabel: categoryLabels.get(category) ?? category,
    available: /available:\s*true/.test(trimmed)
  })
}

entries.sort((left, right) => left.id.localeCompare(right.id))

const payload = {
  generatedAt: new Date().toISOString(),
  categories,
  cases: entries
}
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(`[case-catalog] 已生成 ${outputPath}（${entries.length} 个案例 / ${categories.length} 个分类）`)
