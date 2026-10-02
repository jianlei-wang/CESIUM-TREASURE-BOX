<script setup lang="ts">
/**
 * 城市大气污染三维浓度场与污染输运分析工作台
 *
 * 以固定污染源清单 + 气象条件驱动的 PM2.5 浓度体为底座，围绕环境业务分析流程编排：
 *   污染物切换 → 浓度分级定位 → 环境影响统计（超标面积/体积、人口暴露、站点误差）
 *   → 地面 footprint 与超标边界 → 污染热点与源贡献解析 → 垂直廓线 → 时间演变
 *   → 关键浓度等值面 → 任意方向剖切 → 体素拾取。
 *
 * 污染源、分级断点、相机预设等业务参数集中在 SCENES.pm25 / PM25_CONFIG，组件不硬编码魔法数字。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Color } from 'cesium'
import VolumeShell from '../../lib/volume-engine/VolumeShell.vue'
import ParamHint from '../../lib/volume-engine/ParamHint.vue'
import LayerDock from '../../lib/volume-engine/LayerDock.vue'
import { useVolumeScene } from '../../lib/volume-engine/useVolumeScene'
import { PM25_CONFIG, SCENES } from '../../lib/volume-engine/scenes'
import { PM25_CLASSES, gradientCss, iaqiOfPm25, pm25ClassColor } from '../../lib/volume-engine/palette'
import type { PickedInfo, VolumeEngine } from '../../lib/volume-engine/VolumeEngine'
import type { LayerDockItem, PickedView, StatItem } from '../../lib/volume-engine/types'
import {
  drawProfileChart,
  drawScatterChart,
  drawTrendChart,
  runPm25Analysis,
  runPm25Footprint,
  runPm25Hotspots,
  runPm25Point,
  runPm25Profile,
  runPm25Ray,
  runPm25Sources,
  runPm25Stations,
  runPm25Trend
} from './pm25-analysis'
import { installPm25Ground, type Pm25GroundLayer, type Pm25GroundMode } from './pm25-ground'
import { installPm25Overlay, type Pm25Meteorology, type Pm25Overlay } from './pm25-overlays'
import type {
  Pm25AnalysisResult,
  Pm25FootprintResult,
  Pm25HotspotResult,
  Pm25PointResult,
  Pm25ProfileResult,
  Pm25SourcesResult,
  Pm25StationsResult,
  Pm25TrendResult
} from './pm25-types'

const spec = SCENES.pm25
const cfg = PM25_CONFIG
const volSize: [number, number, number] = [spec.volume.width, spec.volume.depth, spec.volume.height]
const heightM = spec.volume.height

const panelOpen = ref(true)
const busy = ref(false)
const trendBusy = ref(false)
const isoBusy = ref(false)
const analysis = ref<Pm25AnalysisResult | null>(null)
const trend = ref<Pm25TrendResult | null>(null)
const stations = ref<Pm25StationsResult | null>(null)
const hotspots = ref<Pm25HotspotResult | null>(null)
const footprint = ref<Pm25FootprintResult | null>(null)
const sources = ref<Pm25SourcesResult | null>(null)
const profile = ref<Pm25ProfileResult | null>(null)
const pickSample = ref<Pm25PointResult | null>(null)

const overlay = ref<Pm25Overlay | null>(null)
const ground = ref<Pm25GroundLayer | null>(null)
let isoTimer: ReturnType<typeof setTimeout> | undefined
let timeTimer: ReturnType<typeof setTimeout> | undefined
/** 分析请求序号：只允许最后一次请求结果覆盖 UI，避免拖时间轴时旧结果回写 */
let analysisSeq = 0
/** 拾取请求序号：与场分析互不干扰，避免频繁点选压制趋势/统计刷新 */
let pickSeq = 0

const trendCanvas = ref<HTMLCanvasElement | null>(null)
const scatterCanvas = ref<HTMLCanvasElement | null>(null)
const profileCanvas = ref<HTMLCanvasElement | null>(null)

const form = reactive({
  threshold: cfg.analysis.defaultThreshold,
  popDensity: cfg.analysis.defaultPopDensity,
  activeSources: spec.params.activeSources as number,
  windFrom: spec.params.windFrom as number,
  windSpeed: spec.params.windSpeed as number,
  blh: spec.params.blh as number,
  background: spec.params.background as number,
  stability: spec.params.stability as number,
  correct: false
})

const layers = reactive<Record<string, boolean>>({
  volume: true,
  ground: true,
  stations: true,
  hotspots: false,
  sources: true,
  wind: true,
  blh: false,
  city: false,
  frame: true,
  iso35: false,
  iso75: false,
  iso150: false,
  iso250: false
})
const groundMode = ref<Pm25GroundMode>('concentration')
const background = ref<'engineering' | 'satellite' | 'dim'>('engineering')

const render = reactive({
  densityGamma: 1.25,
  edgeGain: 0.55,
  confidenceFloor: 0.35,
  extinction: 2.2
})

const ISO_DEFS: { key: string; base: number; color: [number, number, number]; opacity: number }[] = [
  { key: 'iso35', base: cfg.isoLevels[0], color: [140, 210, 255], opacity: 0.10 },
  { key: 'iso75', base: cfg.isoLevels[1], color: [255, 210, 30], opacity: 0.16 },
  { key: 'iso150', base: cfg.isoLevels[2], color: [255, 90, 60], opacity: 0.24 },
  { key: 'iso250', base: cfg.isoLevels[3], color: [143, 63, 151], opacity: 0.32 }
]

/** 动态质量档：在画质与帧率间提供三档，联动 raymarch 步长与体瓦片细分 */
const qualityOptions = [
  { value: 'performance', label: '流畅', sse: 20, stepSize: 1.7, tileSize: 16, levels: 3 },
  { value: 'balanced', label: '均衡', sse: 14, stepSize: 1.0, tileSize: 16, levels: 4 },
  { value: 'quality', label: '精细', sse: 11, stepSize: 0.8, tileSize: 16, levels: 4 }
]
const quality = ref('balanced')
const fps = ref(0)

