<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import systemLogo from './system-logo.jpeg'
import {
  ArrowDown,
  CaretRight,
  CircleCheckFilled,
  Close,
  Clock,
  Back,
  Document,
  MagicStick,
  Menu,
  Notebook,
  Picture,
  Search,
  Setting,
  Share,
  Star,
  VideoPlay,
  View
} from '@element-plus/icons-vue'
import { categories, demos, loadCaseEntry, type CaseMeta } from './cases'
const PerfChecklistDoc = defineAsyncComponent(() => import('./components/PerfChecklistDoc.vue'))
const SkillsPanel = defineAsyncComponent(() => import('./components/SkillsPanel.vue'))

type CesiumStatsLike = { triangles: number; tileQueue: number }

declare global {
  interface Window {
    Cesium?: Record<string, unknown>
  }
}

let cesiumStatsGetter: (() => CesiumStatsLike) | undefined

async function loadCesiumStats(): Promise<void> {
  if (cesiumStatsGetter) return
  try {
    const mod = await import('./lib/cesium-scene')
    cesiumStatsGetter = mod.getCesiumStats
  } catch {
    cesiumStatsGetter = undefined
  }
}

let cesiumPromise: Promise<void> | undefined

function injectCesiumScript(): Promise<void> {
  return new Promise((resolve) => {
    if (window.Cesium) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = 'cesium/Cesium.js'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      cesiumPromise = undefined
      resolve()
    }
    document.head.appendChild(script)
  })
}

function ensureCesium(): Promise<void> {
  if (window.Cesium) return Promise.resolve()
  if (!cesiumPromise) cesiumPromise = injectCesiumScript()
  return cesiumPromise
}

let cesiumPrefetchBound = false

function bindCesiumPrefetch() {
  if (cesiumPrefetchBound) return
  cesiumPrefetchBound = true
  const onHover = () => {
    void ensureCesium()
    window.removeEventListener('pointerover', onHover, true)
  }
  window.addEventListener('pointerover', onHover, true)
}

const activeCategory = ref('effects')
const mobileMenuOpen = ref(false)
const searchTerm = ref('')
const sortNewest = ref(true)
const showUpdatedAt = ref(true)
const helpOpen = ref(false)
const settingsOpen = ref(false)
const aboutOpen = ref(false)
const perfDocOpen = ref(false)
const skillsOpen = ref(false)
const fullCaseDemo = shallowRef<CaseMeta | null>(null)
const fullCaseComponent = shallowRef<import('vue').Component | null>(null)
const caseReady = ref(false)
let caseOpenSeq = 0

const currentCategory = computed(() => categories.find((item) => item.id === activeCategory.value) ?? categories[0])
const searching = computed(() => searchTerm.value.trim().length > 0)
const visibleDemos = computed(() => {
  const keyword = searchTerm.value.trim().toLowerCase()
  const filtered = demos.filter((demo) => {
    if (keyword) {
      return (
        demo.title.toLowerCase().includes(keyword) ||
        demo.description.toLowerCase().includes(keyword)
      )
    }
    return demo.category === activeCategory.value
  })
  if (!sortNewest.value) return filtered
  return [...filtered].sort((left, right) => (right.updatedAt ?? (right.available ? '2026-08-22' : '')).localeCompare(left.updatedAt ?? (left.available ? '2026-08-22' : '')))
})
const categoryCounts = computed(() => new Map(categories.map((category) => [category.id, demos.filter((demo) => demo.category === category.id).length])))
const totalDemos = computed(() => demos.length)
const availableDemos = computed(() => demos.filter((demo) => demo.available).length)

const GITHUB_REPO_URL = 'https://github.com/jianlei-wang/CESIUM-TREASURE-BOX'
const GITHUB_REPO_API = 'https://api.github.com/repos/jianlei-wang/CESIUM-TREASURE-BOX'
const githubStats = ref<{ watchers: number; forks: number; stars: number } | null>(null)

