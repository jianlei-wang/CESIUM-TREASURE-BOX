<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import * as Cesium from 'cesium'
import { createMapScene, destroyScene, loadBingImagery } from '../../lib/cesium-scene'
import { localToLonLat } from '../sunshine-lib/city'
import {
  autoStability,
  buildTimeSteps,
  computeField,
  computeFieldAsync,
  computeVerticalSectionAsync,
  computeVolumeAsync,
  pointOnPolyline,
  STABILITY_LABEL,
  STAGE_FACTOR,
  stageSequence,
  type DustSource,
  type FieldComputeInput,
  type FieldResult,
  type GridSpec,
  type Measures,
  type SectionResult,
  type SensitiveResult,
  type StabilityClass,
  type VolumeResult
} from './dust-model'
import { createDustScene, type SiteModel } from './dust-scene'
import {
  ConcentrationOverlay,
  dustGradientCss,
  fieldToCanvas,
  renderParticleField,
  renderSensitivePoints,
  renderSiteBoundary,
  renderSources,
  renderVerticalSection,
  renderVolume,
  renderWindArrow,
  updateFenceHeight,
  windSpeedColor,
  type ParticleFieldHandles,
  type SectionRenderHandles,
  type SensitiveRenderHandles,
  type SiteRenderHandles,
  type SourceRenderHandles,
  type VolumeRenderHandles,
  type WindArrowHandles
} from './dust-render'
import { DUST_DISPERSION_HELP } from './help'
import {
  createReportPdfUrl,
  exportReportDocx,
  exportReportPdf,
  type ReportModel,
  type ReportSection
} from './dust-report'

const HOURS = [6, 8, 10, 12, 14, 16, 18, 20]
const RES_OPTIONS = [64, 96, 128]
const STABILITY_OPTIONS: StabilityClass[] = ['A', 'B', 'C', 'D', 'E', 'F']
const SPEED_OPTIONS = [
  { value: 1200, label: '慢' },
  { value: 800, label: '中' },
  { value: 400, label: '快' }
]
const SOLAR_OPTIONS = [
  { value: 'strong', label: '强' },
  { value: 'moderate', label: '中' },
  { value: 'slight', label: '弱' }
] as const
const SOURCE_TYPE_LABEL: Record<string, string> = { point: '点源', line: '线源', area: '面源', mobile: '移动源' }
const SENSITIVE_TYPE_LABEL: Record<string, string> = { school: '学校', hospital: '医院', residential: '居民区', park: '公园', other: '其他' }
const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
const REPORT_TITLE = '施工扬尘扩散模拟 · 分析报告'

function dirLabel(deg: number): string {
  return `${DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]}风`
}

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const isLoaded = ref(false)
const scene = shallowRef<SiteModel | undefined>()

let viewer: Cesium.Viewer | undefined
let overlay: ConcentrationOverlay | undefined
let sourceHandles: SourceRenderHandles | undefined
let sensitiveHandles: SensitiveRenderHandles | undefined
let boundaryHandles: SiteRenderHandles | undefined
let windHandles: WindArrowHandles | undefined
let sectionHandles: SectionRenderHandles | undefined
let volumeHandles: VolumeRenderHandles | undefined
let particleHandles: ParticleFieldHandles | undefined
let clickHandler: Cesium.ScreenSpaceEventHandler | undefined
let runSeq = 0

const weatherForm = reactive({
  windSpeed: 2.6,
  windDirection: 45,
  stabilityMode: 'auto' as 'auto' | 'manual',
  stability: 'D' as StabilityClass,
  temperature: 22,
  humidity: 55,
  solar: 'moderate' as 'strong' | 'moderate' | 'slight',
  cloudCover: 0.4,
  isDay: true,
  varyWeather: true
})

const form = reactive({
  resolution: 96,
  sliceHeight: 1.5,
  gridPad: 700,
  cityFactor: 1.15
})

const display = reactive({
  showOverlay: true,
  showSection: false,
  showVolume: false,
  showParticles: false,
  showSources: true,
  showSensitive: true,
  showFence: true
})

const render = reactive({
  sectionLayers: 24,
  sectionHeight: 60,
  sectionOffsetAlong: 0,
  sectionOffsetCross: 0,
  volumeResolution: 64,
  volumeLayers: 12,
  volumeHeight: 60,
  overlayOpacity: 0.9,
  sectionOpacity: 0.85,
  volumeOpacity: 0.6,
  particleOpacity: 0.6,
  particleCount: 260
})

const TIPS: Record<string, string> = {
  windSpeed: '距地面 10 m 处的平均风速。风速越大，烟羽被拉伸得越细长，近地面浓度越低。',
  windDirection: '风的来向（气象方位角，0° 为北风）。烟羽沿下风向传播，是浓度场形态的主导因素。',
  stabilityMode: '自动判定：按风速、日照与云量推算 Pasquill 稳定度；手动指定：直接选择 A~F 级别。',
  stability: '大气稳定度级别：A 极不稳定、B 不稳定、C 弱不稳定、D 中性、E 弱稳定、F 稳定。越不稳定垂直扩散越强，近地面浓度越低。',
  solar: '太阳辐射强度等级，用于自动判定稳定度。日照越强，对流越旺盛，大气越不稳定。',
  cloudCover: '云量比例，用于自动判定稳定度。云量越少，夜间辐射降温越强，大气越稳定。',
  isDay: '区分白天/夜间，参与稳定度自动判定。',
  temperature: '环境气温（℃），用于描述气象条件与抬升高度修正。',
  humidity: '相对湿度（%），影响颗粒物吸湿增长与沉降。',
  varyWeather: '开启后按日内规律让风速、风向、气温随时间小幅波动；关闭则各时间步采用相同气象。',
  resolution: '浓度场水平网格分辨率。分辨率越高越精细，计算量与耗时越大。',
  sliceHeight: '水平切片热力面的采样高度，1.5 m 为呼吸带高度。',
  gridPad: '计算范围相对施工场界的外扩距离，用于覆盖下风向敏感点。',
  cityFactor: '城市下垫面对横向扩散的增强系数，反映建筑群导致的湍流。',
  emission: '扬尘源强：点源为 g/s、线源为 g/(m·s)、面源为 g/(m²·s)。数值越大单位时间起尘量越高。',
  sourceEnable: '勾选后该扬尘源参与浓度计算，并在地图上显示对应图层。',
  measureEnable: '启用该防控措施，并按设定的效率定量削减源强或修正扩散。',
  measureEfficiency: '措施削减效率（0~100%），源强按 Q_eff = Q x (1 - eta) 折减。',
  barrierHeight: '围挡高度，用于下风向浓度分段折减（2 倍高度内取 0.5，2~5 倍内取 0.8）。',
  overlay: '在指定采样高度绘制水平浓度热力面，颜色越暖浓度越高。',
  section: '沿下风向过场地的垂直剖面，展示浓度随高度的变化，可观察烟羽抬升与建筑遮挡。',
  volume: '基于 Cesium VoxelPrimitive 的三维浓度体渲染，可从任意角度观察烟羽立体形态。',
  particles: '粒子流场辅助效果，沿下风向漂散，用于直观演示风向与扩散趋势，不参与定量计算。',
  sectionLayers: '垂直剖面的高度分层数，层数越多剖面越平滑。',
  sectionHeight: '垂直剖面展示的最大高度。',
  volumeResolution: '体渲染的水平网格分辨率，分辨率越高越精细、计算越慢。',
  volumeLayers: '体渲染的垂直分层数，层数越多垂直方向越连续。',
  volumeHeight: '体渲染覆盖的最大高度。',
  overlayOpacity: '水平切片热力面的整体透明度。',
  sectionOpacity: '垂直剖面贴图的整体透明度。',
  volumeOpacity: '三维体渲染的整体透明度。',
  particleOpacity: '粒子流场的整体透明度。',
  particleCount: '粒子数量，数量越多流场越密集、性能开销越大。',
  sectionOffsetAlong: '剖面中心沿下风向的偏移距离，0 表示过场地中心。',
  sectionOffsetCross: '剖面中心沿横风向的偏移距离，用于移动到场地上风侧或下风侧。'
}

const tip = reactive({ visible: false, text: '', x: 0, y: 0, below: false })

