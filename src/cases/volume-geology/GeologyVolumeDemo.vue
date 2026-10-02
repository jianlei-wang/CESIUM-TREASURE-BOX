<script setup lang="ts">
/**
 * 三维地层属性体 —— 地质解释工作台
 *
 * 由统一构造场（地层倾斜 + 褶皱 + 断层 + 侵入体）驱动的三维地层模型，围绕地质解释流程编排：
 *   结构模式（层位界面 / 断层 / 深度标尺）→ 岩性模式 → 属性模式（孔隙率 / 渗透率 / 含水饱和度）
 *   → A-B 地质剖面 → 层位切片 → 钻孔柱状与分层统计 → 体素拾取。
 *
 * 地层色板、钻孔、断层、属性阈值与相机预设集中在 SCENES.geology / GEOLOGY_CONFIG，组件不硬编码魔法数字。
 */
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import VolumeShell from '../../lib/volume-engine/VolumeShell.vue'
import ParamHint from '../../lib/volume-engine/ParamHint.vue'
import LayerDock from '../../lib/volume-engine/LayerDock.vue'
import { useVolumeScene } from '../../lib/volume-engine/useVolumeScene'
import { GEOLOGY_CONFIG, SCENES, type ChannelSpec } from '../../lib/volume-engine/scenes'
import { buildTransferLut, gradientCss } from '../../lib/volume-engine/palette'
import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'
import type { LayerDockItem, PickedView, StatItem } from '../../lib/volume-engine/types'
import { installGeologyOverlay, type GeologyOverlay } from './geology-overlay'
import { drawGeologySection, type GeologyProfileResult } from './geology-profile'

type Mode = 'structure' | 'litho' | 'property' | 'section' | 'slice'

type LayerStat = {
  code: number
  fraction: number
  thicknessNorm: number
  porosity: number
  saturation: number
  permMean: number
  permP95: number
}
type GeologyAnalysisResult = { res: number; contacts: number[]; layers: LayerStat[]; relief: Float32Array }
type StatsResult = {
  count: number
  min: number
  max: number
  mean: number
  p50: number
  p95: number
  histogram: Float32Array
  bins: number
}
type IsoResult = { positions: Float32Array; normals: Float32Array; count: number; res: number }

const spec = SCENES.geology
const geo = GEOLOGY_CONFIG
const volSize = [spec.volume.width, spec.volume.depth, spec.volume.height]

const panelOpen = ref(true)
const busy = ref(false)
const sectionBusy = ref(false)
const basemap = ref(false)
const mode = ref<Mode>('structure')
const analysis = ref<GeologyAnalysisResult | null>(null)
const stats = ref<StatsResult | null>(null)
const profile = ref<GeologyProfileResult | null>(null)
const overlay = ref<GeologyOverlay | null>(null)
const anomalyCount = ref(0)
const readyCount = ref(0)
let initialized = false

const profileCanvas = ref<HTMLCanvasElement | null>(null)

const HINTS = {
  mode: '工作模式：结构侧重层位 / 断层 / 标尺，岩性按地层分类着色，属性按连续属性着色并可做高值 / 异常分析，剖面输出 A–B 二维剖面，层位切片沿垂向逐层浏览。',
  basemap: '显示 Bing 卫星影像底图，提供地理参照；地下地层体叠加在影像之上渲染。',
  channel: '切换体数据通道：岩性为分类着色；孔隙率 / 渗透率 / 含水饱和度为连续属性标量，决定体渲染配色、直方图与统计口径。',
  highValue: '开启后按阈值透明度压暗低值体素，仅保留高值储层，用于快速圈定甜点区。',
  highThreshold: '高值区判定阈值（按当前属性取值范围的百分比）。高于该值的体素保持明亮，低于则透明度增大。',
  anomaly: '按异常分析通道（显示为属性时沿用该属性，显示为岩性时用孔隙率）提取等值面，以三维网格面叠加呈现属性异常区（如高孔隙储层、低渗隔夹层），不改变地层体当前配色。',
  anomalyThreshold: '异常体等值面的取值阈值（按异常分析通道取值范围的百分比）。值越高，圈定的异常区越小、越聚焦。',
  dip: '整套地层沿倾角方位倾斜的幅度，0 为水平。作用于统一构造场，层位、岩性与属性同步倾斜。',
  dipDir: '地层倾斜的方向（0° 指向东，逆时针为正）。与倾角共同定义地层产状。',
  foldAmp: '叠加在倾斜面上的波状起伏强度，模拟背斜 / 向斜褶皱，数值越大起伏越明显。',
  faultThrow: '断层 F1 两侧地层的垂直错断量，0 表示无断层；同时决定断层面位置与错断程度。',
  intrusion: '岩浆侵入体的空间尺度，并抬升周围热场，影响局部岩性替换与属性分布。',
  exag: '垂向放大倍数，仅改变显示比例（水平方向不变），便于观察薄层，不改变真实厚度与属性值。',
  azimuth: '剖面线 A–B 的水平走向方位角，决定剖面切过的方向，调整后自动重算剖面。',
  bandEnable: '开启水平层位切片，仅显示顶 / 底界深度之间的体素，用于逐层浏览地层。',
  bandTop: '切片顶界的相对位置（0% 为体底、100% 为地表）。',
  bandBottom: '切片底界的相对位置（0% 为体底、100% 为地表）。',
  opacity: '体渲染整体不透明度，数值越高体块越致密、越不透明。',
  gamma: '密度传递曲线指数：大于 1 压暗低密度体素、小于 1 增强低密度体素，用于调节浓淡对比。',
  soft: '对阈值附近体素做软化过渡，减小硬边和低值噪声造成的颗粒感。'
} as const

