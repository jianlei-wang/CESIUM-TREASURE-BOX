<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import * as Cesium from 'cesium'
import { createMapScene, destroyScene, loadBingImagery } from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib/pick'
import { buildDefaultCity, type CityModel } from '../sunshine-lib/city'
import {
  CLIMATE_STANDARDS,
  analyzeGridSunshineAsync,
  analyzePointSunshine,
  buildTimeSteps,
  createSunGrid,
  gridNodeLocal,
  rectRing,
  standardDate,
  type AnalysisParams,
  type PointSunshine,
  type StandardDay,
  type SunGrid,
  type SunTimeStep
} from '../sunshine-lib/analysis'
import { computeSunPosition, formatHours, formatMinutes, type SunContext } from '../sunshine-lib/sun'
import {
  buildFlatContourPrimitive,
  buildGridSurface,
  buildSunPath,
  createGridAppearance,
  createSampleMarker,
  createSunIndicator,
  localToCartesian,
  renderBuildings,
  renderSunPath,
  sunshineGradientCss,
  sunshineRgb,
  sunWorldPosition,
  updateBuildingOpacity
} from '../sunshine-lib/render'
import { computeContours, type SampleGrid } from '../polygon-depth-contour/depth-contour-lib'
import { SUNSHINE_COVERAGE_HELP } from '../sunshine-lib/help'
import {
  exportReportDocx,
  printReport,
  type ReportModel,
  type ReportSection
} from '../sunshine-lib/report'

const STEP_OPTIONS = [1, 5, 10, 15, 30]
const SPACING_OPTIONS = [8, 10, 15, 20, 25, 30]
const SAMPLE_HEIGHT_OPTIONS = [0.9, 1.5, 2.0]
const CONTOUR_INTERVAL_OPTIONS = [0.5, 1, 2]
const RESULT_MODE_OPTIONS = [
  { value: 'height', label: '指定高度结果图' },
  { value: 'grid', label: '区间空间网格' },
  { value: 'points', label: '区间空间点集' }
]

type ResultMode = 'height' | 'grid' | 'points'

type SunshineVolume = {
  grid: SunGrid
  levels: number[]
  hours: Float32Array
  minValue: number
  maxValue: number
}

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const isLoaded = ref(false)
const busy = ref(false)
const progress = ref(0)
const analysisRun = ref(0)
const buildingCount = ref(0)

const city = shallowRef<CityModel | undefined>()
let viewer: Cesium.Viewer | undefined
let handler: Cesium.ScreenSpaceEventHandler | undefined
let buildingEntities: Cesium.Entity[] = []
let sunPathEntities: Cesium.Entity[] = []
let sunIndicator: Cesium.Entity | undefined
let sampleMarker: Cesium.Entity | undefined
let gridValue: SunGrid | undefined
let volumeValue: SunshineVolume | undefined

let slicePrimitive: Cesium.Primitive | undefined
let stackPrimitives: Cesium.Primitive[] = []
let contourPrimitive: Cesium.Primitive | undefined
let pointCollection: Cesium.PointPrimitiveCollection | undefined
let heightDebounce: ReturnType<typeof setTimeout> | undefined

const reportModel = ref<ReportModel | null>(null)
const REPORT_TITLE = '空间分析-日照覆盖分析 · 分析报告'

const form = reactive({
  climateId: 'II',
  standardDay: 'dahan' as StandardDay,
  dateText: '2026-01-20',
  startText: '08:00',
  endText: '16:00',
  stepMinutes: 10,
  spacing: 20,
  sampleHeight: 1.5,
  maxDistance: 1200,
  heightMin: 1.5,
  heightMax: 30,
  currentHeight: 1.5,
  levels: 5
})

const display = reactive({
  resultMode: 'height' as ResultMode,
  showSurface: true,
  surfaceOpacity: 0.85,
  pointSize: 6,
  showContour: true,
  contourInterval: 1,
  contourWidth: 2,
  showBuildings: true,
  buildingOpacity: 1,
  showSunPath: true
})

const pickMode = ref(false)
const hasResult = ref(false)
const gridStats = reactive({
  nx: 0,
  ny: 0,
  min: 0,
  max: 0,
  mean: 0,
  compliantRatio: 0,
  spacing: 0,
  nodes: 0,
  totalHours: 0,
  mode: 'height' as ResultMode,
  heightInfo: '—'
})
const pointResult = ref<PointSunshine | undefined>()
const pointInfo = ref<{ lon: number; lat: number } | undefined>()

const demoMinutes = ref(12 * 60)
const helpOpen = ref(false)
const activeHelpKey = ref<string | undefined>(SUNSHINE_COVERAGE_HELP[0]?.key)

const sunCtx = computed<SunContext>(() => ({
  longitude: city.value?.center.lon ?? 116.4074,
  latitude: city.value?.center.lat ?? 39.9042,
  timezoneOffset: 8
}))

const standardHours = computed(
  () => CLIMATE_STANDARDS.find((item) => item.id === form.climateId)?.standardHours ?? 2
)
const sunshineCss = sunshineGradientCss()
const demoTimeLabel = computed(() => formatMinutes(demoMinutes.value))

const demoSun = computed(() => {
  const position = computeSunPosition(dateAtMinutes(demoMinutes.value), sunCtx.value)
  return position
})