function onTipOver(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  const icon = target?.closest('.info-tip') as HTMLElement | null
  const text = icon?.dataset.tip
  if (!icon || !text) return
  const rect = icon.getBoundingClientRect()
  const half = 106
  tip.text = text
  tip.x = Math.min(Math.max(rect.left + rect.width / 2, half), window.innerWidth - half)
  tip.below = rect.top < 150
  tip.y = tip.below ? rect.bottom + 9 : rect.top - 9
  tip.visible = true
}

function onTipOut(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.closest('.info-tip')) tip.visible = false
}

function hideTip(): void {
  tip.visible = false
}

const measures = reactive<Measures>({
  watering: { enabled: true, efficiency: 0.45 },
  cover: { enabled: false, efficiency: 0.7 },
  barrier: { enabled: true, height: 2.5 },
  fogCannon: { enabled: false, efficiency: 0.6 },
  vehicleWash: { enabled: false, efficiency: 0.3 },
  speedLimit: { enabled: false, efficiency: 0.25 }
})

const sourceList = ref<DustSource[]>([])
const sourceEnabled = reactive<Record<string, boolean>>({})

const timeline = reactive({ currentIndex: 0, playing: false, speedMs: 800 })
let playTimer: ReturnType<typeof setInterval> | undefined

const timeSteps = ref<Awaited<ReturnType<typeof buildTimeSteps>>>([])
const fields = shallowRef<FieldResult[]>([])
const fieldCanvases = shallowRef<HTMLCanvasElement[]>([])
const sections = shallowRef<SectionResult[]>([])
const volumes = shallowRef<(VolumeResult | undefined)[]>([])
const sensitiveResults = ref<SensitiveResult[]>([])
const selectedSensitive = ref<SensitiveResult | null>(null)
const currentStageLabel = ref('—')
const currentWindLabel = ref('—')
const dirty = ref(false)

const analysis = reactive({
  running: false,
  progress: 0,
  hasResult: false,
  scaleMax: 1,
  currentMax: 0,
  exceedArea: 0,
  exceedCount: 0
})

interface Snapshot {
  id: number
  stamp: string
  label: string
  timeIndex: number
  maxConcentration: number
  exceedCount: number
  wind: string
  stage: string
}
const snapshots = ref<Snapshot[]>([])
let snapshotSeq = 0

const helpOpen = ref(false)
const activeHelpKey = ref<string | undefined>(DUST_DISPERSION_HELP[0]?.key)

const reportOpen = ref(false)
const reportModel = ref<ReportModel | null>(null)
const reportPdfUrl = ref('')
const reportPdfMode = ref(false)
const pdfLoading = ref(false)
const reportPaper = ref<HTMLElement | null>(null)

const dustGradient = dustGradientCss()
const currentWindColor = computed(() => windSpeedColor(weatherForm.windSpeed))

const grid = computed<GridSpec | undefined>(() => {
  const model = scene.value
  if (!model) return undefined
  const pad = form.gridPad
  const r = model.siteRect
  return {
    minX: r.minX - pad,
    maxX: r.maxX + pad,
    minY: r.minY - pad,
    maxY: r.maxY + pad,
    nx: form.resolution,
    ny: form.resolution
  }
})

const activeSources = computed(() => sourceList.value.filter((s) => sourceEnabled[s.id] !== false))

function effectiveStability(windSpeed: number): StabilityClass {
  if (weatherForm.stabilityMode === 'manual') return weatherForm.stability
  return autoStability(windSpeed, weatherForm.solar, weatherForm.cloudCover, weatherForm.isDay)
}

function buildInput(step: (typeof timeSteps.value)[number]): FieldComputeInput {
  const model = scene.value!
  return {
    grid: grid.value!,
    sliceHeight: form.sliceHeight,
    weather: {
      windSpeed: step.windSpeed,
      windDirection: step.windDirection,
      stability: effectiveStability(step.windSpeed),
      temperature: step.temperature,
      humidity: step.humidity
    },
    sources: activeSources.value,
    measures,
    buildings: model.buildings,
    timeStep: step,
    stageFactor: STAGE_FACTOR[step.stage],
    siteRect: model.siteRect,
    cityFactor: form.cityFactor,
    sensitivePoints: model.sensitive
  }
}

function noMeasures(): Measures {
  return {
    watering: { enabled: false, efficiency: 0 },
    cover: { enabled: false, efficiency: 0 },
    barrier: { enabled: false, height: 0 },
    fogCannon: { enabled: false, efficiency: 0 },
    vehicleWash: { enabled: false, efficiency: 0 },
    speedLimit: { enabled: false, efficiency: 0 }
  }
}

function updateMobile(step: (typeof timeSteps.value)[number]): void {
  if (!sourceHandles) return
  const positions: { x: number; y: number; z: number }[] = []
  for (const source of sourceList.value) {
    if (source.type !== 'mobile' || !source.path || source.path.length < 2) continue
    for (let v = 0; v < 3; v += 1) {
      const p = pointOnPolyline(source.path, step.mobilePhase + v / 3)
      positions.push({ x: p.x, y: p.y, z: source.height })
    }
  }
  sourceHandles.updateMobile(positions)
}

function rebuildOverlay(): void {
  if (!viewer || !scene.value || !grid.value) return
  overlay?.destroy()
  overlay = new ConcentrationOverlay(viewer, scene.value, grid.value, form.sliceHeight)
  overlay.setVisible(display.showOverlay)
  viewer.scene.requestRender()
}

function updateSection(section: SectionResult): void {
  if (!viewer || !scene.value) return
  try {
    if (!sectionHandles) sectionHandles = renderVerticalSection(viewer, scene.value, section, analysis.scaleMax, render.sectionOpacity)
    else sectionHandles.update(section, analysis.scaleMax, render.sectionOpacity)
    sectionHandles.setVisible(display.showSection)
  } catch {
    statusMessage.value = '垂直剖面渲染失败'
  }
}

function updateVolume(volume: VolumeResult): void {
  if (!viewer || !scene.value) return
  try {
    if (!volumeHandles) volumeHandles = renderVolume(viewer, scene.value, volume, analysis.scaleMax, render.volumeOpacity)
    else volumeHandles.update(volume, analysis.scaleMax, render.volumeOpacity)
    volumeHandles.setVisible(display.showVolume)
  } catch {
    statusMessage.value = '三维体渲染失败'
  }
}

function ensureParticles(): void {
  if (!viewer || !scene.value) return
  try {
    if (display.showParticles) {
      if (!particleHandles) {
        particleHandles = renderParticleField(viewer, scene.value, weatherForm.windDirection, {
          count: render.particleCount,
          opacity: render.particleOpacity
        })
      }
      particleHandles.setOpacity(render.particleOpacity)
      particleHandles.setVisible(true)
    } else if (particleHandles) {
      particleHandles.setVisible(false)
    }
  } catch {
    statusMessage.value = '粒子流场渲染失败'
  }
}

function refreshSources(): void {
  sourceHandles?.refresh(display.showSources, sourceEnabled)
}

async function recomputeSections(): Promise<void> {
  if (!scene.value || !timeSteps.value.length) return
  const seq = runSeq
  const out: SectionResult[] = []
  for (let i = 0; i < timeSteps.value.length; i += 1) {
    const section = await computeVerticalSectionAsync(
      buildInput(timeSteps.value[i]),
      {
        samples: form.resolution,
        layers: render.sectionLayers,
        maxHeight: render.sectionHeight,
        offsetAlong: render.sectionOffsetAlong,
        offsetCross: render.sectionOffsetCross
      },
      () => seq !== runSeq
    )
    if (!section) return
    out.push(section)
  }
  if (seq !== runSeq) return
  sections.value = out
  const current = out[timeline.currentIndex]
  if (current) updateSection(current)
}

