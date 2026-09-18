<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import * as Cesium from 'cesium'
import { createMapScene, destroyScene, loadBingImagery } from '../../lib/cesium-scene'
import { buildDefaultCity, type CityModel } from '../sunshine-lib/city'
import { computeSunPosition, formatMinutes, DEG2RAD, type SunContext } from '../sunshine-lib/sun'
import {
  buildSunPath,
  createSunIndicator,
  renderBuildings,
  renderSunPath,
  sunWorldPosition,
  updateBuildingOpacity,
  localToCartesian,
  buildGridSurface,
  createGridAppearance,
  shadowRgb,
  shadowGradientCss
} from '../sunshine-lib/render'
import {
  buildTimeSteps,
  createSunGrid,
  gridNodeLocal,
  type AnalysisParams,
  type SunGrid
} from '../sunshine-lib/analysis'
import { analyzeShadowSliceAsync, analyzeShadowVolumeAsync, type ShadowVolume } from './analysis'
import { SHADOW_ANALYSIS_HELP } from '../sunshine-lib/help'
import {
  exportReportDocx,
  printReport,
  type ReportModel,
  type ReportSection
} from '../sunshine-lib/report'

const SHADOW_SIZE_OPTIONS = [1024, 2048, 4096]
const SPEED_OPTIONS = [
  { value: 300, label: '5 分钟/秒' },
  { value: 900, label: '15 分钟/秒' },
  { value: 1800, label: '30 分钟/秒' },
  { value: 3600, label: '1 小时/秒' }
]
const STEP_OPTIONS = [5, 10, 15, 30, 60]
const ANALYSIS_MODE_OPTIONS = [
  { value: 'height', label: '对应高度结果图' },
  { value: 'grid', label: '区间空间网格' },
  { value: 'points', label: '区间空间点集' }
]
const TZ_OFFSET = 8

type AnalysisMode = 'height' | 'grid' | 'points'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const isLoaded = ref(false)
const buildingCount = ref(0)

const city = shallowRef<CityModel | undefined>()
let viewer: Cesium.Viewer | undefined
let buildingEntities: Cesium.Entity[] = []
let sunPathEntities: Cesium.Entity[] = []
let sunIndicator: Cesium.Entity | undefined
let shadowVectorEntity: Cesium.Entity | undefined
let postRenderCallback: (() => void) | undefined
let baseJulian: Cesium.JulianDate | undefined

let gridValue: SunGrid | undefined
let volumeValue: ShadowVolume | undefined
let slicePrimitive: Cesium.Primitive | undefined
let stackPrimitives: Cesium.Primitive[] = []
let pointCollection: Cesium.PointPrimitiveCollection | undefined
let analysisRun = 0
let heightDebounce: ReturnType<typeof setTimeout> | undefined

const form = reactive({
  dateText: '2026-12-22',
  currentMinutes: 10 * 60,
  playing: false,
  speed: 1800
})

const display = reactive({
  shadowEnabled: true,
  softShadows: true,
  shadowSize: 2048,
  shadowDistance: 800,
  shadowDarkness: 0.24,
  normalOffset: true,
  buildingOpacity: 1,
  showBuildings: true,
  showSunPath: true,
  showShadowVector: true,
  shadowRefHeight: 80
})

// 阴影率分析参数
const shadowForm = reactive({
  mode: 'height' as AnalysisMode,
  startMinutes: 8 * 60,
  endMinutes: 16 * 60,
  stepMinutes: 15,
  spacing: 16,
  heightMin: 2,
  heightMax: 30,
  currentHeight: 2,
  levels: 5,
  maxDistance: 1000,
  threshold: 0.5
})

const shadowDisplay = reactive({
  show: true,
  surfaceOpacity: 0.62,
  pointSize: 6
})

const analysis = reactive({
  running: false,
  progress: 0,
  hasResult: false,
  mode: 'height' as AnalysisMode,
  meanRate: 0,
  minRate: 0,
  maxRate: 0,
  highRatio: 0,
  nodes: 0,
  totalHours: 0,
  spacing: 0,
  heightInfo: '—'
})

const dayInfo = reactive({ sunrise: 7 * 60, sunset: 17 * 60 })
const helpOpen = ref(false)
const activeHelpKey = ref<string | undefined>(SHADOW_ANALYSIS_HELP[0]?.key)

const REPORT_TITLE = '空间分析-阴影分析 · 分析报告'
const reportModel = ref<ReportModel | null>(null)

const shadowGradient = shadowGradientCss()

const sunCtx = computed<SunContext>(() => ({
  longitude: city.value?.center.lon ?? 116.4074,
  latitude: city.value?.center.lat ?? 39.9042,
  timezoneOffset: TZ_OFFSET
}))

const timeLabel = computed(() => formatMinutes(form.currentMinutes))
const currentSun = computed(() => computeSunPosition(dateAtMinutes(form.currentMinutes), sunCtx.value))

function parseDateText(text: string): Date {
  const [year, month, day] = text.split('-').map((part) => Number(part))
  return new Date(year || 2026, (month || 1) - 1, day || 1)
}

function dateAtMinutes(minutes: number): Date {
  const base = parseDateText(form.dateText)
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(minutes / 60), minutes % 60, 0)
}

function toJulian(localDate: Date): Cesium.JulianDate {
  const utcMs =
    Date.UTC(
      localDate.getFullYear(),
      localDate.getMonth(),
      localDate.getDate(),
      localDate.getHours(),
      localDate.getMinutes(),
      localDate.getSeconds()
    ) -
    TZ_OFFSET * 3600000
  return Cesium.JulianDate.fromDate(new Date(utcMs))
}