const scene = useVolumeScene(spec, {
  onReady: (engine) => {
    if (!overlay.value) overlay.value = installPm25Overlay(engine, met())
    else overlay.value.updateMeteorology(met())
    if (!ground.value) ground.value = installPm25Ground(engine)
    applyLayerVisibility()
    void runAll(engine)
    void runTrend(engine)
  },
  onPicked: (info) => onPicked(info)
})
const { container, sliceCanvas } = scene

function engineOrNull(): VolumeEngine | null {
  return scene.engine.value ?? null
}

function met(): Pm25Meteorology {
  return { windFrom: form.windFrom, windSpeed: form.windSpeed, blh: form.blh, activeSources: form.activeSources }
}

function channelMax(): number {
  return scene.active().max
}

/** 关键等值面浓度按当前污染物值域等比换算，保证与体数据同量级 */
function isoFor(base: number): number {
  return Math.round((base / 300) * channelMax())
}

/* ------------------------------ 分析调度 ------------------------------ */

async function runAll(engine: VolumeEngine | null = engineOrNull()): Promise<void> {
  if (!engine) return
  const seq = ++analysisSeq
  await Promise.all([runAnalysis(engine, seq), runStations(engine, seq), runFootprint(engine, seq)])
  if (layers.hotspots) void runHotspots(engine, seq)
  scheduleIso()
}

async function runAnalysis(engine: VolumeEngine | null = engineOrNull(), seq = ++analysisSeq): Promise<void> {
  if (!engine) return
  busy.value = true
  try {
    const result = await runPm25Analysis(engine, {
      threshold: form.threshold,
      popDensity: form.popDensity,
      volSize,
      channel: scene.ui.channel
    })
    if (result && seq === analysisSeq) analysis.value = result
  } finally {
    busy.value = false
  }
}

async function runStations(engine: VolumeEngine | null = engineOrNull(), seq = ++analysisSeq): Promise<void> {
  if (!engine) return
  const result = await runPm25Stations(engine, scene.ui.channel)
  if (!result || seq !== analysisSeq) return
  stations.value = result
  applyStationPoints(result)
  if (scatterCanvas.value) drawScatterChart(scatterCanvas.value, result, channelMax())
}

async function runFootprint(engine: VolumeEngine | null = engineOrNull(), seq = ++analysisSeq): Promise<void> {
  if (!engine) return
  const result = await runPm25Footprint(engine, form.threshold, volSize, cfg.analysis.footprintGrid, scene.ui.channel)
  if (!result || seq !== analysisSeq) return
  footprint.value = result
  ground.value?.update(result, groundMode.value)
}

async function runHotspots(engine: VolumeEngine | null = engineOrNull(), seq = ++analysisSeq): Promise<void> {
  if (!engine) return
  const result = await runPm25Hotspots(engine, form.threshold, volSize, scene.ui.channel)
  if (!result || seq !== analysisSeq) return
  hotspots.value = result
  if (layers.hotspots) applyHotspotPoints(result)
}

async function runTrend(engine: VolumeEngine | null = engineOrNull()): Promise<void> {
  if (!engine) return
  trendBusy.value = true
  try {
    const result = await runPm25Trend(engine, form.threshold, volSize, spec.timeSteps, scene.ui.channel)
    if (!result) return
    trend.value = result
    if (trendCanvas.value) drawTrendChart(trendCanvas.value, result)
  } finally {
    trendBusy.value = false
  }
}

async function runIsosurfaces(engine: VolumeEngine | null = engineOrNull()): Promise<void> {
  if (!engine) return
  isoBusy.value = true
  try {
    for (const def of ISO_DEFS) {
      if (!layers[def.key]) {
        engine.clearIsosurface(def.key)
        continue
      }
      const r = await engine.analyze<{ positions: Float32Array; normals: Float32Array }>({
        mode: 'isosurface',
        iso: isoFor(def.base),
        res: 56,
        volSize
      })
      if (r) engine.setIsosurface(r.positions, r.normals, def.color, def.opacity, def.key)
    }
  } finally {
    isoBusy.value = false
  }
}

function scheduleIso(): void {
  const e = engineOrNull()
  if (!e || !ISO_DEFS.some((def) => layers[def.key])) return
  if (isoTimer) clearTimeout(isoTimer)
  isoTimer = setTimeout(() => void runIsosurfaces(e), 160)
}

async function runProfile(x: number, y: number): Promise<void> {
  const engine = engineOrNull()
  if (!engine) return
  const result = await runPm25Profile(engine, x, y, 56, scene.ui.channel)
  if (!result) return
  profile.value = result
  const refTop = analysis.value ? analysis.value.p95TopM / heightM : undefined
  if (profileCanvas.value) drawProfileChart(profileCanvas.value, result, channelMax(), form.threshold, refTop)
}

async function runSourceBreakdown(x: number, y: number, z: number): Promise<void> {
  const engine = engineOrNull()
  if (!engine) return
  const result = await runPm25Sources(engine, x, y, Math.max(z, 0.01), scene.ui.channel)
  if (result) sources.value = result
}

/** 点位多污染物采样：为拾取浮层补充三污染物浓度与阈值状态 */
async function runPickSample(x: number, y: number, z: number): Promise<void> {
  const engine = engineOrNull()
  if (!engine) return
  const result = await runPm25Point(engine, x, y, Math.max(z, 0.01), form.threshold)
  pickSample.value = result ?? null
}

/**
 * 射线拾取：VoxelPrimitive 半透明体素不写深度缓冲，scene.pickPosition 常为空，
 * 用屏幕射线在 Worker 内步进定位首个可见采样点，再补全廓线与源解析。
 */
async function runPickRay(origin: [number, number, number], direction: [number, number, number]): Promise<void> {
  const engine = engineOrNull()
  if (!engine) return
  const seq = ++pickSeq
  const result = await runPm25Ray(
    engine,
    origin,
    direction,
    form.threshold,
    Math.max(scene.ui.valueMin, 10),
    scene.ui.channel
  )
  if (seq !== pickSeq) return
  pickSample.value = result ?? null
  if (result?.found) {
    void runProfile(result.x, result.y)
    void runSourceBreakdown(result.x, result.y, result.z)
  }
}

/* ------------------------------ 叠加层 ------------------------------ */

function stationColor(value: number): Color {
  const c = pm25ClassColor(value)
  return new Color(c[0] / 255, c[1] / 255, c[2] / 255, 0.95)
}

