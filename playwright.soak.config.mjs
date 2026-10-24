import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/soak',
  timeout: 600_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4180',
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4180',
    url: 'http://127.0.0.1:4180/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  }
})