function computeDayBounds(): { sunrise: number; sunset: number } {
  let sunrise: number | null = null
  let sunset: number | null = null
  for (let minutes = 0; minutes <= 1439; minutes += 2) {
    const sun = computeSunPosition(dateAtMinutes(minutes), sunCtx.value)
    if (sun.altitude > 0) {
      if (sunrise === null) sunrise = minutes
      sunset = minutes
    }
  }
  return { sunrise: sunrise ?? 7 * 60, sunset: sunset ?? 17 * 60 }
}

function currentMinutesFromClock(): number {
  if (!viewer || !baseJulian) return form.currentMinutes
  const seconds = Cesium.JulianDate.secondsDifference(viewer.clock.currentTime, baseJulian)
  return ((seconds / 60) % 1440 + 1440) % 1440
}

function sunAtMinutes(minutes: number): { altitude: number; direction: { east: number; north: number; up: number } } {
  return computeSunPosition(dateAtMinutes(minutes), sunCtx.value)
}

function updateSunIndicator(): void {
  const model = city.value
  if (!model || !sunIndicator?.position) return
  const sun = currentSun.value
  const radius = Math.max(model.widthMeters, model.depthMeters) * 0.62 + 240
  const position = sunWorldPosition(model, sun.direction, radius, 40)
  ;(sunIndicator.position as Cesium.ConstantPositionProperty).setValue(position)
  if (sunIndicator.label) {
    sunIndicator.label.text = new Cesium.ConstantProperty(
      `${timeLabel.value}  高度角 ${sun.altitude.toFixed(1)}°  方位角 ${sun.azimuth.toFixed(1)}°`
    )
  }
}

/** 地面阴影方向指示：由场景中心沿背光方向绘制，长度 = 参考高度 × cot(高度角) */
function updateShadowVector(): void {
  const model = city.value
  if (!model || !shadowVectorEntity) return
  const sun = currentSun.value
  const visible = display.showShadowVector && sun.altitude > 2
  shadowVectorEntity.show = visible
  if (!visible) return
  const length = Math.min(5000, display.shadowRefHeight / Math.max(0.02, Math.tan(sun.altitude * DEG2RAD)))
  const dirEast = -Math.sin(sun.azimuth * DEG2RAD)
  const dirNorth = -Math.cos(sun.azimuth * DEG2RAD)
  const start = localToCartesian(model, 0, 0, 2)
  const end = localToCartesian(model, dirEast * length, dirNorth * length, 2)
  const position = shadowVectorEntity.position as Cesium.ConstantPositionProperty | undefined
  position?.setValue(end)
  const positions = shadowVectorEntity.polyline?.positions as Cesium.ConstantProperty | undefined
  positions?.setValue([start, end])
  const shadowAzimuth = (sun.azimuth + 180) % 360
  const text = shadowVectorEntity.label?.text as Cesium.ConstantProperty | undefined
  text?.setValue(`阴影方向 ${Math.round(shadowAzimuth)}° · 长度 ${Math.round(length)}m`)
}

function ensureShadowVector(): void {
  if (!viewer || shadowVectorEntity) return
  const origin = Cesium.Cartesian3.fromDegrees(0, 0, 0)
  shadowVectorEntity = viewer.entities.add({
    id: 'shadow-vector',
    position: origin,
    polyline: {
      positions: [origin, origin],
      width: 3,
      material: new Cesium.PolylineArrowMaterialProperty(Cesium.Color.fromCssColorString('#ff8c40')),
      arcType: Cesium.ArcType.NONE
    },
    label: {
      text: '',
      font: 'bold 12px sans-serif',
      fillColor: Cesium.Color.fromCssColorString('#ffd8a8'),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#3a2205').withAlpha(0.78),
      pixelOffset: new Cesium.Cartesian2(0, -12),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM
    }
  })
}

function rebuildSunPath(): void {
  const model = city.value
  if (!viewer || !model) return
  for (const entity of sunPathEntities) viewer.entities.remove(entity)
  sunPathEntities = []
  const radius = Math.max(model.widthMeters, model.depthMeters) * 0.62 + 240
  const path = buildSunPath(model, { computeAt: (minutes) => sunAtMinutes(minutes) }, radius, 40)
  sunPathEntities = renderSunPath(viewer, path)
  for (const entity of sunPathEntities) entity.show = display.showSunPath
}

function applyShadowQuality(): void {
  if (!viewer) return
  const shadowMap = viewer.scene.shadowMap
  shadowMap.enabled = display.shadowEnabled
  shadowMap.softShadows = display.softShadows
  shadowMap.size = display.shadowSize
  shadowMap.maximumDistance = display.shadowDistance
  shadowMap.darkness = display.shadowDarkness
  shadowMap.normalOffset = display.normalOffset
}

function syncClockToMinutes(minutes: number): void {
  if (!viewer || !baseJulian) return
  viewer.clock.currentTime = Cesium.JulianDate.addSeconds(
    baseJulian,
    minutes * 60,
    new Cesium.JulianDate()
  )
}

function setupClock(): void {
  if (!viewer || !baseJulian) return
  const bounds = computeDayBounds()
  dayInfo.sunrise = bounds.sunrise
  dayInfo.sunset = bounds.sunset
  const clock = viewer.clock
  clock.startTime = toJulian(dateAtMinutes(Math.max(0, bounds.sunrise - 30)))
  clock.stopTime = toJulian(dateAtMinutes(Math.min(1439, bounds.sunset + 30)))
  clock.clockRange = Cesium.ClockRange.LOOP_STOP
  clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER
  clock.multiplier = form.speed
  clock.shouldAnimate = form.playing
  syncClockToMinutes(form.currentMinutes)
}

function onDateChange(): void {
  baseJulian = toJulian(dateAtMinutes(0))
  setupClock()
  rebuildSunPath()
  updateSunIndicator()
  updateShadowVector()
  clearAnalysisResult()
}