function applyStationPoints(result: Pm25StationsResult): void {
  const engine = engineOrNull()
  if (!engine) return
  engine.addSurfacePoints(result.positions, (i) => stationColor(result.model[i]), 7)
  engine.setSurfacePointsVisible(layers.stations)
}

function applyHotspotPoints(result: Pm25HotspotResult): void {
  const engine = engineOrNull()
  if (!engine) return
  engine.setOverlayPoints(
    Array.from({ length: result.count }, (_, i) => {
      const value = result.values[i]
      const color = new Color(...(pm25ClassColor(value).map((c) => c / 255) as [number, number, number]), 0.98)
      return {
        position: engine.localFromNormalized(result.positions[i * 3], result.positions[i * 3 + 1], result.positions[i * 3 + 2]),
        color,
        pixelSize: 11,
        label: `#${i + 1}`,
        labelColor: color
      }
    })
  )
}

function applyLayerVisibility(): void {
  overlay.value?.setVisible({
    city: layers.city,
    frame: layers.frame,
    sources: layers.sources,
    wind: layers.wind,
    blh: layers.blh
  })
  ground.value?.setVisible(layers.ground)
  const engine = engineOrNull()
  if (!engine) return
  engine.setVolumeVisible(layers.volume)
  engine.setSurfacePointsVisible(layers.stations)
  if (layers.hotspots && hotspots.value) applyHotspotPoints(hotspots.value)
  else engine.clearOverlayPoints()
}

function onPicked(info: PickedInfo | null): void {
  if (!info || !info.valid) {
    profile.value = null
    sources.value = null
    pickSample.value = null
    return
  }
  if (info.norm) {
    void runProfile(info.norm[0], info.norm[1])
    void runSourceBreakdown(info.norm[0], info.norm[1], info.norm[2])
    void runPickSample(info.norm[0], info.norm[1], info.norm[2])
    return
  }
  if (info.ray) {
    void runPickRay(info.ray.origin, info.ray.direction)
  }
}

/* ------------------------------ 交互 ------------------------------ */

function applyForm(): void {
  overlay.value?.updateMeteorology(met())
  engineOrNull()?.setParams({
    activeSources: form.activeSources,
    windFrom: form.windFrom,
    windSpeed: form.windSpeed,
    blh: form.blh,
    background: form.background,
    stability: form.stability,
    correct: form.correct ? 1 : 0
  })
}

function onThreshold(): void {
  void runAnalysis()
  void runFootprint()
  void runTrend()
  scheduleIso()
}

function onChannel(key: string): void {
  scene.setChannel(key)
  engineOrNull()?.clearIsosurface()
  void runAll()
  void runTrend()
  if (ISO_DEFS.some((def) => layers[def.key])) scheduleIso()
}

function onGroundMode(value: string): void {
  groundMode.value = value === 'class' ? 'class' : 'concentration'
  if (footprint.value) ground.value?.update(footprint.value, groundMode.value)
}

function onDensity(value: number): void {
  render.densityGamma = value
  engineOrNull()?.setRenderParams({ densityGamma: value })
}

function onEdge(value: number): void {
  render.edgeGain = value
  engineOrNull()?.setRenderParams({ pm25EdgeGain: value })
}

function onConfidence(value: number): void {
  render.confidenceFloor = value
  engineOrNull()?.setRenderParams({ pm25ConfidenceFloor: value })
}

function onExtinction(value: number): void {
  render.extinction = value
  engineOrNull()?.setRenderParams({ pm25Extinction: value })
}

function onQuality(value: string): void {
  quality.value = value
  const q = qualityOptions.find((opt) => opt.value === value)
  if (!q) return
  scene.ui.sse = q.sse
  scene.setSse()
  scene.ui.stepSize = q.stepSize
  scene.setStepSize()
  scene.setPreset(q.tileSize, q.levels)
}

function onBackground(value: string): void {
  background.value = value === 'satellite' ? 'satellite' : value === 'dim' ? 'dim' : 'engineering'
  engineOrNull()?.setBackgroundMode(background.value)
}

function flyPreset(key: string): void {
  const preset = cfg.camera[key as keyof typeof cfg.camera]
  if (!preset) return
  engineOrNull()?.flyToView(preset.heading, preset.pitch, preset.rangeFactor, 1.1)
}

function focusStrongestHotspot(): void {
  const engine = engineOrNull()
  const result = hotspots.value
  if (!engine || !result || !result.count) return
  let best = 0
  for (let i = 1; i < result.count; i += 1) if (result.values[i] > result.values[best]) best = i
  engine.flyToNormalized(result.positions[best * 3], result.positions[best * 3 + 1], result.positions[best * 3 + 2], 14000, 1.2)
}

function toggleDockLayer(key: string): void {
  layers[key] = !layers[key]
  if (key === 'volume') {
    engineOrNull()?.setVolumeVisible(layers.volume)
    return
  }
  if (key === 'hotspots') {
    if (layers.hotspots) void runHotspots()
    else engineOrNull()?.clearOverlayPoints()
    return
  }
  if (ISO_DEFS.some((def) => def.key === key)) {
    void runIsosurfaces()
    return
  }
  applyLayerVisibility()
}

function toggleAllDockLayers(): void {
  const turnOn = dockItems.value.some((item) => !item.on)
  for (const item of dockItems.value) layers[item.key] = turnOn
  applyLayerVisibility()
  if (turnOn) void runHotspots()
  else engineOrNull()?.clearOverlayPoints()
  void runIsosurfaces()
}

watch(
  () => scene.ui.timeStep,
  () => {
    // 播放中逐帧轻量刷新（序号保证只回写最后一次结果）；拖动时防抖，松手后统一分析。
    if (scene.ui.playing) {
      const engine = engineOrNull()
      if (!engine) return
      void runAnalysis(engine)
      void runFootprint(engine)
      void runStations(engine)
      if (layers.hotspots) void runHotspots(engine)
      return
    }
    if (timeTimer) clearTimeout(timeTimer)
    timeTimer = setTimeout(() => {
      void runAll()
      if (ISO_DEFS.some((def) => layers[def.key])) scheduleIso()
    }, 140)
  }
)

