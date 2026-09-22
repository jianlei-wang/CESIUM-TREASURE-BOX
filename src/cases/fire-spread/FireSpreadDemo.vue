<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Cartesian2, Cartographic, Ellipsoid, Math as CesiumMath, ScreenSpaceEventHandler, ScreenSpaceEventType, type TerrainProvider, type Viewer } from 'cesium'
import { buildFuelGrid, FUEL_PROFILES } from './wildfire/fuel'
import { buildRiverPath } from './wildfire/hydro'
import { DEFAULT_FIRE_PARAMS, WildfireSimulation, type FireMetrics, type FireParams } from './wildfire/model'
import {
  ARRIVAL_RAMP,
  INTENSITY_RAMP,
  MAX_ROS_REFERENCE,
  OVERLAY_MODES,
  type FireOverlayModeValue
} from './wildfire/overlay'
import {
  DEFAULT_LAYER_FLAGS,
  DEFAULT_PARTICLE_PARAMS,
  DEFAULT_RENDER_STYLE,
  WildfireRenderer,
  type WildfireLayerFlags,
  type WildfireParticleParams,
  type WildfireRenderStyle
} from './wildfire/renderer'
import {
  addWildfireImagery,
  createWildfireViewer,
  destroyWildfireViewer,
  loadWildfireTerrain,
  setWildfireCamera
} from './wildfire/scene'
import { buildProceduralTerrain, buildSampledTerrain, boundsFromCenter, type TerrainGrid } from './wildfire/terrain'
import { DEFAULT_WIND_PARAMS, WIND_SPEED_MAX, WIND_SPEED_RAMP, type WildfireWindParams } from './wildfire/wind'
import {
  createReportPdfUrl,
  exportReportDocx,
  exportReportPdf,
  type ReportModel,
  type ReportSection
} from './fire-report'

/** 四川木里一带：高山峡谷林区，坡陡谷深，适合林火蔓延推演。 */
const DEMO_CENTER = { lon: 101.25, lat: 27.95 }
const SPAN_METERS = 9600
const GRID_COLS = 160
const TERRAIN_SEED = 20260922
/** 播放倍率：1 秒真实时间推进多少分钟火场时间 */
const SPEED_MIN = 1
const SPEED_MAX = 30
const REPORT_TITLE = '林火蔓延渲染分析报告'

const params = reactive<FireParams>({ ...DEFAULT_FIRE_PARAMS })
const style = reactive<WildfireRenderStyle>({ ...DEFAULT_RENDER_STYLE })
const layers = reactive<WildfireLayerFlags>({ ...DEFAULT_LAYER_FLAGS })
const particle = reactive<WildfireParticleParams>({ ...DEFAULT_PARTICLE_PARAMS })
const windFx = reactive<WildfireWindParams>({ ...DEFAULT_WIND_PARAMS })
const mode = ref<FireOverlayModeValue>('theme')
const playing = ref(false)
const speed = ref(8)
const displayTime = ref(0)
const auxOpen = ref(false)
const collapsed = reactive({ run: true, behavior: true, layer: true, style: true })
const statusMessage = ref('正在初始化 Cesium 场景…')
const terrainNote = ref('')
const metrics = ref<FireMetrics | null>(null)
const ignitionLabel = ref('')
const clickHint = ref('单击地图可设置或追加起火点')

const reportOpen = ref(false)
const reportModel = ref<ReportModel | null>(null)
const reportPdfUrl = ref('')
const reportPdfMode = ref(false)
const reportBusy = ref(false)
const reportPaper = ref<HTMLElement | null>(null)

const container = ref<HTMLElement | null>(null)

let viewer: Viewer | undefined
let terrain: TerrainProvider | undefined
let sim: WildfireSimulation | undefined
let renderer: WildfireRenderer | undefined
let inputHandler: ScreenSpaceEventHandler | undefined
let rafId = 0
let lastTimestamp = 0
let lastMetricsAt = 0
let solveTimer: number | undefined
let disposed = false

function boundsFor(): { west: number; south: number; east: number; north: number } {
  return boundsFromCenter(DEMO_CENTER.lon, DEMO_CENTER.lat, SPAN_METERS)
}

function rowsFor(bounds: { west: number; south: number; east: number; north: number }, cols: number): number {
  const widthMeters = (bounds.east - bounds.west) * 111320 * Math.cos(CesiumMath.toRadians(DEMO_CENTER.lat))
  const heightMeters = (bounds.north - bounds.south) * 111320
  return Math.max(8, Math.round((cols * heightMeters) / Math.max(widthMeters, 1)))
}

function formatArea(m2: number): string {
  return m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${Math.round(m2)} m²`
}

function fmtRound(value: number): number {
  return Math.round(value)
}

function formatLength(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`
}

function describeAspect(deg: number): string {
  const directions = ['正北', '东北', '正东', '东南', '正南', '西南', '正西', '西北']
  const index = Math.round((((deg % 360) + 360) % 360) / 45) % 8
  return `${directions[index]} ${deg.toFixed(0)}°`
}

type LegendModel =
  | { mode: 'swatch'; items: Array<{ label: string; color: string }> }
  | { mode: 'ramp'; title: string; gradient: string; min: string; max: string }

