import { createApp } from 'vue'
import { ElIcon } from 'element-plus'
import 'element-plus/es/components/icon/style/css'
import './style.css'
import App from './App.vue'
import { recordDiagnostic } from './cases/presentation-studio-lib/core/diagnostics'
import { runtimeConfig } from './runtime-config'

document.title = runtimeConfig.appTitle

type LongTaskSample = { start: number; duration: number }
declare global {
  interface Window {
    __STUDIO_LONG_TASKS__?: LongTaskSample[]
    __STUDIO_BOOT_MS__?: number
  }
}

const longTasks: LongTaskSample[] = []
window.__STUDIO_LONG_TASKS__ = longTasks
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTasks.push({ start: Math.round(entry.startTime), duration: Math.round(entry.duration) })
    }
    if (longTasks.length > 100) longTasks.splice(0, longTasks.length - 100)
  }).observe({ type: 'longtask', buffered: true })
} catch {}

const bootStarted = performance.now()
createApp(App).use(ElIcon).mount('#app')
requestAnimationFrame(() => {
  window.__STUDIO_BOOT_MS__ = Math.round(performance.now() - bootStarted)
  recordDiagnostic('orchestration', 'app-boot', 'info', { ms: window.__STUDIO_BOOT_MS__ })
})