let fpsRaf = 0
let fpsFrames = 0
let fpsLast = 0
onMounted(() => {
  fpsLast = performance.now()
  const tick = (now: number): void => {
    fpsFrames += 1
    if (now - fpsLast >= 1000) {
      fps.value = fpsFrames
      fpsFrames = 0
      fpsLast = now
    }
    fpsRaf = requestAnimationFrame(tick)
  }
  fpsRaf = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  if (isoTimer) clearTimeout(isoTimer)
  if (timeTimer) clearTimeout(timeTimer)
  if (fpsRaf) cancelAnimationFrame(fpsRaf)
  overlay.value?.destroy()
  ground.value?.destroy()
})

/* ------------------------------ 计算属性 ------------------------------ */

const legendCss = computed(() => gradientCss(scene.ui.channel))

const classTiers = PM25_CLASSES.map((cls) => ({
  label: cls.label,
  color: `rgb(${cls.color[0]}, ${cls.color[1]}, ${cls.color[2]})`,
  range: cls.upper === Infinity ? `≥ ${cls.lower}` : `${cls.lower} ~ ${cls.upper}`
}))

const classBars = computed(() => {
  const a = analysis.value
  if (!a || !a.count) return []
  return PM25_CLASSES.map((cls, i) => ({
    label: cls.label,
    color: classTiers[i].color,
    ratio: a.classHist[i] / a.count
  }))
})

const stats = computed<StatItem[]>(() => {
  const items: StatItem[] = [
    { label: '渲染帧率', value: `${fps.value} FPS` },
    { label: '等效分辨率', value: scene.engine.value ? `${scene.engine.value.fullDims}³` : '—' },
    { label: '已加载 / 待加载瓦片', value: `${scene.stats.tilesReady.toLocaleString()} / ${scene.stats.pending}` }
  ]
  const a = analysis.value
  if (a) {
    const unit = scene.active().unit
    items.push({ label: '区域均值', value: `${a.mean.toFixed(0)} ${unit}` })
    items.push({ label: 'P95 浓度', value: `${a.p95.toFixed(0)} ${unit}` })
    items.push({ label: '峰值浓度', value: `${a.max.toFixed(0)} ${unit}` })
  }
  return items
})

const impactRows = computed<StatItem[]>(() => {
  const a = analysis.value
  if (!a) return []
  const unit = scene.active().unit
  const rows: StatItem[] = [
    { label: '超标阈值', value: `≥ ${a.threshold} ${unit}` },
    { label: '超标面积', value: `${a.exceedAreaKm2.toFixed(2)} / ${a.totalAreaKm2.toFixed(1)} km²` },
    { label: '超标体积', value: `${a.exceedVolumeKm3.toFixed(3)} km³` },
    { label: '超标体积占比', value: `${(a.exceedFraction * 100).toFixed(1)} %` },
    { label: '地面峰值', value: `${a.maxSurface.toFixed(0)} ${unit}` },
    { label: '地面均值', value: `${a.meanSurface.toFixed(0)} ${unit}` },
    { label: '地面 P95', value: `${a.surfaceP95.toFixed(0)} ${unit}` },
    { label: '污染柱顶高（最高）', value: `${a.topHeightM.toFixed(0)} m` },
    { label: '污染柱顶高（P95）', value: `${a.p95TopM.toFixed(0)} m` },
    { label: '人口暴露（示例估算）', value: `${(a.exposed / 1000).toFixed(1)} 千人` },
    { label: '人口暴露覆盖占比', value: `${(a.exposedFraction * 100).toFixed(1)} %` }
  ]
  if (a.tierVolumesKm3 && a.tierThresholds) {
    for (let i = 0; i < a.tierVolumesKm3.length; i += 1) {
      rows.push({ label: `≥ ${a.tierThresholds[i].toFixed(0)} 体积`, value: `${a.tierVolumesKm3[i].toFixed(3)} km³` })
    }
  }
  return rows
})

/** 浓度 → IAQI 换算（按 PM2.5 小时浓度估算，注意与国标 24h 平均口径不同） */
const aqiRows = computed<StatItem[]>(() => {
  const a = analysis.value
  if (!a || !a.count || scene.ui.channel !== 'pm25') return []
  return [
    { label: '区域均值 IAQI', value: `${iaqiOfPm25(a.mean)}` },
    { label: '峰值 IAQI', value: `${iaqiOfPm25(a.max)}` }
  ]
})

const stationRows = computed<StatItem[]>(() => {
  const a = analysis.value
  if (!a || !a.stationCount) return []
  return [
    { label: '监测站数量', value: `${a.stationCount} 个` },
    { label: '模型-观测 RMSE', value: `${a.stationRmse.toFixed(1)} µg/m³` },
    { label: '系统偏差', value: `${a.stationBias >= 0 ? '+' : ''}${a.stationBias.toFixed(1)} µg/m³` },
    { label: '相关系数 r', value: a.stationCorr.toFixed(3) }
  ]
})

const footprintRows = computed<StatItem[]>(() => {
  const f = footprint.value
  if (!f) return []
  return [
    { label: '栅格分辨率', value: `${f.grid} × ${f.grid}` },
    { label: '地面峰值', value: `${f.max.toFixed(0)} µg/m³` },
    { label: '地面 P95', value: `${f.p95.toFixed(0)} µg/m³` },
    { label: '边界阈值', value: `≥ ${f.threshold} µg/m³` }
  ]
})

const hotspotList = computed(() => {
  const h = hotspots.value
  if (!h) return []
  return Array.from({ length: h.count }, (_, i) => ({
    index: i + 1,
    value: h.values[i],
    top: h.positions[i * 3 + 2] * heightM
  })).sort((x, y) => y.value - x.value)
})

const sourceList = computed(() => {
  const s = sources.value
  if (!s) return []
  const active = Math.min(s.count, cfg.sources.length)
  return Array.from({ length: active }, (_, i) => ({
    id: cfg.sources[i].id,
    name: cfg.sources[i].name,
    type: cfg.sources[i].type,
    value: s.contributions[i]
  }))
    .sort((x, y) => y.value - x.value)
    .map((item, i) => ({ ...item, rank: i + 1 }))
})

const sourceTotal = computed(() => sources.value?.total ?? 0)
const sourceBackground = computed(() => sources.value?.background ?? 0)