function rampGradient(ramp: Array<[number, number, number]>): string {
  const stops = ramp.map((color, index) => {
    const ratio = Math.round((index / Math.max(ramp.length - 1, 1)) * 100)
    const rgb = color.map((value) => Math.round(value)).join(', ')
    return `rgb(${rgb}) ${ratio}%`
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

const legend = computed<LegendModel>(() => {
  if (mode.value === 'fuel') {
    return {
      mode: 'swatch',
      items: Object.values(FUEL_PROFILES).map((profile) => ({ label: profile.name, color: profile.color }))
    }
  }
  if (mode.value === 'arrival') {
    return {
      mode: 'ramp',
      title: '到达时间场（分钟）',
      gradient: rampGradient(ARRIVAL_RAMP),
      min: '0',
      max: `${params.maxMinutes}`
    }
  }
  if (mode.value === 'intensity') {
    return {
      mode: 'ramp',
      title: '蔓延强度场（m/min）',
      gradient: rampGradient(INTENSITY_RAMP),
      min: '0',
      max: `${MAX_ROS_REFERENCE}`
    }
  }
  return {
    mode: 'swatch',
    items: [
      { label: '烧毁区填充', color: style.innerColor },
      { label: '火线描边', color: style.borderColor },
      { label: '火线外发光', color: style.glowColor }
    ]
  }
})

const windLegend = computed(() => ({
  gradient: rampGradient(WIND_SPEED_RAMP),
  min: '0',
  max: `${WIND_SPEED_MAX}`,
  label: `${params.windSpeed.toFixed(1)} m/s · ${describeAspect(params.windDir)}`
}))

function scheduleSolve(): void {
  if (solveTimer !== undefined) window.clearTimeout(solveTimer)
  solveTimer = window.setTimeout(() => {
    solveTimer = undefined
    if (!sim) return
    sim.configure({ ...params })
    metrics.value = sim.metrics
    renderer?.markFieldDirty()
  }, 160)
}

function applyWind(): void {
  renderer?.setWindParams({ ...windFx, speed: params.windSpeed, dir: params.windDir })
}

function onWindChange(): void {
  applyWind()
  scheduleSolve()
}

function onStyleChange(): void {
  renderer?.setStyle({ ...style })
}

function onParticleChange(): void {
  renderer?.setParticleParams({ ...particle })
}

function onLayerChange(): void {
  renderer?.setLayers({ ...layers })
}

function onModeChange(): void {
  renderer?.setMode(mode.value)
}

function onTimeInput(): void {
  if (!sim) return
  playing.value = false
  sim.setTime(displayTime.value)
  renderer?.update()
}

async function buildScene(): Promise<void> {
  if (!container.value) return
  const bounds = boundsFor()
  viewer = createWildfireViewer(container.value, bounds)
  addWildfireImagery(viewer, { onStatus: (message) => (statusMessage.value = message) })
  terrain = await loadWildfireTerrain(viewer)
  if (disposed || !viewer) return

  const cols = GRID_COLS
  const rows = rowsFor(bounds, cols)
  const river = buildRiverPath(bounds, TERRAIN_SEED)
  let built: TerrainGrid
  let sampled = false
  if (terrain) {
    statusMessage.value = '正在采样世界地形高度… 0%'
    try {
      built = await buildSampledTerrain(terrain, bounds, cols, rows, SPAN_METERS, river, TERRAIN_SEED, (ratio) => {
        statusMessage.value = `正在采样世界地形高度… ${Math.round(ratio * 100)}%`
      })
      sampled = true
    } catch {
      built = buildProceduralTerrain(bounds, cols, rows, SPAN_METERS, river, TERRAIN_SEED)
    }
  } else {
    built = buildProceduralTerrain(bounds, cols, rows, SPAN_METERS, river, TERRAIN_SEED)
  }
  if (disposed || !viewer) return

  const fuel = buildFuelGrid(built, bounds, TERRAIN_SEED)
  sim = new WildfireSimulation(built, fuel, { ...params })
  const seeded = sim.setIgnition(DEMO_CENTER.lon, DEMO_CENTER.lat)
  if (!seeded) clickHint.value = '默认位置为不可燃地表，请单击地图选择起火点'
  displayTime.value = sim.time

  renderer = new WildfireRenderer(viewer, sim)
  renderer.setStyle({ ...style })
  renderer.setLayers({ ...layers })
  renderer.setMode(mode.value)
  renderer.setWindParams({ ...windFx, speed: params.windSpeed, dir: params.windDir })

  setWildfireCamera(viewer, bounds)
  const ignition = sim.ignitionLonLat()
  ignitionLabel.value = ignition ? `${ignition.lon.toFixed(4)}, ${ignition.lat.toFixed(4)}` : ''
  let minElev = Infinity
  let maxElev = -Infinity
  for (let i = 0; i < built.elevation.length; i += 1) {
    const value = built.elevation[i]
    if (value < minElev) minElev = value
    if (value > maxElev) maxElev = value
  }
  terrainNote.value = `${sampled ? '世界地形采样' : '程序地形'} · 高程 ${Math.round(minElev)}~${Math.round(maxElev)} m · 网格 ${built.cols}×${built.rows} · 单格 ${built.cellMeters.toFixed(0)} m`
  statusMessage.value = ''
  metrics.value = sim.metrics
}

function tick(timestamp: number): void {
  rafId = requestAnimationFrame(tick)
  if (!sim || !renderer) return
  const delta = lastTimestamp ? Math.min((timestamp - lastTimestamp) / 1000, 0.25) : 0
  lastTimestamp = timestamp
  if (playing.value) {
    sim.setTime(sim.time + delta * speed.value)
    displayTime.value = sim.time
    if (sim.time >= sim.params.maxMinutes) playing.value = false
  }
  renderer.update()
  if (timestamp - lastMetricsAt > 260) {
    lastMetricsAt = timestamp
    metrics.value = sim.metrics
  }
}

function togglePlay(): void {
  if (!sim) return
  if (!playing.value && sim.time >= sim.params.maxMinutes) sim.setTime(0)
  playing.value = !playing.value
  displayTime.value = sim.time
}

function resetRun(): void {
  if (!sim) return
  playing.value = false
  sim.setIgnition(DEMO_CENTER.lon, DEMO_CENTER.lat)
  displayTime.value = 0
  metrics.value = sim.metrics
  renderer?.markFieldDirty()
  renderer?.update()
}

function locate(): void {
  if (viewer) setWildfireCamera(viewer, boundsFor())
}

// ---------------------------------------------------------------------------
// 结果报告：在线预览 + 导出 PDF / Word
// ---------------------------------------------------------------------------

const modeLabel = computed(() => OVERLAY_MODES.find((item) => item.value === mode.value)?.label ?? mode.value)
const runCompleted = computed(() => displayTime.value >= params.maxMinutes - 0.01)
const reportReady = computed(() => (metrics.value?.burnedCells ?? 0) > 0)

function collectReport(): ReportModel {
  const current = sim
  const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false })
  const sections: ReportSection[] = []
  const m = current?.metrics ?? metrics.value
  const bounds = boundsFor()

  sections.push({
    title: '一、推演概况',
    kv: [
      { label: '案例名称', value: '林火蔓延渲染分析' },
      { label: '推演区域', value: `${bounds.west.toFixed(4)}~${bounds.east.toFixed(4)}°E, ${bounds.south.toFixed(4)}~${bounds.north.toFixed(4)}°N` },
      { label: '区域尺寸', value: `${(SPAN_METERS / 1000).toFixed(1)} km × ${(SPAN_METERS / 1000).toFixed(1)} km` },
      { label: '网格规模', value: current ? `${current.terrain.cols} × ${current.terrain.rows}（单格 ${current.terrain.cellMeters.toFixed(0)} m）` : '—' },
      { label: '起火点', value: ignitionLabel.value || '—' },
      { label: '推演总时长', value: `${params.maxMinutes.toFixed(0)} min` },
      { label: '当前时刻', value: `T+${displayTime.value.toFixed(0)} min${runCompleted.value ? '（推演完成）' : ''}` },
      { label: '地形来源', value: terrainNote.value || '—' }
    ]
  })

  sections.push({
    title: '二、气象与地形条件',
    kv: [
      { label: '地表风速', value: `${params.windSpeed.toFixed(1)} m/s` },
      { label: '风向', value: describeAspect(params.windDir) },
      { label: '细死可燃物含水率', value: `${(params.moisture * 100).toFixed(1)} %` },
      { label: '风速修正系数', value: `×${params.windFactor.toFixed(2)}` },
      { label: '坡度修正系数', value: `×${params.slopeFactor.toFixed(2)}` },
      { label: '燃烧持续期缩放', value: `×${params.burnScale.toFixed(2)}` },
      { label: '点燃延迟', value: `${params.ignitionDelay.toFixed(2)} min` },
      { label: '过火区平均高程', value: m ? `${m.meanElevation.toFixed(0)} m` : '—' },
      { label: '火线平均坡度', value: m ? `${m.meanSlope.toFixed(1)}°` : '—' },
      { label: '过火区平均坡向', value: m ? describeAspect(m.meanAspect) : '—' }
    ]
  })

  if (m) {
    sections.push({
      title: '三、Rothermel 火行为参数',
      kv: [
        { label: '主要燃烧可燃物', value: m.burningFuel || '—' },
        { label: '平均蔓延速率', value: `${m.meanRos.toFixed(2)} m/min` },
        { label: '最大蔓延速率', value: `${m.maxRos.toFixed(2)} m/min` },
        { label: '火头推进距离', value: formatLength(m.headDistanceM) },
        { label: '模型说明', value: 'Rothermel 简化模型 + 到达时间场 + 优先级松弛，按风向/坡度/可燃物类型逐格推算蔓延速率。' }
      ]
    })

    sections.push({
      title: '四、火场结果统计',
      kv: [
        { label: '过火面积', value: formatArea(m.burnedAreaM2) },
        { label: '烧毁格数', value: `${m.burnedCells} 格` },
        { label: '在燃格数', value: `${m.frontCells} 格` },
        { label: '火线周长', value: formatLength(m.perimeterM) },
        { label: '道路邻接率', value: `${m.roadMatchPct.toFixed(1)} %` },
        { label: '陡坡侵蚀长度', value: formatLength(m.erosionLengthM) },
        { label: '陡坡过火占比', value: `${m.erosionAreaPct.toFixed(1)} %` }
      ]
    })
  }

  sections.push({
    title: '五、专题渲染与可视化配置',
    kv: [
      { label: '专题模式', value: modeLabel.value },
      { label: '火线/烧毁边界', value: layers.fireLine || layers.burnedOutline ? '已启用' : '已关闭' },
      { label: '火焰 / 烟雾粒子', value: `火焰${layers.flame ? '开' : '关'} · 烟雾${layers.smoke ? '开' : '关'}` },
      { label: '三维风场', value: layers.wind ? `开（${params.windSpeed.toFixed(1)} m/s，密度 ${(windFx.density * 100).toFixed(0)}%，拖尾 ${windFx.trail.toFixed(2)}×）` : '关' },
      { label: '专题配色', value: `烧毁填充 ${style.innerColor} · 火线 ${style.borderColor} · 外发光 ${style.glowColor}` }
    ]
  })

  if (current && current.terrain) {
    const total = current.params.maxMinutes
    const steps = 8
    const saved = current.time
    const body: string[][] = []
    for (let i = 0; i <= steps; i += 1) {
      const t = (total * i) / steps
      current.setTime(t)
      const snapshot = current.metrics
      body.push([
        `T+${t.toFixed(0)} min`,
        formatArea(snapshot.burnedAreaM2),
        `${snapshot.frontCells}`,
        formatLength(snapshot.perimeterM),
        `${snapshot.meanRos.toFixed(2)}`,
        `${snapshot.maxRos.toFixed(2)}`
      ])
    }
    current.setTime(saved)
    renderer?.markFieldDirty()
    sections.push({
      title: '六、推演过程时间轴',
      table: {
        caption: '按等间隔重放推演过程，记录火场面积、在燃火线格数、周长与蔓延速率的变化。',
        head: ['时刻', '过火面积', '在燃格数', '火线周长', '平均速率(m/min)', '最大速率(m/min)'],
        body
      }
    })
  }

  return {
    generatedAt,
    intro:
      '本报告由「林火蔓延渲染分析」案例生成，基于 Rothermel 简化蔓延模型与到达时间场求解，汇总推演区域、气象与地形条件、火行为参数、火场结果统计、专题渲染配置以及推演过程时间轴，可用于林火蔓延态势分析与扑救决策参考。',
    sections
  }
}

async function openReportPreview(): Promise<void> {
  if (!reportReady.value) return
  playing.value = false
  reportModel.value = collectReport()
  reportOpen.value = true
  reportPdfMode.value = false
  await nextTick()
  await previewPdf()
}

async function previewPdf(): Promise<void> {
  reportPdfMode.value = false
  await nextTick()
  if (!reportPaper.value) return
  reportBusy.value = true
  try {
    const url = await createReportPdfUrl(reportPaper.value)
    if (reportPdfUrl.value) URL.revokeObjectURL(reportPdfUrl.value)
    reportPdfUrl.value = url
    reportPdfMode.value = true
  } catch {
    statusMessage.value = 'PDF 预览生成失败，已切换为网页版预览'
    reportPdfMode.value = false
  } finally {
    reportBusy.value = false
  }
}

async function onExportPdf(): Promise<void> {
  reportPdfMode.value = false
  await nextTick()
  if (!reportPaper.value) return
  await exportReportPdf(reportPaper.value, {
    docTitle: REPORT_TITLE,
    filenamePrefix: 'fire-spread-report',
    onStatus: (message) => (statusMessage.value = message)
  })
}

async function onExportDocx(): Promise<void> {
  if (!reportModel.value) return
  await exportReportDocx(reportModel.value, {
    docTitle: REPORT_TITLE,
    filenamePrefix: 'fire-spread-report',
    creator: '林火蔓延渲染分析系统',
    onStatus: (message) => (statusMessage.value = message)
  })
}

function closeReport(): void {
  if (reportPdfUrl.value) {
    URL.revokeObjectURL(reportPdfUrl.value)
    reportPdfUrl.value = ''
  }
  reportPdfMode.value = false
  reportOpen.value = false
}

function handleClick(position: Cartesian2): void {
  if (!viewer || !sim) return
  const ray = viewer.camera.getPickRay(position)
  if (!ray) return
  const picked = viewer.scene.globe.pick(ray, viewer.scene) ?? viewer.camera.pickEllipsoid(position, Ellipsoid.WGS84)
  if (!picked) return
  const carto = Cartographic.fromCartesian(picked)
  if (!carto) return
  const lon = CesiumMath.toDegrees(carto.longitude)
  const lat = CesiumMath.toDegrees(carto.latitude)
  const ok = sim.addIgnition(lon, lat)
  clickHint.value = ok
    ? `已在 ${lon.toFixed(4)}, ${lat.toFixed(4)} 追加起火点，到达时间场已重新松弛`
    : '该位置为不可燃地表（水域/裸岩/道路），请换个位置点击'
  metrics.value = sim.metrics
  renderer?.markFieldDirty()
  renderer?.update()
}

onMounted(async () => {
  try {
    await buildScene()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
  if (!viewer || disposed) return
  inputHandler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  inputHandler.setInputAction((event: { position: Cartesian2 }) => handleClick(event.position), ScreenSpaceEventType.LEFT_CLICK)
  rafId = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  disposed = true
  if (solveTimer !== undefined) window.clearTimeout(solveTimer)
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  inputHandler?.destroy()
  inputHandler = undefined
  renderer?.destroy()
  renderer = undefined
  sim = undefined
  terrain = undefined
  destroyWildfireViewer(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="wx-system">
    <header class="wx-topbar">
      <div class="wx-identity">
        <span class="wx-emblem">LF</span>
        <div class="wx-identity-text">
          <p class="wx-system-name">林火蔓延渲染分析系统</p>
          <p class="wx-system-meta">木里高山林区 · Rothermel 简化模型 · 到达时间场求解</p>
        </div>
        <span class="wx-run-state" :class="{ live: playing }"><i></i>{{ playing ? '推演进行中' : '推演已暂停' }}</span>
      </div>
      <div class="wx-toolbar">
        <button class="wx-tool primary" @click="togglePlay">{{ playing ? '暂停推演' : '开始推演' }}</button>
        <button class="wx-tool" @click="resetRun">重置推演</button>
        <button class="wx-tool" @click="locate">定位火场</button>
        <button class="wx-tool" :class="{ active: auxOpen }" @click="auxOpen = !auxOpen">辅助设置</button>
        <button class="wx-tool accent" :disabled="!reportReady" @click="openReportPreview">
          生成分析报告
        </button>
      </div>
    </header>

    <section v-if="auxOpen" class="wx-aux">
      <div class="wx-aux-head">
        <span>辅助设置</span>
        <button class="wx-aux-close" @click="auxOpen = false">收起</button>
      </div>
      <div class="wx-aux-grid">
        <div class="wx-aux-col">
          <div class="group-label">三维风场</div>
          <div class="param-row">
            <span class="param-label">风速(m/s)</span>
            <input v-model.number="params.windSpeed" class="param-slider" type="range" min="0" max="16" step="0.1" @input="onWindChange" />
            <span class="param-value">{{ params.windSpeed.toFixed(1) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">风向(°)</span>
            <input v-model.number="params.windDir" class="param-slider" type="range" min="0" max="359" step="1" @input="onWindChange" />
            <span class="param-value">{{ params.windDir }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">粒子密度</span>
            <input v-model.number="windFx.density" class="param-slider" type="range" min="0.15" max="1" step="0.01" @input="applyWind" />
            <span class="param-value">{{ windFx.density.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">拖尾长度</span>
            <input v-model.number="windFx.trail" class="param-slider" type="range" min="0.4" max="2.4" step="0.05" @input="applyWind" />
            <span class="param-value">{{ windFx.trail.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">粒子线宽</span>
            <input v-model.number="windFx.width" class="param-slider" type="range" min="0.5" max="2.2" step="0.05" @input="applyWind" />
            <span class="param-value">{{ windFx.width.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">流动速度</span>
            <input v-model.number="windFx.flowSpeed" class="param-slider" type="range" min="0.3" max="2.5" step="0.05" @input="applyWind" />
            <span class="param-value">{{ windFx.flowSpeed.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">湍流强度</span>
            <input v-model.number="windFx.turbulence" class="param-slider" type="range" min="0" max="2" step="0.05" @input="applyWind" />
            <span class="param-value">{{ windFx.turbulence.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">粒子亮度</span>
            <input v-model.number="windFx.opacity" class="param-slider" type="range" min="0" max="1" step="0.01" @input="applyWind" />
            <span class="param-value">{{ windFx.opacity.toFixed(2) }}</span>
          </div>
          <div class="param-row"><span class="param-label">风场图层</span><input v-model="layers.wind" class="toggle-input" type="checkbox" @change="onLayerChange" /></div>
        </div>
        <div class="wx-aux-col">
          <div class="group-label">火焰粒子</div>
          <div class="param-row">
            <span class="param-label">发射强度</span>
            <input v-model.number="particle.flameEmission" class="param-slider" type="range" min="0" max="2.5" step="0.05" @input="onParticleChange" />
            <span class="param-value">{{ particle.flameEmission.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">上升速度</span>
            <input v-model.number="particle.flameSpeed" class="param-slider" type="range" min="0.3" max="2.5" step="0.05" @input="onParticleChange" />
            <span class="param-value">{{ particle.flameSpeed.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">粒子尺寸</span>
            <input v-model.number="particle.flameSize" class="param-slider" type="range" min="0.4" max="2.5" step="0.05" @input="onParticleChange" />
            <span class="param-value">{{ particle.flameSize.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">粒子寿命</span>
            <input v-model.number="particle.flameLife" class="param-slider" type="range" min="0.4" max="2.5" step="0.05" @input="onParticleChange" />
            <span class="param-value">{{ particle.flameLife.toFixed(2) }}</span>
          </div>
        </div>
        <div class="wx-aux-col">
          <div class="group-label">烟雾粒子</div>
          <div class="param-row">
            <span class="param-label">发射强度</span>
            <input v-model.number="particle.smokeEmission" class="param-slider" type="range" min="0" max="3" step="0.05" @input="onParticleChange" />
            <span class="param-value">{{ particle.smokeEmission.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">扩散尺寸</span>
            <input v-model.number="particle.smokeSize" class="param-slider" type="range" min="0.4" max="2.5" step="0.05" @input="onParticleChange" />
            <span class="param-value">{{ particle.smokeSize.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">粒子寿命</span>
            <input v-model.number="particle.smokeLife" class="param-slider" type="range" min="0.4" max="2.5" step="0.05" @input="onParticleChange" />
            <span class="param-value">{{ particle.smokeLife.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">烟雾浓度</span>
            <input v-model.number="particle.smokeOpacity" class="param-slider" type="range" min="0" max="0.8" step="0.01" @input="onParticleChange" />
            <span class="param-value">{{ particle.smokeOpacity.toFixed(2) }}</span>
          </div>
        </div>
      </div>
    </section>

    <div class="wx-main">
      <aside class="wx-sidebar">
        <div class="wx-sidebar-head">
          <span>参数与图层配置</span>
          <em>实时生效</em>
        </div>

        <div class="group-label collapsible" :class="{ open: !collapsed.run }" @click="collapsed.run = !collapsed.run">
          <span>推演设置</span>
          <i></i>
        </div>
        <template v-if="!collapsed.run">
          <div class="param-row">
            <span class="param-label">时间步(min)</span>
            <input v-model.number="params.cellMinutes" class="param-slider" type="range" min="1" max="5" step="0.5" @input="scheduleSolve" />
            <span class="param-value">{{ params.cellMinutes.toFixed(1) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">总时长(min)</span>
            <input v-model.number="params.maxMinutes" class="param-slider" type="range" min="60" max="720" step="30" @input="scheduleSolve" />
            <span class="param-value">{{ params.maxMinutes }}</span>
          </div>
        </template>

        <div class="group-label collapsible" :class="{ open: !collapsed.behavior }" @click="collapsed.behavior = !collapsed.behavior">
          <span>火行为参数（Rothermel 简化模型）</span>
          <i></i>
        </div>
        <template v-if="!collapsed.behavior">
          <div class="param-row">
            <span class="param-label">风速(m/s)</span>
            <input v-model.number="params.windSpeed" class="param-slider" type="range" min="0" max="16" step="0.1" @input="onWindChange" />
            <span class="param-value">{{ params.windSpeed.toFixed(1) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">风向(°)</span>
            <input v-model.number="params.windDir" class="param-slider" type="range" min="0" max="359" step="1" @input="onWindChange" />
            <span class="param-value">{{ params.windDir }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">含水率</span>
            <input v-model.number="params.moisture" class="param-slider" type="range" min="0.02" max="0.42" step="0.005" @input="scheduleSolve" />
            <span class="param-value">{{ params.moisture.toFixed(3) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">风速修正</span>
            <input v-model.number="params.windFactor" class="param-slider" type="range" min="0" max="3" step="0.05" @input="scheduleSolve" />
            <span class="param-value">{{ params.windFactor.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">坡度修正</span>
            <input v-model.number="params.slopeFactor" class="param-slider" type="range" min="0" max="3" step="0.05" @input="scheduleSolve" />
            <span class="param-value">{{ params.slopeFactor.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">燃烧持续</span>
            <input v-model.number="params.burnScale" class="param-slider" type="range" min="0.3" max="3" step="0.05" @input="scheduleSolve" />
            <span class="param-value">{{ params.burnScale.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">点燃延迟(min)</span>
            <input v-model.number="params.ignitionDelay" class="param-slider" type="range" min="0" max="2" step="0.05" @input="scheduleSolve" />
            <span class="param-value">{{ params.ignitionDelay.toFixed(2) }}</span>
          </div>
        </template>

        <div class="group-label collapsible" :class="{ open: !collapsed.layer }" @click="collapsed.layer = !collapsed.layer">
          <span>专题图层</span>
          <i></i>
        </div>
        <template v-if="!collapsed.layer">
          <div class="param-row">
            <span class="param-label">专题模式</span>
            <select v-model="mode" class="select-input" @change="onModeChange">
              <option v-for="item in OVERLAY_MODES" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </div>
          <div class="param-row"><span class="param-label">栅格专题</span><input v-model="layers.field" class="toggle-input" type="checkbox" @change="onLayerChange" /></div>
          <div class="param-row"><span class="param-label">烧毁边界</span><input v-model="layers.burnedOutline" class="toggle-input" type="checkbox" @change="onLayerChange" /></div>
          <div class="param-row"><span class="param-label">火线</span><input v-model="layers.fireLine" class="toggle-input" type="checkbox" @change="onLayerChange" /></div>
          <div class="param-row"><span class="param-label">火焰粒子</span><input v-model="layers.flame" class="toggle-input" type="checkbox" @change="onLayerChange" /></div>
          <div class="param-row"><span class="param-label">烟雾粒子</span><input v-model="layers.smoke" class="toggle-input" type="checkbox" @change="onLayerChange" /></div>
          <div class="param-row"><span class="param-label">起火点</span><input v-model="layers.ignition" class="toggle-input" type="checkbox" @change="onLayerChange" /></div>
          <div class="param-row"><span class="param-label">水系</span><input v-model="layers.hydro" class="toggle-input" type="checkbox" @change="onLayerChange" /></div>
          <div class="param-row"><span class="param-label">道路</span><input v-model="layers.roads" class="toggle-input" type="checkbox" @change="onLayerChange" /></div>
          <div class="param-row"><span class="param-label">三维风场</span><input v-model="layers.wind" class="toggle-input" type="checkbox" @change="onLayerChange" /></div>
        </template>

        <div class="group-label collapsible" :class="{ open: !collapsed.style }" @click="collapsed.style = !collapsed.style">
          <span>专题配色</span>
          <i></i>
        </div>
        <template v-if="!collapsed.style">
          <div class="param-row"><span class="param-label">烧毁填充色</span><input v-model="style.innerColor" class="color-input" type="color" @input="onStyleChange" /></div>
          <div class="param-row"><span class="param-label">火线颜色</span><input v-model="style.borderColor" class="color-input" type="color" @input="onStyleChange" /></div>
          <div class="param-row"><span class="param-label">光晕颜色</span><input v-model="style.glowColor" class="color-input" type="color" @input="onStyleChange" /></div>
          <div class="param-row">
            <span class="param-label">填充透明</span>
            <input v-model.number="style.innerAlpha" class="param-slider" type="range" min="0" max="1" step="0.01" @input="onStyleChange" />
            <span class="param-value">{{ style.innerAlpha.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">光晕强度</span>
            <input v-model.number="style.glowAlpha" class="param-slider" type="range" min="0" max="1" step="0.01" @input="onStyleChange" />
            <span class="param-value">{{ style.glowAlpha.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">火线宽度</span>
            <input v-model.number="style.lineWidth" class="param-slider" type="range" min="1" max="14" step="0.5" @input="onStyleChange" />
            <span class="param-value">{{ style.lineWidth.toFixed(1) }}</span>
          </div>
        </template>

      </aside>

      <main class="wx-stage">
        <div ref="container" class="cesium-container"></div>
        <div class="wx-map-caption">木里高山峡谷林区 · 中心 {{ DEMO_CENTER.lon }}°E / {{ DEMO_CENTER.lat }}°N</div>
        <div v-if="statusMessage" class="wx-banner">{{ statusMessage }}</div>
      </main>

      <aside class="wx-inspector">
        <div class="wx-panel-head">火场指标</div>
        <template v-if="metrics">
          <div class="metric-row"><span>过火面积</span><b>{{ formatArea(metrics.burnedAreaM2) }}</b></div>
          <div class="metric-row"><span>总过火格点</span><b>{{ metrics.burnedCells }}</b></div>
          <div class="metric-row"><span>当前火线格点</span><b>{{ metrics.frontCells }}</b></div>
          <div class="metric-row"><span>火线周长</span><b>{{ formatLength(metrics.perimeterM) }}</b></div>
          <div class="metric-row"><span>火头距离</span><b>{{ formatLength(metrics.headDistanceM) }}</b></div>
          <div class="metric-row"><span>平均蔓延速率</span><b>{{ metrics.meanRos.toFixed(2) }} m/min</b></div>
          <div class="metric-row"><span>最大蔓延速率</span><b>{{ metrics.maxRos.toFixed(2) }} m/min</b></div>
          <div class="metric-row"><span>火线平均海拔</span><b>{{ fmtRound(metrics.meanElevation) }} m</b></div>
          <div class="metric-row"><span>火线平均坡度</span><b>{{ metrics.meanSlope.toFixed(1) }}°</b></div>
          <div class="metric-row"><span>过火区坡向</span><b>{{ describeAspect(metrics.meanAspect) }}</b></div>
          <div class="metric-row"><span>道路邻接率</span><b>{{ metrics.roadMatchPct.toFixed(1) }}%</b></div>
          <div class="metric-row"><span>陡坡侵蚀岸线</span><b>{{ formatLength(metrics.erosionLengthM) }}</b></div>
          <div class="metric-row"><span>陡坡过火占比</span><b>{{ metrics.erosionAreaPct.toFixed(1) }}%</b></div>
          <div class="metric-row"><span>主要可燃物</span><b>{{ metrics.burningFuel }}</b></div>
        </template>
        <div v-else class="stats-line">等待起火点与推演结果…</div>

        <div class="wx-panel-head">专题图例</div>
        <div v-if="legend.mode === 'swatch'" class="wx-legend-swatches">
          <span v-for="item in legend.items" :key="item.label"><i :style="{ background: item.color }"></i>{{ item.label }}</span>
        </div>
        <template v-else>
          <div class="wx-legend-ramp" :style="{ background: legend.gradient }"></div>
          <div class="wx-legend-range"><span>{{ legend.min }}</span><span>{{ legend.max }}</span></div>
          <div class="stats-line">{{ legend.title }}</div>
        </template>

        <div v-if="layers.wind" class="wx-legend-wind">
          <div class="stats-line">近地风场风速（m/s）· {{ windLegend.label }}</div>
          <div class="wx-legend-ramp" :style="{ background: windLegend.gradient }"></div>
          <div class="wx-legend-range"><span>{{ windLegend.min }}</span><span>{{ windLegend.max }}</span></div>
        </div>

        <div class="wx-panel-head">数据源与位置</div>
        <div v-if="terrainNote" class="stats-line">{{ terrainNote }}</div>
        <div v-if="ignitionLabel" class="stats-line">起火点 {{ ignitionLabel }}</div>
      </aside>
    </div>

    <footer class="wx-statusbar">
      <button class="wx-play" @click="togglePlay">{{ playing ? '暂停' : '播放' }}</button>
      <span class="wx-clock">T+{{ displayTime.toFixed(0) }}<em>min</em></span>
      <input
        v-model.number="displayTime"
        class="wx-timeline"
        type="range"
        min="0"
        :max="params.maxMinutes"
        step="1"
        @input="onTimeInput"
      />
      <span class="wx-clock-total">总时长 {{ params.maxMinutes }} min</span>
      <label class="wx-speed">
        倍率
        <input v-model.number="speed" type="range" :min="SPEED_MIN" :max="SPEED_MAX" step="1" />
        <b>{{ speed }}×</b>
      </label>
      <span class="wx-status-text">{{ statusMessage || clickHint }}</span>
    </footer>

    <div v-if="reportOpen && reportModel" class="rx-report">
      <div class="rx-report-toolbar">
        <span class="rx-report-title">分析报告 · 在线预览与导出</span>
        <span class="rx-report-actions">
          <button class="rx-report-btn" :class="{ active: !reportPdfMode }" :disabled="reportBusy" @click="reportPdfMode = false">网页版</button>
          <button class="rx-report-btn" :class="{ active: reportPdfMode }" :disabled="reportBusy" @click="previewPdf">PDF 在线预览</button>
          <button class="rx-report-btn accent" :disabled="reportBusy" @click="onExportPdf">导出 PDF</button>
          <button class="rx-report-btn accent" :disabled="reportBusy" @click="onExportDocx">导出 Word</button>
          <button class="rx-report-close" title="关闭预览" @click="closeReport">×</button>
        </span>
      </div>
      <div class="rx-report-body">
        <div v-show="!reportPdfMode" class="rx-report-scroll">
          <div ref="reportPaper" class="rx-report-doc">
            <h1 class="rx-report-h1">{{ REPORT_TITLE }}</h1>
            <p class="rx-report-meta">生成时间：{{ reportModel.generatedAt }}</p>
            <p class="rx-report-intro">{{ reportModel.intro }}</p>
            <template v-for="section in reportModel.sections" :key="section.title">
              <h2 class="rx-report-h2">{{ section.title }}</h2>
              <dl v-if="section.kv && section.kv.length" class="rx-report-kv">
                <template v-for="item in section.kv" :key="item.label">
                  <dt>{{ item.label }}</dt>
                  <dd>{{ item.value }}</dd>
                </template>
              </dl>
              <table v-if="section.table" class="rx-report-table">
                <caption v-if="section.table.caption" class="rx-report-caption">{{ section.table.caption }}</caption>
                <thead>
                  <tr><th v-for="(cell, cellIndex) in section.table.head" :key="cellIndex">{{ cell }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(row, rowIndex) in section.table.body" :key="rowIndex">
                    <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-for="(line, lineIndex) in section.lines || []" :key="lineIndex" class="rx-report-line">{{ line }}</p>
            </template>
          </div>
        </div>
        <div v-if="reportPdfMode" class="rx-report-pdf">
          <div v-if="reportBusy" class="rx-report-loading">正在生成 PDF 预览…</div>
          <iframe v-else-if="reportPdfUrl" :src="reportPdfUrl" class="rx-pdf-frame" title="报告 PDF 预览"></iframe>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wx-system {
  display: grid;
  grid-template-rows: 58px minmax(0, 1fr) 46px;
  width: 100%;
  height: 100%;
  min-height: 420px;
  overflow: hidden;
  background: #0a1524;
  color: #dbe7f4;
  position: relative;
}
.wx-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 158, 84, 0.22);
  background: linear-gradient(180deg, #1c1208, #101018);
}
.wx-identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
.wx-emblem {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: linear-gradient(145deg, #ff8a3d, #b93a10);
  color: #2a1006;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.04em;
}
.wx-identity-text { min-width: 0; }
.wx-system-name { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: 0.02em; }
.wx-system-meta { margin: 2px 0 0; font-size: 11px; color: #93a7bd; }
.wx-run-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  margin-left: 6px;
  padding: 4px 9px;
  border: 1px solid rgba(150, 180, 210, 0.24);
  border-radius: 999px;
  color: #9fb3c8;
  font-size: 11px;
}
.wx-run-state i { width: 7px; height: 7px; border-radius: 50%; background: #7d8ea1; }
.wx-run-state.live { color: #ffb066; border-color: rgba(255, 158, 84, 0.42); }
.wx-run-state.live i { background: #ff7a2a; box-shadow: 0 0 8px #ff7a2a; }
.wx-toolbar { display: flex; gap: 8px; flex: 0 0 auto; }
.wx-tool {
  height: 30px;
  padding: 0 13px;
  border: 1px solid rgba(157, 188, 224, 0.26);
  border-radius: 6px;
  background: rgba(20, 32, 50, 0.85);
  color: #cfe0f2;
  font-size: 12px;
  cursor: pointer;
}
.wx-tool:hover { border-color: #5eacf5; color: #fff; }
.wx-tool.primary {
  border-color: transparent;
  background: linear-gradient(145deg, #ff8a3d, #c1461a);
  color: #2a1006;
  font-weight: 600;
}
.wx-main { display: grid; grid-template-columns: 268px minmax(0, 1fr) 258px; min-height: 0; }
.wx-sidebar,
.wx-inspector {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  background: #101c2c;
}
.wx-sidebar { border-right: 1px solid rgba(157, 188, 224, 0.14); }
.wx-inspector { border-left: 1px solid rgba(157, 188, 224, 0.14); }
.wx-sidebar-head,
.wx-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #8fb6de;
}
.wx-sidebar-head em { font-style: normal; font-weight: 400; font-size: 10px; color: #7f93a8; }
.group-label {
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid rgba(157, 188, 224, 0.16);
  color: #ffb066;
  font-size: 11.5px;
  font-weight: 600;
}
.group-label.collapsible {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.group-label.collapsible i {
  flex: 0 0 auto;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid currentColor;
  transform: rotate(-90deg);
  transition: transform 0.16s ease;
}
.group-label.collapsible.open i { transform: rotate(0deg); }
.wx-tool.active { border-color: #ff8a3d; color: #ffd9a8; }
.wx-aux {
  position: absolute;
  top: 62px;
  right: 14px;
  z-index: 30;
  width: min(720px, calc(100% - 28px));
  max-height: calc(100vh - 140px);
  overflow-y: auto;
  padding: 12px 14px;
  border: 1px solid rgba(255, 158, 84, 0.34);
  border-radius: 10px;
  background: rgba(14, 26, 42, 0.97);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.5);
}
.wx-aux-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  color: #ffb066;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
}
.wx-aux-close {
  padding: 2px 9px;
  border: 1px solid rgba(157, 188, 224, 0.3);
  border-radius: 5px;
  background: transparent;
  color: #a9bdd2;
  font-size: 10.5px;
  cursor: pointer;
}
.wx-aux-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 18px; }
.wx-aux-col { display: flex; flex-direction: column; gap: 7px; }
.wx-aux-col .group-label { margin-top: 0; padding-top: 0; border-top: 0; }
.metric-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 0;
  border-bottom: 1px dashed rgba(157, 188, 224, 0.12);
  font-size: 11px;
  color: #a9bdd2;
}
.metric-row b { color: #ffd9a8; font-weight: 600; }
.param-row { display: flex; align-items: center; gap: 8px; }
.param-label { flex: 0 0 76px; font-size: 11px; color: #a9bdd2; }
.param-slider { flex: 1; min-width: 0; accent-color: #ff7a2a; }
.param-value { flex: 0 0 40px; color: #8fa8bf; font-size: 10.5px; text-align: right; }
.color-input { flex: 1; min-width: 0; height: 24px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.26); border-radius: 4px; background: transparent; cursor: pointer; }
.toggle-input {
  position: relative;
  flex: 0 0 30px;
  width: 30px;
  height: 16px;
  margin: 0 0 0 auto;
  appearance: none;
  border-radius: 999px;
  background: rgba(157, 188, 224, 0.22);
  cursor: pointer;
  transition: background 0.16s ease;
}
.toggle-input::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #9fb3c8;
  transition: transform 0.16s ease, background 0.16s ease;
}
.toggle-input:checked { background: rgba(255, 122, 42, 0.5); }
.toggle-input:checked::after { transform: translateX(14px); background: #ffd9a8; }
.select-input { flex: 1; min-width: 0; height: 26px; padding: 0 6px; border: 1px solid rgba(157, 188, 224, 0.26); border-radius: 4px; background: rgba(12, 24, 40, 0.9); color: #dbe7f4; font-size: 11.5px; cursor: pointer; }
.stats-line { font-size: 10.5px; line-height: 1.5; color: #8ca2b8; }
.wx-stage { position: relative; min-width: 0; min-height: 0; background: #0a1524; }
.cesium-container { width: 100%; height: 100%; }
.wx-map-caption {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 6;
  padding: 4px 10px;
  border: 1px solid rgba(157, 188, 224, 0.2);
  border-radius: 999px;
  background: rgba(8, 18, 30, 0.68);
  color: #a9bdd2;
  font-size: 10.5px;
  pointer-events: none;
}
.wx-banner {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 7;
  max-width: 420px;
  padding: 8px 14px;
  border: 1px solid rgba(255, 158, 84, 0.4);
  border-radius: 7px;
  background: rgba(28, 14, 6, 0.92);
  color: #ffeede;
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
  pointer-events: none;
}
.wx-statusbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  border-top: 1px solid rgba(157, 188, 224, 0.16);
  background: #0e1a29;
}
.wx-play { flex: 0 0 auto; height: 26px; padding: 0 14px; border: 0; border-radius: 5px; background: #c1461a; color: #fff3e8; font-size: 11.5px; cursor: pointer; }
.wx-clock { flex: 0 0 auto; font-family: 'DM Mono', monospace; font-size: 12px; font-weight: 600; color: #ffd9a8; }
.wx-clock em { margin-left: 3px; font-size: 9px; font-style: normal; color: #93a7bd; }
.wx-timeline { flex: 1; min-width: 120px; accent-color: #ff7a2a; }
.wx-clock-total { flex: 0 0 auto; font-size: 10.5px; color: #8ca2b8; }
.wx-speed { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; font-size: 10.5px; color: #8ca2b8; }
.wx-speed input { width: 92px; accent-color: #ff7a2a; }
.wx-speed b { font-size: 11px; color: #ffd9a8; }
.wx-status-text { flex: 0 1 320px; overflow: hidden; font-size: 10.5px; color: #7f93a8; white-space: nowrap; text-overflow: ellipsis; }
.wx-legend-swatches { display: flex; flex-direction: column; gap: 5px; }
.wx-legend-swatches span { display: flex; align-items: center; gap: 7px; font-size: 10.5px; color: #a9bdd2; }
.wx-legend-swatches i { width: 14px; height: 10px; border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 2px; }
.wx-legend-ramp { height: 10px; border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 3px; }
.wx-legend-wind { display: flex; flex-direction: column; gap: 4px; padding-top: 6px; border-top: 1px dashed rgba(157, 188, 224, 0.16); }
.wx-legend-range { display: flex; justify-content: space-between; font-size: 10px; color: #8ca2b8; }
.wx-tool.accent { border-color: rgba(255, 158, 84, 0.5); color: #ffd9a8; }
.wx-tool:disabled { opacity: 0.42; cursor: not-allowed; }

.rx-report { position: absolute; inset: 0; z-index: 90; display: flex; flex-direction: column; background: #fff; color: #16232e; }
.rx-report-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 16px; border-bottom: 1px solid #d5dee5; background: #eef4f8; }
.rx-report-title { font-size: 13px; font-weight: 700; color: #17324d; }
.rx-report-actions { display: flex; align-items: center; gap: 8px; }
.rx-report-btn { border: 1px solid #2f80ed; border-radius: 5px; padding: 4px 12px; cursor: pointer; background: #fff; color: #2f80ed; font-size: 12px; }
.rx-report-btn.active { background: #2f80ed; color: #fff; }
.rx-report-btn.accent { border-color: #c9971c; background: #c9971c; color: #fff; }
.rx-report-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rx-report-close { border: 0; background: transparent; color: #5b6b7a; cursor: pointer; font-size: 20px; line-height: 1; }
.rx-report-body { flex: 1; min-height: 0; display: flex; }
.rx-report-scroll { flex: 1; overflow: auto; }
.rx-report-pdf { flex: 1; min-height: 0; display: flex; }
.rx-report-loading { margin: auto; color: #5b6b7a; font-size: 13px; }
.rx-pdf-frame { flex: 1; width: 100%; height: 100%; border: 0; }
.rx-report-doc { width: 820px; max-width: 100%; margin: 0 auto; padding: 24px 34px 44px; box-sizing: border-box; background: #fff; }
.rx-report-h1 { margin: 0 0 6px; font-size: 20px; color: #17324d; }
.rx-report-meta { margin: 0 0 6px; font-size: 11px; color: #6a7b8a; }
.rx-report-intro { margin: 0 0 10px; font-size: 12px; line-height: 1.6; color: #3b5061; }
.rx-report-h2 { margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #cfe0ec; font-size: 14px; color: #124c7d; }
.rx-report-caption { padding: 2px 0; font-size: 11px; color: #5b6b7a; text-align: left; }
.rx-report-table { width: 100%; margin: 4px 0 8px; border-collapse: collapse; font-size: 11px; }
.rx-report-table th, .rx-report-table td { padding: 3px 7px; border: 1px solid #c9d6e0; text-align: left; vertical-align: top; }
.rx-report-table th { background: #e8f1f8; color: #17324d; font-weight: 700; }
.rx-report-table td { color: #2a3b4a; }
.rx-report-kv { display: grid; grid-template-columns: 180px 1fr; gap: 2px 10px; margin: 4px 0 6px; font-size: 12px; }
.rx-report-kv dt { color: #3c5a73; font-weight: 600; }
.rx-report-kv dd { margin: 0; color: #1e2f3d; }
.rx-report-line { margin: 3px 0; font-size: 12px; line-height: 1.6; color: #1e2f3d; }
@media (max-width: 1280px) {
  .wx-main { grid-template-columns: 236px minmax(0, 1fr) 224px; }
}
@media (max-width: 900px) {
  .wx-main { grid-template-columns: 214px minmax(0, 1fr); }
  .wx-inspector { display: none; }
  .wx-status-text { display: none; }
  .wx-system-meta { display: none; }
}
</style>