function togglePlay(): void {
  if (!viewer) return
  form.playing = !form.playing
  if (form.playing) {
    if (viewer.clock.currentTime >= viewer.clock.stopTime) syncClockToMinutes(dayInfo.sunrise)
    viewer.clock.shouldAnimate = true
  } else {
    viewer.clock.shouldAnimate = false
  }
}

function resetToNoon(): void {
  form.playing = false
  if (viewer) viewer.clock.shouldAnimate = false
  form.currentMinutes = Math.round((dayInfo.sunrise + dayInfo.sunset) / 2)
}

function toggleHelp(key: string): void {
  activeHelpKey.value = activeHelpKey.value === key ? undefined : key
}

// ---------------------------------------------------------------------------
// 阴影率分析（支持采样高度区间，输出单高度结果图或区间体结果）
// ---------------------------------------------------------------------------

function analysisBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
  const model = city.value
  if (!model) return { minX: -1, maxX: 1, minY: -1, maxY: 1 }
  const margin = 8
  return {
    minX: -model.widthMeters / 2 - margin,
    maxX: model.widthMeters / 2 + margin,
    minY: -model.depthMeters / 2 - margin,
    maxY: model.depthMeters / 2 + margin
  }
}

function heightLevels(): number[] {
  const min = Math.min(shadowForm.heightMin, shadowForm.heightMax)
  const max = Math.max(shadowForm.heightMin, shadowForm.heightMax)
  const count = Math.max(2, Math.round(shadowForm.levels))
  const levels: number[] = []
  for (let index = 0; index < count; index += 1) {
    levels.push(min + ((max - min) * index) / (count - 1))
  }
  return levels
}

function removeVisuals(): void {
  if (!viewer) return
  if (slicePrimitive) {
    viewer.scene.primitives.remove(slicePrimitive)
    slicePrimitive = undefined
  }
  for (const primitive of stackPrimitives) viewer.scene.primitives.remove(primitive)
  stackPrimitives = []
  if (pointCollection) {
    viewer.scene.primitives.remove(pointCollection)
    if (!pointCollection.isDestroyed()) pointCollection.destroy()
    pointCollection = undefined
  }
}

function renderSlice(): void {
  const model = city.value
  if (!viewer || !model || !gridValue) return
  const height = analysisHeight()
  const geometry = buildGridSurface(model, gridValue, shadowDisplay.surfaceOpacity, height, 0, 1, shadowRgb)
  const primitive = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({ geometry }),
    appearance: createGridAppearance(),
    asynchronous: false,
    allowPicking: false
  })
  primitive.show = shadowDisplay.show
  viewer.scene.primitives.add(primitive)
  slicePrimitive = primitive
}

function renderGridStack(): void {
  const model = city.value
  if (!viewer || !model || !volumeValue) return
  const { grid, levels, rates } = volumeValue
  const cellCount = grid.nx * grid.ny
  for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
    const sliceGrid: SunGrid = {
      ...grid,
      heights: rates.subarray(levelIndex * cellCount, (levelIndex + 1) * cellCount),
      minValue: 0,
      maxValue: 1
    }
    const geometry = buildGridSurface(model, sliceGrid, shadowDisplay.surfaceOpacity, levels[levelIndex], 0, 1, shadowRgb)
    const primitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry }),
      appearance: createGridAppearance(),
      asynchronous: false,
      allowPicking: false
    })
    primitive.show = shadowDisplay.show
    viewer.scene.primitives.add(primitive)
    stackPrimitives.push(primitive)
  }
}

function renderPointCloud(): void {
  const model = city.value
  if (!viewer || !model || !volumeValue) return
  const { grid, levels, rates } = volumeValue
  const cellCount = grid.nx * grid.ny
  const collection = new Cesium.PointPrimitiveCollection()
  for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
    const height = levels[levelIndex]
    const offset = levelIndex * cellCount
    for (let row = 0; row < grid.ny; row += 1) {
      for (let col = 0; col < grid.nx; col += 1) {
        const rate = rates[offset + row * grid.nx + col]
        const [r, g, b] = shadowRgb(rate)
        const node = gridNodeLocal(grid, row, col)
        collection.add({
          position: localToCartesian(model, node.x, node.y, height),
          pixelSize: shadowDisplay.pointSize,
          color: Cesium.Color.fromBytes(r, g, b, 235),
          outlineColor: Cesium.Color.fromBytes(10, 20, 35, 130),
          outlineWidth: 1
        })
      }
    }
  }
  collection.show = shadowDisplay.show
  viewer.scene.primitives.add(collection)
  pointCollection = collection
}

function renderCurrentResult(): void {
  if (!analysis.hasResult) return
  removeVisuals()
  if (analysis.mode === 'height') renderSlice()
  else if (analysis.mode === 'grid') renderGridStack()
  else renderPointCloud()
}

function analysisHeight(): number {
  const min = Math.min(shadowForm.heightMin, shadowForm.heightMax)
  const max = Math.max(shadowForm.heightMin, shadowForm.heightMax)
  return Math.min(max, Math.max(min, shadowForm.currentHeight))
}

function aggregate(rates: Float32Array): void {
  let sum = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let high = 0
  for (let index = 0; index < rates.length; index += 1) {
    const value = rates[index]
    sum += value
    if (value < min) min = value
    if (value > max) max = value
    if (value >= shadowForm.threshold) high += 1
  }
  const count = rates.length
  analysis.meanRate = count > 0 ? sum / count : 0
  analysis.minRate = count > 0 ? min : 0
  analysis.maxRate = count > 0 ? max : 0
  analysis.highRatio = count > 0 ? high / count : 0
  analysis.nodes = count
}

function recalcHighRatio(): void {
  if (gridValue) aggregate(gridValue.heights)
  else if (volumeValue) aggregate(volumeValue.rates)
}