function parseDateText(text: string): Date {
  const [year, month, day] = text.split('-').map((part) => Number(part))
  return new Date(year || 2026, (month || 1) - 1, day || 1)
}

function dateAtMinutes(minutes: number): Date {
  const base = parseDateText(form.dateText)
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0)
}

function timeToMinutes(text: string): number {
  const [hour, minute] = text.split(':').map((part) => Number(part))
  return (hour || 0) * 60 + (minute || 0)
}

function minutesToTime(minutes: number): string {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

function applyClimateStandard(): void {
  const standard = CLIMATE_STANDARDS.find((item) => item.id === form.climateId)
  if (!standard) return
  form.standardDay = standard.standardDay
  form.startText = minutesToTime(standard.startMinutes)
  form.endText = minutesToTime(standard.endMinutes)
  const date = standardDate(new Date().getFullYear(), standard.standardDay)
  form.dateText = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function currentParams(): AnalysisParams {
  return {
    date: parseDateText(form.dateText),
    timezoneOffset: 8,
    startMinutes: timeToMinutes(form.startText),
    endMinutes: timeToMinutes(form.endText),
    stepMinutes: form.stepMinutes,
    maxDistance: form.maxDistance,
    sampleHeight: form.sampleHeight
  }
}

function analysisBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
  const model = city.value
  if (!model) return { minX: -400, maxX: 400, minY: -300, maxY: 300 }
  return {
    minX: -model.widthMeters / 2,
    maxX: model.widthMeters / 2,
    minY: -model.depthMeters / 2,
    maxY: model.depthMeters / 2
  }
}

function sunAtMinutes(minutes: number): { altitude: number; azimuth: number; direction: { east: number; north: number; up: number } } {
  return computeSunPosition(dateAtMinutes(minutes), sunCtx.value)
}

function updateSunIndicator(): void {
  const model = city.value
  if (!model || !sunIndicator?.position) return
  const sun = demoSun.value
  const radius = Math.max(model.widthMeters, model.depthMeters) * 0.62 + 240
  const position = sunWorldPosition(model, sun.direction, radius, 40)
  ;(sunIndicator.position as Cesium.ConstantPositionProperty).setValue(position)
  if (sunIndicator.label) {
    sunIndicator.label.text = new Cesium.ConstantProperty(
      `${formatMinutes(demoMinutes.value)}  高度角 ${sun.altitude.toFixed(1)}°  方位角 ${sun.azimuth.toFixed(1)}°`
    )
  }
}

function rebuildSunPath(): void {
  const model = city.value
  if (!viewer || !model) return
  for (const entity of sunPathEntities) viewer.entities.remove(entity)
  sunPathEntities = []
  const radius = Math.max(model.widthMeters, model.depthMeters) * 0.62 + 240
  const path = buildSunPath(model, { computeAt: (minutes) => sunAtMinutes(minutes) }, radius, 40)
  sunPathEntities = renderSunPath(viewer, path)
}

function analysisHeight(): number {
  const min = Math.min(form.heightMin, form.heightMax)
  const max = Math.max(form.heightMin, form.heightMax)
  return Math.min(max, Math.max(min, form.currentHeight))
}

function analysisLevels(): number[] {
  const min = Math.min(form.heightMin, form.heightMax)
  const max = Math.max(form.heightMin, form.heightMax)
  const count = Math.max(2, Math.round(form.levels))
  const levels: number[] = []
  for (let index = 0; index < count; index += 1) {
    levels.push(min + ((max - min) * index) / (count - 1))
  }
  return levels
}

/** 移除全部分析结果图元（仅销毁点集，普通 Primitive 交由移除处理，避免重复 destroy） */
function removeVisuals(): void {
  if (!viewer) return
  if (slicePrimitive) {
    viewer.scene.primitives.remove(slicePrimitive)
    slicePrimitive = undefined
  }
  for (const primitive of stackPrimitives) viewer.scene.primitives.remove(primitive)
  stackPrimitives = []
  if (contourPrimitive) {
    viewer.scene.primitives.remove(contourPrimitive)
    contourPrimitive = undefined
  }
  if (pointCollection) {
    viewer.scene.primitives.remove(pointCollection)
    if (!pointCollection.isDestroyed()) pointCollection.destroy()
    pointCollection = undefined
  }
}

/** 指定高度结果图：在该高度平面按日照时数着色的色斑面 */
function addSlice(): void {
  const model = city.value
  if (!viewer || !model || !gridValue) return
  if (slicePrimitive) {
    viewer.scene.primitives.remove(slicePrimitive)
    slicePrimitive = undefined
  }
  const height = analysisHeight()
  const geometry = buildGridSurface(
    model,
    gridValue,
    display.surfaceOpacity,
    height,
    gridValue.minValue,
    Math.max(gridValue.maxValue, gridValue.minValue + 0.001),
    sunshineRgb
  )
  const primitive = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({ geometry }),
    appearance: createGridAppearance(),
    asynchronous: false,
    allowPicking: false
  })
  primitive.show = display.showSurface
  viewer.scene.primitives.add(primitive)
  slicePrimitive = primitive
}