const form = reactive({
  dip: spec.params.dip as number,
  dipDir: spec.params.dipDir as number,
  foldAmp: spec.params.foldAmp as number,
  faultThrow: spec.params.faultThrow as number,
  intrusion: spec.params.intrusion as number,
  exag: 1.6
})

const layers = reactive({
  frame: true,
  faults: true,
  horizons: true,
  boreholes: true,
  volume: true
})

const layerVis = reactive<Record<number, boolean>>(
  Object.fromEntries(geo.layers.map((l) => [l.code, true]))
)
const hiddenLayerCodes = computed(() => geo.layers.filter((l) => !layerVis[l.code]).map((l) => l.code))

const highValue = reactive({ enabled: false, pct: 70 })
const anomaly = reactive({ enabled: false, pct: 85 })
const band = reactive({ enabled: false, min: 0, max: 100 })
const section = reactive({ azimuth: geo.faultDir })
const render = reactive({ gamma: 1, soft: 0 })

const modeOptions: { value: Mode; label: string }[] = [
  { value: 'structure', label: '结构' },
  { value: 'litho', label: '岩性' },
  { value: 'property', label: '属性' },
  { value: 'section', label: '剖面' },
  { value: 'slice', label: '层位切片' }
]

const scene = useVolumeScene(spec, {
  onReady: (engine) => {
    readyCount.value += 1
    // 构造参数变更会触发引擎整体重建（rebuild → initDone），onReady 会被再次回调。
    // 一次性初始化（叠加层安装 / 工程背景 / 地表球面 / 初始视角）只执行一次，
    // 避免重复安装叠加层与重建后再次 flyTo 造成视角跳动。
    if (initialized) return
    initialized = true
    overlay.value = installGeologyOverlay(engine)
    applyLayers()
    applyLayerVis()
    applyBasemap(engine)
    applyMode(mode.value)
    void runStructure(engine)
    installGeoState(engine)
  }
})
const { container, sliceCanvas } = scene

onBeforeUnmount(() => {
  overlay.value?.destroy()
  overlay.value = null
})

const isScalar = computed(() => scene.active().mode === 'scalar')
const activeProperty = computed(() => geo.properties.find((p) => p.key === scene.ui.channel))
const channelDef = computed(() => scene.active())

/**
 * 属性异常区所用的分析通道：与地层体当前的显示通道解耦。
 * 显示通道为连续属性时沿用该属性；显示为分类「岩性」时使用默认属性（孔隙率），
 * 这样勾选异常区不会改变地层体本身的渲染配色。
 */
const anomalyChannelKey = computed(() => (isScalar.value ? scene.ui.channel : (geo.properties[0]?.key ?? 'porosity')))
const anomalyChannelDef = computed<ChannelSpec>(
  () => spec.channels.find((c) => c.key === anomalyChannelKey.value) ?? channelDef.value
)

function engineOrNull(): VolumeEngine | null {
  return scene.engine.value ?? null
}

type GeoState = {
  mode: Mode
  channel: string
  hiddenLayers: number[]
  globeVisible: boolean
  basemap: boolean
  globeTranslucent: boolean
  layers: Record<'frame' | 'faults' | 'horizons' | 'boreholes' | 'volume', boolean>
  labelGroups: ReturnType<GeologyOverlay['debug']>
  readyCount: number
  anomalyCount: number
  camera: { heading: number; pitch: number; roll: number; height: number }
}

function installGeoState(engine: VolumeEngine): void {
  const emptyGroups: ReturnType<GeologyOverlay['debug']> = {
    frame: { show: false, labels: 0, labelsVisible: 0 },
    horizons: { show: false, labels: 0, labelsVisible: 0 },
    faults: { show: false, labels: 0, labelsVisible: 0 },
    boreholes: { show: false, labels: 0, labelsVisible: 0 }
  }
  const target = window as unknown as { __geoState?: GeoState }
  target.__geoState = {
    get mode() {
      return mode.value
    },
    get channel() {
      return scene.ui.channel
    },
    get hiddenLayers() {
      return hiddenLayerCodes.value
    },
    get globeVisible() {
      return engine.getViewer()?.scene.globe.show ?? false
    },
    get basemap() {
      return basemap.value
    },
    get globeTranslucent() {
      return engine.getViewer()?.scene.globe.translucency?.enabled ?? false
    },
    get layers() {
      return { ...layers }
    },
    get labelGroups() {
      return overlay.value?.debug() ?? emptyGroups
    },
    get readyCount() {
      return readyCount.value
    },
    get anomalyCount() {
      return anomalyCount.value
    },
    get camera() {
      const camera = engine.getViewer()?.camera
      if (!camera) return { heading: 0, pitch: 0, roll: 0, height: 0 }
      return { heading: camera.heading, pitch: camera.pitch, roll: camera.roll, height: camera.positionCartographic.height }
    }
  }
}

/* ----------------------------- 分析 ------------------------------ */

