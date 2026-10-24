import { expect, test } from '@playwright/test'

const durationSeconds = Number(process.env.SOAK_SECONDS ?? 30)

test('studio survives offline services and repeated step switching', async ({ page }, testInfo) => {
  const pageErrors = []
  const blockedHosts = new Set()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue()
    blockedHosts.add(url.hostname)
    return route.abort()
  })

  await page.goto('/')
  await page.locator('.category-item', { hasText: '系统DEMO' }).first().click()
  await page.locator('.demo-card', { hasText: '三维场景演示漫游制作系统' }).first().click()
  await expect(page.locator('.ps-root')).toBeVisible({ timeout: 60_000 })
  await page.waitForFunction(
    () => {
      const loading = document.querySelector('.ps-loading')
      return loading === null || loading.classList.contains('is-failed')
    },
    null,
    { timeout: 90_000 }
  )

  const started = Date.now()
  let cycles = 0
  while (Date.now() - started < durationSeconds * 1000) {
    const steps = page.locator('.ps-step__main')
    const count = await steps.count()
    if (count > 1) await steps.nth(cycles % count).click({ timeout: 10_000 })
    await page.keyboard.press('Space')
    await page.waitForTimeout(160)
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(120)
    cycles += 1
  }

  const report = await page.evaluate(() => {
    const diagnostics = window.__STUDIO_DIAGNOSTICS__ ?? []
    const longTasks = window.__STUDIO_LONG_TASKS__ ?? []
    const memory = performance.memory?.usedJSHeapSize ?? null
    const byChannel = {}
    const byLevel = {}
    for (const event of diagnostics) {
      byChannel[event.channel] = (byChannel[event.channel] ?? 0) + 1
      byLevel[event.level] = (byLevel[event.level] ?? 0) + 1
    }
    return {
      bootMs: window.__STUDIO_BOOT_MS__ ?? null,
      diagnostics: diagnostics.length,
      byChannel,
      byLevel,
      longTasks: longTasks.length,
      longestTaskMs: longTasks.reduce((max, item) => Math.max(max, item.duration), 0),
      usedJsHeapBytes: memory,
      recentErrors: diagnostics.filter((event) => event.level === 'error').slice(-8)
    }
  })
  await testInfo.attach('soak-report.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          durationSeconds,
          cycles,
          blockedHosts: [...blockedHosts],
          pageErrors,
          ...report
        },
        null,
        2
      )
    ),
    contentType: 'application/json'
  })

  console.log(
    `soak: ${cycles} iterations, ${report.diagnostics} events ${JSON.stringify(report.byChannel)} ${JSON.stringify(report.byLevel)}, ${report.longTasks} long tasks, longest ${report.longestTaskMs} ms`
  )
  if (report.recentErrors.length) console.log(`soak errors: ${JSON.stringify(report.recentErrors)}`)
  expect(pageErrors).toEqual([])
  expect(report.bootMs).not.toBeNull()
  expect(cycles).toBeGreaterThan(0)
})