function applyIndex(index: number, lightweight = false): void {
  const result = fields.value[index]
  const step = timeSteps.value[index]
  if (!result || !step) return
  analysis.currentMax = result.maxConcentration
  analysis.exceedArea = result.exceedArea
  analysis.exceedCount = result.exceedCount
  sensitiveResults.value = result.sensitiveResults
  const g = grid.value
  const canvas = fieldCanvases.value[index]
  if (canvas) overlay?.setCanvas(canvas, form.sliceHeight)
  else if (g) overlay?.update(result.field, g, analysis.scaleMax, form.sliceHeight)
  const sec = sections.value[index]
  if (sec && !lightweight) updateSection(sec)
  const vol = volumes.value[index]
  if (vol && !lightweight) updateVolume(vol)
  particleHandles?.updateDirection(step.windDirection)
  sensitiveHandles?.update(result.sensitiveResults)
  updateMobile(step)
  windHandles?.update(step.windDirection, step.windSpeed)
  currentStageLabel.value = step.stageLabel
  currentWindLabel.value = `${step.windSpeed.toFixed(1)} m/s ${dirLabel(step.windDirection)} · ${STABILITY_LABEL[effectiveStability(step.windSpeed)]}`
}

function pushSnapshot(): void {
  const step = timeSteps.value[timeline.currentIndex]
  const result = fields.value[timeline.currentIndex]
  if (!step || !result) return
  const now = new Date()
  snapshotSeq += 1
  snapshots.value.unshift({
    id: snapshotSeq,
    stamp: now.toLocaleTimeString('zh-CN', { hour12: false }),
    label: `${step.label} · ${step.stageLabel}`,
    timeIndex: timeline.currentIndex,
    maxConcentration: result.maxConcentration,
    exceedCount: result.exceedCount,
    wind: `${step.windSpeed.toFixed(1)}m/s ${dirLabel(step.windDirection)}`,
    stage: step.stageLabel
  })
  if (snapshots.value.length > 12) snapshots.value.pop()
}

async function runSimulation(): Promise<void> {
  const model = scene.value
  const g = grid.value
  if (!model || !g || analysis.running) return
  const seq = ++runSeq
  timeline.playing = false
  analysis.running = true
  analysis.progress = 0
  dirty.value = false
  const steps = buildTimeSteps(
    {
      windSpeed: weatherForm.windSpeed,
      windDirection: weatherForm.windDirection,
      stability: weatherForm.stability,
      temperature: weatherForm.temperature,
      humidity: weatherForm.humidity
    },
    HOURS,
    stageSequence(HOURS.length),
    weatherForm.varyWeather
  )
  timeSteps.value = steps
  const results: FieldResult[] = []
  const sectionsData: SectionResult[] = []
  const volumesData: (VolumeResult | undefined)[] = []
  for (let i = 0; i < steps.length; i += 1) {
    if (seq !== runSeq) return
    const input = buildInput(steps[i])
    const result = await computeFieldAsync(
      input,
      (ratio) => {
        analysis.progress = Math.round(((i + ratio) / steps.length) * 100)
      },
      () => seq !== runSeq
    )
    if (!result) {
      if (seq === runSeq) analysis.running = false
      return
    }
    results.push(result)
    const section = await computeVerticalSectionAsync(
      input,
      {
        samples: form.resolution,
        layers: render.sectionLayers,
        maxHeight: render.sectionHeight,
        offsetAlong: render.sectionOffsetAlong,
        offsetCross: render.sectionOffsetCross
      },
      () => seq !== runSeq
    )
    if (!section) return
    sectionsData.push(section)
    let volumeData: VolumeResult | undefined
    if (display.showVolume) {
      volumeData =
        (await computeVolumeAsync(
          input,
          {
            resolution: render.volumeResolution,
            layers: render.volumeLayers,
            maxHeight: render.volumeHeight
          },
          () => seq !== runSeq
        )) ?? undefined
      if (seq !== runSeq) return
    }
    volumesData.push(volumeData)
  }
  if (seq !== runSeq) return
  fields.value = results
  sections.value = sectionsData
  volumes.value = volumesData
  rebuildOverlay()
  analysis.hasResult = true
  analysis.running = false
  analysis.scaleMax = Math.max(1, ...results.map((r) => r.maxConcentration))
  fieldCanvases.value = results.map((r) => fieldToCanvas(r.field, g, analysis.scaleMax, render.overlayOpacity))
  timeline.currentIndex = Math.min(timeline.currentIndex, steps.length - 1)
  applyIndex(timeline.currentIndex)
  pushSnapshot()
  statusMessage.value = ''
}

function markDirty(): void {
  if (analysis.hasResult && !analysis.running) dirty.value = true
}

function startPlayTimer(): void {
  stopPlayTimer()
  if (!fields.value.length) return
  playTimer = setInterval(() => {
    const next = (timeline.currentIndex + 1) % timeSteps.value.length
    timeline.currentIndex = next
  }, timeline.speedMs)
}
function stopPlayTimer(): void {
  if (playTimer) {
    clearInterval(playTimer)
    playTimer = undefined
  }
}

function stepBy(delta: number): void {
  if (!fields.value.length) return
  timeline.playing = false
  const next = Math.max(0, Math.min(timeSteps.value.length - 1, timeline.currentIndex + delta))
  timeline.currentIndex = next
}

watch(() => timeline.playing, (playing) => {
  if (playing) startPlayTimer()
  else {
    stopPlayTimer()
    applyIndex(timeline.currentIndex)
  }
})
watch(() => timeline.speedMs, () => {
  if (timeline.playing) startPlayTimer()
})
watch(() => timeline.currentIndex, (index) => applyIndex(index, timeline.playing))

watch(
  [weatherForm, form, measures, sourceList, sourceEnabled, render],
  () => markDirty(),
  { deep: true }
)

watch(() => measures.barrier.height, (height) => {
  if (boundaryHandles) updateFenceHeight(boundaryHandles, height)
})

watch(() => display.showOverlay, (visible) => overlay?.setVisible(visible))
watch(() => form.sliceHeight, (height) => {
  const canvas = fieldCanvases.value[timeline.currentIndex]
  if (canvas) overlay?.setCanvas(canvas, height)
})
watch(() => display.showSection, (visible) => sectionHandles?.setVisible(visible))
watch(() => display.showVolume, (visible) => {
  volumeHandles?.setVisible(visible)
  if (visible && analysis.hasResult && !volumes.value.some(Boolean)) void runSimulation()
})
watch(() => display.showParticles, () => ensureParticles())
watch(() => display.showSources, () => refreshSources())
watch(sourceEnabled, () => refreshSources(), { deep: true })
watch(() => display.showSensitive, (visible) => sensitiveHandles?.setVisible(visible))
watch(() => display.showFence, (visible) => boundaryHandles?.setVisible(visible))

watch(() => render.overlayOpacity, (opacity) => {
  const g = grid.value
  if (!g || !fields.value.length) return
  fieldCanvases.value = fields.value.map((r) => fieldToCanvas(r.field, g, analysis.scaleMax, opacity))
  const canvas = fieldCanvases.value[timeline.currentIndex]
  if (canvas) overlay?.setCanvas(canvas, form.sliceHeight)
})
watch(() => render.sectionOpacity, () => {
  const sec = sections.value[timeline.currentIndex]
  if (sec) updateSection(sec)
})
watch(() => render.volumeOpacity, () => {
  const vol = volumes.value[timeline.currentIndex]
  if (vol) updateVolume(vol)
})
watch(() => render.particleOpacity, (value) => particleHandles?.setOpacity(value))
watch(() => render.particleCount, () => {
  if (!particleHandles) return
  particleHandles.destroy()
  particleHandles = undefined
  ensureParticles()
})
watch(
  () => [render.sectionOffsetAlong, render.sectionOffsetCross, render.sectionHeight, render.sectionLayers],
  () => {
    void recomputeSections()
  }
)

function focusSensitive(result: SensitiveResult): void {
  selectedSensitive.value = result
  if (!viewer || !scene.value) return
  const { lon, lat } = localToLonLat(scene.value.city, result.position.x, result.position.y)
  viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, 1000), duration: 1.2 })
}

function onSceneClick(movement: Cesium.Cartesian2): void {
  if (!viewer) return
  const picked = viewer.scene.pick(movement) as { id?: { id?: string } } | undefined
  const id = picked?.id?.id
  if (id && id.startsWith('dust-sensitive-')) {
    const key = id.replace('dust-sensitive-', '')
    selectedSensitive.value = sensitiveResults.value.find((r) => r.id === key) ?? null
  } else if (id && id.startsWith('dust-source-')) {
    selectedSensitive.value = null
  } else {
    selectedSensitive.value = null
  }
}