async function runStructure(engine: VolumeEngine | null = engineOrNull()): Promise<void> {
  if (!engine) return
  busy.value = true
  try {
    const result = await engine.analyze<GeologyAnalysisResult>({ mode: 'geology', res: 40, vres: 56 })
    if (!result) return
    analysis.value = result
    overlay.value?.updateStructure({ relief: result.relief, res: result.res, contacts: result.contacts })
  } finally {
    busy.value = false
  }
}

async function runStats(engine: VolumeEngine | null = engineOrNull()): Promise<void> {
  if (!engine || !isScalar.value) {
    stats.value = null
    return
  }
  busy.value = true
  try {
    const result = await engine.analyze<StatsResult>({ mode: 'stats', res: 40, channel: scene.ui.channel })
    stats.value = result ?? null
  } finally {
    busy.value = false
  }
}

async function runAnomaly(engine: VolumeEngine | null = engineOrNull()): Promise<void> {
  if (!engine) return
  if (!anomaly.enabled) {
    engine.clearIsosurface('geology-anomaly')
    anomalyCount.value = 0
    return
  }
  busy.value = true
  try {
    const ch = anomalyChannelDef.value
    const iso = valueAtPct(anomaly.pct, ch)
    const result = await engine.analyze<IsoResult>({
      mode: 'isosurface',
      iso,
      res: 48,
      channel: ch.key,
      volSize
    })
    if (!result || !result.count) {
      engine.clearIsosurface('geology-anomaly')
      anomalyCount.value = 0
      return
    }
    // 颜色按异常分析通道自身的色带与取值范围映射，不改动地层体当前的显示通道
    const lut = buildTransferLut(ch.palette)
    const idx = Math.round(Math.max(0, Math.min(1, valueToNormalized(ch, iso))) * 255)
    engine.setIsosurface(result.positions, result.normals, [lut[idx * 4] / 255, lut[idx * 4 + 1] / 255, lut[idx * 4 + 2] / 255], 0.72, 'geology-anomaly')
    anomalyCount.value = result.count
  } finally {
    busy.value = false
  }
}

function sectionEndpoints(): { a: [number, number]; b: [number, number] } {
  const beta = (section.azimuth * Math.PI) / 180
  const dx = Math.cos(beta) * 0.44
  const dy = Math.sin(beta) * 0.44
  const clamp = (v: number): number => Math.max(0.05, Math.min(0.95, v))
  return { a: [clamp(0.5 - dx), clamp(0.5 - dy)], b: [clamp(0.5 + dx), clamp(0.5 + dy)] }
}

async function runProfile(engine: VolumeEngine | null = engineOrNull()): Promise<void> {
  if (!engine) return
  sectionBusy.value = true
  try {
    const { a, b } = sectionEndpoints()
    const result = await engine.analyze<GeologyProfileResult>({
      mode: 'geologyProfile',
      a,
      b,
      steps: 180,
      levels: 100,
      channel: scene.ui.channel
    })
    if (!result) return
    profile.value = result
    drawProfile()
  } finally {
    sectionBusy.value = false
  }
}

function drawProfile(): void {
  if (!profileCanvas.value || !profile.value) return
  drawGeologySection(profileCanvas.value, profile.value, {
    channel: scene.ui.channel,
    palette: scene.ui.palette,
    valueMin: scene.ui.valueMin,
    valueMax: scene.ui.valueMax,
    log: channelDef.value.logScale,
    heightM: spec.volume.height,
    lengthM: Math.hypot(volSize[0], volSize[1]) * 0.88
  })
}

function exportProfile(): void {
  const canvas = profileCanvas.value
  if (!canvas) return
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `geology-section-${scene.ui.channel}-az${Math.round(section.azimuth)}.png`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'image/png')
}

/* ----------------------------- 交互 ------------------------------ */

function valueAtPct(pct: number, ch: ChannelSpec = channelDef.value): number {
  if (ch.logScale && ch.min > 0) {
    return Math.exp(Math.log(ch.min) + (Math.log(ch.max) - Math.log(ch.min)) * (pct / 100))
  }
  return ch.min + (ch.max - ch.min) * (pct / 100)
}

/** 按指定通道的取值范围把数据值归一化到 0~1（与引擎 valueToNormalized 同口径） */
function valueToNormalized(ch: ChannelSpec, value: number): number {
  if (ch.logScale && ch.min > 0 && value > 0) {
    return (Math.log(value) - Math.log(ch.min)) / (Math.log(ch.max) - Math.log(ch.min) || 1)
  }
  return (value - ch.min) / (ch.max - ch.min || 1)
}

function onChannel(key: string): void {
  scene.setChannel(key)
  const ch = SCENES.geology.channels.find((c) => c.key === key)
  scene.engine.value?.setLogScale(!!ch?.logScale)
  highValue.enabled = false
  anomaly.enabled = false
  scene.engine.value?.setThreshold(undefined)
  scene.engine.value?.clearIsosurface('geology-anomaly')
  if (isScalar.value) void runStats()
  else stats.value = null
}

