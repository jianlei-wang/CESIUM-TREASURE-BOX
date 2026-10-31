import assert from 'node:assert/strict'
import { test } from 'node:test'

const sqlite = await import('node:sqlite').catch(() => null)
const DatabaseSync = sqlite?.DatabaseSync
const skip = DatabaseSync ? false : 'node:sqlite 需要 Node.js 22.5+'

function createD1() {
  const db = new DatabaseSync(':memory:')

  function statement(sql, params = []) {
    return {
      sql,
      params,
      bind(...next) {
        return statement(sql, next)
      },
      async all() {
        return { results: db.prepare(sql).all(...params) }
      },
      async first() {
        return db.prepare(sql).get(...params) ?? null
      },
      async run() {
        db.prepare(sql).run(...params)
        return { success: true }
      }
    }
  }

  function prepare(sql) {
    return statement(sql)
  }

  return {
    prepare,
    async batch(statements) {
      db.exec('BEGIN')
      try {
        for (const statement of statements) db.prepare(statement.sql).run(...statement.params)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return statements.map(() => ({ success: true }))
    }
  }
}

function createEnv() {
  return {
    DB: createD1(),
    ADMIN_TOKEN: 'secret-token',
    CATALOG_URL: 'http://catalog.test/cases.json',
    CORS_ORIGINS: 'https://jianlei-wang.github.io'
  }
}

const catalog = {
  generatedAt: '2026-10-31T00:00:00.000Z',
  categories: [{ id: 'effects', label: '三维特效' }],
  cases: [
    { id: 'case-a', title: '案例 A', category: 'effects', available: true },
    { id: 'case-b', title: '案例 B', category: 'effects', available: true }
  ]
}

const originalFetch = globalThis.fetch

function mockGlobalFetch() {
  globalThis.fetch = async (input) => {
    if (String(input).includes('catalog.test')) {
      return new Response(JSON.stringify(catalog), { status: 200 })
    }
    return originalFetch(input)
  }
}

function restoreFetch() {
  globalThis.fetch = originalFetch
}

async function loadWorker() {
  const mod = await import(`../index.mjs?t=${Date.now()}`)
  return mod.default
}

test(
  'GET /api/views 返回基线与累加结果',
  async () => {
    mockGlobalFetch()
    try {
      const worker = await loadWorker()
      const env = createEnv()
      const initial = await worker.fetch(new Request('http://local/api/views?ids=case-a,case-b'), env)
      const initialBody = await initial.json()
      assert.equal(initial.status, 200)
      assert.ok(initialBody.views['case-a'] >= 10 && initialBody.views['case-a'] <= 200)

      const before = initialBody.views['case-a']
      const post = await worker.fetch(
        new Request('http://local/api/views', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'case-a' })
        }),
        env
      )
      const postBody = await post.json()
      assert.equal(post.status, 200)
      assert.equal(postBody.views, before + 1)

      const after = await (await worker.fetch(new Request('http://local/api/views?ids=case-a'), env)).json()
      assert.equal(after.views['case-a'], before + 1)
    } finally {
      restoreFetch()
    }
  },
  { skip }
)

test(
  'POST /api/views 拒绝未知与非法案例',
  async () => {
    mockGlobalFetch()
    try {
      const worker = await loadWorker()
      const env = createEnv()
      const unknown = await worker.fetch(
        new Request('http://local/api/views', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'no-such-case' })
        }),
        env
      )
      assert.equal(unknown.status, 404)

      const bad = await worker.fetch(
        new Request('http://local/api/views', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: '../../etc/passwd' })
        }),
        env
      )
      assert.equal(bad.status, 400)
    } finally {
      restoreFetch()
    }
  },
  { skip }
)

test(
  '后台登录与统计需要正确口令',
  async () => {
    mockGlobalFetch()
    try {
      const worker = await loadWorker()
      const env = createEnv()

      const denied = await worker.fetch(new Request('http://local/api/admin/stats'), env)
      assert.equal(denied.status, 401)

      const badLogin = await worker.fetch(
        new Request('http://local/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'wrong' })
        }),
        env
      )
      assert.equal(badLogin.status, 401)

      const login = await worker.fetch(
        new Request('http://local/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'secret-token' })
        }),
        env
      )
      assert.equal(login.status, 200)

      await worker.fetch(
        new Request('http://local/api/views', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'case-b' })
        }),
        env
      )

      const stats = await worker.fetch(
        new Request('http://local/api/admin/stats?days=7', {
          headers: { Authorization: 'Bearer secret-token' }
        }),
        env
      )
      assert.equal(stats.status, 200)
      const body = await stats.json()
      assert.equal(body.rangeDays, 7)
      assert.equal(body.trend.length, 7)
      assert.equal(body.totals.catalogCases, 2)
      assert.ok(body.totals.totalViews > 0)
      assert.ok(body.top.some((row) => row.id === 'case-b'))
      assert.ok(body.cases.some((row) => row.id === 'case-a'))
    } finally {
      restoreFetch()
    }
  },
  { skip }
)

test(
  'CORS 预检与响应头',
  async () => {
    mockGlobalFetch()
    try {
      const worker = await loadWorker()
      const env = createEnv()
      const preflight = await worker.fetch(
        new Request('http://local/api/views', {
          method: 'OPTIONS',
          headers: { Origin: 'https://jianlei-wang.github.io', 'Access-Control-Request-Method': 'POST' }
        }),
        env
      )
      assert.equal(preflight.status, 204)

      const response = await worker.fetch(
        new Request('http://local/api/views?ids=case-a', { headers: { Origin: 'https://jianlei-wang.github.io' } }),
        env
      )
      assert.equal(response.headers.get('access-control-allow-origin'), 'https://jianlei-wang.github.io')
    } finally {
      restoreFetch()
    }
  },
  { skip }
)
