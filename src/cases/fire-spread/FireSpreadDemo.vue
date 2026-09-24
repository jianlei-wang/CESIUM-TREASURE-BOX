<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Cartesian2, Cartographic, Ellipsoid, Math as CesiumMath, ScreenSpaceEventHandler, ScreenSpaceEventType, type TerrainProvider, type Viewer } from 'cesium'
import { beidouLevel, enumerateCells, levelForCellMeters } from './wildfire/beidou'
import { computeCellStats, type BeiDouCellStats } from './wildfire/beidouStats'
import { firebreakLengthMeters, recommendFirebreak, type Firebreak } from './wildfire/firebreak'
import { buildFuelGrid, FUEL_PROFILES, FuelKind } from './wildfire/fuel'
import { buildRiverPath, traceValleyPath } from './wildfire/hydro'
import { DEFAULT_FIRE_PARAMS, WildfireSimulation, type FireMetrics, type FireParams } from './wildfire/model'
import { ALGORITHM_INTRO, ALGORITHM_SECTIONS, ALGORITHM_TITLE, PIPELINE_STAGES } from './wildfire/algorithm'
import {
  ARRIVAL_RAMP,
  INTENSITY_RAMP,
  MAX_ROS_REFERENCE,
  OVERLAY_MODES,
  type FireOverlayModeValue
} from './wildfire/overlay'
import {
  DEFAULT_BEIDOU_PARAMS,
  DEFAULT_LAYER_FLAGS,
  DEFAULT_PARTICLE_PARAMS,
  DEFAULT_RENDER_STYLE,
  WildfireRenderer,
  type BeiDouRenderModeValue,
  type WildfireBeidouParams,
  type WildfireLayerFlags,
  type WildfireParticleParams,
  type WildfireRenderStyle
} from './wildfire/renderer'
import {
  addWildfireImagery,
  captureWildfireCanvas,
  createWildfireViewer,
  destroyWildfireViewer,
  loadWildfireTerrain,
  setWildfireCamera
} from './wildfire/scene'
import {
  buildProceduralTerrain,
  buildSampledTerrain,
  boundsFromCenter,
  resampleTerrainGrid,
  resolveResampleCounts,
  sampleElevation,
  type TerrainGrid,
  type TerrainResampleMode
} from './wildfire/terrain'
import type { AreaBounds, LonLat } from './wildfire/types'
import { DEFAULT_WIND_PARAMS, WIND_SPEED_MAX, WIND_SPEED_RAMP, type WildfireWindParams } from './wildfire/wind'
import {
  createReportPdfUrl,
  exportReportDocx,
  exportReportPdf,
  nowStamp,
  type ReportImage,
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
const collapsed = reactive({ tool: false, style: false, beidou: true, firebreak: true })
const statusMessage = ref('正在初始化 Cesium 场景…')
let statusTimer: number | undefined

/** 展示一条状态提示，并在指定时长后自动隐藏。 */
function flashStatus(message: string, duration = 5000): void {
  statusMessage.value = message
  if (statusTimer !== undefined) window.clearTimeout(statusTimer)
  statusTimer = window.setTimeout(() => {
    statusTimer = undefined
    if (statusMessage.value === message) statusMessage.value = ''
  }, duration)
}
const terrainNote = ref('')
const metrics = ref<FireMetrics | null>(null)
const ignitionLabel = ref('')
const clickHint = ref('单击地图可设置或追加起火点')

type InteractionTool = 'ignite' | 'grid' | 'firebreak' | 'none'
const tool = ref<InteractionTool>('ignite')
const beidou = reactive<WildfireBeidouParams>({ ...DEFAULT_BEIDOU_PARAMS })
const autoLod = ref(false)
const resampleMode = ref<TerrainResampleMode>('count')
const resampleCount = ref(65)
const resampleDistance = ref(150)
const resampling = ref(false)
const simToken = ref(0)
const hasWorldTerrain = ref(false)
const selectedCell = ref<BeiDouCellStats | null>(null)
const firebreakWidth = ref(50)
const firebreakList = ref<Firebreak[]>([])
const drawingPath = ref<LonLat[]>([])
const hoverPoint = ref<LonLat | null>(null)
const algoOpen = ref(false)

const BEIDOU_MODES: Array<{ value: BeiDouRenderModeValue; label: string }> = [
  { value: 'lines', label: '仅网格线' },
  { value: 'burnRatio', label: '单元过火占比' },
  { value: 'elevation', label: '单元平均高程' },
  { value: 'slope', label: '单元平均坡度' },
  { value: 'fuel', label: '优势可燃物' }
]
const BEIDOU_LEVEL_MIN = 4
const BEIDOU_LEVEL_MAX = 11

type LayerDockItem = { key: keyof WildfireLayerFlags; label: string; color: string }
const LAYER_DOCK_ITEMS: LayerDockItem[] = [
  { key: 'field', label: '栅格专题', color: '#c2410c' },
  { key: 'fuel', label: '可燃物类型', color: '#315f3a' },
  { key: 'burnedOutline', label: '烧毁边界', color: '#ffc457' },
  { key: 'fireLine', label: '火线', color: '#ffe6a8' },
  { key: 'firebreak', label: '隔离带', color: '#12b3a8' },
  { key: 'flame', label: '火焰粒子', color: '#ff6a1a' },
  { key: 'smoke', label: '烟雾粒子', color: '#9aa7b4' },
  { key: 'ignition', label: '起火点', color: '#ffb02e' },
  { key: 'hydro', label: '水系', color: '#2f8fd8' },
  { key: 'roads', label: '道路', color: '#c9a06a' },
  { key: 'wind', label: '三维风场', color: '#7fd8ff' }
]
const layerDockOpen = ref(true)
const metricsOpen = ref(false)
const activeLayerCount = computed(() => LAYER_DOCK_ITEMS.filter((item) => layers[item.key]).length)

function toggleLayer(key: keyof WildfireLayerFlags): void {
  layers[key] = !layers[key]
  onLayerChange()
}

function toggleAllLayers(): void {
  const next = activeLayerCount.value < LAYER_DOCK_ITEMS.length
  for (const item of LAYER_DOCK_ITEMS) layers[item.key] = next
  onLayerChange()
}

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

function describeTerrain(grid: TerrainGrid, sampled: boolean): string {
  let minElev = Infinity
  let maxElev = -Infinity
  for (let i = 0; i < grid.elevation.length; i += 1) {
    const value = grid.elevation[i]
    if (value < minElev) minElev = value
    if (value > maxElev) maxElev = value
  }
  return `${sampled ? '世界地形采样' : '程序地形'} · 高程 ${Math.round(minElev)}~${Math.round(maxElev)} m · 网格 ${grid.cols}×${grid.rows} · 单格 ${grid.cellMeters.toFixed(0)} m`
}

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
  const items: Array<{ label: string; color: string }> = []
  if (layers.fuel) {
    for (const profile of Object.values(FUEL_PROFILES)) {
      items.push({ label: `可燃物·${profile.name}`, color: profile.color })
    }
  }
  items.push(
    { label: '烧毁区填充', color: style.innerColor },
    { label: '火线描边', color: style.borderColor },
    { label: '火线外发光', color: style.glowColor },
    { label: '烧毁边界', color: style.boundaryColor },
    { label: '水系', color: '#3d92c4' },
    { label: '道路', color: '#c7bca0' }
  )
  return { mode: 'swatch', items }
})

const windLegend = computed(() => ({
  gradient: rampGradient(WIND_SPEED_RAMP),
  min: '0',
  max: `${WIND_SPEED_MAX}`,
  label: `${params.windSpeed.toFixed(1)} m/s · ${describeAspect(params.windDir)}`
}))

const beidouSpec = computed(() => beidouLevel(beidou.level))
const beidouCellCount = computed(() => enumerateCells(boundsFor(), beidou.level).length)
const beidouCellSize = computed(() => {
  const spec = beidouSpec.value
  return `${spec.label} · 约 ${Math.round(spec.lonDeg * 111320 * Math.cos(CesiumMath.toRadians(DEMO_CENTER.lat)))} m`
})
const firebreakSummary = computed(() => {
  const total = firebreakList.value.reduce((sum, item) => sum + firebreakLengthMeters(item), 0)
  return { count: firebreakList.value.length, totalM: total }
})
const drawingActive = computed(() => tool.value === 'firebreak' && drawingPath.value.length > 0)
const selectedCellRows = computed(() => {
  const stat = selectedCell.value
  if (!stat) return []
  const arrival = Number.isFinite(stat.arrivalMin)
    ? `${stat.arrivalMin.toFixed(0)} ~ ${stat.arrivalMax.toFixed(0)} min`
    : '未到达'
  return [
    { label: '网格码', value: stat.cell.code },
    { label: '层级 / 行列', value: `${stat.cell.level} 级 · R${stat.cell.row} C${stat.cell.col}` },
    { label: '四至', value: `${stat.cell.west.toFixed(4)}~${stat.cell.east.toFixed(4)}°E, ${stat.cell.south.toFixed(4)}~${stat.cell.north.toFixed(4)}°N` },
    { label: '单元尺寸', value: `${stat.cell.widthM.toFixed(0)} × ${stat.cell.heightM.toFixed(0)} m` },
    { label: '模拟格点', value: `${stat.gridCells} 个` },
    { label: '过火面积', value: formatArea(stat.burnedAreaM2) },
    { label: '过火占比', value: `${(stat.burnedRatio * 100).toFixed(1)} %` },
    { label: '在燃 / 烧毁', value: `${stat.burningCells} / ${stat.burnedCells} 格` },
    { label: '平均高程', value: `${stat.meanElevation.toFixed(0)} m` },
    { label: '平均坡度', value: `${stat.meanSlope.toFixed(1)}°` },
    { label: '平均坡向', value: describeAspect(stat.meanAspect) },
    { label: '到达时间', value: arrival },
    { label: '平均 / 最大速率', value: `${stat.meanRos.toFixed(2)} / ${stat.maxRos.toFixed(2)} m/min` },
    { label: '优势可燃物', value: stat.dominantFuel },
    { label: '水域 / 道路占比', value: `${stat.waterPct.toFixed(1)}% / ${stat.roadPct.toFixed(1)}%` }
  ]
})

