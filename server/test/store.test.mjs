import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { BASELINE_MAX, BASELINE_MIN, createViewStore } from '../store.mjs'

async function tempFile() {
  const dir = await mkdtemp(join(tmpdir(), 'case-views-'))
  return join(dir, 'data/case-views.json')
}

test('记录浏览后累加浏览量并写入每日明细', async () => {
  const dataFile = await tempFile()
  const fixed = new Date('2026-10-31T08:00:00.000Z')
  const store = createViewStore({ dataFile, now: () => fixed, debounceMs: 10 })

  await store.record('affect-area')
  const second = await store.record('affect-area')
  await store.record('area-measure')

  assert.equal(second.views, 2)
  assert.deepEqual(await store.getCounts(['affect-area', 'area-measure', 'missing']), {
    'affect-area': 2,
    'area-measure': 1,
    missing: 0
  })

  await store.flush()
  assert.ok(existsSync(dataFile))
  const persisted = JSON.parse(await readFile(dataFile, 'utf8'))
  assert.equal(persisted.cases['affect-area'].views, 2)
  assert.equal(persisted.daily['2026-10-31']['affect-area'], 2)
})

test('数据文件损坏时以空数据启动', async () => {
  const dataFile = await tempFile()
  const store = createViewStore({ dataFile, logger: { warn() {}, error() {} } })
  await store.load()
  const result = await store.record('affect-area')
  assert.equal(result.views, 1)
})

test('统计结果包含总量、趋势、排行与分类分布', async () => {
  const dataFile = await tempFile()
  let current = new Date('2026-10-28T00:00:00.000Z')
  const store = createViewStore({ dataFile, now: () => current, debounceMs: 10 })

  await store.record('case-a')
  await store.record('case-a')
  current = new Date('2026-10-31T00:00:00.000Z')
  await store.record('case-b')

  const stats = store.stats({
    days: 7,
    catalog: [
      { id: 'case-a', title: '案例 A', category: 'effects', available: true },
      { id: 'case-b', title: '案例 B', category: 'water', available: true }
    ]
  })

  assert.equal(stats.totals.totalViews, 3)
  assert.equal(stats.totals.trackedCases, 2)
  assert.equal(stats.totals.catalogCases, 2)
  assert.equal(stats.trend.length, 7)
  assert.equal(stats.trend[stats.trend.length - 1].date, '2026-10-31')
  assert.equal(stats.trend[stats.trend.length - 1].views, 1)
  assert.equal(stats.top[0].id, 'case-a')
  assert.deepEqual(stats.categoryBreakdown, [
    { category: 'effects', views: 2 },
    { category: 'water', views: 1 }
  ])
})

test('按保留天数清理过期每日明细但保留累计值', async () => {
  const dataFile = await tempFile()
  let current = new Date('2026-01-01T00:00:00.000Z')
  const store = createViewStore({ dataFile, now: () => current, retentionDays: 30, debounceMs: 10 })
  await store.record('case-a')

  current = new Date('2026-03-15T00:00:00.000Z')
  const snapshot = store.snapshot()
  assert.equal(snapshot.daily['2026-01-01'], undefined)
  assert.equal(snapshot.cases['case-a'].views, 1)
})

test('首次启动为目录内案例生成 10-200 的随机基线', async () => {
  const dataFile = await tempFile()
  const store = createViewStore({ dataFile, debounceMs: 10 })
  const ids = Array.from({ length: 40 }, (_, index) => `case-${index}`)

  const first = await store.applyBaseline(ids)
  assert.equal(first.skipped, false)
  assert.equal(first.applied, ids.length)

  const counts = await store.getCounts(ids)
  for (const id of ids) {
    assert.ok(counts[id] >= BASELINE_MIN, `${id} 低于基线下限：${counts[id]}`)
    assert.ok(counts[id] <= BASELINE_MAX, `${id} 高于基线上限：${counts[id]}`)
  }

  const second = await store.applyBaseline(ids)
  assert.equal(second.skipped, true)
  assert.deepEqual(await store.getCounts(ids), counts)

  await store.flush()
  const persisted = JSON.parse(await readFile(dataFile, 'utf8'))
  assert.equal(persisted.baselineApplied, true)
})

test('基线不会覆盖已有的更高浏览量', async () => {
  const dataFile = await tempFile()
  const store = createViewStore({ dataFile, debounceMs: 10 })
  for (let index = 0; index < 400; index += 1) await store.record('hot-case')

  await store.applyBaseline(['hot-case', 'cold-case'])
  const counts = await store.getCounts(['hot-case', 'cold-case'])
  assert.equal(counts['hot-case'], 400)
  assert.ok(counts['cold-case'] >= BASELINE_MIN)
})
