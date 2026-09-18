#!/usr/bin/env node
/**
 * 扫描 src/cases/<dir>/index.ts，生成项目根目录 CASE_LIST.md 案例清单。
 *
 * 规则：
 * - 案例目录 = src/cases 下含 index.ts 且目录名不以 `-lib` 结尾的目录（与 sync-cases.mjs 一致）；
 * - 案例名称取 index.ts 默认导出对象的 title；
 * - 创建时间优先取 updatedAt，缺失时保留清单中已有值，新增案例回退到案例目录 / index.ts 的文件系统时间（birthtime，其次 mtime）；
 * - 文章输出、文章在线地址为人工维护列：重新生成时会按案例名称保留现有值，
 *   新案例文章输出默认 ❌、文章在线地址默认为空；
 * - 排序：创建时间升序，同日按名称排序，无时间的排在末尾。
 *
 * 运行方式：npm run case-list
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const casesRoot = join(root, 'src/cases')
const listPath = join(root, 'CASE_LIST.md')

const DONE = '\u2705\uFE0F'
const TODO = '\u274C\uFE0F'

const propOf = (source, key) => {
  const m = source.match(new RegExp(`${key}:\\s*['"\`]([^'"\`]+)['"\`]`))
  return m ? m[1] : null
}

const formatDate = (ms) => {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const fsTime = (p) => {
  try {
    const st = statSync(p)
    return st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs
  } catch {
    return 0
  }
}

const fallbackDate = (dir) => {
  const times = [fsTime(join(casesRoot, dir)), fsTime(join(casesRoot, dir, 'index.ts'))].filter((t) => t > 0)
  return times.length ? formatDate(Math.min(...times)) : ''
}

function readExistingRows() {
  const rows = new Map()
  if (!existsSync(listPath)) return rows
  const source = readFileSync(listPath, 'utf8')
  for (const line of source.split('\n')) {
    if (!line.trim().startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    if (!/^\d+$/.test(cells[0])) continue
    const name = cells[1]
    if (!name) continue
    const flag = (cells[3] || '').replace(/\uFE0F/g, '').trim()
    const url = (cells[4] || '').trim()
    const created = (cells[2] || '').trim()
    rows.set(name, {
      done: flag.startsWith(DONE.replace(/\uFE0F/g, '')),
      created: created === '-' ? '' : created,
      url: url === '-' ? '' : url,
    })
  }
  return rows
}

const dirs = readdirSync(casesRoot)
  .filter((d) => !d.endsWith('-lib'))
  .filter((d) => {
    try {
      return statSync(join(casesRoot, d)).isDirectory() && existsSync(join(casesRoot, d, 'index.ts'))
    } catch {
      return false
    }
  })

const previous = readExistingRows()

const cases = dirs.map((dir) => {
  const source = readFileSync(join(casesRoot, dir, 'index.ts'), 'utf8')
  const title = (propOf(source, 'title') || dir).replace(/\|/g, '/')
  const created = propOf(source, 'updatedAt') || previous.get(title)?.created || fallbackDate(dir)
  return { dir, title, created }
})

cases.sort(
  (a, b) =>
    (a.created || '9999-99-99').localeCompare(b.created || '9999-99-99') ||
    a.title.localeCompare(b.title, 'zh-Hans-CN')
)

const doneCount = cases.filter((c) => previous.get(c.title)?.done).length

const lines = []
lines.push('# 案例清单')
lines.push('')
lines.push('> 本文件由 `scripts/gen-case-list.mjs` 生成，记录系统当前全部案例及其文章输出状态。')
lines.push(`> 文章输出列由人工维护：${DONE} 表示已产出对应文章，${TODO} 表示尚未产出；重新生成时按案例名称自动保留。`)
lines.push('> 文章在线地址列由人工维护：填写文章发布后的访问链接，未发布时留空；重新生成时按案例名称自动保留。')
lines.push(`> 最近生成：${formatDate(Date.now())}`)
lines.push('')
lines.push(`- 案例总数：${cases.length}`)
lines.push(`- 已输出文章：${doneCount}`)
lines.push('')
lines.push('| 序号 | 案例名称 | 创建时间 | 文章输出 | 文章在线地址 |')
lines.push('| --- | --- | --- | --- | --- |')
cases.forEach((c, i) => {
  const prev = previous.get(c.title)
  const flag = prev?.done ? DONE : TODO
  const url = prev?.url || ''
  lines.push(`| ${i + 1} | ${c.title} | ${c.created || '-'} | ${flag} | ${url} |`)
})
lines.push('')

writeFileSync(listPath, lines.join('\n'), 'utf8')
console.log(`[gen-case-list] generated ${listPath}`)
console.log(`[gen-case-list] cases: ${cases.length}, articles done: ${doneCount}`)