async function runAnalysis(): Promise<void> {
  const model = city.value
  if (!model || analysis.running) return
  analysis.running = true
  analysis.progress = 0
  const run = ++analysisRun
  const mode = shadowForm.mode
  statusMessage.value = '正在计算区域阴影率…'
  try {
    const params: AnalysisParams = {
      date: parseDateText(form.dateText),
      timezoneOffset: TZ_OFFSET,
      startMinutes: shadowForm.startMinutes,
      endMinutes: shadowForm.endMinutes,
      stepMinutes: shadowForm.stepMinutes,
      maxDistance: shadowForm.maxDistance,
      sampleHeight: analysisHeight()
    }
    const steps = buildTimeSteps(sunCtx.value, params)
    if (steps.length === 0) {
      statusMessage.value = '所选时间带内太阳始终位于地平线以下，请调整分析时间带'
      return
    }
    const grid = createSunGrid(model, { spacing: shadowForm.spacing, ...analysisBounds() })

    if (mode === 'height') {
      const height = analysisHeight()
      await analyzeShadowSliceAsync(model, grid, height, steps, params, (ratio) => {
        if (run === analysisRun) analysis.progress = Math.round(ratio * 100)
      })
      if (run !== analysisRun) return
      gridValue = grid
      volumeValue = undefined
      analysis.mode = 'height'
      aggregate(grid.heights)
      analysis.heightInfo = `${height.toFixed(1)} m（对应高度结果图）`
    } else {
      const levels = heightLevels()
      const rates = await analyzeShadowVolumeAsync(model, grid, levels, steps, params, (ratio) => {
        if (run === analysisRun) analysis.progress = Math.round(ratio * 100)
      })
      if (run !== analysisRun) return
      volumeValue = { grid, levels, rates }
      gridValue = undefined
      analysis.mode = mode
      aggregate(rates)
      analysis.heightInfo = `${levels[0].toFixed(0)}–${levels[levels.length - 1].toFixed(0)} m · ${levels.length} 层`
    }

    analysis.spacing = shadowForm.spacing
    analysis.totalHours = (steps.length * params.stepMinutes) / 60
    analysis.hasResult = true
    renderCurrentResult()
    statusMessage.value = ''
  } finally {
    if (run === analysisRun) {
      analysis.running = false
      analysis.progress = 100
    }
  }
}

function clearAnalysisResult(): void {
  analysisRun += 1
  removeVisuals()
  gridValue = undefined
  volumeValue = undefined
  analysis.hasResult = false
}

function scheduleHeightRerun(): void {
  if (heightDebounce) clearTimeout(heightDebounce)
  heightDebounce = setTimeout(() => {
    if (shadowForm.mode === 'height' && analysis.hasResult) runAnalysis()
  }, 260)
}

function updatePointSize(): void {
  if (!pointCollection) return
  for (let index = 0; index < pointCollection.length; index += 1) {
    const point = pointCollection.get(index)
    if (point) point.pixelSize = shadowDisplay.pointSize
  }
}

// ---------------------------------------------------------------------------
// 分析报告输出（PDF 打印 / Word 下载）
// ---------------------------------------------------------------------------

function analysisModeLabel(value: AnalysisMode): string {
  return ANALYSIS_MODE_OPTIONS.find((item) => item.value === value)?.label ?? value
}

function collectReport(): ReportModel {
  const model = city.value
  const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false })
  const sections: ReportSection[] = []
  sections.push({
    title: '一、案例与场景',
    kv: [
      { label: '案例名称', value: '空间分析-阴影分析' },
      { label: '场景中心', value: model ? `${model.center.lon.toFixed(5)}, ${model.center.lat.toFixed(5)}` : '—' },
      { label: '建筑数量', value: `${buildingCount.value} 栋` },
      { label: '场景尺寸', value: model ? `${model.widthMeters.toFixed(0)} × ${model.depthMeters.toFixed(0)} m` : '—' }
    ]
  })
  sections.push({
    title: '二、时间与光照参数',
    kv: [
      { label: '分析日期', value: form.dateText },
      { label: '当前时刻', value: timeLabel.value },
      { label: '日出 / 日落', value: `${formatMinutes(dayInfo.sunrise)} / ${formatMinutes(dayInfo.sunset)}` },
      { label: '太阳高度角', value: `${currentSun.value.altitude.toFixed(2)}°` },
      { label: '太阳方位角', value: `${currentSun.value.azimuth.toFixed(2)}°` },
      { label: '播放速度', value: `${form.speed / 60} 分钟/秒` }
    ]
  })
  sections.push({
    title: '三、阴影渲染参数',
    kv: [
      { label: '启用阴影', value: display.shadowEnabled ? '是' : '否' },
      { label: '软阴影（PCF）', value: display.softShadows ? '是' : '否' },
      { label: '贴图分辨率', value: `${display.shadowSize}²` },
      { label: '最大计算距离', value: `${display.shadowDistance} m` },
      { label: '阴影暗度', value: display.shadowDarkness.toFixed(2) },
      { label: '法线偏移', value: display.normalOffset ? '启用' : '关闭' },
      { label: '阴影方向指示', value: display.showShadowVector ? `开启（参考高度 ${display.shadowRefHeight} m）` : '关闭' }
    ]
  })
  if (analysis.hasResult) {
    sections.push({
      title: '四、阴影率分析参数',
      kv: [
        { label: '结果形式', value: analysisModeLabel(analysis.mode) },
        { label: '分析时间带', value: `${formatMinutes(shadowForm.startMinutes)} — ${formatMinutes(shadowForm.endMinutes)}` },
        { label: '时间步长', value: `${shadowForm.stepMinutes} 分钟` },
        { label: '网格间距', value: `${analysis.spacing} m` },
        { label: '采样高度区间', value: `${Math.min(shadowForm.heightMin, shadowForm.heightMax)} — ${Math.max(shadowForm.heightMin, shadowForm.heightMax)} m` },
        { label: '高阴影阈值', value: `${(shadowForm.threshold * 100).toFixed(0)}%` },
        { label: '有效时段时长', value: `${analysis.totalHours.toFixed(2)} h` }
      ]
    })
    sections.push({
      title: '五、阴影率分析结果',
      table: {
        caption: `结果形式：${analysisModeLabel(analysis.mode)}；高度区间：${analysis.heightInfo}`,
        head: ['指标', '数值'],
        body: [
          ['平均阴影率', `${(analysis.meanRate * 100).toFixed(2)}%`],
          ['最大阴影率', `${(analysis.maxRate * 100).toFixed(2)}%`],
          ['最小阴影率', `${(analysis.minRate * 100).toFixed(2)}%`],
          ['高阴影占比', `${(analysis.highRatio * 100).toFixed(2)}%`],
          ['空间点数', String(analysis.nodes)]
        ]
      }
    })
  } else {
    sections.push({
      title: '四、阴影率分析',
      lines: ['尚未执行阴影率分析，未生成分析结果。可在左侧面板设置结果形式、时间带与采样高度区间后点击「开始分析」。']
    })
  }
  return {
    generatedAt,
    intro:
      '本报告由「空间分析-阴影分析」案例生成，汇总当前日期时间、太阳光照、阴影渲染参数以及阴影率分析结果。阴影率指在分析时间带内空间点处于建筑阴影的时长占比，数值越大表示遮挡越严重。',
    sections
  }
}