function applyMode(key: Mode): void {
  mode.value = key
  const e = engineOrNull()
  if (!e) return
  if (key !== 'section' && key !== 'slice') resetClip()
  if (key === 'structure') {
    setExag(1.6)
    layers.frame = true
    layers.faults = true
    layers.horizons = true
    layers.boreholes = true
    applyLayers()
    onChannel('litho')
    e.flyToView(geo.camera.structure.heading, geo.camera.structure.pitch, geo.camera.structure.rangeFactor, 0.8)
  } else if (key === 'litho') {
    setExag(1)
    layers.horizons = false
    applyLayers()
    onChannel('litho')
    e.flyToView(geo.camera.overview.heading, geo.camera.overview.pitch, geo.camera.overview.rangeFactor, 0.8)
  } else if (key === 'property') {
    setExag(1)
    layers.horizons = false
    applyLayers()
    const target = isScalar.value ? scene.ui.channel : 'porosity'
    onChannel(target)
    e.flyToView(geo.camera.overview.heading, geo.camera.overview.pitch, geo.camera.overview.rangeFactor, 0.8)
  } else if (key === 'section') {
    setExag(1)
    layers.horizons = false
    applyLayers()
    applySection(true)
    e.flyToView(geo.camera.section.heading, geo.camera.section.pitch, geo.camera.section.rangeFactor, 0.8)
  } else if (key === 'slice') {
    setExag(1)
    layers.horizons = false
    applyLayers()
    band.enabled = true
    band.min = 20
    band.max = 60
    onBand()
    e.flyToView(geo.camera.top.heading, geo.camera.top.pitch, geo.camera.top.rangeFactor, 0.8)
  }
}

function resetClip(): void {
  scene.ui.clipEnabled = false
  scene.setClip()
}

function applySection(enabled: boolean, refresh = true): void {
  scene.ui.clipEnabled = enabled
  scene.ui.azimuth = ((section.azimuth - 90) % 360 + 360) % 360
  scene.ui.tilt = 0
  scene.ui.offset = 0
  scene.setClip()
  if (enabled && refresh) void runProfile()
}

function setExag(value: number): void {
  form.exag = value
  const e = engineOrNull()
  if (!e) return
  e.setVerticalExaggeration(value)
  overlay.value?.rebuild()
}

function applyLayers(): void {
  overlay.value?.setVisible({
    frame: layers.frame,
    faults: layers.faults,
    horizons: layers.horizons,
    boreholes: layers.boreholes
  })
  scene.engine.value?.setVolumeVisible(layers.volume)
}

function toggleLayer(key: string): void {
  const k = key as keyof typeof layers
  if (!(k in layers)) return
  layers[k] = !layers[k]
  applyLayers()
}

function applyLayerVis(): void {
  scene.engine.value?.setLayerVisibility(hiddenLayerCodes.value)
}

function toggleLayerVis(code: number): void {
  layerVis[code] = !layerVis[code]
  applyLayerVis()
}

function showAllLayers(): void {
  geo.layers.forEach((l) => {
    layerVis[l.code] = true
  })
  applyLayerVis()
}

function applyBasemap(engine: VolumeEngine | null = engineOrNull()): void {
  if (!engine) return
  engine.setImageryBasemap(basemap.value)
}

function toggleBasemap(): void {
  basemap.value = !basemap.value
  applyBasemap()
}

function onDockToggle(key: string): void {
  if (key === 'anomaly') {
    toggleAnomaly()
    return
  }
  toggleLayer(key)
}

function onDockToggleAll(): void {
  const allOn = layers.volume && layers.frame && layers.horizons && layers.faults && layers.boreholes && anomaly.enabled
  const target = !allOn
  layers.volume = target
  layers.frame = target
  layers.horizons = target
  layers.faults = target
  layers.boreholes = target
  applyLayers()
  setAnomalyEnabled(target)
}

function applyStructure(): void {
  const e = engineOrNull()
  if (!e) return
  e.setParams({
    dip: form.dip,
    dipDir: form.dipDir,
    foldAmp: form.foldAmp,
    faultThrow: form.faultThrow,
    intrusion: form.intrusion
  })
  window.setTimeout(() => {
    e.setVerticalExaggeration(form.exag)
    overlay.value?.rebuild()
    if (mode.value === 'section') applySection(true, false)
    else if (mode.value === 'slice') onBand()
    void runStructure(e)
    if (isScalar.value) void runStats(e)
    if (mode.value === 'section') void runProfile(e)
  }, 300)
}

function onBand(): void {
  const e = engineOrNull()
  if (!e) return
  e.setHeightClip(band.min / 100, band.max / 100, band.enabled)
}

function toggleBand(): void {
  band.enabled = !band.enabled
  onBand()
}

function applyHighValue(): void {
  const e = engineOrNull()
  if (!e) return
  e.setThreshold(highValue.enabled && isScalar.value ? valueAtPct(highValue.pct) : undefined)
}

function toggleHighValue(): void {
  highValue.enabled = !highValue.enabled
  applyHighValue()
}

function setAnomalyEnabled(next: boolean): void {
  // 异常体等值面使用独立的分析通道（分类通道下为默认属性），
  // 不切换地层体的显示通道，避免勾选后体渲染配色发生变化。
  anomaly.enabled = next
  void runAnomaly()
}

function toggleAnomaly(): void {
  setAnomalyEnabled(!anomaly.enabled)
}

function applySectionAngle(): void {
  applySection(true)
}

function applyRender(): void {
  scene.setOpacity()
  engineOrNull()?.setRenderParams({ densityGamma: render.gamma, thresholdSoft: render.soft })
}

/* ----------------------------- 视图数据 ------------------------------ */