/** 区间空间网格结果：沿高度区间离散出多层，逐层生成日照色斑面并叠加 */
function addGridStack(): void {
  const model = city.value
  if (!viewer || !model || !volumeValue) return
  const { grid, levels, hours, minValue, maxValue } = volumeValue
  const cellCount = grid.nx * grid.ny
  const rangeMax = Math.max(maxValue, minValue + 0.001)
  for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
    const sliceGrid: SunGrid = {
      ...grid,
      heights: hours.subarray(levelIndex * cellCount, (levelIndex + 1) * cellCount),
      minValue,
      maxValue
    }
    const geometry = buildGridSurface(model, sliceGrid, display.surfaceOpacity, levels[levelIndex], minValue, rangeMax, sunshineRgb)
    const primitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry }),
      appearance: createGridAppearance(),
      asynchronous: false,
      allowPicking: false
    })
    primitive.show = display.showSurface
    viewer.scene.primitives.add(primitive)
    stackPrimitives.push(primitive)
  }
}

/** 区间空间点集结果：沿高度区间离散出多层，各层网格节点以三维点云着色 */
function addPoints(): void {
  const model = city.value
  if (!viewer || !model || !volumeValue) return
  if (pointCollection) {
    viewer.scene.primitives.remove(pointCollection)
    if (!pointCollection.isDestroyed()) pointCollection.destroy()
    pointCollection = undefined
  }
  const { grid, levels, hours, minValue, maxValue } = volumeValue
  const cellCount = grid.nx * grid.ny
  const range = Math.max(1e-6, maxValue - minValue)
  const collection = new Cesium.PointPrimitiveCollection()
  for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
    const height = levels[levelIndex]
    const offset = levelIndex * cellCount
    for (let row = 0; row < grid.ny; row += 1) {
      for (let col = 0; col < grid.nx; col += 1) {
        const value = hours[offset + row * grid.nx + col]
        const [r, g, b] = sunshineRgb((value - minValue) / range)
        const node = gridNodeLocal(grid, row, col)
        collection.add({
          position: localToCartesian(model, node.x, node.y, height),
          pixelSize: display.pointSize,
          color: Cesium.Color.fromBytes(r, g, b, 235),
          outlineColor: Cesium.Color.fromBytes(10, 20, 35, 130),
          outlineWidth: 1
        })
      }
    }
  }
  collection.show = display.showSurface
  viewer.scene.primitives.add(collection)
  pointCollection = collection
}

function renderCurrentResult(): void {
  if (!hasResult.value) return
  removeVisuals()
  if (display.resultMode === 'height') {
    addSlice()
    addContour()
  } else if (display.resultMode === 'grid') {
    addGridStack()
  } else {
    addPoints()
  }
}

function updatePointSize(): void {
  if (!pointCollection || pointCollection.isDestroyed()) return
  for (let index = 0; index < pointCollection.length; index += 1) {
    const point = pointCollection.get(index)
    if (point) point.pixelSize = display.pointSize
  }
}

function addContour(): void {
  const model = city.value
  if (!viewer || !model || !gridValue) return
  if (contourPrimitive) {
    viewer.scene.primitives.remove(contourPrimitive)
    contourPrimitive = undefined
  }
  const ring = rectRing(model.west, model.south, model.east, model.north)
  const interval = display.contourInterval
  const sampleGrid: SampleGrid = {
    nx: gridValue.nx,
    ny: gridValue.ny,
    west: gridValue.west,
    north: gridValue.north,
    cellLon: gridValue.cellLon,
    cellLat: gridValue.cellLat,
    heights: gridValue.heights,
    minInside: gridValue.minValue,
    maxInside: gridValue.maxValue,
    insideCount: gridValue.insideCount
  }
  const minValue = gridValue.minValue
  const maxValue = Math.max(gridValue.maxValue, gridValue.minValue + 0.001)
  const result = computeContours(sampleGrid, ring, interval, minValue, maxValue)
  const primitive = buildFlatContourPrimitive(
    result,
    minValue,
    maxValue,
    0.95,
    display.contourWidth,
    analysisHeight()
  )
  primitive.show = display.showContour
  viewer.scene.primitives.add(primitive)
  contourPrimitive = primitive
}

function scheduleHeightRerun(): void {
  if (heightDebounce) clearTimeout(heightDebounce)
  heightDebounce = setTimeout(() => {
    if (display.resultMode === 'height' && hasResult.value) void runAnalysis()
  }, 260)
}

