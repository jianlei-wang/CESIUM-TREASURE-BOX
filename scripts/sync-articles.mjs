#!/usr/bin/env node
/**
 * 拉取微信公众号专栏「Cesium 酱の百宝箱」的文章清单，按案例名称回填 CASE_LIST.md
 * 的「文章输出」「文章在线地址」两列（这两列属于人工维护列）。
 *
 * 规则：
 * - 通过 appmsgalbum JSON 接口分页拉取专栏全部文章（继续分页参数取上一页最后一条的 msgid/itemidx）；
 * - 只处理标题形如「第N篇：<案例名>——<副标题>」的文章（前缀使用阿拉伯数字，用以排除 SDK 开发系列「第二篇…」等中文数字篇）；
 * - 案例名 = 去掉篇号前缀与「——」后副标题后的剩余部分；
 * - 仅当案例名能在 CASE_LIST.md 中匹配到案例时才回填，未匹配的文章打印告警并跳过；
 * - 命中后：文章输出置 ✅️，文章在线地址写入文章链接（去掉 #rd 片段）；重复运行幂等；
 * - 同步更新表头汇总行「已输出文章」数量。
 *
 * 可通过环境变量覆盖专栏配置：
 *   WECHAT_ALBUM_BIZ  公众号 biz（默认 MzYzMjU2MDc5NQ==）
 *   WECHAT_ALBUM_ID   专栏 album_id（默认 4319901846464069638）
 *
 * 运行方式：npm run sync-articles
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const listPath = join(root, 'CASE_LIST.md')

const BIZ = process.env.WECHAT_ALBUM_BIZ || 'MzYzMjU2MDc5NQ=='
const ALBUM_ID = process.env.WECHAT_ALBUM_ID || '4319901846464069638'

const DONE = '\u2705\uFE0F'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchAlbumPage(beginMsgid, beginItemidx) {
  let url =
    `https://mp.weixin.qq.com/mp/appmsgalbum?action=getalbum&__biz=${BIZ}` +
    `&album_id=${ALBUM_ID}&count=10&f=json`
  if (beginMsgid) url += `&begin_msgid=${beginMsgid}&begin_itemidx=${beginItemidx}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`请求失败：HTTP ${res.status}`)
  const data = await res.json()
  return data.getalbum_resp || {}
}

async function fetchAllArticles() {
  const articles = []
  const seen = new Set()
  let beginMsgid = ''
  let beginItemidx = ''
  for (let page = 0; page < 100; page += 1) {
    const resp = await fetchAlbumPage(beginMsgid, beginItemidx)
    const list = resp.article_list || []
    if (!list.length) break
    for (const a of list) {
      if (seen.has(a.key)) continue
      seen.add(a.key)
      articles.push(a)
    }
    if (!resp.continue_flag || resp.continue_flag === '0') break
    const last = list[list.length - 1]
    beginMsgid = last.msgid
    beginItemidx = last.itemidx
    await sleep(400)
  }
  return articles
}

const rowRe = /^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$/
const titleRe = /^第\s*\d+\s*篇\s*[：:]\s*(.+)$/

async function main() {
  const source = readFileSync(listPath, 'utf8')
  const lines = source.split('\n')

  const nameToLine = new Map()
  for (let i = 0; i < lines.length; i += 1) {
    const m = rowRe.exec(lines[i])
    if (m) nameToLine.set(m[2], i)
  }
  if (!nameToLine.size) throw new Error(`未在 ${listPath} 中解析到任何案例行`)

  const articles = await fetchAllArticles()
  console.log(`[sync-articles] 拉取到专栏文章：${articles.length} 篇`)

  let updated = 0
  const warnings = []
  const matched = new Set()

  for (const a of articles) {
    const m = titleRe.exec(a.title || '')
    if (!m) continue
    const name = m[1].split('——')[0].trim()
    const lineIndex = nameToLine.get(name)
    if (lineIndex === undefined) {
      warnings.push(`[warn] 未匹配到案例，已跳过：${a.title}`)
      continue
    }
    if (matched.has(name)) {
      warnings.push(`[warn] 案例被多篇文章命中，保留首次匹配：${name}`)
      continue
    }
    matched.add(name)

    const url = (a.url || '').replace(/#rd$/, '')
    const row = rowRe.exec(lines[lineIndex])
    lines[lineIndex] = `| ${row[1]} | ${row[2]} | ${row[3]} | ${DONE} | ${url} |`
    updated += 1
  }

  let out = lines.join('\n')
  const doneCount = lines.filter((line) => {
    const m = rowRe.exec(line)
    return m && m[4].replace(/\uFE0F/g, '') === DONE.replace(/\uFE0F/g, '')
  }).length
  out = out.replace(/- 已输出文章：\d+/, `- 已输出文章：${doneCount}`)
  writeFileSync(listPath, out, 'utf8')

  console.log(`[sync-articles] 更新 ${listPath}`)
  console.log(`[sync-articles] 本次回填案例文章：${updated}，累计已输出文章：${doneCount}`)
  for (const w of warnings) console.log(w)
}

main().catch((err) => {
  console.error(`[sync-articles] 失败：${err.message}`)
  process.exit(1)
})