const dockItems = computed<LayerDockItem[]>(() => [
  { key: 'volume', label: '地层体', color: '#6ea8d8', on: layers.volume, hint: '三维地层属性体本身' },
  { key: 'frame', label: '体域框 / 标尺', color: '#9fc8e8', on: layers.frame, hint: '三维体域框线与深度标尺、指北针' },
  { key: 'horizons', label: '层位界面', color: '#d8b04a', on: layers.horizons, hint: '各地层接触面网格，突出构造起伏' },
  { key: 'faults', label: '断层面 F1', color: '#ff7a4a', on: layers.faults, hint: '断层错断位置' },
  { key: 'boreholes', label: '钻孔柱状', color: '#ffd21e', on: layers.boreholes, hint: 'ZK-01 ~ ZK-03 钻孔分层柱状' },
  { key: 'anomaly', label: '属性异常区', color: '#ff5a3c', on: anomaly.enabled, hint: '按阈值提取的属性异常体等值面' }
])

const legendCss = computed(() => (isScalar.value ? gradientCss(scene.ui.palette) : ''))

const legendMin = computed(() => (isScalar.value ? `${scene.ui.valueMin} ${channelDef.value.unit}` : ''))
const legendMax = computed(() => (isScalar.value ? `${scene.ui.valueMax} ${channelDef.value.unit}` : ''))

const alphaLut = computed(() => buildTransferLut(channelDef.value.palette))

const histogram = computed(() => {
  const s = stats.value
  if (!s) return []
  let max = 0
  for (let i = 0; i < s.bins; i += 1) if (s.histogram[i] > max) max = s.histogram[i]
  const lut = alphaLut.value
  return Array.from({ length: s.bins }, (_, i) => {
    const idx = Math.min(255, Math.round((i / (s.bins - 1)) * 255)) * 4
    return {
      ratio: max ? s.histogram[i] / max : 0,
      color: `rgb(${lut[idx]}, ${lut[idx + 1]}, ${lut[idx + 2]})`
    }
  })
})

const layerRows = computed(() =>
  (analysis.value?.layers ?? [])
    .filter((l) => l.fraction > 0.001)
    .map((l) => {
      const def = geo.layers.find((x) => x.code === l.code)
      return {
        code: l.code,
        name: def?.name ?? `岩性 #${l.code}`,
        color: def?.color ?? [150, 150, 150],
        role: def?.role ?? '',
        thicknessM: l.thicknessNorm * spec.volume.height,
        porosity: l.porosity,
        saturation: l.saturation,
        permP95: l.permP95
      }
    })
)

const statItems = computed<StatItem[]>(() => {
  const engine = scene.engine.value
  const items: StatItem[] = [
    { label: '等效分辨率', value: engine ? `${engine.fullDims}³` : '—' },
    { label: '已加载瓦片', value: scene.stats.tilesReady.toLocaleString() },
    { label: '垂向夸张', value: `×${form.exag.toFixed(1)}` }
  ]
  const s = stats.value
  if (s && isScalar.value) {
    const unit = channelDef.value.unit
    items.push({ label: '最小值', value: `${s.min.toFixed(1)} ${unit}` })
    items.push({ label: '均值', value: `${s.mean.toFixed(1)} ${unit}` })
    items.push({ label: 'P95', value: `${s.p95.toFixed(1)} ${unit}` })
  }
  return items
})

const clipRows = computed<StatItem[]>(() => [
  { label: '顶底裁剪', value: band.enabled ? `${band.min}% ~ ${band.max}%` : '关闭' },
  { label: '剖切方位', value: `${Math.round(scene.ui.azimuth)}°` },
  { label: '剖切倾角', value: `${scene.ui.tilt}°` },
  { label: '剖切偏移', value: `${scene.ui.offset}%` }
])

const pickedView = computed<PickedView | null>(() => {
  const p = scene.picked.value
  if (!p) return null
  if (!p.valid) return { title: '体素拾取', rows: [], empty: '该处无有效体元素' }
  const rows: StatItem[] = []
  if (scene.active().mode === 'categorical') {
    const cat = spec.categories?.find((c) => c.code === Math.round(p.value))
    rows.push({ label: '岩性', value: cat ? cat.label : `#${Math.round(p.value)}` })
  } else {
    const ch = scene.active()
    const show = ch.logScale && p.value > 0 ? p.value.toFixed(2) : p.value.toFixed(ch.decimals ?? 1)
    rows.push({ label: ch.label, value: `${show} ${ch.unit}` })
  }
  if (p.lon !== undefined && p.lat !== undefined) {
    rows.push({ label: '经度 / 纬度', value: `${p.lon.toFixed(3)}, ${p.lat.toFixed(3)}` })
    rows.push({ label: '埋深', value: `${(-(p.height ?? 0)).toFixed(0)} m` })
  }
  return { title: '体素拾取', rows }
})
</script>