// ---------------------------------------------------------------------------
// 分析报告
// ---------------------------------------------------------------------------

function collectReport(): ReportModel {
  const model = scene.value
  const step = timeSteps.value[timeline.currentIndex]
  const result = fields.value[timeline.currentIndex]
  const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false })
  const sections: ReportSection[] = []

  sections.push({
    title: '一、案例与场景',
    kv: [
      { label: '案例名称', value: '施工扬尘扩散模拟' },
      { label: '场地中心', value: model ? `${model.city.center.lon.toFixed(5)}, ${model.city.center.lat.toFixed(5)}` : '—' },
      { label: '场地尺寸', value: model ? `${(model.siteRect.maxX - model.siteRect.minX).toFixed(0)} × ${(model.siteRect.maxY - model.siteRect.minY).toFixed(0)} m` : '—' },
      { label: '扬尘源数量', value: `${activeSources.value.length} 个` },
      { label: '环境敏感点', value: `${model?.sensitive.length ?? 0} 个` },
      { label: '周边建筑', value: `${model?.buildings.length ?? 0} 栋` }
    ]
  })

  if (step) {
    sections.push({
      title: '二、气象与扩散参数',
      kv: [
        { label: '当前时刻', value: `${step.label}（${step.stageLabel}）` },
        { label: '风速', value: `${step.windSpeed.toFixed(2)} m/s` },
        { label: '风向（来向）', value: `${step.windDirection.toFixed(0)}° ${dirLabel(step.windDirection)}` },
        { label: '大气稳定度', value: STABILITY_LABEL[effectiveStability(step.windSpeed)] },
        { label: '稳定度模式', value: weatherForm.stabilityMode === 'auto' ? '自动判定' : '手动指定' },
        { label: '气温 / 湿度', value: `${step.temperature.toFixed(1)} ℃ / ${step.humidity.toFixed(0)} %` },
        { label: '城市扩散修正', value: `×${form.cityFactor.toFixed(2)}` },
        { label: '采样高度', value: `${form.sliceHeight.toFixed(1)} m` },
        { label: '网格分辨率', value: `${form.resolution} × ${form.resolution}` }
      ]
    })
  }

  const measureText: string[] = []
  if (measures.watering.enabled) measureText.push(`洒水（效率 ${(measures.watering.efficiency * 100).toFixed(0)}%）`)
  if (measures.cover.enabled) measureText.push(`覆盖（效率 ${(measures.cover.efficiency * 100).toFixed(0)}%）`)
  if (measures.barrier.enabled) measureText.push(`围挡（高 ${measures.barrier.height.toFixed(1)} m）`)
  if (measures.fogCannon.enabled) measureText.push(`雾炮（效率 ${(measures.fogCannon.efficiency * 100).toFixed(0)}%）`)
  if (measures.vehicleWash.enabled) measureText.push(`车辆冲洗（效率 ${(measures.vehicleWash.efficiency * 100).toFixed(0)}%）`)
  if (measures.speedLimit.enabled) measureText.push(`限速（效率 ${(measures.speedLimit.efficiency * 100).toFixed(0)}%）`)

  sections.push({
    title: '三、扬尘源与防控措施',
    table: {
      caption: `防控措施：${measureText.length ? measureText.join('、') : '无（基线方案）'}`,
      head: ['源名称', '类型', '源强', '源高(m)', '当前阶段启用'],
      body: activeSources.value.map((s) => [
        s.name,
        SOURCE_TYPE_LABEL[s.type] ?? s.type,
        `${s.emission} ${s.type === 'line' ? 'g/(m·s)' : s.type === 'area' ? 'g/(m²·s)' : 'g/s'}`,
        s.height.toFixed(1),
        step ? (s.stages[step.stage] ? '是' : '否') : '—'
      ])
    }
  })

  if (result) {
    sections.push({
      title: '四、当前时刻浓度场结果',
      kv: [
        { label: '最大落地浓度', value: `${result.maxConcentration.toFixed(1)} μg/m³` },
        { label: '最大浓度位置', value: `${result.maxLocation.x.toFixed(0)}, ${result.maxLocation.y.toFixed(0)} m（局部坐标）` },
        { label: 'TSP 超标区域面积', value: `${result.exceedArea.toFixed(0)} m²` },
        { label: '超标敏感点数量', value: `${result.exceedCount} 个` }
      ]
    })
    sections.push({
      title: '五、敏感点影响评估',
      table: {
        caption: '标准限值参考 GB 3095-2012 二级标准（24h 平均）；PM10、PM2.5 由 TSP 按 0.55 / 0.18 折算。',
        head: ['敏感点', '类型', 'TSP(μg/m³)', 'PM10', 'PM2.5', 'TSP 标准', '超标倍数', '判定'],
        body: result.sensitiveResults.map((r) => [
          r.name,
          SENSITIVE_TYPE_LABEL[r.type] ?? r.type,
          r.tsp.toFixed(1),
          r.pm10.toFixed(1),
          r.pm25.toFixed(1),
          r.standardTsp.toFixed(0),
          r.exceedRatio.toFixed(2),
          r.isExceeding ? '超标' : '达标'
        ])
      }
    })
  }

  if (fields.value.length && timeSteps.value.length) {
    sections.push({
      title: '六、分析过程时间轴',
      table: {
        caption: '沿施工阶段与日内时刻逐时模拟的浓度场过程记录。',
        head: ['时刻', '施工阶段', '风速(m/s)', '风向', '最大浓度(μg/m³)', '超标点'],
        body: fields.value.map((r, i) => {
          const s = timeSteps.value[i]
          return [s.label, s.stageLabel, s.windSpeed.toFixed(1), dirLabel(s.windDirection), r.maxConcentration.toFixed(1), String(r.exceedCount)]
        })
      }
    })
  }

  const anyMeasure = measures.watering.enabled || measures.cover.enabled || measures.barrier.enabled || measures.fogCannon.enabled || measures.vehicleWash.enabled || measures.speedLimit.enabled
  if (anyMeasure && step && result) {
    const baseline = computeField({ ...buildInput(step), measures: noMeasures() })
    const reduction = baseline.maxConcentration > 0 ? ((baseline.maxConcentration - result.maxConcentration) / baseline.maxConcentration) * 100 : 0
    sections.push({
      title: '七、防控措施减排对比',
      table: {
        caption: '以无措施方案（基线）为参照，对比当前措施组合的最大落地浓度与减排比例。',
        head: ['方案', '最大落地浓度(μg/m³)', '超标点', '较基线减排'],
        body: [
          ['基线方案（无措施）', baseline.maxConcentration.toFixed(1), String(baseline.exceedCount), '—'],
          ['当前措施组合', result.maxConcentration.toFixed(1), String(result.exceedCount), `${reduction.toFixed(1)}%`]
        ]
      }
    })
  }

  return {
    generatedAt,
    intro: '本报告由「施工扬尘扩散模拟」案例生成，基于高斯烟羽扩散模型汇总施工场地扬尘源、气象与扩散参数、防控措施、浓度场结果、环境敏感点影响评估以及施工过程的时间轴模拟记录，可用于施工扬尘环境影响分析与防控方案比选。',
    sections
  }
}

async function openReportPreview(): Promise<void> {
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
  pdfLoading.value = true
  try {
    const url = await createReportPdfUrl(reportPaper.value)
    if (reportPdfUrl.value) URL.revokeObjectURL(reportPdfUrl.value)
    reportPdfUrl.value = url
    reportPdfMode.value = true
  } catch {
    statusMessage.value = 'PDF 预览生成失败，已切换为网页版预览'
    reportPdfMode.value = false
  } finally {
    pdfLoading.value = false
  }
}

async function onExportPdf(): Promise<void> {
  reportPdfMode.value = false
  await nextTick()
  if (!reportPaper.value) return
  await exportReportPdf(reportPaper.value, {
    docTitle: REPORT_TITLE,
    filenamePrefix: 'dust-dispersion-report',
    onStatus: (message) => (statusMessage.value = message)
  })
}