function formatRepoCount(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

async function fetchGithubStats() {
  try {
    const res = await fetch(GITHUB_REPO_API, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return
    const data = await res.json()
    githubStats.value = {
      watchers: data.subscribers_count ?? 0,
      forks: data.forks_count ?? 0,
      stars: data.stargazers_count ?? 0
    }
  } catch {
    /* 网络异常时静默忽略，仅不展示统计 */
  }
}

function selectCategory(id: string) {
  activeCategory.value = id
  mobileMenuOpen.value = false
  searchTerm.value = ''
}

async function openCase(demo: CaseMeta) {
  if (!demo.available) return
  const seq = ++caseOpenSeq
  await ensureCesium()
  const entry = await loadCaseEntry(demo.id)
  if (seq !== caseOpenSeq || !entry?.component) return
  fullCaseComponent.value = entry.component
  fullCaseDemo.value = demo
  caseReady.value = false
  setTimeout(() => {
    caseReady.value = true
  }, 10000)
}

function closeCase() {
  caseOpenSeq += 1
  fullCaseDemo.value = null
  fullCaseComponent.value = null
  caseReady.value = true
}

const fps = ref(0)
const frameTime = ref(0)
const jsHeapMB = ref(0)
const inp = ref(0)
const triangles = ref(0)
const tileQueue = ref(0)
const domNodes = ref(0)
const concurrentRequests = ref(0)

let fpsFrames = 0
let fpsLastTime = 0
let fpsRafId: number | undefined
let lastFrameTime = 0
let frameTimeSum = 0
let inpMax = 0
let resourceStarts = new Map<string, number>()

const fpsTone = computed(() => (fps.value >= 45 ? 'good' : fps.value >= 30 ? 'ok' : 'bad'))

function fpsTick() {
  fpsFrames += 1
  const now = performance.now()
  if (lastFrameTime > 0) frameTimeSum += now - lastFrameTime
  lastFrameTime = now

  if (now - fpsLastTime >= 1000) {
    const elapsed = now - fpsLastTime
    fps.value = Math.round((fpsFrames * 1000) / elapsed)
    frameTime.value = fpsFrames > 0 ? Math.round(frameTimeSum / fpsFrames) : 0
    fpsFrames = 0
    frameTimeSum = 0
    fpsLastTime = now

    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    jsHeapMB.value = memory ? Math.round(memory.usedJSHeapSize / 1048576) : 0

    const stats = cesiumStatsGetter?.() ?? { triangles: 0, tileQueue: 0 }
    triangles.value = stats.triangles
    tileQueue.value = stats.tileQueue

    domNodes.value = document.getElementsByTagName('*').length

    for (const [name, start] of resourceStarts) {
      if (now - start > 1500) resourceStarts.delete(name)
    }
    concurrentRequests.value = resourceStarts.size
  }

  fpsRafId = requestAnimationFrame(fpsTick)
}

function startFpsMonitor() {
  stopFpsMonitor()
  fps.value = 0
  fpsFrames = 0
  frameTimeSum = 0
  lastFrameTime = 0
  fpsLastTime = performance.now()
  void loadCesiumStats()
  fpsRafId = requestAnimationFrame(fpsTick)
}

function stopFpsMonitor() {
  if (fpsRafId !== undefined) {
    cancelAnimationFrame(fpsRafId)
    fpsRafId = undefined
  }
}

let eventObserver: PerformanceObserver | undefined
let resourceObserver: PerformanceObserver | undefined

type EventTimingEntry = {
  interactionId: number
  duration: number
}

function startPerformanceObservers() {
  inp.value = 0
  inpMax = 0
  resourceStarts.clear()

  eventObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const timing = entry as unknown as EventTimingEntry
      if (timing.interactionId > 0 && timing.duration > inpMax) {
        inpMax = Math.round(timing.duration)
        inp.value = inpMax
      }
    }
  })
  try {
    eventObserver.observe({ type: 'event', buffered: true })
  } catch {
    eventObserver = undefined
  }

  resourceObserver = new PerformanceObserver((list) => {
    const now = performance.now()
    for (const entry of list.getEntries()) {
      resourceStarts.set(entry.name, entry.startTime)
      for (const [name, start] of resourceStarts) {
        if (now - start > 1500) resourceStarts.delete(name)
      }
    }
  })
  try {
    resourceObserver.observe({ type: 'resource', buffered: true })
  } catch {
    resourceObserver = undefined
  }
}

function stopPerformanceObservers() {
  eventObserver?.disconnect()
  eventObserver = undefined
  resourceObserver?.disconnect()
  resourceObserver = undefined
}

onMounted(() => {
  bindCesiumPrefetch()
  fetchGithubStats()
})

