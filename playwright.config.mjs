import { defineConfig, devices } from '@playwright/test'

const browsers = (process.env.E2E_BROWSERS ?? 'chromium')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

export default defineConfig({
  testDir: './tests/output',
  timeout: 120_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.03
    }
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4179',
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4179',
    url: 'http://127.0.0.1:4179/tests/fixtures/output-harness.html',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  },
  projects: browsers.map((name) => {
    const device = { chromium: 'Desktop Chrome', firefox: 'Desktop Firefox', webkit: 'Desktop Safari' }[name]
    return {
      name,
      use: {
        ...(device ? devices[device] : {}),
        viewport: { width: 1440, height: 960 },
        deviceScaleFactor: 1
      }
    }
  })
})