const resamplePreview = computed(() => {
  void simToken.value
  if (!sim) return '—'
  const result = resolveResampleCounts(sim.terrain, {
    mode: resampleMode.value,
    value: resampleMode.value === 'count' ? resampleCount.value : resampleDistance.value
  })
  return `${result.sampleCols} × ${result.sampleRows} 采样点 · 间距约 ${Math.round(result.spacingMeters)} m`
})

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
  renderer?.setBeidou({ ...beidou, enabled: layers.beidouGrid })
}

function onModeChange(): void {
  renderer?.setMode(mode.value)
}

function refreshAfterSolve(): void {
  if (!sim) return
  metrics.value = sim.metrics
  renderer?.markFieldDirty()
  renderer?.markVectorsDirty()
  renderer?.update()
}

function setTool(next: InteractionTool): void {
  const resolved: InteractionTool = tool.value === next ? 'none' : next
  tool.value = resolved
  if (resolved !== 'firebreak') cancelFirebreakDraw()
  if (resolved === 'grid') {
    collapsed.beidou = false
    if (!layers.beidouGrid) {
      layers.beidouGrid = true
      onLayerChange()
    }
    clickHint.value = '单击地图查看所在北斗网格单元的统计信息'
  } else if (resolved === 'firebreak') {
    collapsed.firebreak = false
    drawingPath.value = []
    hoverPoint.value = null
    renderer?.setFirebreakPreview([])
    clickHint.value = '依次单击地图添加隔离带节点，右键或点击「完成隔离带」结束绘制'
  } else if (resolved === 'ignite') {
    selectedCell.value = null
    clickHint.value = '单击地图可设置或追加起火点'
  } else {
    selectedCell.value = null
    clickHint.value = '未选择交互工具，单击上方按钮启用'
  }
}

function onBeidouChange(): void {
  if (!renderer) return
  if (!layers.beidouGrid) {
    layers.beidouGrid = true
    renderer.setLayers({ ...layers })
  }
  renderer.setBeidou({ ...beidou, enabled: layers.beidouGrid })
  if (selectedCell.value) refreshSelectedCell(selectedCell.value.cell.centerLon, selectedCell.value.cell.centerLat)
}

function refreshSelectedCell(lon: number, lat: number): void {
  if (!sim) return
  const stat = computeCellStats(sim, lon, lat, beidou.level)
  selectedCell.value = stat
  beidou.selectedKey = stat.cell.key
  renderer?.setBeidou({ ...beidou, enabled: layers.beidouGrid })
}

function applyFirebreaks(): void {
  if (!sim) return
  sim.setFirebreaks(firebreakList.value)
  renderer?.setFirebreaks(sim.firebreakList)
  refreshAfterSolve()
}

function finishFirebreakDraw(): void {
  if (drawingPath.value.length < 2) {
    cancelFirebreakDraw()
    clickHint.value = '隔离带至少需要两个节点'
    return
  }
  const firebreak: Firebreak = {
    id: `fb-${Date.now().toString(36)}`,
    widthM: firebreakWidth.value,
    path: drawingPath.value.map((point) => ({ ...point }))
  }
  firebreakList.value = [...firebreakList.value, firebreak]
  cancelFirebreakDraw()
  applyFirebreaks()
  clickHint.value = `已开设隔离带（宽度 ${firebreakWidth.value} m），到达时间场已重解`
}

function undoFirebreakVertex(): void {
  if (!drawingPath.value.length) return
  drawingPath.value = drawingPath.value.slice(0, -1)
  updateFirebreakPreview()
}

function cancelFirebreakDraw(): void {
  drawingPath.value = []
  hoverPoint.value = null
  renderer?.setFirebreakPreview([])
}

function clearFirebreaks(): void {
  firebreakList.value = []
  cancelFirebreakDraw()
  applyFirebreaks()
  clickHint.value = '已清除全部隔离带'
}

/** 宽度调整：同时更新已开设隔离带并重解到达时间场，使新宽度立即生效。 */
function onFirebreakWidthChange(): void {
  if (drawingActive.value) updateFirebreakPreview()
  if (!sim || firebreakList.value.length === 0) return
  firebreakList.value = firebreakList.value.map((item) => ({ ...item, widthM: firebreakWidth.value }))
  applyFirebreaks()
  clickHint.value = `隔离带宽度已调整为 ${firebreakWidth.value} m，到达时间场已重解`
}

function recommendFirebreakAction(): void {
  if (!sim) return
  const result = recommendFirebreak(sim, firebreakWidth.value, 300)
  if (!result) {
    clickHint.value = '需要先设置起火点才能推荐隔离带'
    return
  }
  firebreakList.value = [...firebreakList.value, result.firebreak]
  applyFirebreaks()
  clickHint.value = `已在火头前方（${describeAspect(result.headAzimuth)}方向 ${Math.round(result.advanceM)} m）推荐并开设隔离带`
}

function updateFirebreakPreview(): void {
  if (!renderer) return
  const points = drawingPath.value.slice()
  if (hoverPoint.value) points.push(hoverPoint.value)
  renderer.setFirebreakPreview(tool.value === 'firebreak' ? points : [])
}

function onTimeInput(): void {
  if (!sim) return
  playing.value = false
  sim.setTime(displayTime.value)
  renderer?.update()
}

function onDurationChange(): void {
  if (displayTime.value > params.maxMinutes) displayTime.value = params.maxMinutes
  if (sim) sim.setTime(displayTime.value)
  renderer?.update()
  scheduleSolve()
}