async function runAnalysis(): Promise<void> {
  const model = city.value
  if (!model || busy.value) return
  busy.value = true
  progress.value = 0
  const run = ++analysisRun.value
  const mode = display.resultMode
  statusMessage.value = '正在计算区域日照覆盖…'
  try {
    const params = currentParams()
    const steps: SunTimeStep[] = buildTimeSteps(sunCtx.value, params)
    if (steps.length === 0) {
      statusMessage.value = '所选日期在该时间带内太阳始终位于地平线以下，请调整参数'
      return
    }
    const grid = createSunGrid(model, { spacing: form.spacing, ...analysisBounds() })
    gridStats.nx = grid.nx
    gridStats.ny = grid.ny
    gridStats.spacing = form.spacing
    gridStats.totalHours = (steps.length * params.stepMinutes) / 60
    if (mode === 'height') {
      const height = analysisHeight()
      await analyzeGridSunshineAsync(model, grid, steps, { ...params, sampleHeight: height }, (ratio) => {
        if (run === analysisRun.value) progress.value = Math.round(ratio * 100)
      })
      if (run !== analysisRun.value) return
      gridValue = grid
      volumeValue = undefined
      gridStats.mode = 'height'
      updateStats(grid.heights, grid.minValue, grid.maxValue)
      gridStats.heightInfo = `${height.toFixed(1)} m（指定高度结果图）`
    } else {
      const levels = analysisLevels()
      const cellCount = grid.nx * grid.ny
      const hours = new Float32Array(cellCount * levels.length)
      let minValue = Number.POSITIVE_INFINITY
      let maxValue = Number.NEGATIVE_INFINITY
      for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
        await analyzeGridSunshineAsync(model, grid, steps, { ...params, sampleHeight: levels[levelIndex] }, (ratio) => {
          if (run === analysisRun.value) {
            progress.value = Math.round(((levelIndex + ratio) / levels.length) * 100)
          }
        })
        if (run !== analysisRun.value) return
        hours.set(grid.heights, levelIndex * cellCount)
        if (grid.minValue < minValue) minValue = grid.minValue
        if (grid.maxValue > maxValue) maxValue = grid.maxValue
      }
      const volume: SunshineVolume = {
        grid,
        levels,
        hours,
        minValue: Number.isFinite(minValue) ? minValue : 0,
        maxValue: Number.isFinite(maxValue) ? maxValue : 0
      }
      volumeValue = volume
      gridValue = undefined
      gridStats.mode = mode
      updateStats(hours, volume.minValue, volume.maxValue)
      gridStats.heightInfo = `${levels[0].toFixed(0)}–${levels[levels.length - 1].toFixed(0)} m · ${levels.length} 层`
    }
    hasResult.value = true
    renderCurrentResult()
    statusMessage.value = ''
  } finally {
    if (run === analysisRun.value) {
      busy.value = false
      progress.value = 100
    }
  }
}

function updateStats(values: Float32Array, minValue: number, maxValue: number): void {
  let sum = 0
  let compliant = 0
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    sum += value
    if (value >= standardHours.value) compliant += 1
  }
  const count = values.length || 1
  gridStats.min = Math.round(minValue * 100) / 100
  gridStats.max = Math.round(maxValue * 100) / 100
  gridStats.mean = Math.round((sum / count) * 100) / 100
  gridStats.compliantRatio = Math.round((compliant / count) * 1000) / 10
  gridStats.nodes = values.length
}

function clearAnalysis(): void {
  analysisRun.value += 1
  removeVisuals()
  gridValue = undefined
  volumeValue = undefined
  hasResult.value = false
  gridStats.nx = 0
  gridStats.ny = 0
  gridStats.min = 0
  gridStats.max = 0
  gridStats.mean = 0
  gridStats.compliantRatio = 0
  gridStats.nodes = 0
  gridStats.totalHours = 0
  gridStats.heightInfo = '—'
}

function startPick(): void {
  pickMode.value = !pickMode.value
  if (pickMode.value) statusMessage.value = '单击地面选取分析点（再次点击按钮退出）'
  else statusMessage.value = ''
}

function onLeftClick(event: { position?: Cesium.Cartesian2 }): void {
  if (!pickMode.value || !viewer || !city.value || !event.position) return
  const position = pickPosition(viewer.scene, event.position)
  if (!position) return
  const carto = Cesium.Cartographic.fromCartesian(position, viewer.scene.globe.ellipsoid)
  const lon = Cesium.Math.toDegrees(carto.longitude)
  const lat = Cesium.Math.toDegrees(carto.latitude)
  const model = city.value
  const x = (lon - model.center.lon) * model.metersPerDegLon
  const y = (lat - model.center.lat) * model.metersPerDegLat
  const params = currentParams()
  const steps = buildTimeSteps(sunCtx.value, params)
  const result = analyzePointSunshine(model, x, y, steps, params)
  pointResult.value = result
  pointInfo.value = { lon, lat }
  const standard = standardHours.value
  const color =
    result.hours >= standard
      ? Cesium.Color.fromCssColorString('#22c55e')
      : result.hours >= standard * 0.7
        ? Cesium.Color.fromCssColorString('#facc15')
        : Cesium.Color.fromCssColorString('#ef4444')
  if (sampleMarker) viewer.entities.remove(sampleMarker)
  const ground = Cesium.Cartesian3.fromDegrees(lon, lat, params.sampleHeight + 1)
  sampleMarker = createSampleMarker(viewer, ground, color, `${result.hours.toFixed(2)} h`)
  pickMode.value = false
  statusMessage.value = ''
}

function onClimateChange(): void {
  applyClimateStandard()
  rebuildSunPath()
  updateSunIndicator()
}

function onDateChange(): void {
  rebuildSunPath()
  updateSunIndicator()
}

function toggleHelp(key: string): void {
  activeHelpKey.value = activeHelpKey.value === key ? undefined : key
}

function setSunPathVisible(visible: boolean): void {
  for (const entity of sunPathEntities) entity.show = visible
}

