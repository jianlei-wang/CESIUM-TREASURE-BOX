import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const DATA_VERSION = 1
const BASELINE_MIN = 10
const BASELINE_MAX = 200

function emptyData() {
  return { version: DATA_VERSION, updatedAt: new Date().toISOString(), cases: {}, daily: {}, baselineApplied: false }
}

function randomBaseline() {
  const span = BASELINE_MAX - BASELINE_MIN + 1
  return BASELINE_MIN + Math.floor(Math.random() * span)
}

function dayKey(date) {
  return date.toISOString().slice(0, 10)
}

function sanitizeCount(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return 0
  return Math.floor(num)
}

function normalizeLoaded(raw) {
  const data = emptyData()
  if (!raw || typeof raw !== 'object') return data
  const cases = raw.cases && typeof raw.cases === 'object' ? raw.cases : {}
  for (const [id, entry] of Object.entries(cases)) {
    if (!entry || typeof entry !== 'object') continue
    data.cases[id] = {
      views: sanitizeCount(entry.views),
      firstViewedAt: typeof entry.firstViewedAt === 'string' ? entry.firstViewedAt : '',
      lastViewedAt: typeof entry.lastViewedAt === 'string' ? entry.lastViewedAt : ''
    }
  }
  data.baselineApplied = raw.baselineApplied === true
  const daily = raw.daily && typeof raw.daily === 'object' ? raw.daily : {}
  for (const [date, entries] of Object.entries(daily)) {
    if (!entries || typeof entries !== 'object') continue
    const bucket = {}
    for (const [id, count] of Object.entries(entries)) {
      const value = sanitizeCount(count)
      if (value > 0) bucket[id] = value
    }
    if (Object.keys(bucket).length) data.daily[date] = bucket
  }
  return data
}

function pruneDaily(data, retentionDays, today) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return
  const cutoff = new Date(today.getTime() - retentionDays * 86400000)
  const cutoffKey = dayKey(cutoff)
  for (const date of Object.keys(data.daily)) {
    if (date < cutoffKey) delete data.daily[date]
  }
}

function sumDaily(data, dates) {
  let total = 0
  for (const date of dates) {
    const bucket = data.daily[date]
    if (!bucket) continue
    for (const count of Object.values(bucket)) total += sanitizeCount(count)
  }
  return total
}