const clipRows = computed<StatItem[]>(() => [
  { label: '方位角', value: `${scene.ui.azimuth}°` },
  { label: '倾角', value: `${scene.ui.tilt}°` },
  { label: '偏移', value: `${scene.ui.offset}%` }
])

const pickedView = computed<PickedView | null>(() => {
  const p = scene.picked.value
  if (!p) return null
  if (!p.valid) return { title: '浓度拾取', rows: [], empty: '该处为空体元素 / 低于显示阈值' }
  const ch = scene.active()
  const rows: StatItem[] = [{ label: ch.label, value: `${p.value.toFixed(0)} ${ch.unit}` }]
  const ps = pickSample.value
  if (ps) {
    rows.push({ label: 'PM2.5 / PM10', value: `${ps.pm25.toFixed(0)} / ${ps.pm10.toFixed(0)} µg/m³` })
    rows.push({ label: 'NO₂', value: `${ps.no2.toFixed(0)} µg/m³` })
    rows.push({ label: `阈值状态（≥${ps.threshold}）`, value: ps.pm25 >= ps.threshold ? 'PM2.5 超标' : 'PM2.5 达标' })
  }
  if (p.lon !== undefined && p.lat !== undefined) {
    rows.push({ label: '经度 / 纬度', value: `${p.lon.toFixed(4)}°, ${p.lat.toFixed(4)}°` })
    rows.push({ label: '高度', value: `${(p.height ?? 0).toFixed(0)} m` })
  }
  if (p.norm) {
    rows.push({ label: '归一化坐标', value: `${p.norm[0].toFixed(2)}, ${p.norm[1].toFixed(2)}, ${p.norm[2].toFixed(2)}` })
  } else if (ps) {
    rows.push({ label: '归一化坐标', value: `${ps.x.toFixed(2)}, ${ps.y.toFixed(2)}, ${ps.z.toFixed(2)} (射线)` })
  }
  return { title: '浓度拾取 / 源解析定位', rows }
})

const dockItems = computed<LayerDockItem[]>(() => [
  { key: 'volume', label: '三维污染体', color: '#65d3eb', on: layers.volume, hint: '显示/隐藏 GPU 光线步进的三维浓度体主视觉' },
  { key: 'ground', label: '地面 footprint', color: '#ff7e4d', on: layers.ground, hint: '在体域底面叠加近地浓度热力图与分级边界' },
  { key: 'stations', label: '监测站点', color: '#65d3eb', on: layers.stations, hint: '显示监测站位置，按浓度等级着色' },
  { key: 'hotspots', label: '污染热点', color: '#ff5a3c', on: layers.hotspots, hint: '提取超过阈值的三维高浓度单元并编号' },
  { key: 'sources', label: '固定污染源', color: '#ffd21e', on: layers.sources, hint: '显示工业烟囱 / 城区面源 / 道路线源' },
  { key: 'wind', label: '风向风矢', color: '#4fd1c5', on: layers.wind, hint: '显示下风向输运方向与风速' },
  { key: 'blh', label: '边界层顶', color: '#bfe6ff', on: layers.blh, hint: '显示大气边界层顶高度平面，判断垂直混合范围' },
  { key: 'city', label: '城市建筑', color: '#c9d8e8', on: layers.city, hint: '显示城区建筑白模，作为污染受体空间参照' },
  { key: 'frame', label: '体域骨架', color: '#4fd1c5', on: layers.frame, hint: '显示体域边界与地面参考网格' },
  { key: 'iso35', label: `${cfg.isoLevels[0]} 等值面`, color: '#8cd2ff', on: layers.iso35, hint: '清洁上限/低阈值边界等值面' },
  { key: 'iso75', label: `${cfg.isoLevels[1]} 等值面`, color: '#ffd21e', on: layers.iso75, hint: '轻度污染边界等值面' },
  { key: 'iso150', label: `${cfg.isoLevels[2]} 等值面`, color: '#ff5a3c', on: layers.iso150, hint: '重度污染核心等值面' },
  { key: 'iso250', label: `${cfg.isoLevels[3]} 等值面`, color: '#8f3f97', on: layers.iso250, hint: '严重污染核心等值面' }
])

const groundModeOptions = [
  { value: 'concentration', label: '连续浓度' },
  { value: 'class', label: '等级分色' }
]

const backgroundOptions = [
  { value: 'engineering', label: '工程深色' },
  { value: 'dim', label: '弱影像' },
  { value: 'satellite', label: '卫星影像' }
]
</script>