function openReportPreview(): void {
  reportModel.value = collectReport()
}

function closeReport(): void {
  reportModel.value = null
}

function onPrintReport(): void {
  if (!reportModel.value) return
  printReport(reportModel.value, {
    docTitle: REPORT_TITLE,
    filenamePrefix: 'shadow-analysis-report',
    onStatus: (message) => (statusMessage.value = message)
  })
}

async function onExportReportDocx(): Promise<void> {
  if (!reportModel.value) return
  await exportReportDocx(reportModel.value, {
    docTitle: REPORT_TITLE,
    filenamePrefix: 'shadow-analysis-report',
    creator: '空间分析-阴影分析',
    onStatus: (message) => (statusMessage.value = message)
  })
}

watch(
  () => display.shadowEnabled,
  () => applyShadowQuality()
)
watch(
  () => display.softShadows,
  () => applyShadowQuality()
)
watch(
  () => display.shadowSize,
  () => applyShadowQuality()
)
watch(
  () => display.shadowDistance,
  () => applyShadowQuality()
)
watch(
  () => display.shadowDarkness,
  () => applyShadowQuality()
)
watch(
  () => display.normalOffset,
  () => applyShadowQuality()
)

watch(
  () => display.buildingOpacity,
  (value) => {
    if (city.value) updateBuildingOpacity(buildingEntities, city.value, value)
  }
)

watch(
  () => display.showBuildings,
  (value) => {
    for (const entity of buildingEntities) entity.show = value
  }
)

watch(
  () => display.showSunPath,
  (value) => {
    for (const entity of sunPathEntities) entity.show = value
  }
)

watch([() => display.showShadowVector, () => display.shadowRefHeight], () => updateShadowVector())

watch(
  () => form.speed,
  (value) => {
    if (viewer) viewer.clock.multiplier = value
  }
)

watch(
  () => form.currentMinutes,
  (value) => {
    if (!viewer) return
    if (form.playing) return
    syncClockToMinutes(value)
    updateSunIndicator()
    updateShadowVector()
  }
)

watch(
  () => shadowForm.currentHeight,
  () => scheduleHeightRerun()
)

watch([() => shadowForm.heightMin, () => shadowForm.heightMax], () => {
  shadowForm.currentHeight = analysisHeight()
})

watch(
  () => shadowDisplay.show,
  (value) => {
    if (slicePrimitive) slicePrimitive.show = value
    for (const primitive of stackPrimitives) primitive.show = value
    if (pointCollection) pointCollection.show = value
  }
)

watch(
  () => shadowDisplay.surfaceOpacity,
  () => {
    if (analysis.hasResult && (analysis.mode === 'height' || analysis.mode === 'grid')) renderCurrentResult()
  }
)

watch(
  () => shadowDisplay.pointSize,
  () => updatePointSize()
)

watch(
  () => shadowForm.threshold,
  () => recalcHighRatio()
)

onMounted(() => {
  if (!container.value) return
  const model = buildDefaultCity()
  city.value = model
  buildingCount.value = model.buildings.length

  const created = createMapScene(container.value)
  viewer = created
  loadBingImagery(created, { onStatus: (message) => (statusMessage.value = message) })
  created.scene.globe.enableLighting = true

  buildingEntities = renderBuildings(created, model, display.buildingOpacity, Cesium.ShadowMode.ENABLED)
  rebuildSunPath()
  sunIndicator = createSunIndicator(created)
  ensureShadowVector()

  applyShadowQuality()
  baseJulian = toJulian(dateAtMinutes(0))
  setupClock()
  syncClockToMinutes(form.currentMinutes)
  updateSunIndicator()
  updateShadowVector()

  created.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(model.center.lon, model.center.lat - 0.005, 780),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-34),
      roll: 0
    },
    duration: 0
  })

  postRenderCallback = () => {
    const minutes = Math.round(currentMinutesFromClock())
    if (minutes !== form.currentMinutes) {
      form.currentMinutes = minutes
      updateSunIndicator()
      updateShadowVector()
    }
  }
  created.scene.postRender.addEventListener(postRenderCallback)

  isLoaded.value = true
})

