#!/usr/bin/env node
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { createGzip } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { createViewStore } from './store.mjs'
import { defaultCatalogFile, loadCatalog } from './catalog.mjs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  dataFile: resolve(process.env.VIEWS_DATA_FILE ?? join(rootDir, 'data/case-views.json')),
  tokenFile: resolve(process.env.ADMIN_TOKEN_FILE ?? join(rootDir, 'data/admin-token.txt')),
  staticRoot: resolve(process.env.STATIC_ROOT ?? join(rootDir, 'dist')),
  catalogFile: process.env.VIEWS_CATALOG_FILE ? resolve(process.env.VIEWS_CATALOG_FILE) : '',
  retentionDays: Number(process.env.VIEW_RETENTION_DAYS ?? 90),
  envToken: (process.env.ADMIN_TOKEN ?? '').trim()
}

const CASE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const MAX_BODY_BYTES = 8 * 1024

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.dat': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.wld': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.czml': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.kml': 'application/vnd.google-earth.kml+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
}

const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.xml',
  '.geojson',
  '.kml',
  '.txt',
  '.czml',
  '.dat'
])

function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders
  })
  res.end(body)
}

function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
  return req.socket.remoteAddress ?? 'unknown'
}

function createRateLimiter({ windowMs, limit }) {
  const buckets = new Map()
  return {
    hit(key) {
      const now = Date.now()
      const bucket = buckets.get(key)
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs })
        return { allowed: true, retryAfter: 0 }
      }
      bucket.count += 1
      if (bucket.count > limit) return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) }
      return { allowed: true, retryAfter: 0 }
    },
    reset(key) {
      buckets.delete(key)
    },
    sweep() {
      const now = Date.now()
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key)
      }
    }
  }
}

let catalogFileOverride = ''

const viewLimiter = createRateLimiter({ windowMs: 60_000, limit: 120 })
const loginLimiter = createRateLimiter({ windowMs: 60_000, limit: 20 })
const loginSweep = setInterval(() => {
  viewLimiter.sweep()
  loginLimiter.sweep()
}, 60_000)
loginSweep.unref()

async function readBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        rejectPromise(Object.assign(new Error('payload too large'), { statusCode: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) {
        resolvePromise({})
        return
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        rejectPromise(Object.assign(new Error('invalid json'), { statusCode: 400 }))
      }
    })
    req.on('error', rejectPromise)
  })
}

async function resolveAdminToken() {
  if (config.envToken) return { token: config.envToken, source: 'ADMIN_TOKEN' }
  try {
    const existing = (await readFile(config.tokenFile, 'utf8')).trim()
    if (existing) return { token: existing, source: 'file' }
  } catch {
    /* 首次启动时生成 */
  }
  const token = `cv_${randomBytes(18).toString('base64url')}`
  await mkdir(dirname(config.tokenFile), { recursive: true })
  await writeFile(config.tokenFile, `${token}\n`, { mode: 0o600 })
  return { token, source: 'generated' }
}

function tokenMatches(candidate, expected) {
  if (!candidate || !expected) return false
  const left = createHash('sha256').update(String(candidate)).digest()
  const right = createHash('sha256').update(String(expected)).digest()
  return timingSafeEqual(left, right)
}

function extractToken(req) {
  const header = req.headers.authorization
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
  const custom = req.headers['x-admin-token']
  if (typeof custom === 'string') return custom.trim()
  return ''
}

async function resolveCatalog() {
  const candidates = catalogFileOverride
    ? [catalogFileOverride]
    : config.catalogFile
      ? [config.catalogFile]
      : [
          defaultCatalogFile(config.staticRoot),
          join(rootDir, 'public/data/cases.json'),
          join(rootDir, 'data/cases-catalog.json')
        ]
  for (const file of candidates) {
    const catalog = await loadCatalog(file)
    if (catalog.cases.length) return catalog
  }
  return { generatedAt: '', cases: [], categories: [] }
}

function categoryLabels(catalog) {
  const map = new Map(catalog.categories.map((item) => [item.id, item.label]))
  return catalog.cases.map((item) => ({
    ...item,
    categoryLabel: item.categoryLabel || map.get(item.category) || item.category
  }))
}

async function serveStatic(req, res, pathname) {
  let decoded = ''
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    json(res, 400, { error: 'bad path' })
    return
  }
  const normalizedPath = normalize(decoded).replace(/^([/\\])+/, '')
  if (normalizedPath.includes('..')) {
    json(res, 400, { error: 'bad path' })
    return
  }
  const filePath = join(config.staticRoot, normalizedPath)
  if (!filePath.startsWith(config.staticRoot + sep) && filePath !== config.staticRoot) {
    json(res, 403, { error: 'forbidden' })
    return
  }

  let target = filePath
  let info = null
  try {
    info = await stat(target)
    if (info.isDirectory()) {
      target = join(target, 'index.html')
      info = await stat(target)
    }
  } catch {
    info = null
  }

  if (!info) {
    if (extname(decoded)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not Found')
      return
    }
    const fallback = join(config.staticRoot, 'index.html')
    try {
      info = await stat(fallback)
      target = fallback
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not Found')
      return
    }
  }

  const ext = extname(target).toLowerCase()
  const headers = {
    'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff'
  }
  if (target.endsWith(`${sep}runtime-config.js`)) {
    headers['Cache-Control'] = 'no-store'
  } else if (/\/(assets|cesium)\//.test(target.replaceAll(sep, '/'))) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable'
  } else {
    headers['Cache-Control'] = 'public, max-age=300'
  }

  const acceptEncoding = String(req.headers['accept-encoding'] ?? '')
  const compressible = COMPRESSIBLE.has(ext) && info.size > 1024 && acceptEncoding.includes('gzip')
  if (compressible) {
    headers['Content-Encoding'] = 'gzip'
    headers['Vary'] = 'Accept-Encoding'
  } else {
    headers['Content-Length'] = info.size
  }

  if (req.method === 'HEAD') {
    res.writeHead(200, headers)
    res.end()
    return
  }

  res.writeHead(200, headers)
  const stream = createReadStream(target)
  if (compressible) {
    const gzip = createGzip({ level: 6 })
    stream.pipe(gzip).pipe(res)
  } else {
    stream.pipe(res)
  }
  stream.on('error', () => res.destroy())
}

