const CASE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const MAX_IDS = 500
const MAX_DAYS = 365
const TOP_LIMIT = 10
const BASELINE_MIN = 10
const BASELINE_MAX = 200
const DEFAULT_CATALOG_URL = 'https://jianlei-wang.github.io/CESIUM-TREASURE-BOX/data/cases.json'

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
}

function json(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...jsonHeaders, ...extra }
  })
}

function corsHeaders(request, allowed) {
  const origin = request.headers.get('Origin')
  if (!origin) return {}
  const list = allowed ?? ['*']
  const wildcard = list.includes('*')
  if (!wildcard && !list.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': wildcard ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  }
}

function dayKey(date) {
  return date.toISOString().slice(0, 10)
}

function sanitizeCount(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return 0
  return Math.floor(num)
}

function randomBaseline() {
  const span = BASELINE_MAX - BASELINE_MIN + 1
  return BASELINE_MIN + Math.floor(Math.random() * span)
}

async function digest(value) {
  const data = new TextEncoder().encode(String(value))
  const hash = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(hash)
}

async function tokenMatches(candidate, expected) {
  if (typeof candidate !== 'string' || !candidate || !expected) return false
  const [left, right] = await Promise.all([digest(candidate), digest(expected)])
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index]
  return diff === 0
}

async function readJson(request) {
  const text = await request.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    const error = new Error('invalid json')
    error.status = 400
    throw error
  }
}

function normalizeCatalog(raw) {
  const cases = Array.isArray(raw?.cases)
    ? raw.cases
        .filter((item) => item && typeof item.id === 'string')
        .map((item) => ({
          id: item.id,
          title: typeof item.title === 'string' ? item.title : item.id,
          category: typeof item.category === 'string' ? item.category : 'unknown',
          categoryLabel: typeof item.categoryLabel === 'string' ? item.categoryLabel : '',
          available: item.available !== false
        }))
    : []
  const categories = Array.isArray(raw?.categories)
    ? raw.categories
        .filter((item) => item && typeof item.id === 'string')
        .map((item) => ({ id: item.id, label: typeof item.label === 'string' ? item.label : item.id }))
    : []
  return { generatedAt: raw?.generatedAt ?? '', cases, categories }
}

async function loadCatalog(env) {
  const url = env.CATALOG_URL || DEFAULT_CATALOG_URL
  try {
    const response = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } })
    if (!response.ok) return { generatedAt: '', cases: [], categories: [] }
    return normalizeCatalog(await response.json())
  } catch {
    return { generatedAt: '', cases: [], categories: [] }
  }
}

function withLabels(catalog) {
  const map = new Map(catalog.categories.map((item) => [item.id, item.label]))
  return catalog.cases.map((item) => ({
    ...item,
    categoryLabel: item.categoryLabel || map.get(item.category) || item.category
  }))
}

async function ensureSchema(env) {
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, views INTEGER NOT NULL DEFAULT 0, first_viewed_at TEXT NOT NULL DEFAULT '', last_viewed_at TEXT NOT NULL DEFAULT '')"
    ),
    env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS daily (date TEXT NOT NULL, case_id TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (date, case_id))'
    ),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_daily_date ON daily (date)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_cases_views ON cases (views DESC)')
  ])
}

async function applyBaseline(env, catalogIds) {
  if (!catalogIds.length) return
  const marker = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind('baseline_applied').first()
  if (marker?.value === 'true') return

  const existing = await env.DB.prepare('SELECT id, views FROM cases').all()
  const viewsById = new Map((existing.results ?? []).map((row) => [row.id, sanitizeCount(row.views)]))
  const now = new Date().toISOString()
  const statements = []
  for (const id of catalogIds) {
    const target = randomBaseline()
    if (sanitizeCount(viewsById.get(id)) >= target) continue
    statements.push(
      env.DB.prepare(
        'INSERT INTO cases (id, views, first_viewed_at, last_viewed_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET views = excluded.views'
      ).bind(id, target, now, now)
    )
  }
  statements.push(
    env.DB.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).bind('baseline_applied', 'true')
  )
  await env.DB.batch(statements)
  console.log(`[views] 基线初始化完成：${statements.length - 1} 个案例`)
}