<template>
  <VolumeShell
    title="三维地层属性体"
    :status="scene.status.value"
    :panel-open="panelOpen"
    :legend-css="legendCss"
    :legend-min="legendMin"
    :legend-max="legendMax"
    :stats="statItems"
    :clip-rows="clipRows"
    :show-clip-panel="mode === 'slice'"
    :has-slice="scene.hasSlice.value"
    :picked="pickedView"
    @toggle-panel="panelOpen = !panelOpen"
    @download-slice="scene.downloadSlice()"
  >
    <template #scene>
      <div ref="container" class="vol-cesium"></div>

      <div v-if="mode === 'section'" class="gl-section">
        <div class="gl-section-head">
          <span>A–B 地质剖面</span>
          <button class="gl-section-export" :disabled="!profile" @click="exportProfile">导出 PNG</button>
        </div>
        <canvas ref="profileCanvas" class="gl-section-canvas"></canvas>
        <div class="gl-section-foot">
          <span v-if="sectionBusy">剖面计算中…</span>
          <span v-else>{{ channelDef.label }} · 方位 {{ Math.round(section.azimuth) }}° · {{ geo.layers.length }} 套地层</span>
        </div>
      </div>

      <div v-if="mode === 'slice'" class="gl-slice-note">
        层位切片：拖动“层位深度”滑块沿垂向扫描水平层位
      </div>
    </template>

    <template #slice>
      <canvas ref="sliceCanvas" :class="{ hidden: !scene.hasSlice.value }"></canvas>
    </template>

    <template #legend>
      <div class="gl-title gl-tier-title">
        <span>地层显隐（点击切换）</span>
        <button v-if="hiddenLayerCodes.length" class="gl-tier-reset" @click="showAllLayers">全部显示</button>
      </div>
      <button
        v-for="l in geo.layers"
        :key="l.code"
        type="button"
        class="gl-tier"
        :class="{ off: !layerVis[l.code] }"
        @click="toggleLayerVis(l.code)"
      >
        <i :style="{ background: `rgb(${l.color[0]}, ${l.color[1]}, ${l.color[2]})` }"></i>
        <span>{{ l.name }}</span>
        <b>{{ l.role }}</b>
        <em class="gl-tier-eye">{{ layerVis[l.code] ? '显示' : '隐藏' }}</em>
      </button>

      <div v-if="isScalar && histogram.length" class="gl-hist">
        <div class="gl-hist-title">属性分布直方图</div>
        <div class="gl-hist-bars">
          <i v-for="(bar, i) in histogram" :key="i" :style="{ height: `${Math.max(3, bar.ratio * 100)}%`, background: bar.color }"></i>
        </div>
        <div class="gl-hist-range">
          <span>{{ stats?.min.toFixed(1) }}</span>
          <span>{{ stats?.max.toFixed(1) }}</span>
        </div>
      </div>

      <div v-if="layerRows.length" class="gl-layers">
        <div class="gl-hist-title">分层统计</div>
        <div class="gl-layer-head">
          <span>地层</span><span>厚度</span><span>孔隙率</span><span>渗透率P95</span>
        </div>
        <div class="gl-layer-row" v-for="row in layerRows" :key="row.code">
          <span><i :style="{ background: `rgb(${row.color[0]}, ${row.color[1]}, ${row.color[2]})` }"></i>{{ row.name }}</span>
          <span>{{ row.thicknessM.toFixed(0) }}m</span>
          <span>{{ row.porosity.toFixed(1) }}%</span>
          <span>{{ row.permP95.toFixed(1) }}</span>
        </div>
      </div>
    </template>

    <template #controls>
      <div class="gl-block">
        <div class="vol-section">工作模式
          <ParamHint :text="HINTS.mode" />
        </div>
        <div class="gl-modes">
          <button
            v-for="m in modeOptions"
            :key="m.value"
            type="button"
            class="gl-mode"
            :class="{ active: mode === m.value }"
            @click="applyMode(m.value)"
          >
            {{ m.label }}
          </button>
        </div>
      </div>

      <div class="gl-block">
        <div class="vol-section">数据通道
          <ParamHint :text="HINTS.channel" />
        </div>
        <div class="gl-channels">
          <button
            v-for="ch in spec.channels"
            :key="ch.key"
            type="button"
            class="gl-channel"
            :class="{ active: scene.ui.channel === ch.key, categorical: ch.mode === 'categorical' }"
            @click="onChannel(ch.key)"
          >
            {{ ch.label }}
          </button>
        </div>
        <div class="gl-hint">{{ activeProperty ? activeProperty.hint : '按岩性分类着色，叠加层位界面可读构造' }}</div>
      </div>

      <div class="gl-block">
        <div class="vol-section">属性分析
          <ParamHint text="高值区按阈值透明度压暗低值；异常体以等值面提取，用于刻画储层甜点或隔夹层。异常区基于独立属性通道计算，不改变地层体当前的显示配色。" />
        </div>
        <template v-if="isScalar">
          <div class="vol-row">
            <span class="vol-label gl-plabel">高值区<ParamHint :text="HINTS.highValue" /></span>
            <button class="vol-switch" :class="{ 'is-on': highValue.enabled }" @click="toggleHighValue"><span></span></button>
          </div>
          <div class="vol-row">
            <span class="vol-label gl-plabel">高值阈值<ParamHint :text="HINTS.highThreshold" /></span>
            <input type="range" min="10" max="95" step="1" v-model.number="highValue.pct" @input="applyHighValue" />
            <span class="vol-value">{{ valueAtPct(highValue.pct).toFixed(1) }}</span>
          </div>
        </template>
        <div class="vol-row">
          <span class="vol-label gl-plabel">异常体等值面<ParamHint :text="HINTS.anomaly" /></span>
          <button class="vol-switch" :class="{ 'is-on': anomaly.enabled }" @click="toggleAnomaly"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label gl-plabel">异常阈值<ParamHint :text="HINTS.anomalyThreshold" /></span>
          <input type="range" min="40" max="98" step="1" v-model.number="anomaly.pct" @change="runAnomaly()" />
          <span class="vol-value">{{ valueAtPct(anomaly.pct, anomalyChannelDef).toFixed(1) }} {{ anomalyChannelDef.unit }}</span>
        </div>
        <div class="gl-hint">异常区基于「{{ anomalyChannelDef.label }}」通道计算，地层体配色保持不变</div>
      </div>

      <div class="gl-block">
        <div class="vol-section">构造参数
          <ParamHint text="地层倾斜、褶皱、断层与侵入体共用同一构造场，层位、岩性与属性同步变化。" />
        </div>
        <div class="vol-row">
          <span class="vol-label gl-plabel">地层倾角<ParamHint :text="HINTS.dip" /></span>
          <input type="range" min="0" max="0.12" step="0.005" v-model.number="form.dip" @change="applyStructure" />
          <span class="vol-value">{{ form.dip.toFixed(3) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label gl-plabel">倾角方位<ParamHint :text="HINTS.dipDir" /></span>
          <input type="range" min="0" max="360" step="5" v-model.number="form.dipDir" @change="applyStructure" />
          <span class="vol-value">{{ form.dipDir }}°</span>
        </div>
        <div class="vol-row">
          <span class="vol-label gl-plabel">褶皱幅度<ParamHint :text="HINTS.foldAmp" /></span>
          <input type="range" min="0" max="0.12" step="0.005" v-model.number="form.foldAmp" @change="applyStructure" />
          <span class="vol-value">{{ form.foldAmp.toFixed(3) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label gl-plabel">断层落差<ParamHint :text="HINTS.faultThrow" /></span>
          <input type="range" min="0" max="0.12" step="0.005" v-model.number="form.faultThrow" @change="applyStructure" />
          <span class="vol-value">{{ form.faultThrow.toFixed(3) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label gl-plabel">侵入体规模<ParamHint :text="HINTS.intrusion" /></span>
          <input type="range" min="0.04" max="0.2" step="0.005" v-model.number="form.intrusion" @change="applyStructure" />
          <span class="vol-value">{{ form.intrusion.toFixed(3) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label gl-plabel">垂向夸张<ParamHint :text="HINTS.exag" /></span>
          <input type="range" min="0.5" max="4" step="0.1" v-model.number="form.exag" @input="setExag(form.exag)" />
          <span class="vol-value">×{{ form.exag.toFixed(1) }}</span>
        </div>
      </div>

      <div v-if="mode === 'section'" class="gl-block">
        <div class="vol-section">剖面方位</div>
        <div class="vol-row">
          <span class="vol-label gl-plabel">A–B 走向<ParamHint :text="HINTS.azimuth" /></span>
          <input type="range" min="0" max="180" step="5" v-model.number="section.azimuth" @change="applySectionAngle" />
          <span class="vol-value">{{ Math.round(section.azimuth) }}°</span>
        </div>
        <button class="gl-btn" :disabled="sectionBusy" @click="runProfile()">{{ sectionBusy ? '计算中…' : '重算剖面' }}</button>
      </div>

      <div v-if="mode === 'slice' || band.enabled" class="gl-block">
        <div class="vol-section">层位切片</div>
        <div class="vol-row">
          <span class="vol-label gl-plabel">启用<ParamHint :text="HINTS.bandEnable" /></span>
          <button class="vol-switch" :class="{ 'is-on': band.enabled }" @click="toggleBand"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label gl-plabel">顶界深度<ParamHint :text="HINTS.bandTop" /></span>
          <input type="range" min="0" max="100" step="1" v-model.number="band.min" @input="onBand" />
          <span class="vol-value">{{ band.min }}%</span>
        </div>
        <div class="vol-row">
          <span class="vol-label gl-plabel">底界深度<ParamHint :text="HINTS.bandBottom" /></span>
          <input type="range" min="0" max="100" step="1" v-model.number="band.max" @input="onBand" />
          <span class="vol-value">{{ band.max }}%</span>
        </div>
      </div>

      <div class="gl-block">
        <div class="vol-section">底图</div>
        <div class="vol-row">
          <span class="vol-label gl-plabel">影像底图<ParamHint :text="HINTS.basemap" /></span>
          <button class="vol-switch" :class="{ 'is-on': basemap }" @click="toggleBasemap"><span></span></button>
        </div>
      </div>

      <div class="gl-block">
        <div class="vol-section">渲染</div>
        <div class="vol-row">
          <span class="vol-label gl-plabel">不透明度<ParamHint :text="HINTS.opacity" /></span>
          <input type="range" min="0.15" max="1" step="0.02" v-model.number="scene.ui.opacity" @input="scene.setOpacity()" />
          <span class="vol-value">{{ scene.ui.opacity.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label gl-plabel">密度压缩<ParamHint :text="HINTS.gamma" /></span>
          <input type="range" min="0.5" max="2.5" step="0.05" v-model.number="render.gamma" @input="applyRender" />
          <span class="vol-value">{{ render.gamma.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label gl-plabel">低值软切<ParamHint :text="HINTS.soft" /></span>
          <input type="range" min="0" max="0.3" step="0.01" v-model.number="render.soft" @input="applyRender" />
          <span class="vol-value">{{ render.soft.toFixed(2) }}</span>
        </div>
      </div>
    </template>

    <template #actions>
      <button class="vol-action" :disabled="busy" @click="runStructure()">{{ busy ? '计算中…' : '重算地层结构' }}</button>
      <button class="vol-action ghost" @click="scene.engine.value?.resetCamera(1)">恢复视图</button>
    </template>

    <template #dock>
      <LayerDock :items="dockItems" title="地层图层" @toggle="onDockToggle" @toggle-all="onDockToggleAll" />
    </template>
  </VolumeShell>
</template>

<style scoped>
.gl-block {
  margin-bottom: 10px;
}
.vol-label.gl-plabel {
  white-space: nowrap;
}
.gl-title {
  margin-top: 6px;
  font-size: 11px;
  font-weight: 700;
  color: #65d3eb;
}
.gl-modes {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.gl-mode {
  padding: 6px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.gl-mode.active {
  border-color: #2f80ed;
  background: #2f80ed;
  color: #fff;
  font-weight: 600;
}
.gl-channels {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
}
.gl-channel {
  padding: 6px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.gl-channel.categorical {
  border-style: dashed;
}
.gl-channel.active {
  border-color: #d8b04a;
  background: rgba(216, 176, 74, 0.24);
  color: #fff;
  font-weight: 600;
}
.gl-btn {
  width: 100%;
  height: 26px;
  margin-top: 6px;
  border: 0;
  border-radius: 5px;
  background: #2f80ed;
  color: #eef4ff;
  font-size: 11px;
  cursor: pointer;
}
.gl-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.gl-hint {
  margin-top: 5px;
  font-size: 9px;
  line-height: 1.5;
  color: #7f96b3;
}
.gl-tier-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.gl-tier-reset {
  padding: 1px 6px;
  border: 1px solid rgba(101, 211, 235, 0.45);
  border-radius: 4px;
  background: rgba(101, 211, 235, 0.12);
  color: #65d3eb;
  font-size: 9px;
  cursor: pointer;
}
.gl-tier {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin-top: 4px;
  padding: 3px 5px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 10px;
  color: #c3d5e8;
  cursor: pointer;
  text-align: left;
}
.gl-tier:hover {
  border-color: rgba(101, 211, 235, 0.4);
}
.gl-tier.off {
  opacity: 0.45;
  background: rgba(255, 255, 255, 0.01);
}
.gl-tier.off i {
  box-shadow: none;
  filter: grayscale(1);
}
.gl-tier.off span,
.gl-tier.off b {
  text-decoration: line-through;
}
.gl-tier i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex: 0 0 auto;
}
.gl-tier span {
  flex: 0 0 52px;
}
.gl-tier b {
  flex: 1 1 auto;
  text-align: right;
  color: #9fc8e8;
  font-weight: 500;
}
.gl-tier-eye {
  flex: 0 0 auto;
  font-size: 9px;
  font-style: normal;
  color: #65d3eb;
}
.gl-tier.off .gl-tier-eye {
  color: #7b8fa6;
}
.gl-hist {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
}
.gl-hist-title {
  font-size: 10px;
  font-weight: 700;
  color: #65d3eb;
  margin-bottom: 4px;
}
.gl-hist-bars {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 58px;
  padding: 2px;
  box-sizing: border-box;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
}
.gl-hist-bars i {
  flex: 1 1 0;
  border-radius: 1px 1px 0 0;
  opacity: 0.92;
}
.gl-hist-range {
  display: flex;
  justify-content: space-between;
  margin-top: 3px;
  font-size: 9px;
  color: #9fb8d4;
  font-variant-numeric: tabular-nums;
}
.gl-layers {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
}
.gl-layer-head,
.gl-layer-row {
  display: grid;
  grid-template-columns: 1.5fr 0.8fr 0.8fr 1fr;
  gap: 2px;
  align-items: center;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}
.gl-layer-head {
  color: #7f96b3;
  margin-bottom: 3px;
}
.gl-layer-row {
  color: #c3d5e8;
  padding: 2px 0;
}
.gl-layer-row span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.gl-layer-row i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex: 0 0 auto;
}
.gl-layer-row span:not(:first-child) {
  text-align: right;
}
.gl-section {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  z-index: 9;
  width: min(520px, calc(100% - 48px));
  padding: 8px 10px 7px;
  box-sizing: border-box;
  border: 1px solid rgba(101, 211, 235, 0.35);
  border-radius: 9px;
  background: rgba(6, 18, 34, 0.9);
  backdrop-filter: blur(6px);
}
.gl-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
  font-size: 11px;
  font-weight: 700;
  color: #65d3eb;
}
.gl-section-export {
  height: 20px;
  padding: 0 8px;
  border: 1px solid rgba(47, 128, 237, 0.7);
  border-radius: 5px;
  background: rgba(47, 128, 237, 0.18);
  color: #9fd8ff;
  font-size: 10px;
  cursor: pointer;
}
.gl-section-export:disabled {
  opacity: 0.45;
  cursor: default;
}
.gl-section-canvas {
  display: block;
  width: 100%;
  height: 168px;
}
.gl-section-foot {
  margin-top: 4px;
  font-size: 9px;
  color: #9fb8d4;
  text-align: center;
}
.gl-slice-note {
  position: absolute;
  left: 50%;
  top: 14px;
  transform: translateX(-50%);
  z-index: 9;
  padding: 5px 12px;
  border: 1px solid rgba(101, 211, 235, 0.3);
  border-radius: 7px;
  background: rgba(6, 18, 34, 0.82);
  color: #9fd8ff;
  font-size: 10px;
}
</style>