onBeforeUnmount(() => {
  analysisRun += 1
  if (heightDebounce) clearTimeout(heightDebounce)
  if (viewer && postRenderCallback) {
    viewer.scene.postRender.removeEventListener(postRenderCallback)
    postRenderCallback = undefined
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="shadow-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">空间分析-阴影分析</div>

      <div class="section-title">时间与光照</div>
      <div class="control-row">
        <span class="row-label">分析日期</span>
        <input v-model="form.dateText" type="date" @change="onDateChange" />
      </div>
      <div class="control-row">
        <span class="row-label">当前时刻</span>
        <input
          v-model.number="form.currentMinutes"
          type="range"
          min="0"
          max="1439"
          step="1"
          :disabled="form.playing"
        />
        <span class="row-value">{{ timeLabel }}</span>
      </div>
      <div class="row-note">
        日出 {{ formatMinutes(dayInfo.sunrise) }} · 日落 {{ formatMinutes(dayInfo.sunset) }}
      </div>
      <div class="row-note">
        高度角 {{ currentSun.altitude.toFixed(1) }}° · 方位角 {{ currentSun.azimuth.toFixed(1) }}
      </div>
      <div class="control-row">
        <span class="row-label">播放速度</span>
        <select v-model.number="form.speed" :disabled="form.playing">
          <option v-for="item in SPEED_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>
      <div class="button-row">
        <button class="action-button primary" :disabled="!isLoaded" @click="togglePlay">
          {{ form.playing ? '暂停' : '播放' }}
        </button>
        <button class="action-button accent" :disabled="!isLoaded" @click="resetToNoon">回到正午</button>
      </div>

      <div class="section-title">阴影质量</div>
      <label class="switch-row">
        <span>启用阴影</span>
        <input v-model="display.shadowEnabled" type="checkbox" />
      </label>
      <label class="switch-row">
        <span>软阴影（PCF）</span>
        <input v-model="display.softShadows" type="checkbox" :disabled="!display.shadowEnabled" />
      </label>
      <div class="control-row">
        <span class="row-label">贴图分辨率</span>
        <select v-model.number="display.shadowSize" :disabled="!display.shadowEnabled">
          <option v-for="item in SHADOW_SIZE_OPTIONS" :key="item" :value="item">{{ item }}²</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">最大距离</span>
        <input
          v-model.number="display.shadowDistance"
          type="range"
          min="200"
          max="3000"
          step="50"
          :disabled="!display.shadowEnabled"
        />
        <span class="row-value">{{ display.shadowDistance }}m</span>
      </div>
      <div class="control-row">
        <span class="row-label">阴影暗度</span>
        <input
          v-model.number="display.shadowDarkness"
          type="range"
          min="0.05"
          max="1"
          step="0.01"
          :disabled="!display.shadowEnabled"
        />
        <span class="row-value">{{ display.shadowDarkness.toFixed(2) }}</span>
      </div>
      <label class="switch-row">
        <span>法线偏移</span>
        <input v-model="display.normalOffset" type="checkbox" :disabled="!display.shadowEnabled" />
      </label>

      <div class="section-title">场景显示</div>
      <label class="switch-row">
        <span>建筑白模</span>
        <input v-model="display.showBuildings" type="checkbox" />
      </label>
      <div class="control-row">
        <span class="row-label">建筑透明度</span>
        <input v-model.number="display.buildingOpacity" type="range" min="0.25" max="1" step="0.05" />
        <span class="row-value">{{ display.buildingOpacity.toFixed(2) }}</span>
      </div>
      <label class="switch-row">
        <span>太阳轨迹</span>
        <input v-model="display.showSunPath" type="checkbox" />
      </label>
      <label class="switch-row">
        <span>阴影方向指示</span>
        <input v-model="display.showShadowVector" type="checkbox" />
      </label>
      <div class="control-row" v-if="display.showShadowVector">
        <span class="row-label">参考高度</span>
        <input v-model.number="display.shadowRefHeight" type="range" min="20" max="200" step="10" />
        <span class="row-value">{{ display.shadowRefHeight }}m</span>
      </div>

      <div class="section-title">阴影率分析</div>
      <div class="control-row">
        <span class="row-label">结果形式</span>
        <select v-model="shadowForm.mode">
          <option v-for="item in ANALYSIS_MODE_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">时间带起</span>
        <input v-model.number="shadowForm.startMinutes" type="range" min="0" max="1439" step="15" />
        <span class="row-value">{{ formatMinutes(shadowForm.startMinutes) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">时间带止</span>
        <input v-model.number="shadowForm.endMinutes" type="range" min="0" max="1439" step="15" />
        <span class="row-value">{{ formatMinutes(shadowForm.endMinutes) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">时间步长</span>
        <select v-model.number="shadowForm.stepMinutes">
          <option v-for="item in STEP_OPTIONS" :key="item" :value="item">{{ item }} 分钟</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">网格间距</span>
        <input v-model.number="shadowForm.spacing" type="range" min="8" max="40" step="4" />
        <span class="row-value">{{ shadowForm.spacing }}m</span>
      </div>

      <div class="row-note">采样分析高度区间</div>
      <div class="control-row">
        <span class="row-label">起始高度</span>
        <input v-model.number="shadowForm.heightMin" type="range" min="1" max="120" step="1" />
        <span class="row-value">{{ shadowForm.heightMin }}m</span>
      </div>
      <div class="control-row">
        <span class="row-label">结束高度</span>
        <input v-model.number="shadowForm.heightMax" type="range" min="1" max="120" step="1" />
        <span class="row-value">{{ shadowForm.heightMax }}m</span>
      </div>
      <div class="control-row" v-if="shadowForm.mode === 'height'">
        <span class="row-label">采样高度</span>
        <input
          v-model.number="shadowForm.currentHeight"
          type="range"
          :min="Math.min(shadowForm.heightMin, shadowForm.heightMax)"
          :max="Math.max(shadowForm.heightMin, shadowForm.heightMax)"
          step="1"
        />
        <span class="row-value">{{ analysisHeight().toFixed(0) }}m</span>
      </div>
      <div class="control-row" v-else>
        <span class="row-label">高度层数</span>
        <input v-model.number="shadowForm.levels" type="range" min="2" max="8" step="1" />
        <span class="row-value">{{ shadowForm.levels }}</span>
      </div>

      <div class="control-row">
        <span class="row-label">高阴影阈值</span>
        <input v-model.number="shadowForm.threshold" type="range" min="0.3" max="0.9" step="0.05" />
        <span class="row-value">{{ (shadowForm.threshold * 100).toFixed(0) }}%</span>
      </div>
      <div class="button-row">
        <button class="action-button primary" :disabled="!isLoaded || analysis.running" @click="runAnalysis">
          {{ analysis.running ? '计算中…' : '开始分析' }}
        </button>
        <button class="action-button ghost" :disabled="!analysis.hasResult" @click="clearAnalysisResult">清除</button>
      </div>
      <div v-if="analysis.running" class="progress-track"><div class="progress-fill" :style="{ width: analysis.progress + '%' }"></div></div>

      <div v-if="analysis.hasResult" class="stat-grid">
        <div class="stat-cell"><span>平均阴影率</span><b>{{ (analysis.meanRate * 100).toFixed(1) }}%</b></div>
        <div class="stat-cell"><span>最大阴影率</span><b class="danger">{{ (analysis.maxRate * 100).toFixed(1) }}%</b></div>
        <div class="stat-cell"><span>最小阴影率</span><b>{{ (analysis.minRate * 100).toFixed(1) }}%</b></div>
        <div class="stat-cell"><span>高阴影占比</span><b class="danger">{{ (analysis.highRatio * 100).toFixed(1) }}%</b></div>
        <div class="stat-cell"><span>时段时长</span><b>{{ analysis.totalHours.toFixed(1) }}h</b></div>
        <div class="stat-cell"><span>空间点数</span><b>{{ analysis.nodes }}</b></div>
      </div>
      <div v-if="analysis.hasResult" class="row-note">高度区间：{{ analysis.heightInfo }} · 网格 {{ analysis.spacing }}m</div>

      <label class="switch-row" v-if="analysis.hasResult">
        <span>显示分析结果</span>
        <input v-model="shadowDisplay.show" type="checkbox" />
      </label>
      <div class="control-row" v-if="analysis.hasResult && analysis.mode !== 'points'">
        <span class="row-label">结果透明度</span>
        <input v-model.number="shadowDisplay.surfaceOpacity" type="range" min="0.2" max="1" step="0.05" />
        <span class="row-value">{{ shadowDisplay.surfaceOpacity.toFixed(2) }}</span>
      </div>
      <div class="control-row" v-if="analysis.hasResult && analysis.mode === 'points'">
        <span class="row-label">点大小</span>
        <input v-model.number="shadowDisplay.pointSize" type="range" min="2" max="14" step="1" />
        <span class="row-value">{{ shadowDisplay.pointSize }}px</span>
      </div>
      <div v-if="analysis.hasResult" class="legend">
        <div class="legend-bar" :style="{ background: shadowGradient }"></div>
        <div class="legend-labels"><span>低 0%</span><span>100% 高</span></div>
      </div>

      <div v-if="analysis.hasResult" class="section-title">分析报告</div>
      <div v-if="analysis.hasResult" class="button-row">
        <button class="action-button accent" @click="openReportPreview">生成分析报告</button>
      </div>

      <button class="help-toggle" @click="helpOpen = !helpOpen">功能实现说明</button>
      <div v-if="helpOpen" class="help-panel">
        <div class="help-head">
          <span>功能实现说明</span>
          <button class="help-close" @click="helpOpen = false">×</button>
        </div>
        <div v-for="item in SHADOW_ANALYSIS_HELP" :key="item.key" class="help-item">
          <button class="help-item-head" :class="{ active: activeHelpKey === item.key }" @click="toggleHelp(item.key)">
            <span>{{ item.title }}</span><i>{{ activeHelpKey === item.key ? '−' : '+' }}</i>
          </button>
          <p v-if="activeHelpKey === item.key" class="help-summary">{{ item.summary }}</p>
          <ul v-if="activeHelpKey === item.key" class="help-detail">
            <li v-for="(line, index) in item.detail" :key="index">{{ line }}</li>
          </ul>
        </div>
      </div>

      <p class="hint">
        级联阴影映射实时渲染建筑阴影，地面阴影方向指示随时刻连续扫动；阴影率分析可在设定高度区间内输出单高度结果图，或输出区间空间网格/空间点集，反映不同高度上的遮挡分布。
      </p>
    </div>

    <div v-if="!isLoaded" class="status-mask">{{ statusMessage }}</div>

    <div v-if="reportModel" class="report-backdrop">
      <div class="report-toolbar">
        <span class="report-toolbar-title">分析报告 · 预览与导出</span>
        <span class="report-actions">
          <button class="report-btn" @click="onPrintReport">打印 / 另存为 PDF</button>
          <button class="report-btn accent" @click="onExportReportDocx">下载 Word(.docx)</button>
          <button class="report-close" title="关闭预览" @click="closeReport">×</button>
        </span>
      </div>
      <div class="report-doc">
        <h1 class="report-h1">{{ REPORT_TITLE }}</h1>
        <p class="report-meta">生成时间：{{ reportModel.generatedAt }}</p>
        <p class="report-intro">{{ reportModel.intro }}</p>
        <template v-for="section in reportModel.sections" :key="section.title">
          <h2 class="report-h2">{{ section.title }}</h2>
          <dl v-if="section.kv && section.kv.length > 0" class="report-kv">
            <template v-for="pair in section.kv" :key="pair.label">
              <dt>{{ pair.label }}</dt>
              <dd>{{ pair.value }}</dd>
            </template>
          </dl>
          <table v-if="section.table" class="report-table">
            <caption v-if="section.table.caption" class="report-caption">{{ section.table.caption }}</caption>
            <thead>
              <tr><th v-for="head in section.table.head" :key="head">{{ head }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in section.table.body" :key="rowIndex">
                <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
          <p v-for="(line, lineIndex) in section.lines || []" :key="lineIndex" class="report-line">{{ line }}</p>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shadow-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #0f2438; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 5px; width: 274px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 26, 44, 0.9); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.panel-title { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
.section-title { margin-top: 7px; margin-bottom: 2px; padding-bottom: 2px; border-bottom: 1px solid rgba(137, 210, 233, 0.16); font-size: 11px; font-weight: 700; color: #7fd0e6; }
.button-row { display: flex; gap: 6px; }
.action-button { flex: 1; min-height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; color: #edfaff; }
.action-button.primary { background: #257f9e; }
.action-button.accent { background: #8a6d1a; color: #fff3d6; }
.action-button.ghost { background: rgba(20, 52, 80, 0.7); border: 1px solid rgba(137, 210, 233, 0.35); color: #d9eff6; }
.action-button:disabled { cursor: default; opacity: 0.5; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 0; color: #c3d8e6; }
.row-label { flex: 0 0 auto; }
.row-value { flex: 0 0 54px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.row-note { font-size: 10px; color: #7fd0e6; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row select, .control-row input[type="date"] { width: 130px; height: 22px; padding: 0 5px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.switch-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; color: #c3d8e6; }
.switch-row input { cursor: pointer; }
.progress-track { height: 6px; margin-top: 3px; border-radius: 3px; background: rgba(137, 210, 233, 0.18); overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #257f9e, #45b4d6); transition: width 0.2s ease; }
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 4px; }
.stat-cell { display: flex; flex-direction: column; gap: 2px; padding: 5px 4px; border: 1px solid rgba(137, 210, 233, 0.2); border-radius: 5px; background: rgba(16, 43, 64, 0.55); text-align: center; }
.stat-cell span { font-size: 9px; color: #8fb0c8; }
.stat-cell b { font-size: 12px; color: #d9eff6; }
.stat-cell b.danger { color: #ff7875; }
.legend { margin-top: 5px; }
.legend-bar { height: 10px; border-radius: 3px; border: 1px solid rgba(137, 210, 233, 0.25); }
.legend-labels { display: flex; justify-content: space-between; margin-top: 2px; font-size: 9px; color: #8fb0c8; }
.hint { margin: 6px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.help-toggle { margin-top: 7px; min-height: 26px; border: 1px solid rgba(255, 199, 92, 0.5); border-radius: 5px; background: rgba(74, 58, 12, 0.4); color: #ffd666; cursor: pointer; font-size: 11px; }
.help-panel { margin-top: 6px; padding: 8px; border: 1px solid rgba(255, 199, 92, 0.45); border-radius: 6px; background: rgba(30, 24, 8, 0.55); }
.help-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; color: #ffd666; font-weight: 700; }
.help-close { border: 0; background: transparent; color: #cbb98a; cursor: pointer; font-size: 14px; line-height: 1; }
.help-item { border-top: 1px solid rgba(255, 199, 92, 0.16); }
.help-item-head { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 5px 0; border: 0; background: transparent; color: #e9d9ae; cursor: pointer; font-size: 11px; text-align: left; }
.help-item-head.active { color: #ffe9a8; }
.help-item-head i { font-style: normal; font-size: 13px; }
.help-summary { margin: 0 0 3px; font-size: 10px; color: #d9cdab; line-height: 1.5; }
.help-detail { margin: 0; padding-left: 15px; }
.help-detail li { font-size: 10px; color: #cbbd97; line-height: 1.55; margin-bottom: 2px; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 11; width: max-content; max-width: 440px; padding: 8px 14px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
.report-backdrop { position: absolute; inset: 0; z-index: 90; display: flex; flex-direction: column; background: #fff; color: #16232e; }
.report-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 16px; border-bottom: 1px solid #d5dee5; background: #eef4f8; }
.report-toolbar-title { font-size: 13px; font-weight: 700; color: #17324d; }
.report-actions { display: flex; align-items: center; gap: 8px; }
.report-btn { border: 1px solid #2f80ed; border-radius: 5px; padding: 4px 12px; cursor: pointer; background: #2f80ed; color: #fff; font-size: 12px; }
.report-btn.accent { border-color: #c9971c; background: #c9971c; color: #fff; }
.report-close { border: 0; background: transparent; color: #5b6b7a; cursor: pointer; font-size: 20px; line-height: 1; }
.report-doc { overflow: auto; width: 100%; max-width: 880px; margin: 0 auto; padding: 24px 34px 44px; box-sizing: border-box; }
.report-h1 { margin: 0 0 6px; font-size: 20px; color: #17324d; }
.report-meta { margin: 0 0 6px; font-size: 11px; color: #6a7b8a; }
.report-intro { margin: 0 0 10px; font-size: 12px; line-height: 1.6; color: #3b5061; }
.report-h2 { margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #cfe0ec; font-size: 14px; color: #124c7d; }
.report-caption { padding: 2px 0; font-size: 11px; color: #5b6b7a; text-align: left; }
.report-table { width: 100%; margin: 4px 0 8px; border-collapse: collapse; font-size: 11px; }
.report-table th, .report-table td { padding: 3px 7px; border: 1px solid #c9d6e0; text-align: left; vertical-align: top; }
.report-table th { background: #e8f1f8; color: #17324d; font-weight: 700; }
.report-table td { color: #2a3b4a; }
.report-kv { display: grid; grid-template-columns: 190px 1fr; gap: 2px 10px; margin: 4px 0 6px; font-size: 12px; }
.report-kv dt { color: #3c5a73; font-weight: 600; }
.report-kv dd { margin: 0; color: #1e2f3d; }
.report-line { margin: 3px 0; font-size: 12px; line-height: 1.6; color: #1e2f3d; }
</style>