async function onExportDocx(): Promise<void> {
  if (!reportModel.value) return
  await exportReportDocx(reportModel.value, {
    docTitle: REPORT_TITLE,
    filenamePrefix: 'dust-dispersion-report',
    creator: '施工扬尘扩散模拟',
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

onMounted(async () => {
  if (!container.value) return
  viewer = createMapScene(container.value, { onStatus: (message) => (statusMessage.value = message) })
  loadBingImagery(viewer, {
    onStatus: (message) => (statusMessage.value = message),
    onBasemapReady: () => {
      isLoaded.value = true
      statusMessage.value = ''
    }
  })
  const model = createDustScene()
  scene.value = model
  const { lon, lat } = model.city.center
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat - 0.003, 2400),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-62), roll: 0 }
  })

  sourceList.value = model.sources.map((s) => ({ ...s, stages: { ...s.stages } }))
  for (const s of sourceList.value) sourceEnabled[s.id] = true

  boundaryHandles = renderSiteBoundary(viewer, model, measures.barrier.height)
  sourceHandles = renderSources(viewer, model, model.sources)
  const initial: SensitiveResult[] = model.sensitive.map((sp) => ({
    id: sp.id,
    name: sp.name,
    type: sp.type,
    position: sp.position,
    tsp: 0,
    pm10: 0,
    pm25: 0,
    standardTsp: sp.standard.tsp,
    isExceeding: false,
    exceedRatio: 0
  }))
  sensitiveHandles = renderSensitivePoints(viewer, model, initial)
  windHandles = renderWindArrow(viewer, model, weatherForm.windDirection, weatherForm.windSpeed, model.siteRect)

  clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  clickHandler.setInputAction((event: { position: Cesium.Cartesian2 }) => onSceneClick(event.position), Cesium.ScreenSpaceEventType.LEFT_CLICK)

  refreshSources()
  ensureParticles()

  await nextTick()
  void runSimulation()
})