// ---------------------------------------------------------------------------
// 分析报告输出（PDF 打印 / Word 下载）
// ---------------------------------------------------------------------------

function standardDayLabel(value: StandardDay): string {
  if (value === 'dongzhi') return '冬至日'
  if (value === 'dahan') return '大寒日'
  return '自定义'
}

function climateLabel(): string {
  return CLIMATE_STANDARDS.find((item) => item.id === form.climateId)?.label ?? form.climateId
}

function resultModeLabel(value: ResultMode): string {
  return RESULT_MODE_OPTIONS.find((item) => item.value === value)?.label ?? value
}

function collectReport(): ReportModel {
  const model = city.value
  const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false })
  const sections: ReportSection[] = []
  sections.push({
    title: '一、案例与场景',
    kv: [
      { label: '案例名称', value: '空间分析-日照覆盖分析' },
      { label: '场景中心', value: model ? `${model.center.lon.toFixed(5)}, ${model.center.lat.toFixed(5)}` : '—' },
      { label: '建筑数量', value: `${buildingCount.value} 栋` },
      { label: '场景尺寸', value: model ? `${model.widthMeters.toFixed(0)} × ${model.depthMeters.toFixed(0)} m` : '—' }
    ]
  })
  sections.push({
    title: '二、分析参数',
    kv: [
      { label: '建筑气候区', value: climateLabel() },
      { label: '标准日', value: standardDayLabel(form.standardDay) },
      { label: '分析日期', value: form.dateText },
      { label: '有效日照时间带', value: `${form.startText} — ${form.endText}` },
      { label: '时间步长', value: `${form.stepMinutes} 分钟` },
      { label: '网格间距', value: `${form.spacing} m` },
      { label: '单点采样高度', value: `${form.sampleHeight.toFixed(1)} m` },
      { label: '最大遮挡距离', value: `${form.maxDistance} m` },
      { label: '采样分析高度区间', value: `${Math.min(form.heightMin, form.heightMax)} — ${Math.max(form.heightMin, form.heightMax)} m` },
      { label: '日照标准', value: `≥ ${standardHours.value} h` }
    ]
  })
  if (hasResult.value) {
    sections.push({
      title: '三、区域日照统计',
      kv: [
        { label: '结果形式', value: resultModeLabel(gridStats.mode) },
        { label: '高度信息', value: gridStats.heightInfo },
        { label: '网格规模', value: `${gridStats.nx} × ${gridStats.ny}（${gridStats.spacing} m）` },
        { label: '平均日照时数', value: `${gridStats.mean} h` },
        { label: '最大日照时数', value: `${gridStats.max} h` },
        { label: '最小日照时数', value: `${gridStats.min} h` },
        { label: '达标率', value: `${gridStats.compliantRatio}%` },
        { label: '分析点位', value: `${gridStats.nodes} 个` },
        { label: '有效时段时长', value: `${gridStats.totalHours.toFixed(2)} h` }
      ]
    })
  } else {
    sections.push({
      title: '三、区域日照统计',
      lines: ['尚未执行区域日照分析，未生成统计结果。可在左侧面板设置标准日、时间带与网格参数后点击「开始分析」。']
    })
  }
  if (pointResult.value && pointInfo.value) {
    const point = pointResult.value
    sections.push({
      title: '四、单点日照分析',
      table: {
        caption: `采样点坐标 ${pointInfo.value.lon.toFixed(5)}, ${pointInfo.value.lat.toFixed(5)}（采样高度 ${form.sampleHeight.toFixed(1)} m）`,
        head: ['指标', '数值'],
        body: [
          ['累计日照', `${point.hours.toFixed(2)} h`],
          ['是否达标', point.hours >= standardHours.value ? '是' : '否'],
          ['首次日照', point.first !== null ? formatMinutes(point.first) : '—'],
          ['末次日照', point.last !== null ? formatMinutes(point.last) : '—'],
          ['连续日照时段', `${point.segments.length} 段`]
        ]
      }
    })
  }
  return {
    generatedAt,
    intro:
      '本报告由「空间分析-日照覆盖分析」案例生成，汇总当前气候区、标准日、时间带与网格参数配置，以及区域日照统计与单点日照分析结果。日照时数指在有效时间带内采样点未被建筑遮挡的累计时长，达标判定依据所选气候区的日照标准。',
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
    filenamePrefix: 'sunshine-coverage-report',
    onStatus: (message) => (statusMessage.value = message)
  })
}

async function onExportReportDocx(): Promise<void> {
  if (!reportModel.value) return
  await exportReportDocx(reportModel.value, {
    docTitle: REPORT_TITLE,
    filenamePrefix: 'sunshine-coverage-report',
    creator: '空间分析-日照覆盖分析',
    onStatus: (message) => (statusMessage.value = message)
  })
}

watch(
  () => display.showBuildings,
  (value) => {
    for (const entity of buildingEntities) entity.show = value
  }
)

watch(
  () => display.buildingOpacity,
  (value) => {
    if (city.value) updateBuildingOpacity(buildingEntities, city.value, value)
  }
)

watch(
  () => display.showSunPath,
  (value) => setSunPathVisible(value)
)