export async function createViewServer(options = {}) {
  const store = options.store ?? createViewStore({ dataFile: config.dataFile, retentionDays: config.retentionDays })
  let adminToken = options.adminToken ?? ''
  if (!adminToken) {
    const resolved = await resolveAdminToken()
    adminToken = resolved.token
    if (resolved.source === 'generated') {
      console.log(`[views] 已生成管理员口令（保存在 ${config.tokenFile}）：${resolved.token}`)
    }
  }
  catalogFileOverride = options.catalogFile ? resolve(options.catalogFile) : ''
  await store.load()
  const initialCatalog = categoryLabels(await resolveCatalog())
  const seeded = await store.applyBaseline(initialCatalog.map((item) => item.id))
  if (!seeded.skipped) {
    console.log(`[views] 已完成案例浏览量基线初始化：${seeded.applied} 个案例`)
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const pathname = url.pathname
    const method = req.method ?? 'GET'

    try {
      if (pathname === '/api/health') {
        json(res, 200, { ok: true, uptime: Math.round(process.uptime()) })
        return
      }

      if (pathname === '/api/views' && method === 'GET') {
        const ids = (url.searchParams.get('ids') ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter((item) => CASE_ID_RE.test(item))
          .slice(0, 500)
        const views = await store.getCounts(ids)
        json(res, 200, { views })
        return
      }

      if (pathname === '/api/views' && method === 'POST') {
        const limit = viewLimiter.hit(clientKey(req))
        if (!limit.allowed) {
          json(res, 429, { error: 'too many requests' }, { 'Retry-After': String(limit.retryAfter) })
          return
        }
        const body = await readBody(req)
        const id = typeof body.id === 'string' ? body.id.trim() : ''
        if (!CASE_ID_RE.test(id)) {
          json(res, 400, { error: 'invalid case id' })
          return
        }
        const catalog = categoryLabels(await resolveCatalog())
        if (catalog.length && !catalog.some((item) => item.id === id)) {
          json(res, 404, { error: 'unknown case' })
          return
        }
        const recorded = await store.record(id)
        json(res, 200, recorded)
        return
      }

      if (pathname === '/api/admin/login' && method === 'POST') {
        const key = clientKey(req)
        const limit = loginLimiter.hit(key)
        if (!limit.allowed) {
          json(res, 429, { error: 'too many attempts' }, { 'Retry-After': String(limit.retryAfter) })
          return
        }
        const body = await readBody(req)
        if (!tokenMatches(body.token, adminToken)) {
          json(res, 401, { error: 'invalid token' })
          return
        }
        loginLimiter.reset(key)
        json(res, 200, { ok: true })
        return
      }

      if (pathname.startsWith('/api/admin/')) {
        if (!tokenMatches(extractToken(req), adminToken)) {
          json(res, 401, { error: 'unauthorized' })
          return
        }
        if (pathname === '/api/admin/stats' && method === 'GET') {
          const days = Number(url.searchParams.get('days') ?? 7)
          const catalog = categoryLabels(await resolveCatalog())
          const stats = store.stats({ days, catalog })
          json(res, 200, stats)
          return
        }
        if (pathname === '/api/admin/catalog' && method === 'GET') {
          json(res, 200, await resolveCatalog())
          return
        }
        json(res, 404, { error: 'not found' })
        return
      }

      if (method === 'GET' || method === 'HEAD') {
        if (pathname === '/admin') {
          res.writeHead(301, { Location: '/admin/' })
          res.end()
          return
        }
        await serveStatic(req, res, pathname)
        return
      }

      json(res, 405, { error: 'method not allowed' })
    } catch (error) {
      const statusCode = error?.statusCode ?? 500
      if (statusCode >= 500) console.error('[views] 请求处理失败', error)
      json(res, statusCode, { error: statusCode === 500 ? 'internal error' : error.message })
    }
  })

  return { server, store, adminToken, config }
}

async function main() {
  try {
    await access(config.staticRoot)
  } catch {
    console.warn(`[views] 静态目录不存在：${config.staticRoot}（仅提供 /api 接口）`)
  }
  const { server, store } = await createViewServer()
  server.listen(config.port, config.host, () => {
    console.log(`[views] 浏览量服务已启动：http://${config.host}:${config.port}`)
    console.log(`[views] 数据文件：${store.dataFile}`)
    console.log(`[views] 后台入口：/admin/`)
  })
  const shutdown = async (signal) => {
    console.log(`[views] 收到 ${signal}，正在保存数据`)
    server.close()
    try {
      await store.flush()
    } catch (error) {
      console.error('[views] 退出前保存失败', error)
    }
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main()
}