watch(fullCaseDemo, (demo) => {
  if (demo) {
    startFpsMonitor()
    startPerformanceObservers()
  } else {
    stopFpsMonitor()
    stopPerformanceObservers()
  }
})

onUnmounted(() => {
  stopFpsMonitor()
  stopPerformanceObservers()
})
</script>

<template>
  <div class="page-root">
    <PerfChecklistDoc v-if="perfDocOpen" @close="perfDocOpen = false" />
    <SkillsPanel v-if="skillsOpen" @close="skillsOpen = false" />

    <section v-if="fullCaseDemo" class="case-page" :class="{ 'is-system': fullCaseDemo.category === 'system' }">
      <header class="topbar case-topbar">
        <div class="brand-area">
           <div class="brand-mark"><img :src="systemLogo" alt="Cesium酱の百宝箱 Logo" /></div>
          <div>
            <p class="brand-name">Cesium酱の百宝箱</p>
            <p class="brand-subtitle">Cesium Example Gallery</p>
          </div>
        </div>
        <div class="case-metrics">
          <span class="metric" :class="fpsTone"><b>FPS</b>{{ fps }}</span>
          <span class="metric"><b>Frame</b>{{ frameTime }}<i>ms</i></span>
          <span class="metric"><b>JS</b>{{ jsHeapMB }}<i>MB</i></span>
          <span class="metric"><b>INP</b>{{ inp }}<i>ms</i></span>
          <span class="metric"><b>Tri</b>{{ triangles.toLocaleString() }}</span>
          <span class="metric"><b>Queue</b>{{ tileQueue }}</span>
          <span class="metric"><b>DOM</b>{{ domNodes.toLocaleString() }}</span>
          <span class="metric"><b>Req</b>{{ concurrentRequests }}</span>
        </div>
        <button v-if="fullCaseDemo.category === 'system'" class="case-back-button case-topbar-exit" @click="closeCase">
          <el-icon><Back /></el-icon>
          返回案例库
        </button>
      </header>
      <main class="case-content">
        <div class="case-heading">
          <div>
            <p class="eyebrow">FULL CASE / {{ fullCaseDemo.tag }}</p>
            <h1>{{ fullCaseDemo.title }}</h1>
            <p>{{ fullCaseDemo.description }}</p>
          </div>
          <button class="case-back-button secondary" @click="closeCase">返回列表</button>
        </div>
        <div class="case-stage">
          <component :is="fullCaseComponent" v-if="fullCaseComponent" @vue:mounted="caseReady = true" />
          <div v-else class="case-coming-soon">该案例正在开发中</div>
          <div v-if="!caseReady" class="case-loading">
            <span class="case-loading-spinner"></span>
            <p>案例加载中，请稍候…</p>
          </div>
        </div>
      </main>
    </section>

  <div v-else class="app-shell">
    <header class="topbar">
      <div class="brand-area">
        <button class="mobile-menu-button" aria-label="打开导航" @click="mobileMenuOpen = true">
          <el-icon><Menu /></el-icon>
        </button>
         <div class="brand-mark"><img :src="systemLogo" alt="Cesium酱の百宝箱 Logo" /></div>
        <div>
          <p class="brand-name">Cesium酱の百宝箱</p>
          <p class="brand-subtitle">Cesium Example Gallery</p>
        </div>
      </div>
      <div class="topbar-actions">
        <span class="version-chip"><span class="status-dot"></span>在线案例库 - 共 {{ totalDemos }} 个</span>
        <a class="github-link" :href="GITHUB_REPO_URL" target="_blank" rel="noopener noreferrer" title="GitHub 仓库">
          <svg class="github-icon" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
          <span v-if="githubStats" class="github-stats">
            <span class="github-stat" title="Watch"><el-icon><View /></el-icon>{{ formatRepoCount(githubStats.watchers) }}</span>
            <span class="github-stat" title="Fork"><el-icon><Share /></el-icon>{{ formatRepoCount(githubStats.forks) }}</span>
            <span class="github-stat" title="Star"><el-icon><Star /></el-icon>{{ formatRepoCount(githubStats.stars) }}</span>
          </span>
        </a>
        <el-icon class="topbar-icon" title="使用帮助" @click="helpOpen = true"><Document /></el-icon>
        <el-icon class="topbar-icon" title="Cesium 卡顿排查清单" @click="perfDocOpen = true"><Notebook /></el-icon>
        <el-icon class="topbar-icon" title="技能管理（Skills）" @click="skillsOpen = true"><MagicStick /></el-icon>
        <el-icon class="topbar-icon" title="界面设置" @click="settingsOpen = true"><Setting /></el-icon>
        <div class="avatar" title="关于案例库" @click="aboutOpen = true">C</div>
      </div>
    </header>

    <div class="workspace">
      <div v-if="mobileMenuOpen" class="sidebar-backdrop" @click="mobileMenuOpen = false"></div>
      <aside class="sidebar" :class="{ 'is-open': mobileMenuOpen }">
        <div class="sidebar-heading">
          <div>
            <p class="eyebrow">EXPLORE</p>
            <h2>功能导航</h2>
          </div>
          <button class="close-sidebar" aria-label="关闭导航" @click="mobileMenuOpen = false"><el-icon><Close /></el-icon></button>
        </div>
        <nav class="category-list" aria-label="案例分类">
          <button
            v-for="category in categories"
            :key="category.id"
            class="category-item"
            :class="{ active: activeCategory === category.id }"
            @click="selectCategory(category.id)"
          >
            <span class="category-icon"><el-icon><component :is="category.icon" /></el-icon></span>
            <span class="category-label">{{ category.label }}</span>
            <span class="category-count">{{ categoryCounts.get(category.id) ?? 0 }}</span>
            <el-icon class="category-arrow"><CaretRight /></el-icon>
          </button>
        </nav>
        <div class="sidebar-footer">
          <div class="tip-card">
            <div class="tip-icon"><Star /></div>
            <div><strong>发现更多案例</strong><span>持续更新中 · 2026</span></div>
          </div>
           <p class="copyright">Built with Cesium & Cesium 1.144.0</p>
        </div>
      </aside>

      <main class="content-area">
        <div class="content-header">
          <div>
            <div class="breadcrumb"><span>案例中心</span><i>/</i><span class="current">{{ searching ? '全局搜索' : currentCategory.label }}</span></div>
            <h1>{{ searching ? `搜索 “${searchTerm.trim()}”` : currentCategory.label }} <span class="title-count">{{ visibleDemos.length }} 个案例</span></h1>
          </div>
          <div class="content-tools">
            <div class="search-box">
              <el-icon><Search /></el-icon>
              <input v-model="searchTerm" type="search" placeholder="全局搜索案例名称 / 描述" />
            </div>
             <button class="sort-button" :class="{ active: sortNewest }" @click="sortNewest = !sortNewest">
               {{ sortNewest ? '最新收录' : '默认顺序' }}
               <el-icon :class="{ reversed: !sortNewest }"><ArrowDown /></el-icon>
             </button>
          </div>
        </div>

        <div v-if="visibleDemos.length" class="demo-grid">
          <article v-for="demo in visibleDemos" :key="demo.id" class="demo-card" :class="{ 'is-available': demo.available }" @click="openCase(demo)">
            <div class="thumbnail">
              <img v-if="demo.icon" :src="demo.icon" :alt="demo.title" loading="lazy" decoding="async" />
              <div v-else class="no-image">
                <el-icon><Picture /></el-icon>
                <span>暂无截图</span>
              </div>
              <div class="thumbnail-overlay"><span>查看演示</span><el-icon><VideoPlay /></el-icon></div>
              <span class="demo-tag">{{ demo.tag }}</span>
            </div>
            <div class="card-copy">
              <h3>{{ demo.title }}</h3>
               <div class="card-footer">
                <span v-if="showUpdatedAt && demo.available" class="card-status completed"><el-icon><CircleCheckFilled /></el-icon>更新完成 {{ demo.updatedAt ?? '2026-08-22' }}</span>
                <span v-else-if="demo.available" class="card-status completed"><el-icon><CircleCheckFilled /></el-icon>可在线演示</span>
                 <span v-else class="card-status developing"><el-icon><Clock /></el-icon>开发中</span>
               </div>
            </div>
          </article>
        </div>
        <div v-else class="empty-state"><el-icon><Search /></el-icon><h3>没有找到相关案例</h3><p>试试搜索其他关键词</p></div>
      </main>
    </div>

  </div>

    <Teleport to="body">
      <div v-if="helpOpen" class="modal-mask" @click.self="helpOpen = false">
        <div class="modal-panel">
          <div class="modal-head">
            <div class="modal-icon"><el-icon><Document /></el-icon></div>
            <div><h3>使用帮助</h3><span>Cesium 案例库操作指南</span></div>
            <button class="modal-close" aria-label="关闭" @click="helpOpen = false"><el-icon><Close /></el-icon></button>
          </div>
          <div class="modal-body">
            <section>
              <h4>浏览案例</h4>
              <p>左侧「功能导航」按技术类别划分案例（三维特效、天气特效、粒子特效、水面效果、标记标绘、空间测量、空间分析、数据可视化、三维数据加载、场景示例、界面控件），点击分类即可查看对应案例。</p>
            </section>
            <section>
              <h4>查看演示</h4>
              <p>点击任意案例卡片进入全屏演示。顶部指标栏实时显示 FPS、帧耗时、JS 堆内存、INP、三角面数、瓦片队列、DOM 节点数与并发请求数。</p>
            </section>
            <section>
              <h4>搜索与排序</h4>
              <p>分类标题右侧的搜索框支持全局搜索，可跨全部分类按案例名称或描述检索；输入关键词后自动切换到全局搜索结果视图。「最新收录 / 默认顺序」按钮切换排序方式，最新收录优先展示近期更新的案例。</p>
            </section>
            <section>
              <h4>新增案例</h4>
              <p>在 <code>src/cases</code> 下新建目录并注册到 <code>src/cases/index.ts</code>，提供 <code>index.ts</code> 导出 DemoCard 即可自动纳入分类统计。</p>
            </section>
          </div>
        </div>
      </div>

      <div v-if="settingsOpen" class="modal-mask" @click.self="settingsOpen = false">
        <div class="modal-panel">
          <div class="modal-head">
            <div class="modal-icon"><el-icon><Setting /></el-icon></div>
            <div><h3>界面设置</h3><span>调整案例列表的展示行为</span></div>
            <button class="modal-close" aria-label="关闭" @click="settingsOpen = false"><el-icon><Close /></el-icon></button>
          </div>
          <div class="modal-body">
            <section class="setting-row">
              <div>
                <h4>默认排序</h4>
                <p>控制案例卡片在列表中的排列顺序。</p>
              </div>
              <div class="setting-control">
                <label class="toggle"><input type="radio" name="orderMode" :checked="sortNewest" @change="sortNewest = true" /><span>最新收录</span></label>
                <label class="toggle"><input type="radio" name="orderMode" :checked="!sortNewest" @change="sortNewest = false" /><span>默认顺序</span></label>
              </div>
            </section>
            <section class="setting-row">
              <div>
                <h4>显示更新时间</h4>
                <p>在案例卡片底部展示「更新完成」时间徽标。</p>
              </div>
              <div class="setting-control">
                <button class="switch-button" :class="{ 'is-on': showUpdatedAt }" role="switch" :aria-checked="showUpdatedAt" @click="showUpdatedAt = !showUpdatedAt"><span class="switch-knob"></span></button>
              </div>
            </section>
          </div>
        </div>
      </div>

      <div v-if="aboutOpen" class="modal-mask" @click.self="aboutOpen = false">
        <div class="modal-panel">
          <div class="modal-head">
            <div class="modal-icon"><div class="about-avatar">C</div></div>
            <div><h3>关于 Cesium酱の百宝箱</h3><span>Cesium Example Gallery</span></div>
            <button class="modal-close" aria-label="关闭" @click="aboutOpen = false"><el-icon><Close /></el-icon></button>
          </div>
          <div class="modal-body">
            <section class="stats-grid">
              <div class="stat-item"><b>{{ totalDemos }}</b><span>已收录案例</span></div>
              <div class="stat-item"><b>{{ availableDemos }}</b><span>可在线演示</span></div>
              <div class="stat-item"><b>{{ categories.length }}</b><span>功能分类</span></div>
            </section>
            <section>
              <h4>技术栈</h4>
              <p>Vue 3 · Vite · Cesium 1.144 · Element Plus · ECharts。案例覆盖三维特效、空间分析、数据可视化、地图控件等 Cesium 常用开发场景。</p>
            </section>
            <section>
              <h4>版权</h4>
              <p>Built with Cesium &amp; Cesium 1.144.0 · 案例库持续更新中 · 2026</p>
            </section>
          </div>
        </div>
      </div>
    </Teleport>

  </div>
</template>