watch(
  () => display.showSurface,
  (value) => {
    if (slicePrimitive) slicePrimitive.show = value
    for (const primitive of stackPrimitives) primitive.show = value
    if (pointCollection) pointCollection.show = value
    if (contourPrimitive) contourPrimitive.show = value && display.showContour
  }
)

watch(
  () => display.showContour,
  (value) => {
    if (contourPrimitive) contourPrimitive.show = value
  }
)

watch(
  () => display.surfaceOpacity,
  () => {
    if (hasResult.value && (display.resultMode === 'height' || display.resultMode === 'grid')) renderCurrentResult()
  }
)

watch(
  () => display.contourWidth,
  () => {
    if (hasResult.value && display.resultMode === 'height') addContour()
  }
)

watch(
  () => display.contourInterval,
  () => {
    if (hasResult.value && display.resultMode === 'height') addContour()
  }
)

watch(
  () => display.resultMode,
  () => renderCurrentResult()
)

watch(
  () => display.pointSize,
  () => updatePointSize()
)

watch(
  () => form.currentHeight,
  () => scheduleHeightRerun()
)

watch([() => form.heightMin, () => form.heightMax], () => {
  form.currentHeight = analysisHeight()
})

watch(demoMinutes, () => updateSunIndicator())

onMounted(() => {
  if (!container.value) return
  const model = buildDefaultCity()
  city.value = model
  buildingCount.value = model.buildings.length

  const created = createMapScene(container.value)
  viewer = created
  loadBingImagery(created, { onStatus: (message) => (statusMessage.value = message) })

  buildingEntities = renderBuildings(created, model, display.buildingOpacity)
  rebuildSunPath()
  sunIndicator = createSunIndicator(created)
  updateSunIndicator()

  created.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(model.center.lon, model.center.lat, 1500),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-38),
      roll: 0
    },
    duration: 0
  })

  handler = new Cesium.ScreenSpaceEventHandler(created.scene.canvas)
  handler.setInputAction((event: { position?: Cesium.Cartesian2 }) => onLeftClick(event), Cesium.ScreenSpaceEventType.LEFT_CLICK)

  isLoaded.value = true
  applyClimateStandard()
  window.setTimeout(() => {
    if (viewer) void runAnalysis()
  }, 500)
})