export function createViewStore(options = {}) {
  const dataFile = options.dataFile ?? join(process.cwd(), 'data/case-views.json')
  const retentionDays = options.retentionDays ?? 90
  const now = options.now ?? (() => new Date())
  const debounceMs = options.debounceMs ?? 500
  const logger = options.logger ?? console

  let data = emptyData()
  let loaded = false
  let writeTimer = null
  let pendingWrite = null
  let writeChain = Promise.resolve()

  async function load() {
    try {
      const text = await readFile(dataFile, 'utf8')
      data = normalizeLoaded(JSON.parse(text))
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        logger.warn?.(`[views] 数据文件不可解析，已按空数据启动：${error.message}`)
      }
      data = emptyData()
    }
    loaded = true
    pruneDaily(data, retentionDays, now())
    return data
  }

  async function ensureLoaded() {
    if (!loaded) await load()
  }

  function snapshot() {
    pruneDaily(data, retentionDays, now())
    return JSON.parse(JSON.stringify(data))
  }

  async function writeNow() {
    const payload = JSON.stringify(data, null, 2)
    const tmpFile = `${dataFile}.${process.pid}.tmp`
    await mkdir(dirname(dataFile), { recursive: true })
    await writeFile(tmpFile, payload, 'utf8')
    await rename(tmpFile, dataFile)
  }

  function scheduleWrite() {
    if (writeTimer) clearTimeout(writeTimer)
    writeTimer = setTimeout(() => {
      writeTimer = null
      pendingWrite = writeChain.then(writeNow).catch((error) => {
        logger.error?.(`[views] 持久化失败：${error.message}`)
      })
      writeChain = pendingWrite
    }, debounceMs)
    if (typeof writeTimer.unref === 'function') writeTimer.unref()
  }

  async function flush() {
    if (writeTimer) {
      clearTimeout(writeTimer)
      writeTimer = null
    }
    await ensureLoaded()
    pendingWrite = writeChain.then(writeNow)
    writeChain = pendingWrite
    await pendingWrite
    return snapshot()
  }

  async function record(id, at = now()) {
    await ensureLoaded()
    const timestamp = at.toISOString()
    const date = dayKey(at)
    const entry = data.cases[id] ?? { views: 0, firstViewedAt: timestamp, lastViewedAt: timestamp }
    entry.views = sanitizeCount(entry.views) + 1
    if (!entry.firstViewedAt) entry.firstViewedAt = timestamp
    entry.lastViewedAt = timestamp
    data.cases[id] = entry
    const bucket = data.daily[date] ?? {}
    bucket[id] = sanitizeCount(bucket[id]) + 1
    data.daily[date] = bucket
    data.updatedAt = timestamp
    pruneDaily(data, retentionDays, at)
    scheduleWrite()
    return { id, views: entry.views, lastViewedAt: entry.lastViewedAt }
  }

  async function applyBaseline(ids = []) {
    await ensureLoaded()
    if (data.baselineApplied) return { applied: 0, skipped: true }
    if (!ids.length) return { applied: 0, skipped: true }
    const timestamp = now().toISOString()
    let applied = 0
    for (const id of ids) {
      if (!id) continue
      const entry = data.cases[id]
      const target = randomBaseline()
      if (entry && sanitizeCount(entry.views) >= target) continue
      data.cases[id] = {
        views: target,
        firstViewedAt: entry?.firstViewedAt || timestamp,
        lastViewedAt: entry?.lastViewedAt || timestamp
      }
      applied += 1
    }
    data.baselineApplied = true
    data.updatedAt = timestamp
    scheduleWrite()
    return { applied, skipped: false }
  }

  async function getCounts(ids = []) {
    await ensureLoaded()
    const result = {}
    for (const id of ids) result[id] = sanitizeCount(data.cases[id]?.views)
    return result
  }

  function caseRows(catalog = []) {
    const known = new Map(catalog.map((item) => [item.id, item]))
    const ids = new Set([...Object.keys(data.cases), ...catalog.map((item) => item.id)])
    const rows = []
    for (const id of ids) {
      const entry = data.cases[id]
      const meta = known.get(id)
      rows.push({
        id,
        title: meta?.title ?? id,
        category: meta?.category ?? 'unknown',
        available: meta?.available ?? false,
        views: sanitizeCount(entry?.views),
        firstViewedAt: entry?.firstViewedAt ?? '',
        lastViewedAt: entry?.lastViewedAt ?? ''
      })
    }
    return rows
  }

  function stats({ days = 7, topLimit = 10, catalog = [] } = {}) {
    const today = now()
    const historyDays = Math.max(1, Math.min(365, Math.floor(days) || 7))
    const trend = []
    const dates = []
    for (let offset = historyDays - 1; offset >= 0; offset -= 1) {
      const date = dayKey(new Date(today.getTime() - offset * 86400000))
      dates.push(date)
      const bucket = data.daily[date] ?? {}
      trend.push({
        date,
        views: Object.values(bucket).reduce((sum, count) => sum + sanitizeCount(count), 0)
      })
    }

    const rows = caseRows(catalog)
    const totalViews = rows.reduce((sum, row) => sum + row.views, 0)
    const todayKey = dayKey(today)
    const todayViews = Object.values(data.daily[todayKey] ?? {}).reduce((sum, count) => sum + sanitizeCount(count), 0)
    const last7Dates = []
    for (let offset = 6; offset >= 0; offset -= 1)
      last7Dates.push(dayKey(new Date(today.getTime() - offset * 86400000)))

    const categories = {}
    for (const row of rows) {
      if (!row.views) continue
      categories[row.category] = (categories[row.category] ?? 0) + row.views
    }

    const top = [...rows]
      .filter((row) => row.views > 0)
      .sort((left, right) => right.views - left.views || left.title.localeCompare(right.title, 'zh-CN'))
      .slice(0, Math.max(1, Math.min(50, topLimit)))

    return {
      generatedAt: today.toISOString(),
      rangeDays: historyDays,
      totals: {
        totalViews,
        todayViews,
        last7DaysViews: sumDaily(data, last7Dates),
        trackedCases: rows.filter((row) => row.views > 0).length,
        catalogCases: catalog.length
      },
      trend,
      top,
      categoryBreakdown: Object.entries(categories)
        .map(([category, views]) => ({ category, views }))
        .sort((left, right) => right.views - left.views),
      cases: rows.sort((left, right) => right.views - left.views || left.title.localeCompare(right.title, 'zh-CN'))
    }
  }

  return {
    load,
    flush,
    record,
    applyBaseline,
    getCounts,
    stats,
    snapshot,
    get dataFile() {
      return dataFile
    }
  }
}

export { dayKey, normalizeLoaded, randomBaseline, BASELINE_MIN, BASELINE_MAX }