async function getCounts(env, ids) {
  if (!ids.length) return {}
  const placeholders = ids.map(() => '?').join(',')
  const { results } = await env.DB.prepare(`SELECT id, views FROM cases WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all()
  const counts = {}
  for (const id of ids) counts[id] = 0
  for (const row of results ?? []) counts[row.id] = sanitizeCount(row.views)
  return counts
}

async function recordView(env, id) {
  const now = new Date()
  const timestamp = now.toISOString()
  const date = dayKey(now)
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO cases (id, views, first_viewed_at, last_viewed_at) VALUES (?, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET views = views + 1, last_viewed_at = excluded.last_viewed_at, first_viewed_at = CASE WHEN cases.first_viewed_at = '' THEN excluded.first_viewed_at ELSE cases.first_viewed_at END"
    ).bind(id, timestamp, timestamp),
    env.DB.prepare(
      'INSERT INTO daily (date, case_id, views) VALUES (?, ?, 1) ON CONFLICT(date, case_id) DO UPDATE SET views = views + 1'
    ).bind(date, id)
  ])
  const row = await env.DB.prepare('SELECT views, last_viewed_at FROM cases WHERE id = ?').bind(id).first()
  return { id, views: sanitizeCount(row?.views), lastViewedAt: row?.last_viewed_at ?? timestamp }
}

async function buildStats(env, days, catalog) {
  const rangeDays = Math.max(1, Math.min(MAX_DAYS, Math.floor(Number(days)) || 7))
  const today = new Date()
  const todayKey = dayKey(today)
  const dates = []
  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    dates.push(dayKey(new Date(today.getTime() - offset * 86400000)))
  }
  const last7 = []
  for (let offset = 6; offset >= 0; offset -= 1) last7.push(dayKey(new Date(today.getTime() - offset * 86400000)))

  const { results: caseRows } = await env.DB.prepare(
    'SELECT id, views, first_viewed_at, last_viewed_at FROM cases'
  ).all()
  const viewsById = new Map()
  const firstById = new Map()
  const lastById = new Map()
  for (const row of caseRows ?? []) {
    viewsById.set(row.id, sanitizeCount(row.views))
    firstById.set(row.id, row.first_viewed_at ?? '')
    lastById.set(row.id, row.last_viewed_at ?? '')
  }

  const datedRows = await env.DB.prepare(
    `SELECT date, SUM(views) AS views FROM daily WHERE date IN (${dates.map(() => '?').join(',')}) GROUP BY date`
  )
    .bind(...dates)
    .all()
  const trendMap = new Map((datedRows.results ?? []).map((row) => [row.date, sanitizeCount(row.views)]))
  const trend = dates.map((date) => ({ date, views: trendMap.get(date) ?? 0 }))

  const last7Rows = await env.DB.prepare(
    `SELECT SUM(views) AS views FROM daily WHERE date IN (${last7.map(() => '?').join(',')})`
  )
    .bind(...last7)
    .first()
  const todayRow = await env.DB.prepare('SELECT SUM(views) AS views FROM daily WHERE date = ?').bind(todayKey).first()

  const catalogIds = new Set(catalog.cases.map((item) => item.id))
  const ids = new Set([...viewsById.keys(), ...catalogIds])
  const metaById = new Map(catalog.cases.map((item) => [item.id, item]))
  const rows = [...ids].map((id) => {
    const meta = metaById.get(id)
    return {
      id,
      title: meta?.title ?? id,
      category: meta?.category ?? 'unknown',
      categoryLabel: meta?.categoryLabel ?? '',
      available: meta?.available ?? false,
      views: viewsById.get(id) ?? 0,
      firstViewedAt: firstById.get(id) ?? '',
      lastViewedAt: lastById.get(id) ?? ''
    }
  })

  const categories = {}
  for (const row of rows) {
    if (!row.views) continue
    categories[row.category] = (categories[row.category] ?? 0) + row.views
  }

  const sorted = [...rows].sort(
    (left, right) => right.views - left.views || left.title.localeCompare(right.title, 'zh-CN')
  )

  return {
    generatedAt: today.toISOString(),
    rangeDays,
    totals: {
      totalViews: rows.reduce((sum, row) => sum + row.views, 0),
      todayViews: sanitizeCount(todayRow?.views),
      last7DaysViews: sanitizeCount(last7Rows?.views),
      trackedCases: rows.filter((row) => row.views > 0).length,
      catalogCases: catalog.cases.length
    },
    trend,
    top: sorted.filter((row) => row.views > 0).slice(0, TOP_LIMIT),
    categoryBreakdown: Object.entries(categories)
      .map(([category, views]) => ({ category, views }))
      .sort((left, right) => right.views - left.views),
    cases: sorted
  }
}

async function handleRequest(request, env) {
  const url = new URL(request.url)
  const pathname = url.pathname
  const method = request.method

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(
        request,
        env.CORS_ORIGINS?.split(',').map((s) => s.trim())
      )
    })
  }

  if (pathname === '/api/health') {
    return json({ ok: true, uptime: 0 })
  }

  if (!env.DB) return json({ error: 'storage not configured' }, 500)

  if (pathname === '/api/views' && method === 'GET') {
    const ids = (url.searchParams.get('ids') ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => CASE_ID_RE.test(item))
      .slice(0, MAX_IDS)
    return json({ views: await getCounts(env, ids) })
  }

  if (pathname === '/api/views' && method === 'POST') {
    let body
    try {
      body = await readJson(request)
    } catch {
      return json({ error: 'invalid json' }, 400)
    }
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!CASE_ID_RE.test(id)) return json({ error: 'invalid case id' }, 400)
    const catalog = withLabels(await loadCatalog(env))
    if (catalog.length && !catalog.some((item) => item.id === id)) {
      return json({ error: 'unknown case' }, 404)
    }
    return json(await recordView(env, id))
  }

  if (pathname === '/api/admin/login' && method === 'POST') {
    let body
    try {
      body = await readJson(request)
    } catch {
      return json({ error: 'invalid json' }, 400)
    }
    if (!(await tokenMatches(body.token, env.ADMIN_TOKEN))) {
      return json({ error: 'invalid token' }, 401)
    }
    return json({ ok: true })
  }

  if (pathname.startsWith('/api/admin/')) {
    const header = request.headers.get('Authorization') ?? ''
    const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
    const custom = request.headers.get('X-Admin-Token') ?? ''
    const token = bearer || custom
    if (!(await tokenMatches(token, env.ADMIN_TOKEN))) return json({ error: 'unauthorized' }, 401)

    if (pathname === '/api/admin/stats' && method === 'GET') {
      const catalog = withLabels(await loadCatalog(env))
      return json(await buildStats(env, url.searchParams.get('days') ?? 7, { ...catalog, cases: catalog }))
    }
    if (pathname === '/api/admin/catalog' && method === 'GET') {
      return json(await loadCatalog(env))
    }
    return json({ error: 'not found' }, 404)
  }

  return json({ error: 'not found' }, 404)
}

let bootstrapped = false

async function bootstrap(env) {
  if (bootstrapped) return
  await ensureSchema(env)
  const catalog = await loadCatalog(env)
  await applyBaseline(
    env,
    catalog.cases.map((item) => item.id)
  )
  bootstrapped = true
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(
      request,
      env.CORS_ORIGINS?.split(',').map((s) => s.trim())
    )
    try {
      await bootstrap(env)
      const response = await handleRequest(request, env)
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value)
      return response
    } catch (error) {
      console.error('[views] 请求处理失败', error)
      return json({ error: 'internal error' }, 500, headers)
    }
  }
}

export { buildStats, getCounts, recordView, applyBaseline, normalizeCatalog, tokenMatches, dayKey }