onBeforeUnmount(() => {
  analysisRun.value += 1
  if (heightDebounce) clearTimeout(heightDebounce)
  if (viewer && handler) {
    handler.destroy()
    handler = undefined
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="sc-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">空间分析-日照覆盖分析</div>

      <div class="section-title">分析设置</div>
      <div class="control-row">
        <span class="row-label">气候区</span>
        <select v-model="form.climateId" :disabled="busy" @change="onClimateChange">
          <option v-for="item in CLIMATE_STANDARDS" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">标准日</span>
        <select v-model="form.standardDay" :disabled="busy" @change="onDateChange">
          <option value="dahan">大寒日</option>
          <option value="dongzhi">冬至日</option>
          <option value="custom">自定义</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">分析日期</span>
        <input v-model="form.dateText" type="date" :disabled="busy" @change="onDateChange" />
      </div>
      <div class="control-row">
        <span class="row-label">起始时刻</span>
        <input v-model="form.startText" type="time" :disabled="busy" />
      </div>
      <div class="control-row">
        <span class="row-label">结束时刻</span>
        <input v-model="form.endText" type="time" :disabled="busy" />
      </div>
      <div class="control-row">
        <span class="row-label">时间步长</span>
        <select v-model.number="form.stepMinutes" :disabled="busy">
          <option v-for="item in STEP_OPTIONS" :key="item" :value="item">{{ item }} 分钟</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">网格间距</span>
        <select v-model.number="form.spacing" :disabled="busy">
          <option v-for="item in SPACING_OPTIONS" :key="item" :value="item">{{ item }} 米</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">单点采样高度</span>
        <select v-model.number="form.sampleHeight" :disabled="busy">
          <option v-for="item in SAMPLE_HEIGHT_OPTIONS" :key="item" :value="item">{{ item.toFixed(1) }} 米</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">遮挡距离</span>
        <input v-model.number="form.maxDistance" type="number" min="300" max="3000" step="50" :disabled="busy" />
      </div>

      <div class="row-note">采样分析高度区间</div>
      <div class="control-row">
        <span class="row-label">起始高度</span>
        <input v-model.number="form.heightMin" type="range" min="1" max="120" step="1" />
        <span class="row-value">{{ form.heightMin }}m</span>
      </div>
      <div class="control-row">
        <span class="row-label">结束高度</span>
        <input v-model.number="form.heightMax" type="range" min="1" max="120" step="1" />
        <span class="row-value">{{ form.heightMax }}m</span>
      </div>
      <div class="control-row" v-if="display.resultMode === 'height'">
        <span class="row-label">采样高度</span>
        <input
          v-model.number="form.currentHeight"
          type="range"
          :min="Math.min(form.heightMin, form.heightMax)"
          :max="Math.max(form.heightMin, form.heightMax)"
          step="1"
        />
        <span class="row-value">{{ analysisHeight().toFixed(0) }}m</span>
      </div>
      <div class="control-row" v-else>
        <span class="row-label">高度层数</span>
        <input v-model.number="form.levels" type="range" min="2" max="8" step="1" />
        <span class="row-value">{{ form.levels }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">结果形式</span>
        <select v-model="display.resultMode">
          <option v-for="item in RESULT_MODE_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>
      <div class="row-note">标准：{{ form.standardDay === 'dongzhi' ? '冬至日' : form.standardDay === 'dahan' ? '大寒日' : '自定义' }} ≥ {{ standardHours }} h</div>

      <div class="button-row">
        <button class="action-button primary" :disabled="!isLoaded || busy" @click="runAnalysis">开始分析</button>
        <button class="action-button danger" :disabled="busy || !hasResult" @click="clearAnalysis">清除</button>
      </div>

      <div class="section-title">显示设置</div>
      <template v-if="hasResult && display.resultMode === 'height'">
        <label class="switch-row"><span>日照等值线</span><input v-model="display.showContour" type="checkbox" /></label>
        <div class="control-row">
          <span class="row-label">等值间距</span>
          <select v-model.number="display.contourInterval">
            <option v-for="item in CONTOUR_INTERVAL_OPTIONS" :key="item" :value="item">{{ item }} h</option>
          </select>
        </div>
        <div class="control-row">
          <span class="row-label">线宽</span>
          <input v-model.number="display.contourWidth" type="range" min="1" max="5" step="1" />
          <span class="row-value">{{ display.contourWidth }}px</span>
        </div>
      </template>
      <label class="switch-row"><span>建筑白模</span><input v-model="display.showBuildings" type="checkbox" /></label>
      <div class="control-row">
        <span class="row-label">建筑透明度</span>
        <input v-model.number="display.buildingOpacity" type="range" min="0.25" max="1" step="0.05" />
        <span class="row-value">{{ display.buildingOpacity.toFixed(2) }}</span>
      </div>
      <label class="switch-row"><span>太阳轨迹</span><input v-model="display.showSunPath" type="checkbox" /></label>

      <div class="section-title">查看时刻</div>
      <div class="control-row">
        <span class="row-label">时刻</span>
        <input v-model.number="demoMinutes" type="range" min="0" max="1439" step="5" />
        <span class="row-value">{{ demoTimeLabel }}</span>
      </div>
      <div class="row-note">高度角 {{ demoSun.altitude.toFixed(1) }}° · 方位角 {{ demoSun.azimuth.toFixed(1) }}</div>

      <div class="section-title">单点分析</div>
      <div class="button-row">
        <button class="action-button accent" :disabled="!isLoaded || busy" @click="startPick">
          {{ pickMode ? '拾取中…' : '拾取分析点' }}
        </button>
      </div>
      <div v-if="pointResult && pointInfo" class="point-card">
        <p class="stat-line">坐标：{{ pointInfo.lon.toFixed(5) }}, {{ pointInfo.lat.toFixed(5) }}</p>
        <p class="stat-line">日照：{{ formatHours(pointResult.hours) }} / 标准 {{ standardHours }} h</p>
        <p class="stat-line">
          达标：
          <b :class="pointResult.hours >= standardHours ? 'ok' : 'bad'">
            {{ pointResult.hours >= standardHours ? '是' : '否' }}
          </b>
        </p>
        <p class="stat-line">首次/末次：{{ pointResult.first !== null ? formatMinutes(pointResult.first) : '—' }} / {{ pointResult.last !== null ? formatMinutes(pointResult.last) : '—' }}</p>
        <p class="stat-line">连续时段：{{ pointResult.segments.length }} 段</p>
      </div>

      <div v-if="hasResult" class="section-title">区域统计</div>
      <div v-if="hasResult" class="stat-grid">
        <div class="stat-cell"><span>平均日照</span><b>{{ gridStats.mean }}h</b></div>
        <div class="stat-cell"><span>最大日照</span><b>{{ gridStats.max }}h</b></div>
        <div class="stat-cell"><span>最小日照</span><b>{{ gridStats.min }}h</b></div>
        <div class="stat-cell"><span>达标率</span><b class="ok">{{ gridStats.compliantRatio }}%</b></div>
        <div class="stat-cell"><span>网格</span><b>{{ gridStats.nx }}×{{ gridStats.ny }}</b></div>
        <div class="stat-cell"><span>间距</span><b>{{ gridStats.spacing }}m</b></div>
      </div>
      <div v-if="hasResult" class="row-note">高度信息 {{ gridStats.heightInfo }} · 日照区间 {{ gridStats.min }} ~ {{ gridStats.max }} h · 标准 ≥ {{ standardHours }} h</div>

      <div v-if="hasResult" class="section-title">结果显示</div>
      <label v-if="hasResult" class="switch-row"><span>显示分析结果</span><input v-model="display.showSurface" type="checkbox" /></label>
      <div v-if="hasResult && display.resultMode !== 'points'" class="control-row">
        <span class="row-label">色斑透明度</span>
        <input v-model.number="display.surfaceOpacity" type="range" min="0.2" max="1" step="0.05" />
        <span class="row-value">{{ display.surfaceOpacity.toFixed(2) }}</span>
      </div>
      <div v-if="hasResult && display.resultMode === 'points'" class="control-row">
        <span class="row-label">点大小</span>
        <input v-model.number="display.pointSize" type="range" min="2" max="14" step="1" />
        <span class="row-value">{{ display.pointSize }}px</span>
      </div>
      <div v-if="hasResult" class="legend-inline">
        <div class="legend-bar" :style="{ background: sunshineCss }"></div>
        <div class="legend-labels"><span>0h</span><span>{{ gridStats.max }}h</span></div>
      </div>

      <div v-if="hasResult" class="section-title">分析报告</div>
      <div v-if="hasResult" class="button-row">
        <button class="action-button accent" @click="openReportPreview">生成分析报告</button>
      </div>

      <button class="help-toggle" @click="helpOpen = !helpOpen">功能实现说明</button>
      <div v-if="helpOpen" class="help-panel">
        <div class="help-head">
          <span>功能实现说明</span>
          <button class="help-close" @click="helpOpen = false">×</button>
        </div>
        <div v-for="item in SUNSHINE_COVERAGE_HELP" :key="item.key" class="help-item">
          <button class="help-item-head" :class="{ active: activeHelpKey === item.key }" @click="toggleHelp(item.key)">
            <span>{{ item.title }}</span><i>{{ activeHelpKey === item.key ? '−' : '+' }}</i>
          </button>
          <p v-if="activeHelpKey === item.key" class="help-summary">{{ item.summary }}</p>
          <ul v-if="activeHelpKey === item.key" class="help-detail">
            <li v-for="(line, index) in item.detail" :key="index">{{ line }}</li>
          </ul>
        </div>
      </div>

      <p class="hint">规划街区参数化白模 + 逐点光线投射，累计有效日照时数并生成色斑与等值线；建筑数量 {{ buildingCount }} 栋。</p>
    </div>

    <div v-if="busy" class="progress-mask">
      <div class="progress-bar"><i :style="{ width: `${progress}%` }"></i></div>
      <span>日照分析中 {{ progress }}%</span>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>

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
.sc-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #0f2438; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 5px; width: 274px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 26, 44, 0.9); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.panel-title { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
.section-title { margin-top: 7px; margin-bottom: 2px; padding-bottom: 2px; border-bottom: 1px solid rgba(137, 210, 233, 0.16); font-size: 11px; font-weight: 700; color: #7fd0e6; }
.button-row { display: flex; gap: 6px; }
.action-button { flex: 1; min-height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; color: #edfaff; }
.action-button.primary { background: #257f9e; }
.action-button.accent { background: #8a6d1a; color: #fff3d6; }
.action-button.danger { background: #4a5a72; color: #ffd6d6; }
.action-button:disabled { cursor: default; opacity: 0.5; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 0; color: #c3d8e6; }
.row-label { flex: 0 0 auto; }
.row-value { flex: 0 0 48px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.row-note { font-size: 10px; color: #7fd0e6; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row select, .control-row input[type="number"], .control-row input[type="date"], .control-row input[type="time"] { width: 120px; height: 22px; padding: 0 5px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.switch-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; color: #c3d8e6; }
.switch-row input { cursor: pointer; }
.stat-line { margin: 0; font-size: 10px; color: #9fb8d4; line-height: 1.7; }
.stat-line .ok { color: #4ade80; }
.stat-line .bad { color: #f87171; }
.point-card { margin-top: 3px; padding: 6px; border: 1px solid rgba(137, 210, 233, 0.2); border-radius: 6px; background: rgba(21, 48, 78, 0.4); }
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
.progress-mask { position: absolute; top: 12px; left: 50%; z-index: 11; display: flex; flex-direction: column; align-items: center; gap: 6px; transform: translateX(-50%); padding: 10px 16px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; background: rgba(8, 21, 40, 0.9); color: #e8f4fa; font-size: 12px; pointer-events: none; min-width: 220px; }
.progress-bar { position: relative; width: 100%; height: 8px; overflow: hidden; border-radius: 4px; background: rgba(137, 210, 233, 0.2); }
.progress-bar i { position: absolute; top: 0; bottom: 0; left: 0; background: #2f80ed; }
.legend { position: absolute; bottom: 14px; left: 12px; z-index: 8; display: flex; align-items: center; gap: 8px; padding: 6px 9px; border: 1px solid rgba(137, 210, 233, 0.25); border-radius: 6px; background: rgba(8, 26, 44, 0.82); color: #bcd7e4; font-size: 10px; }
.legend-gradient { width: 130px; height: 8px; border-radius: 4px; }
.legend-sep { padding-left: 8px; border-left: 1px solid rgba(137, 210, 233, 0.22); }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 11; width: max-content; max-width: 440px; padding: 8px 14px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 4px; }
.stat-cell { display: flex; flex-direction: column; gap: 2px; padding: 5px 4px; border: 1px solid rgba(137, 210, 233, 0.2); border-radius: 5px; background: rgba(16, 43, 64, 0.55); text-align: center; }
.stat-cell span { font-size: 9px; color: #8fb0c8; }
.stat-cell b { font-size: 12px; color: #d9eff6; }
.stat-cell b.ok { color: #4ade80; }
.legend-inline { margin-top: 5px; }
.legend-bar { height: 10px; border-radius: 3px; border: 1px solid rgba(137, 210, 233, 0.25); }
.legend-labels { display: flex; justify-content: space-between; margin-top: 2px; font-size: 9px; color: #8fb0c8; }
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
