import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createViewServer } from '../index.mjs'
import { createViewStore } from '../store.mjs'

let baseUrl = ''
let server
let store

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'case-views-api-'))
  const catalogFile = join(dir, 'cases.json')
  await writeFile(
    catalogFile,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      categories: [{ id: 'effects', label: '三维特效' }],
      cases: [
        { id: 'case-a', title: '案例 A', category: 'effects', available: true },
        { id: 'case-b', title: '案例 B', category: 'effects', available: true }
      ]
    }),
    'utf8'
  )
  store = createViewStore({ dataFile: join(dir, 'views.json'), debounceMs: 10 })
  const created = await createViewServer({ store, adminToken: 'test-token', catalogFile })
  server = created.server
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  await store.flush()
})

async function post(path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
}

test('GET /api/views 返回指定案例浏览量', async () => {
  const initial = await (await fetch(`${baseUrl}/api/views?ids=case-a,case-b`)).json()
  await post('/api/views', { id: 'case-a' })
  const response = await fetch(`${baseUrl}/api/views?ids=case-a,case-b,unknown`)
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.views['case-a'], initial.views['case-a'] + 1)
  assert.equal(data.views['case-b'], initial.views['case-b'])
  assert.equal(data.views['unknown'], 0)
})

test('POST /api/views 拒绝非法案例标识', async () => {
  const response = await post('/api/views', { id: '../../etc/passwd' })
  assert.equal(response.status, 400)
})

test('POST /api/views 拒绝目录中不存在的案例', async () => {
  const response = await post('/api/views', { id: 'not-in-catalog' })
  assert.equal(response.status, 404)
})

test('后台接口需要有效口令', async () => {
  const unauthorized = await fetch(`${baseUrl}/api/admin/stats`)
  assert.equal(unauthorized.status, 401)

  const login = await post('/api/admin/login', { token: 'wrong-token' })
  assert.equal(login.status, 401)

  const ok = await post('/api/admin/login', { token: 'test-token' })
  assert.equal(ok.status, 200)

  const stats = await fetch(`${baseUrl}/api/admin/stats?days=7`, {
    headers: { Authorization: 'Bearer test-token' }
  })
  assert.equal(stats.status, 200)
  const data = await stats.json()
  assert.equal(data.totals.totalViews >= 1, true)
  assert.equal(Array.isArray(data.cases), true)
})