onBeforeUnmount(() => {
  runSeq += 1
  stopPlayTimer()
  if (reportPdfUrl.value) URL.revokeObjectURL(reportPdfUrl.value)
  clickHandler?.destroy()
  overlay?.destroy()
  sectionHandles?.destroy()
  volumeHandles?.destroy()
  particleHandles?.destroy()
  sourceHandles?.destroy()
  sensitiveHandles?.destroy()
  boundaryHandles?.destroy()
  windHandles?.destroy()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="dust-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel" @mouseover="onTipOver" @mouseout="onTipOut" @scroll="hideTip">
      <div class="panel-title">施工扬尘扩散模拟</div>

      <div class="section-title">气象条件</div>
      <div class="control-row">
        <span class="row-label">风速<span class="info-tip" :data-tip="TIPS.windSpeed">?</span></span>
        <input v-model.number="weatherForm.windSpeed" type="range" min="0.5" max="10" step="0.1" />
        <span class="row-value">{{ weatherForm.windSpeed.toFixed(1) }}m/s</span>
      </div>
      <div class="control-row">
        <span class="row-label">风向（来向）<span class="info-tip" :data-tip="TIPS.windDirection">?</span></span>
        <input v-model.number="weatherForm.windDirection" type="range" min="0" max="359" step="1" />
        <span class="row-value">{{ weatherForm.windDirection }}°</span>
      </div>
      <div class="control-row">
        <span class="row-label">稳定度<span class="info-tip" :data-tip="TIPS.stabilityMode">?</span></span>
        <select v-model="weatherForm.stabilityMode">
          <option value="auto">自动判定</option>
          <option value="manual">手动指定</option>
        </select>
      </div>
      <div v-if="weatherForm.stabilityMode === 'manual'" class="control-row">
        <span class="row-label">级别<span class="info-tip" :data-tip="TIPS.stability">?</span></span>
        <select v-model="weatherForm.stability">
          <option v-for="cls in STABILITY_OPTIONS" :key="cls" :value="cls">{{ STABILITY_LABEL[cls] }}</option>
        </select>
      </div>
      <template v-else>
        <div class="control-row">
          <span class="row-label">日照等级<span class="info-tip" :data-tip="TIPS.solar">?</span></span>
          <select v-model="weatherForm.solar">
            <option v-for="opt in SOLAR_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>
        <div class="control-row">
          <span class="row-label">云量<span class="info-tip" :data-tip="TIPS.cloudCover">?</span></span>
          <input v-model.number="weatherForm.cloudCover" type="range" min="0" max="1" step="0.1" />
          <span class="row-value">{{ (weatherForm.cloudCover * 100).toFixed(0) }}%</span>
        </div>
        <label class="switch-row"><span>白天时段<span class="info-tip" :data-tip="TIPS.isDay">?</span></span><input v-model="weatherForm.isDay" type="checkbox" /></label>
      </template>
      <div class="control-row">
        <span class="row-label">气温<span class="info-tip" :data-tip="TIPS.temperature">?</span></span>
        <input v-model.number="weatherForm.temperature" type="range" min="-10" max="40" step="1" />
        <span class="row-value">{{ weatherForm.temperature }}℃</span>
      </div>
      <div class="control-row">
        <span class="row-label">湿度<span class="info-tip" :data-tip="TIPS.humidity">?</span></span>
        <input v-model.number="weatherForm.humidity" type="range" min="10" max="95" step="5" />
        <span class="row-value">{{ weatherForm.humidity }}%</span>
      </div>
      <label class="switch-row"><span>气象随时间变化<span class="info-tip" :data-tip="TIPS.varyWeather">?</span></span><input v-model="weatherForm.varyWeather" type="checkbox" /></label>

      <div class="section-title">模型与网格参数</div>
      <div class="control-row">
        <span class="row-label">网格分辨率<span class="info-tip" :data-tip="TIPS.resolution">?</span></span>
        <select v-model.number="form.resolution">
          <option v-for="res in RES_OPTIONS" :key="res" :value="res">{{ res }} × {{ res }}</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">采样高度<span class="info-tip" :data-tip="TIPS.sliceHeight">?</span></span>
        <input v-model.number="form.sliceHeight" type="range" min="0.5" max="30" step="0.5" />
        <span class="row-value">{{ form.sliceHeight.toFixed(1) }}m</span>
      </div>
      <div class="control-row">
        <span class="row-label">计算范围外扩<span class="info-tip" :data-tip="TIPS.gridPad">?</span></span>
        <input v-model.number="form.gridPad" type="range" min="400" max="1200" step="50" />
        <span class="row-value">{{ form.gridPad }}m</span>
      </div>
      <div class="control-row">
        <span class="row-label">城市扩散修正<span class="info-tip" :data-tip="TIPS.cityFactor">?</span></span>
        <input v-model.number="form.cityFactor" type="range" min="1" max="1.4" step="0.05" />
        <span class="row-value">×{{ form.cityFactor.toFixed(2) }}</span>
      </div>

      <div class="section-title">扬尘源参数</div>
      <div v-for="source in sourceList" :key="source.id" class="source-item">
        <label class="switch-row">
          <span>{{ source.name }}<span class="info-tip" :data-tip="TIPS.sourceEnable">?</span></span>
          <input v-model="sourceEnabled[source.id]" type="checkbox" />
        </label>
        <div class="control-row">
          <span class="row-label">{{ SOURCE_TYPE_LABEL[source.type] }}源强<span class="info-tip" :data-tip="TIPS.emission">?</span></span>
          <input v-model.number="source.emission" type="range" min="0" max="5" step="0.005" :disabled="sourceEnabled[source.id] === false" />
          <span class="row-value">{{ source.emission }}</span>
        </div>
      </div>

      <div class="section-title">防控措施</div>
      <label class="switch-row"><span>洒水 / 喷淋<span class="info-tip" :data-tip="TIPS.measureEnable">?</span></span><input v-model="measures.watering.enabled" type="checkbox" /></label>
      <div class="control-row" v-if="measures.watering.enabled">
        <span class="row-label">效率<span class="info-tip" :data-tip="TIPS.measureEfficiency">?</span></span>
        <input v-model.number="measures.watering.efficiency" type="range" min="0" max="0.9" step="0.05" />
        <span class="row-value">{{ (measures.watering.efficiency * 100).toFixed(0) }}%</span>
      </div>
      <label class="switch-row"><span>覆盖（防尘网）<span class="info-tip" :data-tip="TIPS.measureEnable">?</span></span><input v-model="measures.cover.enabled" type="checkbox" /></label>
      <div class="control-row" v-if="measures.cover.enabled">
        <span class="row-label">效率<span class="info-tip" :data-tip="TIPS.measureEfficiency">?</span></span>
        <input v-model.number="measures.cover.efficiency" type="range" min="0" max="0.95" step="0.05" />
        <span class="row-value">{{ (measures.cover.efficiency * 100).toFixed(0) }}%</span>
      </div>
      <label class="switch-row"><span>围挡<span class="info-tip" :data-tip="TIPS.measureEnable">?</span></span><input v-model="measures.barrier.enabled" type="checkbox" /></label>
      <div class="control-row" v-if="measures.barrier.enabled">
        <span class="row-label">围挡高度<span class="info-tip" :data-tip="TIPS.barrierHeight">?</span></span>
        <input v-model.number="measures.barrier.height" type="range" min="1" max="6" step="0.5" />
        <span class="row-value">{{ measures.barrier.height.toFixed(1) }}m</span>
      </div>
      <label class="switch-row"><span>雾炮机<span class="info-tip" :data-tip="TIPS.measureEnable">?</span></span><input v-model="measures.fogCannon.enabled" type="checkbox" /></label>
      <div class="control-row" v-if="measures.fogCannon.enabled">
        <span class="row-label">效率<span class="info-tip" :data-tip="TIPS.measureEfficiency">?</span></span>
        <input v-model.number="measures.fogCannon.efficiency" type="range" min="0" max="0.9" step="0.05" />
        <span class="row-value">{{ (measures.fogCannon.efficiency * 100).toFixed(0) }}%</span>
      </div>
      <label class="switch-row"><span>车辆冲洗<span class="info-tip" :data-tip="TIPS.measureEnable">?</span></span><input v-model="measures.vehicleWash.enabled" type="checkbox" /></label>
      <div class="control-row" v-if="measures.vehicleWash.enabled">
        <span class="row-label">效率<span class="info-tip" :data-tip="TIPS.measureEfficiency">?</span></span>
        <input v-model.number="measures.vehicleWash.efficiency" type="range" min="0" max="0.8" step="0.05" />
        <span class="row-value">{{ (measures.vehicleWash.efficiency * 100).toFixed(0) }}%</span>
      </div>
      <label class="switch-row"><span>限速<span class="info-tip" :data-tip="TIPS.measureEnable">?</span></span><input v-model="measures.speedLimit.enabled" type="checkbox" /></label>
      <div class="control-row" v-if="measures.speedLimit.enabled">
        <span class="row-label">效率<span class="info-tip" :data-tip="TIPS.measureEfficiency">?</span></span>
        <input v-model.number="measures.speedLimit.efficiency" type="range" min="0" max="0.6" step="0.05" />
        <span class="row-value">{{ (measures.speedLimit.efficiency * 100).toFixed(0) }}%</span>
      </div>

      <div class="section-title">浓度场可视化</div>
      <div class="wind-legend">
        <span class="wind-legend-swatch" :style="{ background: currentWindColor }"></span>
        <span>风向箭头颜色随风速由蓝（小）到红（大）变化，箭头指向下风向</span>
      </div>
      <label class="switch-row"><span>水平切片热力面<span class="info-tip" :data-tip="TIPS.overlay">?</span></span><input v-model="display.showOverlay" type="checkbox" /></label>
      <div v-if="display.showOverlay" class="control-row">
        <span class="row-label">热力面透明度<span class="info-tip" :data-tip="TIPS.overlayOpacity">?</span></span>
        <input v-model.number="render.overlayOpacity" type="range" min="0.1" max="1" step="0.05" />
        <span class="row-value">{{ (render.overlayOpacity * 100).toFixed(0) }}%</span>
      </div>
      <label class="switch-row"><span>垂直剖面<span class="info-tip" :data-tip="TIPS.section">?</span></span><input v-model="display.showSection" type="checkbox" /></label>
      <label class="switch-row"><span>三维体渲染<span class="info-tip" :data-tip="TIPS.volume">?</span></span><input v-model="display.showVolume" type="checkbox" /></label>
      <label class="switch-row"><span>粒子流场<span class="info-tip" :data-tip="TIPS.particles">?</span></span><input v-model="display.showParticles" type="checkbox" /></label>
      <div v-if="display.showParticles" class="control-row">
        <span class="row-label">粒子透明度<span class="info-tip" :data-tip="TIPS.particleOpacity">?</span></span>
        <input v-model.number="render.particleOpacity" type="range" min="0.1" max="1" step="0.05" />
        <span class="row-value">{{ (render.particleOpacity * 100).toFixed(0) }}%</span>
      </div>
      <div v-if="display.showParticles" class="control-row">
        <span class="row-label">粒子数量<span class="info-tip" :data-tip="TIPS.particleCount">?</span></span>
        <input v-model.number="render.particleCount" type="range" min="60" max="800" step="20" />
        <span class="row-value">{{ render.particleCount }}</span>
      </div>
      <div v-if="display.showSection" class="control-row">
        <span class="row-label">剖面分层<span class="info-tip" :data-tip="TIPS.sectionLayers">?</span></span>
        <input v-model.number="render.sectionLayers" type="range" min="8" max="40" step="2" />
        <span class="row-value">{{ render.sectionLayers }}</span>
      </div>
      <div v-if="display.showSection" class="control-row">
        <span class="row-label">剖面高度<span class="info-tip" :data-tip="TIPS.sectionHeight">?</span></span>
        <input v-model.number="render.sectionHeight" type="range" min="20" max="120" step="10" />
        <span class="row-value">{{ render.sectionHeight }}m</span>
      </div>
      <div v-if="display.showSection" class="control-row">
        <span class="row-label">剖面透明度<span class="info-tip" :data-tip="TIPS.sectionOpacity">?</span></span>
        <input v-model.number="render.sectionOpacity" type="range" min="0.1" max="1" step="0.05" />
        <span class="row-value">{{ (render.sectionOpacity * 100).toFixed(0) }}%</span>
      </div>
      <div v-if="display.showSection" class="control-row">
        <span class="row-label">剖面顺风偏移<span class="info-tip" :data-tip="TIPS.sectionOffsetAlong">?</span></span>
        <input v-model.number="render.sectionOffsetAlong" type="range" min="-600" max="600" step="25" />
        <span class="row-value">{{ render.sectionOffsetAlong }}m</span>
      </div>
      <div v-if="display.showSection" class="control-row">
        <span class="row-label">剖面横风偏移<span class="info-tip" :data-tip="TIPS.sectionOffsetCross">?</span></span>
        <input v-model.number="render.sectionOffsetCross" type="range" min="-600" max="600" step="25" />
        <span class="row-value">{{ render.sectionOffsetCross }}m</span>
      </div>
      <div v-if="display.showVolume" class="control-row">
        <span class="row-label">体渲染分辨率<span class="info-tip" :data-tip="TIPS.volumeResolution">?</span></span>
        <select v-model.number="render.volumeResolution">
          <option :value="48">48 × 48</option>
          <option :value="64">64 × 64</option>
          <option :value="96">96 × 96</option>
        </select>
      </div>
      <div v-if="display.showVolume" class="control-row">
        <span class="row-label">体渲染分层<span class="info-tip" :data-tip="TIPS.volumeLayers">?</span></span>
        <input v-model.number="render.volumeLayers" type="range" min="6" max="20" step="1" />
        <span class="row-value">{{ render.volumeLayers }}</span>
      </div>
      <div v-if="display.showVolume" class="control-row">
        <span class="row-label">体渲染高度<span class="info-tip" :data-tip="TIPS.volumeHeight">?</span></span>
        <input v-model.number="render.volumeHeight" type="range" min="20" max="120" step="10" />
        <span class="row-value">{{ render.volumeHeight }}m</span>
      </div>
      <div v-if="display.showVolume" class="control-row">
        <span class="row-label">体渲染透明度<span class="info-tip" :data-tip="TIPS.volumeOpacity">?</span></span>
        <input v-model.number="render.volumeOpacity" type="range" min="0.1" max="1" step="0.05" />
        <span class="row-value">{{ (render.volumeOpacity * 100).toFixed(0) }}%</span>
      </div>

      <div class="section-title">场景图层</div>
      <label class="switch-row"><span>扬尘源<span class="info-tip" :data-tip="TIPS.sourceEnable">?</span></span><input v-model="display.showSources" type="checkbox" /></label>
      <label class="switch-row"><span>环境敏感点</span><input v-model="display.showSensitive" type="checkbox" /></label>
      <label class="switch-row"><span>场地围挡</span><input v-model="display.showFence" type="checkbox" /></label>

      <div class="button-row">
        <button class="action-button primary" :disabled="analysis.running || !isLoaded" @click="runSimulation">
          {{ analysis.running ? `计算中 ${analysis.progress}%` : analysis.hasResult ? '重新模拟' : '开始模拟' }}
        </button>
      </div>
      <div v-if="analysis.running" class="progress-track"><div class="progress-fill" :style="{ width: analysis.progress + '%' }"></div></div>
      <div v-if="dirty && !analysis.running" class="dirty-tip">参数已变更，点击「重新模拟」更新结果</div>

      <div class="section-title">时间轴追溯</div>
      <div class="timeline-row">
        <button class="mini-button" :disabled="!fields.length" @click="stepBy(-1)">◀</button>
        <button class="mini-button play" :disabled="!fields.length" @click="timeline.playing = !timeline.playing">
          {{ timeline.playing ? '暂停' : '播放' }}
        </button>
        <button class="mini-button" :disabled="!fields.length" @click="stepBy(1)">▶</button>
        <select v-model.number="timeline.speedMs" class="speed-select">
          <option v-for="opt in SPEED_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
      <input
        v-model.number="timeline.currentIndex"
        class="timeline-range"
        type="range"
        min="0"
        :max="Math.max(0, timeSteps.length - 1)"
        step="1"
        :disabled="!fields.length"
      />
      <div class="timeline-info">
        <span>{{ timeSteps[timeline.currentIndex]?.label ?? '—' }}</span>
        <span>{{ currentStageLabel }}</span>
        <span>{{ currentWindLabel }}</span>
      </div>
      <div v-if="snapshots.length" class="snapshot-list">
        <div class="row-note">分析快照（点击恢复）</div>
        <button
          v-for="snap in snapshots"
          :key="snap.id"
          class="snapshot-item"
          @click="timeline.currentIndex = snap.timeIndex"
        >
          <span>{{ snap.stamp }} · {{ snap.label }}</span>
          <span>{{ snap.maxConcentration.toFixed(0) }}μg/m³ · 超标{{ snap.exceedCount }}</span>
        </button>
      </div>

      <div class="section-title">环境敏感点</div>
      <div v-if="!sensitiveResults.length" class="row-note">尚未模拟</div>
      <button
        v-for="item in sensitiveResults"
        :key="item.id"
        class="sensitive-item"
        :class="{ danger: item.isExceeding }"
        @click="focusSensitive(item)"
      >
        <span>{{ item.name }}</span>
        <span>{{ item.tsp.toFixed(1) }} μg/m³ · {{ item.isExceeding ? `超标 ${item.exceedRatio.toFixed(1)}×` : '达标' }}</span>
      </button>

      <div v-if="analysis.hasResult" class="stat-grid">
        <div class="stat-cell"><span>最大浓度</span><b class="danger">{{ analysis.currentMax.toFixed(0) }}</b></div>
        <div class="stat-cell"><span>超标点</span><b class="danger">{{ analysis.exceedCount }}</b></div>
        <div class="stat-cell"><span>超标面积</span><b>{{ analysis.exceedArea.toFixed(0) }}m²</b></div>
      </div>
      <div class="legend">
        <div class="legend-bar" :style="{ background: dustGradient }"></div>
        <div class="legend-labels"><span>0</span><span>{{ analysis.scaleMax.toFixed(0) }} μg/m³</span></div>
      </div>

      <div class="button-row">
        <button class="action-button accent" :disabled="!analysis.hasResult" @click="openReportPreview">生成分析报告</button>
      </div>

      <button class="help-toggle" @click="helpOpen = !helpOpen">功能实现说明</button>
      <div v-if="helpOpen" class="help-panel">
        <div class="help-head"><span>功能实现说明</span><button class="help-close" @click="helpOpen = false">×</button></div>
        <div v-for="item in DUST_DISPERSION_HELP" :key="item.key" class="help-item">
          <button class="help-item-head" :class="{ active: activeHelpKey === item.key }" @click="activeHelpKey = activeHelpKey === item.key ? undefined : item.key">
            <span>{{ item.title }}</span><i>{{ activeHelpKey === item.key ? '−' : '+' }}</i>
          </button>
          <template v-if="activeHelpKey === item.key">
            <p class="help-summary">{{ item.summary }}</p>
            <ul class="help-detail"><li v-for="(line, index) in item.detail" :key="index">{{ line }}</li></ul>
          </template>
        </div>
      </div>

      <p class="hint">
        高斯烟羽模型实时计算施工扬尘浓度场，支持水平切片、垂直剖面、VoxelPrimitive 三维体渲染与粒子流场四种可视化方式；源、气象、措施、网格参数均可调，参数旁的「?」可查看说明；时间轴可回放施工阶段与日内变化并记录分析快照；报告支持在线预览（PDF）与 Word / PDF 导出。
      </p>
    </div>

    <div v-if="!isLoaded" class="status-mask">{{ statusMessage || '场景加载中…' }}</div>
    <div v-else-if="statusMessage" class="status-mask">{{ statusMessage }}</div>

    <div v-if="selectedSensitive" class="sensitive-popup">
      <div class="popup-head">
        <span>{{ selectedSensitive.name }}</span>
        <button class="popup-close" @click="selectedSensitive = null">×</button>
      </div>
      <div class="popup-row"><span>类型</span><b>{{ SENSITIVE_TYPE_LABEL[selectedSensitive.type] ?? selectedSensitive.type }}</b></div>
      <div class="popup-row"><span>TSP</span><b :class="{ danger: selectedSensitive.isExceeding }">{{ selectedSensitive.tsp.toFixed(1) }} μg/m³</b></div>
      <div class="popup-row"><span>PM10</span><b>{{ selectedSensitive.pm10.toFixed(1) }} μg/m³</b></div>
      <div class="popup-row"><span>PM2.5</span><b>{{ selectedSensitive.pm25.toFixed(1) }} μg/m³</b></div>
      <div class="popup-row"><span>标准限值</span><b>{{ selectedSensitive.standardTsp.toFixed(0) }} μg/m³</b></div>
      <div class="popup-row"><span>判定</span><b :class="{ danger: selectedSensitive.isExceeding }">{{ selectedSensitive.isExceeding ? `超标 ${selectedSensitive.exceedRatio.toFixed(2)} 倍` : '达标' }}</b></div>
    </div>

    <div v-if="reportOpen && reportModel" class="report-backdrop">
      <div class="report-toolbar">
        <span class="report-toolbar-title">分析报告 · 在线预览与导出</span>
        <span class="report-actions">
          <button class="report-btn" :class="{ active: !reportPdfMode }" @click="reportPdfMode = false">网页版</button>
          <button class="report-btn" :class="{ active: reportPdfMode }" @click="previewPdf">PDF 在线预览</button>
          <button class="report-btn accent" @click="onExportPdf">导出 PDF</button>
          <button class="report-btn accent" @click="onExportDocx">导出 Word</button>
          <button class="report-close" title="关闭预览" @click="closeReport">×</button>
        </span>
      </div>
      <div class="report-body">
        <div v-show="!reportPdfMode" class="report-scroll">
          <div ref="reportPaper" class="report-doc">
            <h1 class="report-h1">{{ REPORT_TITLE }}</h1>
            <p class="report-meta">生成时间：{{ reportModel.generatedAt }}</p>
            <p class="report-intro">{{ reportModel.intro }}</p>
            <template v-for="section in reportModel.sections" :key="section.title">
              <h2 class="report-h2">{{ section.title }}</h2>
              <dl v-if="section.kv && section.kv.length" class="report-kv">
                <template v-for="pair in section.kv" :key="pair.label">
                  <dt>{{ pair.label }}</dt>
                  <dd>{{ pair.value }}</dd>
                </template>
              </dl>
              <table v-if="section.table" class="report-table">
                <caption v-if="section.table.caption" class="report-caption">{{ section.table.caption }}</caption>
                <thead><tr><th v-for="head in section.table.head" :key="head">{{ head }}</th></tr></thead>
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
        <div v-if="reportPdfMode" class="report-pdf">
          <div v-if="pdfLoading" class="pdf-loading">正在生成 PDF 预览…</div>
          <iframe v-else-if="reportPdfUrl" :src="reportPdfUrl" class="pdf-frame" title="报告 PDF 预览"></iframe>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="tip.visible"
        class="tip-bubble"
        :class="{ below: tip.below }"
        :style="{ left: `${tip.x}px`, top: `${tip.y}px` }"
      >{{ tip.text }}</div>
    </Teleport>
  </div>
</template>

<style scoped>
.dust-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #0f2438; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 5px; width: 292px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 26, 44, 0.92); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.panel-title { font-size: 13px; font-weight: 700; margin-bottom: 2px; }
.section-title { margin-top: 8px; margin-bottom: 2px; padding-bottom: 2px; border-bottom: 1px solid rgba(137, 210, 233, 0.16); font-size: 11px; font-weight: 700; color: #7fd0e6; }
.button-row { display: flex; gap: 6px; margin-top: 4px; }
.action-button { flex: 1; min-height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; color: #edfaff; }
.action-button.primary { background: #257f9e; }
.action-button.accent { background: #8a6d1a; color: #fff3d6; }
.action-button:disabled { cursor: default; opacity: 0.5; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 0; color: #c3d8e6; }
.row-label { flex: 0 0 auto; display: inline-flex; align-items: center; }
.info-tip { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 13px; height: 13px; margin-left: 4px; border-radius: 50%; background: rgba(127, 208, 230, 0.2); color: #7fd0e6; font-size: 9px; font-weight: 700; cursor: help; vertical-align: middle; }
.tip-bubble { position: fixed; z-index: 9999; width: 200px; padding: 6px 9px; border: 1px solid rgba(127, 208, 230, 0.42); border-radius: 6px; background: rgba(4, 18, 32, 0.97); color: #ddf2f8; font-size: 10px; font-weight: 400; line-height: 1.5; text-align: left; transform: translate(-50%, -100%); pointer-events: none; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45); }
.tip-bubble.below { transform: translate(-50%, 0); }
.tip-bubble::after { content: ''; position: absolute; left: 50%; top: 100%; transform: translateX(-50%); border: 6px solid transparent; border-top-color: rgba(127, 208, 230, 0.42); }
.tip-bubble.below::after { top: auto; bottom: 100%; border-top-color: transparent; border-bottom-color: rgba(127, 208, 230, 0.42); }
.row-value { flex: 0 0 56px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.row-note { font-size: 10px; color: #7fd0e6; }
.wind-legend { display: flex; align-items: center; gap: 6px; margin: 3px 0 4px; font-size: 10px; color: #8fb0c8; line-height: 1.4; }
.wind-legend-swatch { flex: 0 0 auto; width: 22px; height: 10px; border-radius: 3px; border: 1px solid rgba(137, 210, 233, 0.3); }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row select { width: 128px; height: 22px; padding: 0 5px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.switch-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; color: #c3d8e6; }
.switch-row input { cursor: pointer; }
.source-item { padding: 3px 0 4px; border-bottom: 1px dashed rgba(137, 210, 233, 0.14); }
.progress-track { height: 6px; margin-top: 3px; border-radius: 3px; background: rgba(137, 210, 233, 0.18); overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #257f9e, #45b4d6); transition: width 0.2s ease; }
.dirty-tip { margin-top: 4px; padding: 4px 6px; border-radius: 4px; background: rgba(138, 109, 26, 0.4); color: #ffd666; font-size: 10px; }
.timeline-row { display: flex; align-items: center; gap: 6px; }
.mini-button { min-width: 34px; min-height: 24px; border: 1px solid rgba(137, 210, 233, 0.35); border-radius: 4px; background: rgba(20, 52, 80, 0.7); color: #d9eff6; cursor: pointer; font-size: 11px; }
.mini-button.play { flex: 1; }
.mini-button:disabled { opacity: 0.4; cursor: default; }
.speed-select { width: 56px; height: 24px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.timeline-range { width: 100%; accent-color: #f7b04a; }
.timeline-info { display: flex; justify-content: space-between; gap: 4px; font-size: 10px; color: #9fb8d4; }
.snapshot-list { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
.snapshot-item { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 4px 6px; border: 1px solid rgba(137, 210, 233, 0.22); border-radius: 4px; background: rgba(16, 43, 64, 0.5); color: #cfe6f2; cursor: pointer; font-size: 10px; text-align: left; }
.snapshot-item:hover { border-color: #45b4d6; }
.sensitive-item { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 3px; padding: 4px 6px; border: 1px solid rgba(137, 210, 233, 0.22); border-radius: 4px; background: rgba(16, 43, 64, 0.5); color: #cfe6f2; cursor: pointer; font-size: 10px; }
.sensitive-item.danger { border-color: rgba(255, 77, 79, 0.6); color: #ffb3b3; }
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 5px; }
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
.sensitive-popup { position: absolute; left: 16px; bottom: 16px; z-index: 20; width: 230px; padding: 10px 12px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 8px; background: rgba(8, 26, 44, 0.94); color: #ddf2f8; font-size: 11px; }
.popup-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 12px; font-weight: 700; }
.popup-close { border: 0; background: transparent; color: #9fb8d4; cursor: pointer; font-size: 16px; line-height: 1; }
.popup-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; color: #c3d8e6; }
.popup-row b.danger { color: #ff7875; }
.report-backdrop { position: absolute; inset: 0; z-index: 90; display: flex; flex-direction: column; background: #fff; color: #16232e; }
.report-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 16px; border-bottom: 1px solid #d5dee5; background: #eef4f8; }
.report-toolbar-title { font-size: 13px; font-weight: 700; color: #17324d; }
.report-actions { display: flex; align-items: center; gap: 8px; }
.report-btn { border: 1px solid #2f80ed; border-radius: 5px; padding: 4px 12px; cursor: pointer; background: #fff; color: #2f80ed; font-size: 12px; }
.report-btn.active { background: #2f80ed; color: #fff; }
.report-btn.accent { border-color: #c9971c; background: #c9971c; color: #fff; }
.report-close { border: 0; background: transparent; color: #5b6b7a; cursor: pointer; font-size: 20px; line-height: 1; }
.report-body { flex: 1; min-height: 0; display: flex; }
.report-scroll { flex: 1; overflow: auto; }
.report-pdf { flex: 1; min-height: 0; display: flex; }
.pdf-frame { flex: 1; width: 100%; border: 0; }
.pdf-loading { margin: auto; color: #5b6b7a; font-size: 13px; }
.report-doc { width: 820px; max-width: 100%; margin: 0 auto; padding: 24px 34px 44px; box-sizing: border-box; background: #fff; }
.report-h1 { margin: 0 0 6px; font-size: 20px; color: #17324d; }
.report-meta { margin: 0 0 6px; font-size: 11px; color: #6a7b8a; }
.report-intro { margin: 0 0 10px; font-size: 12px; line-height: 1.6; color: #3b5061; }
.report-h2 { margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #cfe0ec; font-size: 14px; color: #124c7d; }
.report-caption { padding: 2px 0; font-size: 11px; color: #5b6b7a; text-align: left; }
.report-table { width: 100%; margin: 4px 0 8px; border-collapse: collapse; font-size: 11px; }
.report-table th, .report-table td { padding: 3px 7px; border: 1px solid #c9d6e0; text-align: left; vertical-align: top; }
.report-table th { background: #e8f1f8; color: #17324d; font-weight: 700; }
.report-table td { color: #2a3b4a; }
.report-kv { display: grid; grid-template-columns: 180px 1fr; gap: 2px 10px; margin: 4px 0 6px; font-size: 12px; }
.report-kv dt { color: #3c5a73; font-weight: 600; }
.report-kv dd { margin: 0; color: #1e2f3d; }
.report-line { margin: 3px 0; font-size: 12px; line-height: 1.6; color: #1e2f3d; }
</style>