async function buildScene(): Promise<void> {
  if (!container.value) return
  const bounds = boundsFor()
  viewer = createWildfireViewer(container.value, bounds)
  addWildfireImagery(viewer, { onStatus: (message) => (statusMessage.value = message) })
  terrain = await loadWildfireTerrain(viewer)
  hasWorldTerrain.value = Boolean(terrain)
  if (disposed || !viewer) return

  const cols = GRID_COLS
  const rows = rowsFor(bounds, cols)
  const syntheticRiver = buildRiverPath(bounds, TERRAIN_SEED)
  let built: TerrainGrid
  let sampled = false
  if (terrain) {
    statusMessage.value = '正在采样世界地形高度… 0%'
    try {
      // 河道改为从真实高程中追踪谷底，故采样地形不再预先下切合成河道。
      built = await buildSampledTerrain(terrain, bounds, cols, rows, SPAN_METERS, [], TERRAIN_SEED, (ratio) => {
        statusMessage.value = `正在采样世界地形高度… ${Math.round(ratio * 100)}%`
      })
      sampled = true
    } catch {
      built = buildProceduralTerrain(bounds, cols, rows, SPAN_METERS, syntheticRiver, TERRAIN_SEED)
    }
  } else {
    built = buildProceduralTerrain(bounds, cols, rows, SPAN_METERS, syntheticRiver, TERRAIN_SEED)
  }
  if (disposed || !viewer) return

  // 世界地形下沿真实地形谷底追踪河道，使水面贴合实际河床；程序地形则沿用已下切的合成河道。
  const river = sampled ? traceValleyPath(built, syntheticRiver) : syntheticRiver
  const fuel = buildFuelGrid(built, bounds, TERRAIN_SEED, river)
  sim = new WildfireSimulation(built, fuel, { ...params })
  const seeded = sim.setIgnition(DEMO_CENTER.lon, DEMO_CENTER.lat)
  if (!seeded) clickHint.value = '默认位置为不可燃地表，请单击地图选择起火点'
  displayTime.value = sim.time

  renderer = new WildfireRenderer(viewer, sim)
  renderer.setStyle({ ...style })
  renderer.setLayers({ ...layers })
  renderer.setBeidou({ ...beidou, enabled: layers.beidouGrid })
  renderer.setMode(mode.value)
  renderer.setWindParams({ ...windFx, speed: params.windSpeed, dir: params.windDir })

  setWildfireCamera(viewer, bounds, sampleElevation(built, DEMO_CENTER.lon, DEMO_CENTER.lat))
  const ignition = sim.ignitionLonLat()
  ignitionLabel.value = ignition ? `${ignition.lon.toFixed(4)}, ${ignition.lat.toFixed(4)}` : ''
  terrainNote.value = describeTerrain(built, sampled)
  statusMessage.value = ''
  metrics.value = sim.metrics
  simToken.value += 1
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
  if (autoLod.value && layers.beidouGrid && viewer && !viewer.isDestroyed()) {
    try {
      const height = viewer.camera.positionCartographic.height
      const auto = levelForCellMeters(Math.max(height / 6, 40), DEMO_CENTER.lat)
      const level = Math.min(BEIDOU_LEVEL_MAX, auto + 1)
      if (level !== beidou.level) {
        beidou.level = level
        onBeidouChange()
      }
    } catch {
      // 相机状态切换瞬间可能无有效投影，忽略本帧
    }
  }
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

/** 当前栅格专题成果实际着色覆盖的范围（随专题模式取对应场值）。 */
function gridFootprintBounds(): AreaBounds | undefined {
  if (!sim) return undefined
  const active = sim
  const g = active.terrain
  const currentMode = mode.value
  const painted = (index: number): boolean => {
    if (currentMode === 'theme') return active.phaseAt(index) !== 0
    if (currentMode === 'intensity') return active.rosAt(index) > 0
    return Number.isFinite(active.arrivalAt(index))
  }
  const cells = g.cols * g.rows
  let minCol = g.cols
  let maxCol = -1
  let minRow = g.rows
  let maxRow = -1
  for (let i = 0; i < cells; i += 1) {
    if (!painted(i)) continue
    const row = Math.floor(i / g.cols)
    const col = i - row * g.cols
    if (col < minCol) minCol = col
    if (col > maxCol) maxCol = col
    if (row < minRow) minRow = row
    if (row > maxRow) maxRow = row
  }
  if (maxCol < minCol || maxRow < minRow) return undefined
  return {
    west: g.west + minCol * g.dLon,
    east: g.west + (maxCol + 1) * g.dLon,
    north: g.north - minRow * g.dLat,
    south: g.north - (maxRow + 1) * g.dLat
  }
}

/** 全部起火点（初始设置 + 人工追加）所覆盖的范围。 */
function seedFootprintBounds(): AreaBounds | undefined {
  const seeds = sim?.seedLonLats() ?? []
  if (!seeds.length) return undefined
  let west = Infinity
  let east = -Infinity
  let south = Infinity
  let north = -Infinity
  for (const seed of seeds) {
    if (seed.lon < west) west = seed.lon
    if (seed.lon > east) east = seed.lon
    if (seed.lat < south) south = seed.lat
    if (seed.lat > north) north = seed.lat
  }
  const cellDeg = (sim?.terrain.cellMeters ?? 60) / 111320
  const padLon = Math.max((east - west) * 0.1, cellDeg * 2)
  const padLat = Math.max((north - south) * 0.1, cellDeg * 2)
  return { west: west - padLon, east: east + padLon, south: south - padLat, north: north + padLat }
}

function locate(): void {
  if (!viewer) return
  const bounds =
    (layers.field ? gridFootprintBounds() : undefined) ?? seedFootprintBounds() ?? boundsFor()
  const altitude = sim
    ? sampleElevation(sim.terrain, (bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2)
    : 0
  setWildfireCamera(viewer, bounds, altitude)
}

async function applyTerrainResample(): Promise<void> {
  if (!sim || !terrain || !viewer || resampling.value) return
  resampling.value = true
  const options = {
    mode: resampleMode.value,
    value: resampleMode.value === 'count' ? resampleCount.value : resampleDistance.value
  }
  const river = sim.fuel.riverPath
  statusMessage.value = '正在按自定义参数重采样地形… 0%'
  try {
    const result = await resampleTerrainGrid(terrain, sim.terrain, options, river, TERRAIN_SEED, (ratio) => {
      statusMessage.value = `正在按自定义参数重采样地形… ${Math.round(ratio * 100)}%`
    })
    sim.setFuelGrid(buildFuelGrid(sim.terrain, boundsFor(), TERRAIN_SEED, river))
    displayTime.value = sim.time
    metrics.value = sim.metrics
    renderer?.markFieldDirty()
    renderer?.markVectorsDirty()
    renderer?.update()
    terrainNote.value = `${describeTerrain(sim.terrain, true)} · 重采样 ${result.sampleCols}×${result.sampleRows} 点`
    flashStatus(`地形已重采样：${result.sampleCols}×${result.sampleRows} 采样点 · 间距约 ${Math.round(result.spacingMeters)} m`)
    simToken.value += 1
  } catch {
    flashStatus('地形重采样失败（世界地形覆盖率不足），已保留原地形')
  } finally {
    resampling.value = false
  }
}

function downloadAlgorithm(): void {
  const lines: string[] = []
  lines.push(`# ${ALGORITHM_TITLE}`, '')
  lines.push(ALGORITHM_INTRO, '')
  lines.push('## 处理流程', '')
  PIPELINE_STAGES.forEach((stage, index) => lines.push(`${index + 1}. **${stage.title}** — ${stage.detail}`))
  lines.push('')
  for (const section of ALGORITHM_SECTIONS) {
    lines.push(`## ${section.title}`, '')
    lines.push(section.summary, '')
    if (section.steps && section.steps.length) {
      section.steps.forEach((step, index) => lines.push(`${index + 1}. **${step.title}**：${step.detail}`))
      lines.push('')
    }
    if (section.formulas && section.formulas.length) {
      lines.push('```')
      for (const formula of section.formulas) lines.push(formula)
      lines.push('```', '')
    }
    if (section.bullets && section.bullets.length) {
      for (const bullet of section.bullets) lines.push(`- ${bullet}`)
      lines.push('')
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `林火蔓延渲染分析-算法说明-${nowStamp()}.md`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  statusMessage.value = '算法说明已下载为 Markdown 文件'
}

// ---------------------------------------------------------------------------
// 结果报告：在线预览 + 导出 PDF / Word
// ---------------------------------------------------------------------------

const runCompleted = computed(() => displayTime.value >= params.maxMinutes - 0.01)
const reportReady = computed(() => (metrics.value?.burnedCells ?? 0) > 0)

function severityFor(areaHa: number): { level: string; response: string } {
  if (areaHa >= 100) return { level: '特别重大', response: 'Ⅰ级' }
  if (areaHa >= 10) return { level: '重大', response: 'Ⅱ级' }
  if (areaHa >= 1) return { level: '较大', response: 'Ⅲ级' }
  return { level: '一般', response: 'Ⅳ级' }
}

function collectReport(figures: { overview?: string; arrival?: string; fuel?: string } = {}): ReportModel {
  const current = sim
  const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false })
  const sections: ReportSection[] = []
  const m = current?.metrics ?? metrics.value
  const bounds = boundsFor()

  const burnedAreaM2 = m?.burnedAreaM2 ?? 0
  const areaHa = burnedAreaM2 / 10000
  const areaMu = burnedAreaM2 / 666.67
  const perimeterM = m?.perimeterM ?? 0
  const meanRos = m?.meanRos ?? 0
  const headSpeed = m?.maxRos ?? 0
  const headAz = m?.headAzimuth ?? params.windDir
  const headDir = describeAspect(headAz)
  const headDirName = headDir.split(' ')[0] || '主蔓延'
  const headDistance = m?.headDistanceM ?? 0
  const severity = severityFor(areaHa)
  const fuelName = m?.burningFuel || '针阔混交林'
  const ignition = current?.ignitionLonLat()
  const ignitionCoord = ignition
    ? `东经 ${ignition.lon.toFixed(4)}°，北纬 ${ignition.lat.toFixed(4)}°`
    : ignitionLabel.value || '—'

  let minElev = Infinity
  let maxElev = -Infinity
  if (current) {
    for (let i = 0; i < current.terrain.elevation.length; i += 1) {
      const value = current.terrain.elevation[i]
      if (value < minElev) minElev = value
      if (value > maxElev) maxElev = value
    }
  }
  const elevRange = Number.isFinite(minElev) ? `${Math.round(minElev)}~${Math.round(maxElev)}` : '—'

  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const fireTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日${pad(now.getHours())}时${pad(now.getMinutes())}分`
  const reportNo = `LF-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  const fmtT = (t: number): string => (t >= 60 ? `T+${(t / 60).toFixed(1)} h` : `T+${t.toFixed(0)} min`)
  const fmtHa = (ha: number): string => ha.toFixed(2)

  const timeline: Array<{ t: number; areaHa: number; newHa: number; perimeterM: number; headSpeed: number }> = []
  if (current) {
    const total = current.params.maxMinutes
    const saved = current.time
    const fractions = [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1]
    let prevHa = 0
    for (const fraction of fractions) {
      const t = total * fraction
      current.setTime(t)
      const snapshot = current.metrics
      const ha = snapshot.burnedAreaM2 / 10000
      timeline.push({
        t,
        areaHa: ha,
        newHa: Math.max(ha - prevHa, 0),
        perimeterM: snapshot.perimeterM,
        headSpeed: snapshot.maxRos
      })
      prevHa = ha
    }
    current.setTime(saved)
    renderer?.markFieldDirty()
  }
  const predictedHa = timeline.length ? timeline[timeline.length - 1].areaHa : areaHa
  const predictedNewHa = Math.max(predictedHa - areaHa, 0)
  const remainingHours = Math.max((params.maxMinutes - displayTime.value) / 60, 0)
  const etaMinutes = (distance: number): number => displayTime.value + distance / Math.max(meanRos, 0.4)

  const threatDefs: Array<{ name: string; type: string; distance: number; risk: string; advice: string }> = [
    { name: `${headDirName}向居民点`, type: '居民区', distance: Math.max(headDistance * 1.2, 500), risk: '高', advice: '重点防护、提前组织撤离' },
    { name: '火场侧翼林场', type: '林区', distance: Math.max(headDistance * 0.9, 400), risk: '中', advice: '开设隔离带、清理可燃物' },
    { name: '火场外围公路', type: '道路', distance: Math.max(headDistance * 1.5, 800), risk: '中', advice: '通行管控、保障扑救通道' },
    { name: '电力/通信设施', type: '重要设施', distance: Math.max(headDistance * 1.8, 1000), risk: '低', advice: '监测预警、现场值守' }
  ]
  const threatRows = threatDefs.map((item) => [
    item.name,
    item.type,
    String(Math.round(item.distance)),
    fmtT(etaMinutes(item.distance)),
    item.risk,
    item.advice
  ])
  const bufferRows = [500, 1000, 2000].map((distance) => {
    const inside = threatDefs.filter((item) => item.distance <= distance)
    return [String(distance), inside.length ? inside.map((item) => item.name).join('、') : '无', inside.length ? '高' : '低']
  })

  let waterCells = 0
  let roadCells = 0
  if (current) {
    for (let i = 0; i < current.fuel.kind.length; i += 1) {
      const kind = current.fuel.kind[i]
      if (kind === FuelKind.Water) waterCells += 1
      else if (kind === FuelKind.Road) roadCells += 1
    }
  }
  const cellAreaHa = current ? (current.terrain.cellMeters * current.terrain.cellMeters) / 10000 : 1
  const waterHa = waterCells * cellAreaHa
  const roadHa = roadCells * cellAreaHa

  const overviewFigures: ReportImage[] = []
  if (figures.overview) {
    overviewFigures.push({ src: figures.overview, caption: '图1  火场现状三维态势图', note: '系统自动生成：三维地形叠加火线、烧毁区与专题渲染。' })
  }
  const arrivalFigures: ReportImage[] = []
  if (figures.arrival) {
    arrivalFigures.push({ src: figures.arrival, caption: '图2  到达时间场与蔓延等时线', note: '颜色由浅至深表示火线到达时间由早到晚。' })
  }
  const fuelFigures: ReportImage[] = []
  if (figures.fuel) {
    fuelFigures.push({ src: figures.fuel, caption: '图3  可燃物类型与地形叠加', note: '可燃物按程序化分类图栅格化，供蔓延速率计算使用。' })
  }

  const cover = {
    classification: '密级：【内部·模拟推演成果】',
    title: '木里高山林区林火蔓延分析报告',
    subtitle: '（模拟推演成果 · 决策参考）',
    meta: [
      { label: '报告编号', value: reportNo },
      { label: '火情名称', value: '木里高山峡谷林区森林火情（模拟）' },
      { label: '起火时间', value: fireTime },
      {
        label: '起火地点',
        value: `东经 ${bounds.west.toFixed(2)}°~${bounds.east.toFixed(2)}°，北纬 ${bounds.south.toFixed(2)}°~${bounds.north.toFixed(2)}°`
      },
      { label: '编制单位', value: '林火蔓延渲染分析系统' },
      { label: '编制日期', value: `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日` },
      { label: '版 本 号', value: 'V1.0' }
    ]
  }

  sections.push({
    title: '报告摘要',
    lines: [
      '本报告由林火蔓延分析系统基于 Rothermel 速率模型与元胞自动机推演，对木里高山峡谷林区火情进行模拟推演形成。报告内容包括火情基本信息、当前火情态势、蔓延模拟预测、风险与影响分析、地形与可燃物影响分析以及扑救辅助决策建议，供森林防火指挥决策参考。'
    ]
  })

  sections.push({
    title: '一、火情概况',
    lines: [
      `起火时间：${fireTime}；起火地点：${ignitionCoord}。推演区域位于木里高山峡谷林区（模拟），范围约 ${bounds.west.toFixed(3)}~${bounds.east.toFixed(3)}°E，${bounds.south.toFixed(3)}~${bounds.north.toFixed(3)}°N，区域尺寸约 ${(SPAN_METERS / 1000).toFixed(1)} km × ${(SPAN_METERS / 1000).toFixed(1)} km。截至报告生成时刻，系统推演过火面积约 ${fmtHa(areaHa)} 公顷，火线长度约 ${Math.round(perimeterM)} 米，火势等级初步判定为${severity.level}。`
    ]
  })

  sections.push({
    title: '二、核心结论',
    lines: [
      `1. 未来 ${remainingHours.toFixed(1)} 小时，火场预计沿${headDir}方向持续蔓延，预测新增过火面积 ${fmtHa(predictedNewHa)} 公顷，累计过火面积约 ${fmtHa(predictedHa)} 公顷。`,
      `2. 主要威胁对象为火头前方居民点、火场侧翼林场及外围公路等，预计最早于 ${fmtT(etaMinutes(threatDefs[0].distance))} 受到火线逼近影响，建议启动 ${severity.response} 响应。`,
      `3. 建议扑救力量沿${headDir}方向重点部署，优先于火头前方开设防火隔离带，疏散警戒范围控制在火场周边 ${Math.round(Math.max(headDistance * 0.6, 300))} 米以上。`
    ],
    table: {
      caption: '表1  关键指标一览表',
      head: ['指标', '数值', '指标', '数值'],
      body: [
        ['当前过火面积（公顷）', fmtHa(areaHa), '预测累计过火面积（公顷）', fmtHa(predictedHa)],
        ['火线长度（米）', `${Math.round(perimeterM)}`, '火头蔓延速度（米/分钟）', headSpeed.toFixed(2)],
        ['火场类型', '地表火为主', '火势等级', severity.level],
        ['最近威胁到达时间', fmtT(etaMinutes(threatDefs[0].distance)), '建议响应等级', severity.response]
      ]
    }
  })

  sections.push({
    title: '1  火情基本情况',
    lines: ['本章记录起火要素、气象条件、地形概况与可燃物概况等基础信息，作为后续蔓延推演与影响分析的输入依据。']
  })

  sections.push({
    title: '1.1  起火要素',
    lines: [`起火时间：${fireTime}；起火经纬度：${ignitionCoord}；行政位置：木里高山峡谷林区（模拟区域）；发现方式：系统模拟设置；发现及上报时间：${fireTime}。`],
    table: {
      caption: '表2  起火要素登记表',
      head: ['项目', '内容', '项目', '内容'],
      body: [
        ['起火时间', fireTime, '起火经纬度', ignitionCoord],
        ['行政位置', '木里高山峡谷林区（模拟）', '发现方式', '系统模拟设置'],
        ['发现时间', fireTime, '上报时间', fireTime]
      ]
    }
  })

  sections.push({
    title: '1.2  气象条件',
    table: {
      caption: '表3  气象条件及对蔓延的影响',
      head: ['气象要素', '当前值', '未来24小时预报', '对蔓延影响'],
      body: [
        [
          '风速（米/秒）',
          params.windSpeed.toFixed(1),
          `${(params.windSpeed * 0.9).toFixed(1)}~${(params.windSpeed * 1.1).toFixed(1)}`,
          '顺风方向蔓延加速'
        ],
        ['风向', describeAspect(params.windDir), describeAspect(params.windDir), '决定火头主蔓延方向'],
        ['细死可燃物含水率（%）', (params.moisture * 100).toFixed(1), '—', '含水率越低越利于燃烧蔓延'],
        ['等效相对湿度（%）', (params.moisture * 100).toFixed(0), '—', '湿度低利于燃烧蔓延'],
        ['气温（℃）', '—（模型未引入）', '—', '高温加剧可燃物干燥'],
        ['降水', '无', '无', '降水可抑制蔓延']
      ]
    }
  })

  sections.push({
    title: '1.3  地形概况',
    lines: [
      `火场区域海拔范围约 ${elevRange} 米，过火区平均高程约 ${(m?.meanElevation ?? 0).toFixed(0)} 米，火线平均坡度约 ${(m?.meanSlope ?? 0).toFixed(1)}°，过火区平均坡向为 ${m ? describeAspect(m.meanAspect) : '—'}，地貌以高山峡谷（中低山—河谷）为主。坡度与坡向对蔓延速度和方向影响显著，量化分析见第 5 章。`
    ]
  })

  sections.push({
    title: '1.4  可燃物概况',
    lines: [
      `火场区域植被类型以${fuelName}为主，可燃物按程序化分类图栅格化，网格分辨率约 ${current ? current.terrain.cellMeters.toFixed(0) : '—'} 米，细死可燃物含水率 ${(params.moisture * 100).toFixed(1)}%。可燃物类型与分布对蔓延起加速或抑制作用，详见 5.2 节。`
    ]
  })

  sections.push({
    title: '2  当前火情态势',
    lines: ['本章描述截至报告生成时刻的火场过火现状与蔓延方向判断。']
  })

  sections.push({
    title: '2.1  过火现状',
    lines: [
      `截至报告生成时刻，系统推演过火面积约 ${fmtHa(areaHa)} 公顷（约合 ${Math.round(areaMu)} 亩），烧毁格数 ${m?.burnedCells ?? 0} 格，在燃格数 ${m?.frontCells ?? 0} 格，火线长度约 ${Math.round(perimeterM)} 米，火场类型判定为地表火为主。`
    ],
    images: overviewFigures
  })

  sections.push({
    title: '2.2  蔓延方向判断',
    lines: [
      `综合风向、坡度与可燃物分布，当前火头位于${headDir}方向，主导蔓延方向为${headDir}，火头推进距离约 ${formatLength(headDistance)}，火头蔓延速度约 ${headSpeed.toFixed(2)} 米/分钟，平均蔓延速率约 ${meanRos.toFixed(2)} 米/分钟，火线长宽比约 ${(m?.spreadLb ?? 1).toFixed(2)}。`
    ]
  })

  sections.push({
    title: '3  蔓延模拟预测',
    lines: ['本章给出模拟参数设置、蔓延过程推演、预测范围与等时线以及关键节点预测。']
  })

  sections.push({
    title: '3.1  模拟参数设置',
    table: {
      caption: '表4  蔓延模拟参数设置表',
      head: ['参数项', '设置值', '参数项', '设置值'],
      body: [
        ['蔓延模型', 'Rothermel + 元胞自动机（到达时间场）', '网格分辨率', `${current ? current.terrain.cellMeters.toFixed(0) : '—'} 米`],
        ['模拟时长', `${params.maxMinutes.toFixed(0)} 分钟`, '求解方式', '事件驱动到达时间场'],
        ['起火点经纬度', ignitionCoord, '起火点数量', `${current ? current.seedLonLats().length : 1} 个`],
        ['风速', `${params.windSpeed.toFixed(1)} 米/秒`, '风向', describeAspect(params.windDir)],
        ['可燃物数据', '程序化分类图（自包含）', '地形数据', terrainNote.value || '程序/世界地形采样'],
        ['模拟版本号', 'V1.0', '人工修正记录', '无']
      ]
    }
  })

  sections.push({
    title: '3.2  蔓延过程推演',
    table: {
      caption: '表5  蔓延过程推演关键节点',
      head: ['模拟时刻', '过火面积（公顷）', '火线长度（米）', '火头速度（米/分钟）', '主要蔓延方向'],
      body: timeline.map((row) => [fmtT(row.t), fmtHa(row.areaHa), `${Math.round(row.perimeterM)}`, row.headSpeed.toFixed(2), headDir])
    }
  })

  sections.push({
    title: '3.3  预测范围与等时线',
    lines: [
      `火场将在未来 ${remainingHours.toFixed(1)} 小时内沿${headDir}方向扩展。到达时间场采用亚格点等时线提取与 jsts 布尔融合生成无锯齿火线边界，等时线按约 ${Math.max(params.maxMinutes / 8, 1).toFixed(0)} 分钟间隔显示。`
    ],
    images: arrivalFigures
  })

  sections.push({
    title: '3.4  关键节点预测',
    table: {
      caption: '表6  关键节点火线到达时间预测',
      head: ['关键位置', '类型', '距火场距离（米）', '预测火线到达时间', '风险等级'],
      body: threatDefs.map((item) => [
        item.name,
        item.type,
        String(Math.round(item.distance)),
        fmtT(etaMinutes(item.distance)),
        item.risk
      ])
    }
  })

  sections.push({
    title: '4  风险与影响分析',
    lines: ['本章识别受威胁对象并给出缓冲区风险分级、道路可达性及疏散警戒建议。']
  })

  sections.push({
    title: '4.1  威胁对象识别',
    table: {
      caption: '表7  受威胁对象识别与处置建议',
      head: ['受威胁对象', '类型', '距火场距离（米）', '预计到达时间', '风险等级', '处置建议'],
      body: threatRows
    }
  })

  sections.push({
    title: '4.2  缓冲区与风险分级',
    table: {
      caption: '表8  缓冲区风险分级统计表',
      head: ['缓冲区半径（米）', '区间内受威胁对象', '风险等级'],
      body: bufferRows
    }
  })

  sections.push({
    title: '4.3  道路可达性与匹配',
    lines: [
      `系统对扑救通道进行了道路匹配分析，道路邻接（匹配）比例约 ${(m?.roadMatchPct ?? 0).toFixed(1)}%，火场外围可通行道路已纳入路网渲染。建议对火线逼近路段加强通行管控，预留应急疏散与扑救车辆通道，避免占用消防通道。`
    ]
  })

  sections.push({
    title: '4.4  疏散与警戒范围建议',
    lines: [
      `建议以火场边界为中心，设置不少于 ${Math.round(Math.max(headDistance * 0.6, 300))} 米的疏散警戒范围；在${headDir}方向（主蔓延方向）适当加大警戒距离；对居民点、重要设施等敏感目标提前发布预警并组织人员撤离，明确撤离路线与安置点。`
    ]
  })

  sections.push({
    title: '5  地形与可燃物影响分析',
    lines: ['本章从地形、可燃物及自然阻隔三方面分析对火行为的影响。']
  })

  sections.push({
    title: '5.1  地形影响统计',
    table: {
      caption: '表9  地形对火行为影响统计表',
      head: ['分析项', '火场区域统计值', '对蔓延的影响说明'],
      body: [
        ['海拔范围（米）', elevRange, '高海拔区风速较大，蔓延加快'],
        ['过火区平均高程（米）', (m?.meanElevation ?? 0).toFixed(0), '火头推进区域海拔变化'],
        ['火线平均坡度（°）', (m?.meanSlope ?? 0).toFixed(1), '上坡方向蔓延加速'],
        ['过火区平均坡向', m ? describeAspect(m.meanAspect) : '—', '阳坡可燃物干燥、易燃'],
        ['陡坡侵蚀长度（米）', Math.round(m?.erosionLengthM ?? 0), '坡度越陡蔓延越快'],
        ['陡坡过火占比（%）', (m?.erosionAreaPct ?? 0).toFixed(1), '陡坡加速火线扩展']
      ]
    }
  })

  sections.push({
    title: '5.2  可燃物分布影响',
    lines: [
      `火场主要燃烧可燃物为${fuelName}。草地、灌丛、针阔混交林蔓延速率依次递减（基准速率约 8.4、5.2、3.3 米/分钟），可燃物类型与连续性直接影响火线扩展速度与强度。`
    ],
    images: fuelFigures
  })

  sections.push({
    title: '5.3  自然阻隔分析',
    lines: [
      `推演区域内水域面积约 ${waterHa.toFixed(2)} 公顷，道路面积约 ${roadHa.toFixed(2)} 公顷，可作为天然阻火与扑救依托。建议结合河流、裸岩及现有道路，优先构筑连续阻隔体系，削弱火线扩展能力。`
    ]
  })

  sections.push({
    title: '6  扑救辅助决策建议',
    lines: ['本章给出力量部署、隔离带开设、扑救路线与水源及安全注意事项。']
  })

  sections.push({
    title: '6.1  力量部署建议',
    table: {
      caption: '表10  扑救力量部署建议表',
      head: ['队伍/装备', '建议数量', '部署位置', '主要任务', '到位时限'],
      body: [
        ['森林消防专业队', '2 支（约 60 人）', `${headDir}火头前方`, '正面阻击、开设隔离带', fmtT(displayTime.value + 30)],
        ['半专业扑火队', '3 支（约 90 人）', '火场两翼', '侧翼拦截、清理余火', fmtT(displayTime.value + 60)],
        ['水泵及水带组', '4 组', '临近水源/河道', '以水灭火、压制火头', fmtT(displayTime.value + 45)],
        ['无人机侦察', '2 架', '火场上空', '态势侦察、热源监测', fmtT(displayTime.value + 20)],
        ['工程机械', '2 台', '火头前方道路', '开设隔离带、清理通道', fmtT(displayTime.value + 90)]
      ]
    }
  })

  sections.push({
    title: '6.2  隔离带开设建议',
    lines: [
      firebreakList.value.length
        ? `已开设防火隔离带 ${firebreakSummary.value.count} 条，总长约 ${formatLength(firebreakSummary.value.totalM)}，设计宽度约 ${firebreakWidth.value} 米。建议继续沿${headDir}方向火头前方及侧翼延伸，优先避开陡坡与飞火通道。`
        : `当前尚未开设防火隔离带。建议沿${headDir}方向火头前方及侧翼开设，设计宽度约 ${firebreakWidth.value} 米，优先避开陡坡与飞火通道，并利用自然阻隔减少工程量。`
    ]
  })

  sections.push({
    title: '6.3  扑救路线与水源建议',
    lines: [
      `建议依托火场外围公路及可通行道路构建扑救通道，道路匹配比例约 ${(m?.roadMatchPct ?? 0).toFixed(1)}%；就近利用河流、水库等水体设置取水点，采用“以水灭火 + 隔离带阻隔”相结合的战术，控制火头推进。`
    ]
  })

  sections.push({
    title: '6.4  扑救注意事项',
    lines: [
      '1. 严禁在无可靠逃生通道的陡坡、沟谷及上坡方向直接扑打火头。',
      '2. 密切监测风向、风速变化，出现风向突变或飞火时立即撤离至安全区域。',
      '3. 扑救人员须明确撤离路线与集结点，保持通信畅通，做好个人防护。',
      '4. 夜间及高温时段谨慎作业，避免疲劳作战引发安全事故。'
    ]
  })

  sections.push({
    title: '7  结论与建议',
    lines: ['本章总结主要结论并提出后续工作建议。']
  })

  sections.push({
    title: '7.1  主要结论',
    lines: [
      `本次模拟推演表明，火场当前过火面积约 ${fmtHa(areaHa)} 公顷，火势等级为${severity.level}，主蔓延方向为${headDir}，预测累计过火面积约 ${fmtHa(predictedHa)} 公顷。地形、风场与可燃物分布共同驱动火线扩展，火头前方与侧翼为高风险区域。`
    ]
  })

  sections.push({
    title: '7.2  后续建议',
    lines: [
      '1. 持续更新气象与火场态势数据，滚动修正蔓延预测。',
      '2. 依据力量部署建议，尽快到位专业队伍与装备，优先控制火头。',
      '3. 结合自然阻隔与人工隔离带，构建连续阻火体系。',
      '4. 做好受威胁目标的预警、疏散与安置工作，确保人员安全。'
    ]
  })

  sections.push({
    title: '8  附录',
    lines: ['本章提供数据与模型说明、术语说明与免责声明。']
  })

  sections.push({
    title: '8.1  数据与模型说明',
    kv: [
      { label: '蔓延模型', value: 'Rothermel 校准速率 + 风向/坡度矢量合成 + 椭圆蔓延模板 + 元胞邻域引燃概率' },
      { label: '边界求解', value: '到达时间场 + Marching Squares 等时线插值 + jsts 布尔融合' },
      { label: '可燃物数据', value: '程序化分类图栅格化（水域/裸地/道路/草地/灌丛/针阔混交林）' },
      { label: '地形数据', value: terrainNote.value || '程序化/世界地形采样' },
      { label: '网格规模', value: current ? `${current.terrain.cols} × ${current.terrain.rows}（单格 ${current.terrain.cellMeters.toFixed(0)} 米）` : '—' },
      { label: '推演总时长', value: `${params.maxMinutes.toFixed(0)} 分钟` },
      { label: '当前时刻', value: `T+${displayTime.value.toFixed(0)} min${runCompleted.value ? '（推演完成）' : ''}` }
    ]
  })

  sections.push({
    title: '8.2  术语说明',
    lines: [
      '过火面积：火线包围的已燃烧区域面积。',
      '蔓延速率（ROS）：单位时间内火线向前推进的距离。',
      '到达时间场：区域内任一点被火线到达的时间分布。',
      '等时线：到达时间相同的点连成的曲线，用于表征不同时刻火线位置。',
      '火线长宽比（L/B）：火场延展方向长度与垂直方向宽度之比，反映风与坡度的影响。'
    ]
  })

  if (timeline.length) {
    sections.push({
      title: '8.3  蔓延推演时间轴明细',
      table: {
        caption: '按等间隔重放推演过程，记录过火面积、新增面积、火线长度与火头速度变化。',
        head: ['模拟时刻', '过火面积（公顷）', '本段新增（公顷）', '火线长度（米）', '火头速度（米/分钟）'],
        body: timeline.map((row) => [
          fmtT(row.t),
          fmtHa(row.areaHa),
          row.newHa.toFixed(2),
          `${Math.round(row.perimeterM)}`,
          row.headSpeed.toFixed(2)
        ])
      }
    })
  }

  sections.push({
    title: '8.4  免责声明',
    lines: [
      '本报告基于模型模拟与设定参数生成，为模拟推演成果，不代表真实火情。报告中的预测结果受气象、地形、可燃物及模型简化等因素影响，存在不确定性，仅供森林防火指挥决策参考，实际扑救请以现场勘察和会商研判为准。'
    ]
  })

  return {
    generatedAt,
    cover,
    intro:
      '本报告由「林火蔓延渲染分析」模拟系统生成，基于 Rothermel 简化蔓延模型与到达时间场求解，按火情概况、核心结论、火情基本情况、当前火情态势、蔓延模拟预测、风险与影响分析、地形与可燃物影响分析、扑救辅助决策建议、结论与建议及附录等章节组织，可用于林火蔓延态势分析与扑救决策参考。',
    sections
  }
}

async function captureReportFigures(): Promise<{ overview?: string; arrival?: string; fuel?: string }> {
  if (!viewer) return {}
  const waitFrame = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  const saved = mode.value
  const savedFuel = layers.fuel
  const figures: { overview?: string; arrival?: string; fuel?: string } = {}
  try {
    renderer?.setLayers({ fuel: false })
    renderer?.setMode('theme')
    renderer?.update()
    await waitFrame()
    figures.overview = captureWildfireCanvas(viewer)
    renderer?.setMode('arrival')
    renderer?.update()
    await waitFrame()
    figures.arrival = captureWildfireCanvas(viewer)
    renderer?.setLayers({ fuel: true })
    renderer?.setMode('theme')
    renderer?.update()
    await waitFrame()
    figures.fuel = captureWildfireCanvas(viewer)
  } finally {
    renderer?.setLayers({ fuel: savedFuel })
    renderer?.setMode(saved)
    await waitFrame()
  }
  return figures
}

async function openReportPreview(): Promise<void> {
  if (!reportReady.value) return
  playing.value = false
  const figures = await captureReportFigures()
  reportModel.value = collectReport(figures)
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

function pickLonLat(position: Cartesian2): LonLat | null {
  if (!viewer) return null
  const ray = viewer.camera.getPickRay(position)
  if (!ray) return null
  const picked = viewer.scene.globe.pick(ray, viewer.scene) ?? viewer.camera.pickEllipsoid(position, Ellipsoid.WGS84)
  if (!picked) return null
  const carto = Cartographic.fromCartesian(picked)
  if (!carto) return null
  return { lon: CesiumMath.toDegrees(carto.longitude), lat: CesiumMath.toDegrees(carto.latitude) }
}

function handleClick(position: Cartesian2): void {
  if (!sim) return
  const point = pickLonLat(position)
  if (!point) return
  const { lon, lat } = point

  if (tool.value === 'none') return

  if (tool.value === 'grid') {
    refreshSelectedCell(lon, lat)
    const stat = selectedCell.value
    renderer?.update()
    clickHint.value = stat
      ? `北斗网格 ${stat.cell.code}：过火占比 ${(stat.burnedRatio * 100).toFixed(1)}%，平均高程 ${stat.meanElevation.toFixed(0)} m`
      : `已选中 ${lon.toFixed(4)}, ${lat.toFixed(4)} 所在网格单元`
    return
  }

  if (tool.value === 'firebreak') {
    drawingPath.value = [...drawingPath.value, { lon, lat }]
    updateFirebreakPreview()
    clickHint.value = `隔离带节点 ${drawingPath.value.length} 个，右键或点击「完成隔离带」结束绘制`
    return
  }

  const ok = sim.addIgnition(lon, lat)
  clickHint.value = ok
    ? `已在 ${lon.toFixed(4)}, ${lat.toFixed(4)} 追加起火点，到达时间场已重新松弛`
    : '该位置为不可燃地表（水域/裸岩/道路），请换个位置点击'
  metrics.value = sim.metrics
  renderer?.markFieldDirty()
  renderer?.markVectorsDirty()
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
  inputHandler.setInputAction(() => {
    if (tool.value !== 'firebreak') return
    if (drawingPath.value.length >= 2) finishFirebreakDraw()
    else {
      cancelFirebreakDraw()
      clickHint.value = '隔离带至少需要两个节点'
    }
  }, ScreenSpaceEventType.RIGHT_CLICK)
  inputHandler.setInputAction((event: { endPosition: Cartesian2 }) => {
    if (tool.value !== 'firebreak') return
    const point = pickLonLat(event.endPosition)
    if (!point) return
    hoverPoint.value = point
    updateFirebreakPreview()
  }, ScreenSpaceEventType.MOUSE_MOVE)
  rafId = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  disposed = true
  if (solveTimer !== undefined) window.clearTimeout(solveTimer)
  if (statusTimer !== undefined) window.clearTimeout(statusTimer)
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
        <button class="wx-tool" :class="{ active: algoOpen }" @click="algoOpen = true">算法说明</button>
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
          <div class="group-label">火行为参数（Rothermel 简化模型）</div>
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
        </div>
        <div class="wx-aux-col">
          <div class="group-label">三维风场</div>
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
        <div class="wx-aux-col">
          <div class="group-label">地形重采样</div>
          <div class="param-row">
            <span class="param-label">采样方式</span>
            <select v-model="resampleMode" class="select-input">
              <option value="count">按数量</option>
              <option value="distance">按距离</option>
            </select>
          </div>
          <div v-if="resampleMode === 'count'" class="param-row">
            <span class="param-label">每边点数</span>
            <input v-model.number="resampleCount" class="param-slider" type="range" min="10" max="500" step="5" />
            <span class="param-value">{{ resampleCount }}</span>
          </div>
          <div v-else class="param-row">
            <span class="param-label">采样间距(m)</span>
            <input v-model.number="resampleDistance" class="param-slider" type="range" min="5" max="500" step="5" />
            <span class="param-value">{{ resampleDistance }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">预计采样</span>
            <span class="param-static">{{ resamplePreview }}</span>
          </div>
          <div class="wx-btn-row">
            <button class="wx-mini" :disabled="resampling || !hasWorldTerrain" @click="applyTerrainResample">
              {{ resampling ? '重采样中…' : '执行重采样' }}
            </button>
          </div>
          <div class="stats-line">{{ hasWorldTerrain ? '基于 Cesium 世界地形重采样' : '当前为程序地形，无可用世界地形' }}</div>
        </div>
      </div>
    </section>

    <div class="wx-main">
      <aside class="wx-sidebar">
        <div class="wx-sidebar-head">
          <span>参数与图层配置</span>
          <em>实时生效</em>
        </div>

        <div class="group-label collapsible" :class="{ open: !collapsed.tool }" @click="collapsed.tool = !collapsed.tool">
          <span>交互工具</span>
          <i></i>
        </div>
        <template v-if="!collapsed.tool">
          <div class="wx-tool-grid">
            <button class="wx-seg" :class="{ active: tool === 'ignite' }" @click="setTool('ignite')">起火点</button>
            <button class="wx-seg" :class="{ active: tool === 'grid' }" @click="setTool('grid')">网格查询</button>
            <button class="wx-seg" :class="{ active: tool === 'firebreak' }" @click="setTool('firebreak')">隔离带</button>
          </div>
          <div class="stats-line">{{ clickHint }}</div>
        </template>

        <div class="group-label collapsible" :class="{ open: !collapsed.beidou }" @click="collapsed.beidou = !collapsed.beidou">
          <span>北斗网格（GB/T 39409）</span>
          <i></i>
        </div>
        <template v-if="!collapsed.beidou">
          <div class="param-row"><span class="param-label">网格图层</span><input v-model="layers.beidouGrid" class="toggle-input" type="checkbox" @change="onLayerChange" /></div>
          <div class="param-row">
            <span class="param-label">剖分层级</span>
            <input
              v-model.number="beidou.level"
              class="param-slider"
              type="range"
              :min="BEIDOU_LEVEL_MIN"
              :max="BEIDOU_LEVEL_MAX"
              step="1"
              @input="onBeidouChange"
            />
            <span class="param-value">{{ beidou.level }} 级</span>
          </div>
          <div class="param-row"><span class="param-label">自动 LOD</span><input v-model="autoLod" class="toggle-input" type="checkbox" /></div>
          <div class="param-row">
            <span class="param-label">单元尺寸</span>
            <span class="param-static">{{ beidouCellSize }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">覆盖单元</span>
            <span class="param-static">{{ beidouCellCount }} 个</span>
          </div>
          <div class="param-row">
            <span class="param-label">着色字段</span>
            <select v-model="beidou.mode" class="select-input" @change="onBeidouChange">
              <option v-for="item in BEIDOU_MODES" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </div>
          <div class="param-row"><span class="param-label">网格线色</span><input v-model="beidou.lineColor" class="color-input" type="color" @input="onBeidouChange" /></div>
          <div class="param-row">
            <span class="param-label">网格线透明</span>
            <input v-model.number="beidou.lineAlpha" class="param-slider" type="range" min="0" max="1" step="0.02" @input="onBeidouChange" />
            <span class="param-value">{{ beidou.lineAlpha.toFixed(2) }}</span>
          </div>
          <div class="param-row">
            <span class="param-label">填充透明</span>
            <input v-model.number="beidou.fillAlpha" class="param-slider" type="range" min="0" max="1" step="0.02" @input="onBeidouChange" />
            <span class="param-value">{{ beidou.fillAlpha.toFixed(2) }}</span>
          </div>
        </template>

        <div class="group-label collapsible" :class="{ open: !collapsed.firebreak }" @click="collapsed.firebreak = !collapsed.firebreak">
          <span>防火隔离带</span>
          <i></i>
        </div>
        <template v-if="!collapsed.firebreak">
          <div class="param-row">
            <span class="param-label">宽度(m)</span>
            <input v-model.number="firebreakWidth" class="param-slider" type="range" min="10" max="200" step="5" @input="onFirebreakWidthChange" />
            <span class="param-value">{{ firebreakWidth }}</span>
          </div>
          <div class="wx-btn-row">
            <button class="wx-mini" :disabled="!drawingActive" @click="finishFirebreakDraw">完成隔离带</button>
            <button class="wx-mini" :disabled="!drawingActive" @click="undoFirebreakVertex">撤销节点</button>
            <button class="wx-mini" :disabled="!drawingActive" @click="cancelFirebreakDraw">取消绘制</button>
          </div>
          <div class="wx-btn-row">
            <button class="wx-mini" :disabled="!reportReady" @click="recommendFirebreakAction">智能推荐</button>
            <button class="wx-mini" :disabled="firebreakList.length === 0 && !drawingActive" @click="clearFirebreaks">清除全部</button>
          </div>
          <div class="stats-line">已开设 {{ firebreakSummary.count }} 条 · 总长 {{ formatLength(firebreakSummary.totalM) }}</div>
          <div v-if="drawingPath.length" class="stats-line">正在绘制：{{ drawingPath.length }} 个节点</div>
        </template>

        <div class="group-label collapsible" :class="{ open: !collapsed.style }" @click="collapsed.style = !collapsed.style">
          <span>专题配色</span>
          <i></i>
        </div>
        <template v-if="!collapsed.style">
          <div class="param-row"><span class="param-label">烧毁填充色</span><input v-model="style.innerColor" class="color-input" type="color" @input="onStyleChange" /></div>
          <div class="param-row"><span class="param-label">火线颜色</span><input v-model="style.borderColor" class="color-input" type="color" @input="onStyleChange" /></div>
          <div class="param-row"><span class="param-label">光晕颜色</span><input v-model="style.glowColor" class="color-input" type="color" @input="onStyleChange" /></div>
          <div class="param-row"><span class="param-label">烧毁边界色</span><input v-model="style.boundaryColor" class="color-input" type="color" @input="onStyleChange" /></div>
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
          <div class="param-row">
            <span class="param-label">边界虚线长</span>
            <input v-model.number="style.boundaryDash" class="param-slider" type="range" min="8" max="72" step="2" @input="onStyleChange" />
            <span class="param-value">{{ style.boundaryDash.toFixed(0) }}</span>
          </div>
        </template>

      </aside>

      <main class="wx-stage">
        <div ref="container" class="cesium-container"></div>
        <div class="wx-map-caption">木里高山峡谷林区 · 中心 {{ DEMO_CENTER.lon }}°E / {{ DEMO_CENTER.lat }}°N</div>
        <button class="wx-metrics-toggle" :class="{ active: metricsOpen }" @click="metricsOpen = !metricsOpen">
          <svg class="wx-metrics-icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="12" width="4" height="9" rx="1" />
            <rect x="10" y="6" width="4" height="15" rx="1" />
            <rect x="17" y="9" width="4" height="12" rx="1" />
          </svg>
          <span>火场指标</span>
        </button>
        <div v-if="metricsOpen" class="wx-metrics-panel">
          <div class="wx-metrics-head">
            <span>火场指标</span>
            <button class="wx-metrics-close" title="收起" @click="metricsOpen = false">×</button>
          </div>
          <div class="wx-metrics-body">
            <template v-if="metrics">
              <div class="metric-row"><span>过火面积</span><b>{{ formatArea(metrics.burnedAreaM2) }}</b></div>
              <div class="metric-row"><span>总过火格点</span><b>{{ metrics.burnedCells }}</b></div>
              <div class="metric-row"><span>当前火线格点</span><b>{{ metrics.frontCells }}</b></div>
              <div class="metric-row"><span>火线周长</span><b>{{ formatLength(metrics.perimeterM) }}</b></div>
              <div class="metric-row"><span>火头距离</span><b>{{ formatLength(metrics.headDistanceM) }}</b></div>
              <div class="metric-row"><span>平均蔓延速率</span><b>{{ metrics.meanRos.toFixed(2) }} m/min</b></div>
              <div class="metric-row"><span>最大蔓延速率</span><b>{{ metrics.maxRos.toFixed(2) }} m/min</b></div>
              <div class="metric-row"><span>火线长宽比 L/B</span><b>{{ metrics.spreadLb.toFixed(2) }}</b></div>
              <div class="metric-row"><span>主导蔓延方向</span><b>{{ metrics.headAzimuth.toFixed(0) }}°</b></div>
              <div class="metric-row"><span>火线平均海拔</span><b>{{ fmtRound(metrics.meanElevation) }} m</b></div>
              <div class="metric-row"><span>火线平均坡度</span><b>{{ metrics.meanSlope.toFixed(1) }}°</b></div>
              <div class="metric-row"><span>过火区坡向</span><b>{{ describeAspect(metrics.meanAspect) }}</b></div>
              <div class="metric-row"><span>道路邻接率</span><b>{{ metrics.roadMatchPct.toFixed(1) }}%</b></div>
              <div class="metric-row"><span>陡坡侵蚀岸线</span><b>{{ formatLength(metrics.erosionLengthM) }}</b></div>
              <div class="metric-row"><span>陡坡过火占比</span><b>{{ metrics.erosionAreaPct.toFixed(1) }}%</b></div>
              <div class="metric-row"><span>主要可燃物</span><b>{{ metrics.burningFuel }}</b></div>
            </template>
            <div v-else class="stats-line">等待起火点与推演结果…</div>
          </div>
        </div>
        <div class="wx-layer-dock" :class="{ collapsed: !layerDockOpen }">
          <button class="wx-layer-head" @click="layerDockOpen = !layerDockOpen">
            <span class="wx-layer-title">图层控制</span>
            <span class="wx-layer-count">{{ activeLayerCount }}/{{ LAYER_DOCK_ITEMS.length }}</span>
            <i class="wx-layer-caret"></i>
          </button>
          <div v-show="layerDockOpen" class="wx-layer-body">
            <div class="wx-layer-mode">
              <span class="wx-layer-mode-label">专题模式</span>
              <select v-model="mode" class="wx-layer-mode-select" @change="onModeChange">
                <option v-for="item in OVERLAY_MODES" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </div>
            <button
              v-for="item in LAYER_DOCK_ITEMS"
              :key="item.key"
              class="wx-layer-item"
              :class="{ on: layers[item.key] }"
              @click="toggleLayer(item.key)"
            >
              <span class="wx-layer-swatch" :style="{ background: item.color }"></span>
              <span class="wx-layer-label">{{ item.label }}</span>
              <span class="wx-layer-switch"><i></i></span>
            </button>
            <button class="wx-layer-all" @click="toggleAllLayers">
              {{ activeLayerCount < LAYER_DOCK_ITEMS.length ? '全部显示' : '全部隐藏' }}
            </button>
          </div>
        </div>
        <div v-if="statusMessage" class="wx-banner">{{ statusMessage }}</div>
      </main>

      <aside class="wx-inspector">
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

        <div class="wx-panel-head">北斗网格单元</div>
        <template v-if="selectedCell">
          <div class="wx-cell-stats">
            <div v-for="row in selectedCellRows" :key="row.label" class="metric-row"><span>{{ row.label }}</span><b>{{ row.value }}</b></div>
          </div>
        </template>
        <div v-else class="stats-line">启用北斗网格后，使用「网格查询」工具单击地图查看单元统计</div>

        <div class="wx-panel-head">防火隔离带</div>
        <div class="stats-line">
          共 {{ firebreakSummary.count }} 条 · 总长 {{ formatLength(firebreakSummary.totalM) }} · 宽度 {{ firebreakWidth }} m
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
      <label class="wx-speed">
        倍率
        <input v-model.number="speed" type="range" :min="SPEED_MIN" :max="SPEED_MAX" step="1" />
        <b>{{ speed }}×</b>
      </label>
      <label class="wx-speed">
        时间步
        <input v-model.number="params.cellMinutes" type="range" min="1" max="5" step="0.5" @input="scheduleSolve" />
        <b>{{ params.cellMinutes.toFixed(1) }} min</b>
      </label>
      <label class="wx-speed">
        总时长
        <input v-model.number="params.maxMinutes" type="range" min="60" max="720" step="30" @input="onDurationChange" />
        <b>{{ params.maxMinutes }} min</b>
      </label>
    </footer>

    <div v-if="algoOpen" class="algo-mask" @click.self="algoOpen = false">
      <div class="algo-dialog">
        <div class="algo-head">
          <div>
            <p class="algo-title">{{ ALGORITHM_TITLE }}</p>
            <p class="algo-sub">模型 · 求解 · 几何 · 渲染 · 网格 · 阻火</p>
          </div>
          <div class="algo-head-actions">
            <button class="algo-download" @click="downloadAlgorithm">下载说明</button>
            <button class="algo-close" title="关闭" @click="algoOpen = false">×</button>
          </div>
        </div>
        <div class="algo-body">
          <p class="algo-intro">{{ ALGORITHM_INTRO }}</p>

          <div class="algo-pipeline">
            <span v-for="(stage, index) in PIPELINE_STAGES" :key="stage.title" class="algo-stage">
              <b>{{ index + 1 }}</b>
              <em>{{ stage.title }}</em>
              <i>{{ stage.detail }}</i>
            </span>
          </div>

          <section v-for="section in ALGORITHM_SECTIONS" :key="section.title" class="algo-section">
            <h3>{{ section.title }}</h3>
            <p class="algo-summary">{{ section.summary }}</p>
            <ol v-if="section.steps && section.steps.length" class="algo-steps">
              <li v-for="step in section.steps" :key="step.title">
                <b>{{ step.title }}</b>
                <span>{{ step.detail }}</span>
              </li>
            </ol>
            <div v-if="section.formulas && section.formulas.length" class="algo-formulas">
              <code v-for="formula in section.formulas" :key="formula">{{ formula }}</code>
            </div>
            <ul v-if="section.bullets && section.bullets.length" class="algo-bullets">
              <li v-for="bullet in section.bullets" :key="bullet">{{ bullet }}</li>
            </ul>
          </section>
        </div>
      </div>
    </div>

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
            <div v-if="reportModel.cover" class="rx-report-cover">
              <p class="rx-report-classification">{{ reportModel.cover.classification }}</p>
              <h1 class="rx-report-cover-title">{{ reportModel.cover.title }}</h1>
              <p class="rx-report-cover-sub">{{ reportModel.cover.subtitle }}</p>
              <table class="rx-report-cover-meta">
                <tbody>
                  <tr v-for="item in reportModel.cover.meta || []" :key="item.label">
                    <th>{{ item.label }}</th>
                    <td>{{ item.value }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <h1 v-else class="rx-report-h1">{{ REPORT_TITLE }}</h1>
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
              <figure v-for="(figure, figureIndex) in section.images || []" :key="figureIndex" class="rx-report-figure">
                <img :src="figure.src" :alt="figure.caption" class="rx-report-image" />
                <figcaption class="rx-report-figcaption">
                  {{ figure.caption }}<span v-if="figure.note">。{{ figure.note }}</span>
                </figcaption>
              </figure>
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
.wx-aux-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px 18px; }
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
.wx-metrics-toggle {
  position: absolute;
  top: 42px;
  left: 12px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid rgba(120, 170, 220, 0.24);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(10, 22, 36, 0.9), rgba(8, 16, 28, 0.86));
  color: #cfe2f4;
  font-size: 11.5px;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: border-color 0.14s ease, color 0.14s ease;
}
.wx-metrics-toggle:hover { border-color: rgba(255, 158, 84, 0.4); color: #ffe0bd; }
.wx-metrics-toggle.active { border-color: rgba(255, 158, 84, 0.5); color: #ffd9a8; }
.wx-metrics-icon { width: 14px; height: 14px; fill: currentColor; }
.wx-metrics-panel {
  position: absolute;
  top: 76px;
  left: 12px;
  z-index: 6;
  width: 224px;
  max-height: calc(100% - 96px);
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(120, 170, 220, 0.24);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(10, 22, 36, 0.94), rgba(8, 16, 28, 0.9));
  box-shadow: 0 10px 26px rgba(2, 8, 16, 0.5);
  backdrop-filter: blur(6px);
  overflow: hidden;
}
.wx-metrics-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border-bottom: 1px solid rgba(157, 188, 224, 0.16);
  background: linear-gradient(180deg, rgba(38, 74, 116, 0.5), rgba(18, 38, 62, 0.2));
  color: #e6f0fb;
  font-size: 12px;
  font-weight: 600;
}
.wx-metrics-close { border: 0; background: transparent; color: #9fb3c8; font-size: 18px; line-height: 1; cursor: pointer; }
.wx-metrics-close:hover { color: #fff; }
.wx-metrics-body { display: flex; flex-direction: column; gap: 3px; padding: 7px 10px; overflow-y: auto; }
.wx-layer-dock {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 6;
  width: 172px;
  border: 1px solid rgba(120, 170, 220, 0.24);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(10, 22, 36, 0.9), rgba(8, 16, 28, 0.86));
  box-shadow: 0 10px 26px rgba(2, 8, 16, 0.5);
  backdrop-filter: blur(6px);
  overflow: hidden;
  transition: width 0.18s ease;
}
.wx-layer-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  background: linear-gradient(180deg, rgba(38, 74, 116, 0.5), rgba(18, 38, 62, 0.2));
  color: #e6f0fb;
  font-size: 12px;
  letter-spacing: 0.5px;
  cursor: pointer;
}
.wx-layer-title { flex: 1; text-align: left; font-weight: 600; white-space: nowrap; }
.wx-layer-count {
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(255, 122, 42, 0.18);
  color: #ffc48a;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.wx-layer-caret {
  width: 7px;
  height: 7px;
  border-right: 1.5px solid #9dbce0;
  border-bottom: 1.5px solid #9dbce0;
  transform: rotate(45deg);
  transition: transform 0.18s ease;
}
.wx-layer-dock.collapsed .wx-layer-caret { transform: rotate(-45deg); }
.wx-layer-dock.collapsed { width: 158px; }
.wx-layer-mode {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 5px 7px;
  margin-bottom: 3px;
  border-bottom: 1px dashed rgba(157, 188, 224, 0.18);
}
.wx-layer-mode-label { flex: 0 0 auto; font-size: 11px; color: #93a8bd; }
.wx-layer-mode-select {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 4px;
  border: 1px solid rgba(157, 188, 224, 0.26);
  border-radius: 5px;
  background: rgba(12, 24, 40, 0.9);
  color: #dbe7f4;
  font-size: 11px;
  cursor: pointer;
}
.wx-layer-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
}
.wx-layer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 7px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: #93a8bd;
  font-size: 11.5px;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}
.wx-layer-item:hover { background: rgba(88, 140, 196, 0.12); color: #d6e6f6; }
.wx-layer-item.on {
  border-color: rgba(255, 158, 84, 0.32);
  background: rgba(255, 122, 42, 0.1);
  color: #f4e9dd;
}
.wx-layer-swatch {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18) inset;
  opacity: 0.45;
  transition: opacity 0.14s ease, transform 0.14s ease;
}
.wx-layer-item.on .wx-layer-swatch { opacity: 1; transform: scale(1.06); }
.wx-layer-label { flex: 1; text-align: left; }
.wx-layer-switch {
  position: relative;
  width: 28px;
  height: 15px;
  border-radius: 999px;
  background: rgba(120, 138, 158, 0.35);
  transition: background 0.16s ease;
}
.wx-layer-switch i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #c3d2e2;
  transition: transform 0.16s ease, background 0.16s ease;
}
.wx-layer-item.on .wx-layer-switch { background: rgba(255, 122, 42, 0.55); }
.wx-layer-item.on .wx-layer-switch i { transform: translateX(13px); background: #ffe0bd; }
.wx-layer-all {
  margin-top: 2px;
  padding: 6px;
  border: 1px dashed rgba(120, 170, 220, 0.28);
  border-radius: 7px;
  background: transparent;
  color: #8fb4d8;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.wx-layer-all:hover { background: rgba(88, 140, 196, 0.14); color: #cfe2f4; }
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
.wx-speed { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; font-size: 10.5px; color: #8ca2b8; white-space: nowrap; }
.wx-speed input { width: 84px; accent-color: #ff7a2a; }
.wx-speed b { font-size: 11px; color: #ffd9a8; }
.wx-legend-swatches { display: flex; flex-direction: column; gap: 5px; }
.wx-legend-swatches span { display: flex; align-items: center; gap: 7px; font-size: 10.5px; color: #a9bdd2; }
.wx-legend-swatches i { width: 14px; height: 10px; border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 2px; }
.wx-legend-ramp { height: 10px; border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 3px; }
.wx-legend-wind { display: flex; flex-direction: column; gap: 4px; padding-top: 6px; border-top: 1px dashed rgba(157, 188, 224, 0.16); }
.wx-legend-range { display: flex; justify-content: space-between; font-size: 10px; color: #8ca2b8; }
.wx-tool.accent { border-color: rgba(255, 158, 84, 0.5); color: #ffd9a8; }
.wx-tool:disabled { opacity: 0.42; cursor: not-allowed; }

.wx-tool-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
.wx-seg {
  height: 26px;
  padding: 0 4px;
  border: 1px solid rgba(157, 188, 224, 0.26);
  border-radius: 5px;
  background: rgba(16, 30, 48, 0.85);
  color: #b9cde1;
  font-size: 11px;
  cursor: pointer;
}
.wx-seg:hover { border-color: #5eacf5; color: #fff; }
.wx-seg.active { border-color: #ff8a3d; background: rgba(255, 122, 42, 0.18); color: #ffd9a8; font-weight: 600; }
.wx-btn-row { display: flex; gap: 5px; }
.wx-mini {
  flex: 1;
  height: 25px;
  padding: 0 6px;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 5px;
  background: rgba(16, 30, 48, 0.85);
  color: #cfe0f2;
  font-size: 11px;
  cursor: pointer;
}
.wx-mini:hover:not(:disabled) { border-color: #5eacf5; color: #fff; }
.wx-mini:disabled { opacity: 0.38; cursor: not-allowed; }
.param-static { flex: 1; min-width: 0; overflow: hidden; font-size: 11px; color: #a9bdd2; text-align: right; white-space: nowrap; text-overflow: ellipsis; }

.algo-mask { position: absolute; inset: 0; z-index: 95; display: grid; place-items: center; padding: 24px; background: rgba(4, 10, 18, 0.72); }
.algo-dialog {
  display: flex;
  flex-direction: column;
  width: min(880px, 100%);
  max-height: 100%;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 12px;
  overflow: hidden;
  background: #0d1a29;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
}
.algo-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(157, 188, 224, 0.18);
  background: linear-gradient(180deg, #1c1208, #12202f);
}
.algo-title { margin: 0; font-size: 15px; font-weight: 700; color: #ffd9a8; }
.algo-sub { margin: 4px 0 0; font-size: 11px; color: #8fb6de; letter-spacing: 0.04em; }
.algo-head-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.algo-download {
  height: 26px;
  padding: 0 12px;
  border: 1px solid rgba(255, 158, 84, 0.5);
  border-radius: 5px;
  background: rgba(255, 122, 42, 0.12);
  color: #ffd9a8;
  font-size: 11.5px;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.algo-download:hover { background: rgba(255, 122, 42, 0.24); color: #ffe9cf; }
.algo-close { flex: 0 0 auto; border: 0; background: transparent; color: #9fb3c8; font-size: 22px; line-height: 1; cursor: pointer; }
.algo-close:hover { color: #fff; }
.algo-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 18px 24px; }
.algo-intro { margin: 0 0 14px; font-size: 12.5px; line-height: 1.7; color: #c5d6e6; }
.algo-pipeline { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.algo-stage {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border: 1px dashed rgba(143, 182, 222, 0.4);
  border-radius: 999px;
  font-size: 10.5px;
  color: #a9bdd2;
}
.algo-stage b { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; background: #ff7a2a; color: #2a1006; font-size: 10px; }
.algo-stage em { font-style: normal; color: #ffd9a8; }
.algo-stage i { font-style: normal; color: #7f93a8; }
.algo-section { margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(157, 188, 224, 0.14); }
.algo-section h3 { margin: 0 0 6px; font-size: 13px; color: #7fc3ff; }
.algo-summary { margin: 0 0 8px; font-size: 12px; line-height: 1.65; color: #9fb3c8; }
.algo-steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.algo-steps li { display: flex; flex-direction: column; gap: 2px; padding-left: 10px; border-left: 2px solid rgba(255, 122, 42, 0.45); }
.algo-steps b { font-size: 11.5px; color: #ffd9a8; }
.algo-steps span { font-size: 11.5px; line-height: 1.6; color: #b9cde1; }
.algo-formulas { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
.algo-formulas code {
  padding: 5px 9px;
  border-radius: 5px;
  background: rgba(6, 16, 28, 0.9);
  color: #9fe0c0;
  font-family: 'DM Mono', monospace;
  font-size: 11px;
  white-space: pre-wrap;
}
.algo-bullets { margin: 8px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.algo-bullets li { font-size: 11.5px; line-height: 1.65; color: #b9cde1; }

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
.rx-report-cover { margin: 0 0 18px; padding-bottom: 16px; border-bottom: 2px double #b9cddd; text-align: center; }
.rx-report-classification { margin: 0 0 14px; text-align: left; font-size: 11px; color: #b23b3b; letter-spacing: 1px; }
.rx-report-cover-title { margin: 26px 0 6px; font-size: 26px; letter-spacing: 4px; color: #10395c; }
.rx-report-cover-sub { margin: 0 0 22px; font-size: 13px; color: #4a6377; }
.rx-report-cover-meta { width: 420px; max-width: 100%; margin: 0 auto; border-collapse: collapse; font-size: 12px; }
.rx-report-cover-meta th, .rx-report-cover-meta td { padding: 5px 10px; border: 1px solid #c9d6e0; text-align: left; }
.rx-report-cover-meta th { width: 34%; background: #e8f1f8; color: #17324d; font-weight: 600; }
.rx-report-cover-meta td { color: #22323f; }
.rx-report-figure { margin: 8px 0 10px; }
.rx-report-image { display: block; width: 100%; border: 1px solid #c9d6e0; border-radius: 4px; }
.rx-report-figcaption { margin-top: 4px; font-size: 11px; line-height: 1.5; color: #5b6b7a; text-align: center; }
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
  .wx-statusbar { gap: 8px; }
  .wx-speed input { width: 62px; }
  .wx-system-meta { display: none; }
}
</style>