<template>
  <VolumeShell
    title="城市 PM2.5 三维浓度场与污染输运分析"
    :status="scene.status.value"
    :panel-open="panelOpen"
    :legend-css="legendCss"
    :legend-min="`0 ${scene.active().unit}`"
    :legend-max="`${scene.active().max}+ ${scene.active().unit}`"
    :stats="stats"
    :clip-rows="clipRows"
    :has-slice="scene.hasSlice.value"
    :picked="pickedView"
    @toggle-panel="panelOpen = !panelOpen"
    @download-slice="scene.downloadSlice()"
  >
    <template #scene>
      <div ref="container" class="vol-cesium"></div>
    </template>

    <template #slice>
      <canvas ref="sliceCanvas" :class="{ hidden: !scene.hasSlice.value }"></canvas>
    </template>

    <template #legend>
      <div class="pm-tier" v-for="tier in classTiers" :key="tier.label">
        <i :style="{ background: tier.color }"></i>
        <span>{{ tier.label }}</span>
        <b>{{ tier.range }}</b>
      </div>

      <div v-if="classBars.length" class="pm-group">
        <div class="pm-group-title">浓度分级体积占比</div>
        <div class="pm-bar" v-for="bar in classBars" :key="bar.label">
          <span>{{ bar.label }}</span>
          <div class="pm-bar-track"><i :style="{ width: `${(bar.ratio * 100).toFixed(1)}%`, background: bar.color }"></i></div>
          <em>{{ (bar.ratio * 100).toFixed(0) }}%</em>
        </div>
      </div>

      <div v-if="footprintRows.length" class="pm-group">
        <div class="pm-group-title">地面 footprint</div>
        <div class="pm-metric" v-for="row in footprintRows" :key="row.label">
          <span>{{ row.label }}</span><b>{{ row.value }}</b>
        </div>
      </div>

      <div v-if="hotspotList.length" class="pm-group">
        <div class="pm-group-title">污染热点（≥{{ form.threshold }} µg/m³）</div>
        <div class="pm-hot" v-for="spot in hotspotList" :key="spot.index">
          <span>#{{ spot.index }}</span>
          <b>{{ spot.value.toFixed(0) }} µg/m³</b>
          <em>高 {{ spot.top.toFixed(0) }} m</em>
        </div>
      </div>
    </template>

    <template #dock>
      <LayerDock
        title="图层控制"
        :items="dockItems"
        mode-label="地面着色"
        :mode="groundMode"
        :mode-options="groundModeOptions"
        @toggle="toggleDockLayer"
        @toggle-all="toggleAllDockLayers"
        @update:mode="onGroundMode"
      />
    </template>

    <template #controls>
      <div class="pm-block">
        <div class="vol-section">污染物指标</div>
        <div class="pm-seg">
          <button
            v-for="ch in spec.channels"
            :key="ch.key"
            type="button"
            class="pm-seg-btn"
            :class="{ active: scene.ui.channel === ch.key }"
            @click="onChannel(ch.key)"
          >
            {{ ch.label }}
          </button>
        </div>
        <div class="vol-row">
          <span class="vol-label">值域下限<ParamHint text="过滤显示的浓度下限：低于该值的体素保持透明，用于突出污染核心" /></span>
          <input type="range" :min="0" :max="scene.active().max" step="1" v-model.number="scene.ui.valueMin" @input="scene.setRange()" />
          <span class="vol-value">{{ scene.ui.valueMin.toFixed(0) }} {{ scene.active().unit }}</span>
        </div>
      </div>

      <div class="pm-block">
        <div class="vol-section">环境影响分析</div>
        <div class="pm-chips">
          <button
            v-for="b in cfg.classBreaks"
            :key="b"
            type="button"
            class="vol-chip"
            :class="{ active: form.threshold === b }"
            @click="form.threshold = b; onThreshold()"
          >
            ≥{{ b }}
          </button>
        </div>
        <div class="vol-row">
          <span class="vol-label">人口密度<ParamHint text="用于估算暴露人口，单位为 人/km²" /></span>
          <input type="range" min="200" max="6000" step="100" v-model.number="form.popDensity" @change="runAnalysis()" />
          <span class="vol-value">{{ form.popDensity }}/km²</span>
        </div>
        <div v-if="impactRows.length" class="pm-grid">
          <div v-for="row in impactRows" :key="row.label" class="pm-cell">
            <span>{{ row.label }}</span>
            <b>{{ row.value }}</b>
          </div>
        </div>
        <div v-if="aqiRows.length" class="pm-group">
          <div class="pm-group-title">浓度 → IAQI 对照（小时浓度估算）</div>
          <div class="pm-metric" v-for="row in aqiRows" :key="row.label">
            <span>{{ row.label }}</span><b>{{ row.value }}</b>
          </div>
          <div class="pm-hint">IAQI 依据 HJ 633-2012 由 PM2.5 浓度换算；此处为单小时浓度估算，与官方 24 小时平均口径存在差异。</div>
        </div>
        <div class="pm-btn-row">
          <button class="pm-btn" :disabled="busy" @click="runAnalysis()">
            {{ busy ? '分析中…' : '重新分析' }}
          </button>
          <button class="pm-btn ghost" :disabled="!hotspotList.length" @click="focusStrongestHotspot">
            聚焦最强热点
          </button>
        </div>
      </div>

      <div class="pm-block">
        <div class="vol-section">污染源与气象</div>
        <div class="vol-row">
          <span class="vol-label">启用源数量<ParamHint text="从固定源清单中启用前 N 个污染源，源位置固定不跳变" /></span>
          <input type="range" min="1" :max="cfg.sources.length" step="1" v-model.number="form.activeSources" @change="applyForm" />
          <span class="vol-value">{{ form.activeSources }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">风向<ParamHint text="风的来向（0° 为正北），决定污染物下风向输运方向" /></span>
          <input type="range" min="0" max="359" step="1" v-model.number="form.windFrom" @change="applyForm" />
          <span class="vol-value">{{ form.windFrom }}°</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">风速<ParamHint text="近地风速，影响烟羽下风向拉伸与稀释强度" /></span>
          <input type="range" min="0.5" max="12" step="0.1" v-model.number="form.windSpeed" @change="applyForm" />
          <span class="vol-value">{{ form.windSpeed.toFixed(1) }} m/s</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">边界层高度<ParamHint text="大气边界层顶高度，控制垂直混合与浓度累积" /></span>
          <input type="range" min="0.1" max="0.6" step="0.01" v-model.number="form.blh" @change="applyForm" />
          <span class="vol-value">{{ (form.blh * heightM).toFixed(0) }} m</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">大气稳定度<ParamHint text="稳定度越高，垂直扩散越弱、污染越易累积" /></span>
          <input type="range" min="0" max="1" step="0.05" v-model.number="form.stability" @change="applyForm" />
          <span class="vol-value">{{ form.stability.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">区域背景值<ParamHint text="不受本地源影响的背景浓度，单位 μg/m³" /></span>
          <input type="range" min="0" max="60" step="1" v-model.number="form.background" @change="applyForm" />
          <span class="vol-value">{{ form.background }} µg/m³</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">监测同化订正<ParamHint text="开启后以监测站残差对浓度场做时空调正，改善模型偏差" /></span>
          <button class="vol-switch" :class="{ 'is-on': form.correct }" @click="form.correct = !form.correct; applyForm()"><span></span></button>
        </div>
      </div>

      <div class="pm-block">
        <div class="vol-section">监测站模型-观测评估</div>
        <div v-if="stationRows.length" class="pm-metrics">
          <div class="pm-metric" v-for="row in stationRows" :key="row.label">
            <span>{{ row.label }}</span><b>{{ row.value }}</b>
          </div>
        </div>
        <canvas ref="scatterCanvas" class="pm-canvas" width="240" height="140"></canvas>
        <div class="pm-key">
          <i style="background:#65d3eb"></i>城市站
          <i style="background:#ffd21e"></i>交通站
          <i style="background:#ff7e4d"></i>工业站
          <i style="background:#9fb8d4"></i>背景站
        </div>
      </div>

      <div class="pm-block">
        <div class="vol-section">垂直廓线与源解析</div>
        <div class="pm-hint">在三维场景中点击任意位置，可查看该处浓度垂直廓线并拆解各污染源贡献。</div>
        <canvas ref="profileCanvas" class="pm-canvas" width="240" height="140"></canvas>
        <div v-if="sourceList.length" class="pm-sources">
          <div class="pm-source-title">
            源贡献（合计 {{ sourceTotal.toFixed(0) }} · 背景 {{ sourceBackground.toFixed(0) }} µg/m³）
          </div>
          <div class="pm-source" v-for="item in sourceList" :key="item.id">
            <span class="pm-source-rank">{{ item.rank }}</span>
            <span class="pm-source-name">{{ item.id }} {{ item.name }}</span>
            <b>{{ item.value.toFixed(1) }}</b>
            <div class="pm-source-track">
              <i :style="{ width: `${Math.min(100, (item.value / (sourceTotal || 1)) * 100).toFixed(1)}%` }"></i>
            </div>
          </div>
        </div>
      </div>

      <div class="pm-block">
        <div class="vol-section">时间演变（{{ spec.timeSteps }} {{ spec.timeStepUnit }}）</div>
        <div class="vol-row">
          <span class="vol-label">时间步<ParamHint text="选择污染演变时刻，切换后自动重新分析与统计" /></span>
          <input
            type="range"
            min="0"
            :max="spec.timeSteps - 1"
            step="1"
            :value="scene.ui.timeStep"
            @input="scene.setTimeStep(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="vol-value">T+{{ scene.ui.timeStep * cfg.timeStepHours }}{{ spec.timeStepUnit }}</span>
        </div>
        <canvas ref="trendCanvas" class="pm-canvas" width="240" height="72"></canvas>
        <div class="pm-key">
          <i style="background:#ff5a3c"></i>地面峰值
          <i style="background:#65d3eb"></i>地面均值
          <i style="background:#ffd21e"></i>超标面积
          <i style="background:#8f9bff"></i>污染层顶高
        </div>
        <div class="pm-speed">
          <span>回放倍速</span>
          <button
            v-for="s in [1, 2, 4]"
            :key="s"
            type="button"
            :class="{ active: scene.ui.playSpeed === s }"
            @click="scene.setPlaySpeed(s)"
          >
            {{ s }}×
          </button>
        </div>
        <div class="pm-btn-row">
          <button class="pm-btn ghost" @click="scene.togglePlay()">
            {{ scene.ui.playing ? '暂停回放' : '自动播放' }}
          </button>
          <button class="pm-btn ghost" :disabled="trendBusy" @click="runTrend()">
            {{ trendBusy ? '统计中…' : '刷新统计' }}
          </button>
        </div>
      </div>

      <div class="pm-block">
        <div class="vol-section">关键浓度等值面</div>
        <div class="pm-chips">
          <button
            v-for="def in ISO_DEFS"
            :key="def.key"
            type="button"
            class="vol-chip"
            :class="{ active: layers[def.key] }"
            :disabled="isoBusy"
            @click="toggleDockLayer(def.key)"
          >
            ≥{{ isoFor(def.base) }}
          </button>
        </div>
        <div class="pm-hint">等值面浓度按当前污染物值域等比换算，用于框定污染核心空间范围。</div>
      </div>

      <div class="pm-block">
        <div class="vol-section">视角预设</div>
        <div class="pm-chips">
          <button
            v-for="(preset, key) in cfg.camera"
            :key="key"
            type="button"
            class="vol-chip"
            @click="flyPreset(key)"
          >
            {{ preset.label }}
          </button>
        </div>
      </div>

      <div class="pm-block">
        <div class="vol-section">任意方向剖切</div>
        <div class="vol-row">
          <span class="vol-label">启用剖切<ParamHint text="开启后可沿任意方位/倾角剖开体域，查看内部浓度结构" /></span>
          <button
            class="vol-switch"
            :class="{ 'is-on': scene.ui.clipEnabled }"
            @click="scene.ui.clipEnabled = !scene.ui.clipEnabled; scene.setClip()"
          ><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">方位角<ParamHint text="剖切面在水平面内的朝向（0° 为正北，顺时针增大）" /></span>
          <input type="range" min="0" max="360" step="1" v-model.number="scene.ui.azimuth" @input="scene.setClip()" />
          <span class="vol-value">{{ scene.ui.azimuth }}°</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">倾角<ParamHint text="剖切面相对水平面的倾斜角度，90° 为垂直剖面" /></span>
          <input type="range" min="0" max="90" step="1" v-model.number="scene.ui.tilt" @input="scene.setClip()" />
          <span class="vol-value">{{ scene.ui.tilt }}°</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">偏移<ParamHint text="剖切面沿法线方向的偏移量，用于在体域内平移切割位置" /></span>
          <input type="range" min="-100" max="100" step="1" v-model.number="scene.ui.offset" @input="scene.setClip()" />
          <span class="vol-value">{{ scene.ui.offset }}%</span>
        </div>
      </div>

      <div class="pm-block">
        <div class="vol-section">渲染</div>
        <div class="vol-row">
          <span class="vol-label">不透明度<ParamHint text="体渲染整体透明度系数" /></span>
          <input type="range" min="0.1" max="1" step="0.02" v-model.number="scene.ui.opacity" @input="scene.setOpacity()" />
          <span class="vol-value">{{ scene.ui.opacity.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">覆盖基底<ParamHint text="低浓度区域的基底不透明度，数值越大污染范围越完整" /></span>
          <input type="range" min="0" max="0.9" step="0.02" v-model.number="scene.ui.coverage" @input="scene.setCoverage()" />
          <span class="vol-value">{{ scene.ui.coverage.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">密度压缩<ParamHint text="调整浓度-透明度映射曲线，数值越大高值核心越突出" /></span>
          <input type="range" min="0.5" max="2.5" step="0.05" v-model.number="render.densityGamma" @input="onDensity(render.densityGamma)" />
          <span class="vol-value">{{ render.densityGamma.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">边界增强<ParamHint text="烟羽锋面/污染边界的视觉增强强度" /></span>
          <input type="range" min="0" max="1.5" step="0.05" v-model.number="render.edgeGain" @input="onEdge(render.edgeGain)" />
          <span class="vol-value">{{ render.edgeGain.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">置信度底<ParamHint text="低置信度区域保留的最低不透明度比例" /></span>
          <input type="range" min="0" max="1" step="0.05" v-model.number="render.confidenceFloor" @input="onConfidence(render.confidenceFloor)" />
          <span class="vol-value">{{ render.confidenceFloor.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">消光系数<ParamHint text="Beer-Lambert 消光系数，控制高浓度核心的致密程度" /></span>
          <input type="range" min="0.5" max="4" step="0.1" v-model.number="render.extinction" @input="onExtinction(render.extinction)" />
          <span class="vol-value">{{ render.extinction.toFixed(1) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">质量档<ParamHint text="动态质量档：联动 raymarch 步长与体瓦片细分，兼顾帧率与画质" /></span>
          <select class="pm-select" :value="quality" @change="onQuality(($event.target as HTMLSelectElement).value)">
            <option v-for="opt in qualityOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>
        <div class="vol-row">
          <span class="vol-label">场景底图</span>
          <select class="pm-select" :value="background" @change="onBackground(($event.target as HTMLSelectElement).value)">
            <option v-for="opt in backgroundOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>
      </div>
    </template>

    <template #actions>
      <button class="vol-action" @click="engineOrNull()?.rebuild()">重新生成</button>
      <button class="vol-action ghost" @click="flyPreset('overview')">恢复视图</button>
    </template>
  </VolumeShell>
</template>

<style scoped>
.pm-block {
  margin-bottom: 10px;
}
.pm-seg {
  display: flex;
  gap: 4px;
}
.pm-seg-btn {
  flex: 1 1 0;
  padding: 6px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.pm-seg-btn.active {
  border-color: #2f80ed;
  background: #2f80ed;
  color: #fff;
  font-weight: 600;
}
.pm-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}
.pm-chips .vol-chip {
  flex: 1 1 28%;
}
.pm-btn-row {
  display: flex;
  gap: 5px;
}
.pm-speed {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 5px;
  font-size: 10px;
  color: #9fb8d4;
}
.pm-speed button {
  padding: 2px 9px;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.pm-speed button.active {
  border-color: #2f80ed;
  background: #2f80ed;
  color: #fff;
  font-weight: 600;
}
.pm-btn {
  flex: 1 1 0;
  height: 26px;
  margin-top: 6px;
  border: 0;
  border-radius: 5px;
  background: #2f80ed;
  color: #eef4ff;
  font-size: 11px;
  cursor: pointer;
}
.pm-btn.ghost {
  background: rgba(47, 128, 237, 0.18);
  border: 1px solid rgba(47, 128, 237, 0.7);
  color: #9fd8ff;
}
.pm-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.pm-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin-top: 6px;
}
.pm-cell {
  padding: 5px 6px;
  border: 1px solid rgba(157, 188, 224, 0.22);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.04);
}
.pm-cell span {
  display: block;
  font-size: 9px;
  color: #8ea5c2;
}
.pm-cell b {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: #65d3eb;
  font-variant-numeric: tabular-nums;
}
.pm-metrics {
  margin-top: 2px;
}
.pm-metric {
  display: flex;
  justify-content: space-between;
  margin-top: 3px;
  font-size: 10px;
  color: #c3d5e8;
}
.pm-metric b {
  color: #9fe8b9;
  font-variant-numeric: tabular-nums;
}
.pm-canvas {
  width: 100%;
  height: 72px;
  margin-top: 5px;
  border: 1px solid rgba(157, 188, 224, 0.22);
  border-radius: 4px;
  background: rgba(6, 16, 30, 0.6);
}
.pm-key {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 3px;
  font-size: 9px;
  color: #9fb8d4;
}
.pm-key i {
  display: inline-block;
  width: 9px;
  height: 3px;
  border-radius: 2px;
}
.pm-hint {
  margin-top: 4px;
  font-size: 9px;
  line-height: 1.5;
  color: #7f96b3;
}
.pm-select {
  flex: 0 0 96px;
  height: 22px;
  padding: 0 4px;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(12, 24, 40, 0.9);
  color: #dbe7f4;
  font-size: 10px;
  cursor: pointer;
}
.pm-sources {
  margin-top: 7px;
  padding-top: 6px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
}
.pm-source-title {
  margin-bottom: 4px;
  font-size: 10px;
  font-weight: 700;
  color: #65d3eb;
}
.pm-source {
  display: grid;
  grid-template-columns: 16px 1fr auto;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  font-size: 10px;
  color: #c3d5e8;
}
.pm-source-rank {
  color: #65d3eb;
  font-variant-numeric: tabular-nums;
}
.pm-source-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pm-source b {
  color: #9fe8b9;
  font-variant-numeric: tabular-nums;
}
.pm-source-track {
  grid-column: 1 / -1;
  height: 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.pm-source-track i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #2f80ed, #65d3eb);
}
.pm-tier {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 10px;
  color: #c3d5e8;
}
.pm-tier i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.pm-tier span {
  flex: 1 1 auto;
}
.pm-tier b {
  color: #65d3eb;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.pm-group {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
}
.pm-group-title {
  margin-bottom: 4px;
  font-size: 10px;
  font-weight: 700;
  color: #65d3eb;
}
.pm-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 3px;
  font-size: 9px;
  color: #c3d5e8;
}
.pm-bar span {
  flex: 0 0 46px;
}
.pm-bar-track {
  flex: 1 1 auto;
  height: 7px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.pm-bar-track i {
  display: block;
  height: 100%;
}
.pm-bar em {
  flex: 0 0 30px;
  text-align: right;
  font-style: normal;
  color: #9fb8d4;
  font-variant-numeric: tabular-nums;
}
.pm-hot {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 3px;
  font-size: 10px;
  color: #c3d5e8;
}
.pm-hot span {
  flex: 0 0 22px;
}
.pm-hot b {
  flex: 1 1 auto;
  color: #ff8f5e;
  font-variant-numeric: tabular-nums;
}
.pm-hot em {
  color: #9fb8d4;
  font-style: normal;
  font-variant-numeric: tabular-nums;
}
</style>
