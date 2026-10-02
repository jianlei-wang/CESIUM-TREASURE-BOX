<script setup lang="ts">
/**
 * 三维天气雷达回波与对流分析工作台
 *
 * 以雷达站为中心的回波体为底座，围绕雷达业务分析流程编排：
 *   回波分级定位 → 回波顶高/强对流核心 → 地面覆盖/顶高平面 → 35/45 dBZ 等值面
 *   → 雷达站/距离圈/顶高参考环 → 时间演变 → 任意方向剖切 → 体素拾取。
 *
 * 阈值、距离圈、相机预设等业务参数集中在 SCENES.radar / RADAR_CONFIG，组件不硬编码魔法数字。
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { Color } from 'cesium'
import VolumeShell from '../../lib/volume-engine/VolumeShell.vue'
import ParamHint from '../../lib/volume-engine/ParamHint.vue'
import LayerDock from '../../lib/volume-engine/LayerDock.vue'
import { useVolumeScene } from '../../lib/volume-engine/useVolumeScene'
import { RADAR_CONFIG, SCENES } from '../../lib/volume-engine/scenes'
import { gradientCss, radarColorAt } from '../../lib/volume-engine/palette'
import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'
import type { LayerDockItem, PickedView, StatItem } from '../../lib/volume-engine/types'
import { installRadarOverlay, type RadarOverlay } from './radar-overlay'
import {
  drawTrendChart,
  installGroundLayer,
  type GroundLayer,
  type RadarAnalysisResult,
  type RadarTrendResult
} from './radar-analysis'

const spec = SCENES.radar
const radar = RADAR_CONFIG
const volumeSize = [spec.volume.width, spec.volume.depth, spec.volume.height]
const heightKm = spec.volume.height / 1000

const panelOpen = ref(true)
const busy = ref(false)
const trendBusy = ref(false)
const isoBusy = ref(false)
const analysis = ref<RadarAnalysisResult | null>(null)
const trend = ref<RadarTrendResult | null>(null)

const overlay = ref<RadarOverlay | null>(null)
const ground = ref<GroundLayer | null>(null)
const trendCanvas = ref<HTMLCanvasElement | null>(null)

const form = reactive({
  cells: spec.params.cells as number,
  wind: spec.params.wind as number,
  topThreshold: radar.analysis.topThreshold,
  coreThreshold: radar.analysis.coreThreshold,
  showCores: true,
  isoWeak: false,
  isoStrong: false
})

const layers = reactive({
  rings: true,
  directions: true,
  station: true,
  topLadder: true,
  ground: true,
  groundField: 'max' as 'max' | 'top'
})

const band = reactive({ enabled: false, min: 0, max: 100 })
const render = reactive({ densityGamma: 1 })
let isoTimer: ReturnType<typeof setTimeout> | undefined

const tiers = [
  { label: '弱回波', min: 0, max: radar.thresholds.weak, color: '#0d7fe0' },
  { label: '中等回波', min: radar.thresholds.weak, max: radar.thresholds.moderate, color: '#2ecc40' },
  { label: '强回波', min: radar.thresholds.moderate, max: radar.thresholds.strong, color: '#ffd21e' },
  { label: '特强回波', min: radar.thresholds.strong, max: radar.thresholds.extreme, color: '#ff5a20' },
  { label: '极端回波', min: radar.thresholds.extreme, max: 70, color: '#ff2a1e' }
]

const coreColor = (dbz: number): Color => {
  const c = radarColorAt(dbz)
  return new Color(c[0] / 255, c[1] / 255, c[2] / 255, 0.98)
}

const scene = useVolumeScene(spec, {
  onReady: (engine) => {
    overlay.value = installRadarOverlay(engine)
    ground.value = installGroundLayer(engine)
    applyLayerVisibility()
    void runAnalysis(engine)
    void runTrend(engine)
  }
})
const { container, sliceCanvas } = scene

function engineOrNull(): VolumeEngine | null {
  return scene.engine.value ?? null
}

function applyLayerVisibility(): void {
  overlay.value?.setVisible({
    rings: layers.rings,
    directions: layers.directions,
    station: layers.station,
    topLadder: layers.topLadder
  })
  ground.value?.setVisible(layers.ground)
}

async function runAnalysis(engine: VolumeEngine | null = engineOrNull()): Promise<void> {
  if (!engine) return
  busy.value = true
  try {
    const result = await engine.analyze<RadarAnalysisResult>({
      mode: 'radar',
      res: 44,
      vertical: 48,
      topThreshold: form.topThreshold,
      coreThreshold: form.coreThreshold,
      volSize: volumeSize
    })
    if (!result) return
    analysis.value = result
    if (layers.ground) ground.value?.update(result, layers.groundField)
    applyCorePoints(result)
  } finally {
    busy.value = false
  }
}

function applyCorePoints(result: RadarAnalysisResult | null): void {
  const e = engineOrNull()
  if (!e) return
  if (!form.showCores || !result || !result.coreCount) {
    e.clearOverlayPoints()
    return
  }
  e.setOverlayPoints(
    Array.from({ length: result.coreCount }, (_, i) => ({
      position: e.localFromNormalized(
        result.corePos[i * 3],
        result.corePos[i * 3 + 1],
        result.corePos[i * 3 + 2]
      ),
      color: coreColor(result.corePeak[i]),
      pixelSize: 11,
      label: `#${i + 1}`,
      labelColor: coreColor(result.corePeak[i])
    }))
  )
}

async function runTrend(engine: VolumeEngine | null = engineOrNull()): Promise<void> {
  if (!engine) return
  trendBusy.value = true
  try {
    const result = await engine.analyze<RadarTrendResult>({
      mode: 'radarTrend',
      steps: spec.timeSteps,
      res: 18,
      vertical: 16,
      topThreshold: form.topThreshold,
      volSize: volumeSize
    })
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
    if (form.isoWeak) {
      const r = await engine.analyze<{ positions: Float32Array; normals: Float32Array }>({
        mode: 'isosurface',
        iso: radar.thresholds.moderate,
        res: 56,
        volSize: volumeSize
      })
      if (r) engine.setIsosurface(r.positions, r.normals, [46, 220, 66], 0.22, 'radar-35')
    } else {
      engine.clearIsosurface('radar-35')
    }
    if (form.isoStrong) {
      const r = await engine.analyze<{ positions: Float32Array; normals: Float32Array }>({
        mode: 'isosurface',
        iso: radar.thresholds.strong,
        res: 56,
        volSize: volumeSize
      })
      if (r) engine.setIsosurface(r.positions, r.normals, [255, 90, 32], 0.5, 'radar-45')
    } else {
      engine.clearIsosurface('radar-45')
    }
  } finally {
    isoBusy.value = false
  }
}

function scheduleIso(): void {
  const e = engineOrNull()
  if (!e || (!form.isoWeak && !form.isoStrong)) return
  if (isoTimer) clearTimeout(isoTimer)
  isoTimer = setTimeout(() => void runIsosurfaces(e), 140)
}

function applyForm(): void {
  engineOrNull()?.setParams({ cells: form.cells, wind: form.wind })
}

function onDensity(value: number): void {
  render.densityGamma = value
  engineOrNull()?.setRenderParams({ densityGamma: value })
}

function onTier(value: number): void {
  scene.ui.valueMin = value
  scene.ui.valueMax = spec.channels[0].max
  scene.setRange()
}

function isTierActive(min: number): boolean {
  return Math.round(scene.ui.valueMin) === min
}

function tierStyle(tier: { min: number; color: string }): Record<string, string> {
  if (!isTierActive(tier.min)) return { borderColor: tier.color }
  return {
    borderColor: tier.color,
    background: tier.color,
    color: '#06121f',
    fontWeight: '700',
    boxShadow: `0 0 8px ${tier.color}`
  }
}

function onBand(): void {
  engineOrNull()?.setHeightClip(band.min / 100, band.max / 100, band.enabled)
}

function toggleBand(): void {
  band.enabled = !band.enabled
  onBand()
}

function onCores(): void {
  form.showCores = !form.showCores
  if (!form.showCores) {
    engineOrNull()?.clearOverlayPoints()
    return
  }
  // 已有分析结果时立即叠加，避免等待重新分析造成"切换无响应"
  if (analysis.value) applyCorePoints(analysis.value)
  else void runAnalysis()
}

function toggleIso(which: 'weak' | 'strong'): void {
  if (which === 'weak') form.isoWeak = !form.isoWeak
  else form.isoStrong = !form.isoStrong
  void runIsosurfaces()
}

const dockItems = computed<LayerDockItem[]>(() => [
  { key: 'cores', label: '叠加核心点', color: '#ff8f5e', on: form.showCores, hint: '在三维场景中标注强对流核心位置，编号与左侧核心列表一致' },
  { key: 'isoWeak', label: '35 dBZ 等值面', color: '#2ecc40', on: form.isoWeak, hint: '以 35 dBZ 为阈值生成半透明三维等值面（中等回波边界）' },
  { key: 'isoStrong', label: '45 dBZ 等值面', color: '#ff5a20', on: form.isoStrong, hint: '以 45 dBZ 为阈值生成三维等值面（强回波核心）' },
  { key: 'ground', label: '地面覆盖', color: '#7fd8ff', on: layers.ground, hint: '在地面叠加雷达柱体的覆盖平面' },
  { key: 'station', label: '雷达站', color: '#ffd21e', on: layers.station, hint: '显示雷达站塔标、站名与海拔' },
  { key: 'rings', label: '距离圈', color: '#9fd8ff', on: layers.rings, hint: '显示以雷达站为圆心的距离等值圈' },
  { key: 'directions', label: '方位标注', color: '#cfe0f2', on: layers.directions, hint: '显示 N/E/S/W 方位标注' },
  { key: 'topLadder', label: '顶高参考环', color: '#65d3eb', on: layers.topLadder, hint: '显示 5~15 km 回波顶高参考环' }
])

const dockModeOptions = [
  { value: 'max', label: '柱最大 dBZ' },
  { value: 'top', label: '回波顶高' }
]

function toggleDockLayer(key: string): void {
  switch (key) {
    case 'cores':
      onCores()
      break
    case 'isoWeak':
      toggleIso('weak')
      break
    case 'isoStrong':
      toggleIso('strong')
      break
    case 'ground':
      layers.ground = !layers.ground
      break
    case 'station':
      layers.station = !layers.station
      break
    case 'rings':
      layers.rings = !layers.rings
      break
    case 'directions':
      layers.directions = !layers.directions
      break
    case 'topLadder':
      layers.topLadder = !layers.topLadder
      break
  }
}

function toggleAllDockLayers(): void {
  const turnOn = dockItems.value.some((item) => !item.on)
  form.showCores = turnOn
  form.isoWeak = turnOn
  form.isoStrong = turnOn
  layers.ground = turnOn
  layers.station = turnOn
  layers.rings = turnOn
  layers.directions = turnOn
  layers.topLadder = turnOn
  if (turnOn) {
    if (analysis.value) applyCorePoints(analysis.value)
    else void runAnalysis()
  } else {
    engineOrNull()?.clearOverlayPoints()
  }
  void runIsosurfaces()
}

function onDockMode(value: string): void {
  setGroundField(value === 'top' ? 'top' : 'max')
}

function setGroundField(field: 'max' | 'top'): void {
  layers.groundField = field
  if (analysis.value && layers.ground) ground.value?.update(analysis.value, layers.groundField)
}

function focusStrongestCore(): void {
  const e = engineOrNull()
  const a = analysis.value
  if (!e || !a || !a.coreCount) return
  let best = 0
  for (let i = 1; i < a.coreCount; i += 1) if (a.corePeak[i] > a.corePeak[best]) best = i
  e.flyToNormalized(a.corePos[best * 3], a.corePos[best * 3 + 1], a.corePos[best * 3 + 2], 26000, 1.2)
}

function flyPreset(key: string): void {
  const preset = radar.camera[key as keyof typeof radar.camera]
  if (!preset) return
  engineOrNull()?.flyToView(preset.heading, preset.pitch, preset.rangeFactor, 1.1)
}

watch(
  () => scene.ui.timeStep,
  () => {
    if (analysis.value) void runAnalysis()
    if (!scene.ui.playing) scheduleIso()
  }
)

watch(
  () => [layers.rings, layers.directions, layers.station, layers.topLadder, layers.ground],
  () => applyLayerVisibility()
)

onBeforeUnmount(() => {
  if (isoTimer) clearTimeout(isoTimer)
  overlay.value?.destroy()
  ground.value?.destroy()
})

const legendCss = computed(() => gradientCss('radar'))

const stats = computed<StatItem[]>(() => {
  const items: StatItem[] = [
    { label: '等效分辨率', value: scene.engine.value ? `${scene.engine.value.fullDims}³` : '—' },
    { label: '已加载瓦片', value: scene.stats.tilesReady.toLocaleString() }
  ]
  const a = analysis.value
  if (a) {
    items.push({ label: '最强回波', value: `${a.maxDbz.toFixed(1)} dBZ` })
    items.push({ label: '回波顶高（最高）', value: `${(a.maxTop * heightKm).toFixed(1)} km` })
    items.push({ label: '回波顶高（P95）', value: `${(a.p95Top * heightKm).toFixed(1)} km` })
    items.push({ label: '强对流核心', value: `${a.coreCount} 个` })
  }
  return items
})

const footprintRows = computed<StatItem[]>(() => {
  const a = analysis.value
  if (!a) return []
  return [
    { label: '≥20 dBZ 覆盖', value: `${a.footprint.area20Km2.toFixed(1)} km²` },
    { label: '≥35 dBZ 覆盖', value: `${a.footprint.area35Km2.toFixed(1)} km²` },
    { label: '≥45 dBZ 覆盖', value: `${a.footprint.area45Km2.toFixed(1)} km²` },
    { label: '顶高格点阈值', value: `≥${a.topThreshold} dBZ` },
    { label: '核心阈值', value: `≥${a.coreThreshold} dBZ` }
  ]
})

const clipRows = computed<StatItem[]>(() => [
  { label: '方位角', value: `${scene.ui.azimuth}°` },
  { label: '倾角', value: `${scene.ui.tilt}°` },
  { label: '偏移', value: `${scene.ui.offset}%` },
  { label: '高度带', value: band.enabled ? `${band.min}% ~ ${band.max}%` : '关闭' }
])

const pickedView = computed<PickedView | null>(() => {
  const p = scene.picked.value
  if (!p) return null
  if (!p.valid) return { title: '雷达回波拾取', rows: [], empty: '该处为空体元素 / 低于回波阈值' }
  const rows: StatItem[] = [{ label: '反射率', value: `${p.value.toFixed(1)} dBZ` }]
  if (p.lon !== undefined && p.lat !== undefined) {
    rows.push({ label: '经度', value: `${p.lon.toFixed(4)}°` })
    rows.push({ label: '纬度', value: `${p.lat.toFixed(4)}°` })
    rows.push({ label: '高度', value: `${((p.height ?? 0) / 1000).toFixed(2)} km` })
  }
  rows.push({ label: '瓦片 / 样本', value: `${p.tileIndex} / ${p.sampleIndex}` })
  return { title: '雷达回波拾取', rows }
})

const coreList = computed(() => {
  const a = analysis.value
  if (!a) return []
  return Array.from({ length: a.coreCount }, (_, i) => ({
    index: i + 1,
    dbz: a.corePeak[i],
    top: a.coreTop[i] * heightKm
  })).sort((x, y) => y.dbz - x.dbz)
})
</script>

<template>
  <VolumeShell
    title="三维天气雷达回波与对流分析"
    :status="scene.status.value"
    :panel-open="panelOpen"
    :legend-css="legendCss"
    legend-min="0 dBZ"
    legend-max="70 dBZ"
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
      <div class="rd-tier" v-for="tier in tiers" :key="tier.label">
        <i :style="{ background: tier.color }"></i>
        <span>{{ tier.label }}</span>
        <b>{{ tier.min }}~{{ tier.max }} dBZ</b>
      </div>
      <div v-if="footprintRows.length" class="rd-metrics">
        <div class="rd-metrics-title">地面覆盖</div>
        <div class="rd-metric" v-for="row in footprintRows" :key="row.label">
          <span>{{ row.label }}</span>
          <b>{{ row.value }}</b>
        </div>
      </div>
      <div v-if="coreList.length" class="rd-cores">
        <div class="rd-cores-title">强对流核心（≥{{ form.coreThreshold }} dBZ）</div>
        <div class="rd-core" v-for="core in coreList" :key="core.index">
          <span>#{{ core.index }}</span>
          <b>{{ core.dbz.toFixed(0) }} dBZ</b>
          <em>顶高 {{ core.top.toFixed(1) }} km</em>
        </div>
      </div>
    </template>

    <template #dock>
      <LayerDock
        title="图层控制"
        :items="dockItems"
        mode-label="覆盖字段"
        :mode="layers.groundField"
        :mode-options="dockModeOptions"
        @toggle="toggleDockLayer"
        @toggle-all="toggleAllDockLayers"
        @update:mode="onDockMode"
      />
    </template>

    <template #controls>
      <div class="rd-block">
        <div class="vol-section">回波分级定位</div>
        <div class="rd-tiers">
          <button
            v-for="tier in tiers"
            :key="tier.label"
            type="button"
            class="rd-tier-btn"
            :class="{ active: isTierActive(tier.min) }"
            :style="tierStyle(tier)"
            @click="onTier(tier.min)"
          >
            {{ tier.label }}
          </button>
        </div>
        <div class="vol-row">
          <span class="vol-label">值域下限<ParamHint text="过滤显示的回波强度下限：低于该值的体素保持透明，用于突出更强回波" /></span>
          <input type="range" :min="0" :max="70" step="1" v-model.number="scene.ui.valueMin" @input="scene.setRange()" />
          <span class="vol-value">{{ scene.ui.valueMin.toFixed(0) }} dBZ</span>
        </div>
      </div>

      <div class="rd-block">
        <div class="vol-section">回波顶高 / 强对流核心</div>
        <div class="vol-row">
          <span class="vol-label">顶高阈值<ParamHint text="统计回波顶高时采用的反射率下限：柱体内 ≥ 该值的最高高度记为回波顶高" /></span>
          <input type="range" min="5" max="40" step="1" v-model.number="form.topThreshold" @change="runAnalysis(); runTrend()" />
          <span class="vol-value">≥ {{ form.topThreshold }} dBZ</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">核心阈值<ParamHint text="识别强对流核心的反射率阈值，独立于顶高阈值，用于框定最强回波区" /></span>
          <input type="range" min="30" max="60" step="1" v-model.number="form.coreThreshold" @change="runAnalysis()" />
          <span class="vol-value">≥ {{ form.coreThreshold }} dBZ</span>
        </div>
        <div class="rd-btn-row">
          <button class="rd-analyze" :disabled="busy" @click="runAnalysis()">
            {{ busy ? '分析中…' : '重新分析' }}
          </button>
          <button class="rd-analyze ghost" :disabled="!analysis?.coreCount" @click="focusStrongestCore">
            聚焦最强核心
          </button>
        </div>
      </div>

      <div class="rd-block">
        <div class="vol-section">视角预设</div>
        <div class="rd-tiers">
          <button
            v-for="(preset, key) in radar.camera"
            :key="key"
            type="button"
            class="rd-tier-btn"
            @click="flyPreset(key)"
          >
            {{ preset.label }}
          </button>
        </div>
      </div>

      <div class="rd-block">
        <div class="vol-section">高度带裁剪</div>
        <div class="vol-row">
          <span class="vol-label">启用<ParamHint text="开启后仅显示上下界之间的高度区间，用于分层查看回波结构" /></span>
          <button class="vol-switch" :class="{ 'is-on': band.enabled }" @click="toggleBand"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">下界<ParamHint text="高度带下边界，取体域高度的百分比（0% 为地面）" /></span>
          <input type="range" min="0" max="100" step="1" v-model.number="band.min" @input="onBand" />
          <span class="vol-value">{{ band.min }}%</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">上界<ParamHint text="高度带上边界，取体域高度的百分比（100% 为体域顶部）" /></span>
          <input type="range" min="0" max="100" step="1" v-model.number="band.max" @input="onBand" />
          <span class="vol-value">{{ band.max }}%</span>
        </div>
      </div>

      <div class="rd-block">
        <div class="vol-section">对流形态</div>
        <div class="vol-row">
          <span class="vol-label">对流单体数<ParamHint text="参与合成的对流单体数量，数量越多回波分布越零散" /></span>
          <input type="range" min="2" max="12" step="1" v-model.number="form.cells" @change="applyForm" />
          <span class="vol-value">{{ form.cells }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">风移速度<ParamHint text="时间演变中整个回波场的平移速度，用于模拟系统移动" /></span>
          <input type="range" min="0" max="1.2" step="0.05" v-model.number="form.wind" @change="applyForm" />
          <span class="vol-value">{{ form.wind.toFixed(2) }}</span>
        </div>
      </div>

      <div class="rd-block">
        <div class="vol-section">时间演变（{{ spec.timeSteps }} {{ spec.timeStepUnit }}）</div>
        <div class="vol-row">
          <span class="vol-label">时间步<ParamHint text="选择回波演变的时间切片，切换后自动重新分析与统计" /></span>
          <input
            type="range"
            min="0"
            :max="spec.timeSteps - 1"
            step="1"
            :value="scene.ui.timeStep"
            @input="scene.setTimeStep(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="vol-value">T+{{ scene.ui.timeStep * 5 }}{{ spec.timeStepUnit }}</span>
        </div>
        <canvas ref="trendCanvas" class="rd-trend" width="240" height="64"></canvas>
        <div class="rd-trend-key">
          <i style="background:#ff5a3c"></i>最大 dBZ
          <i style="background:#5ad7ff"></i>最高顶高
          <i style="background:#ffd21e"></i>≥35dBZ 面积
        </div>
        <div class="rd-btn-row">
          <button class="rd-analyze ghost" @click="scene.togglePlay()">
            {{ scene.ui.playing ? '暂停回放' : '自动播放' }}
          </button>
          <button class="rd-analyze ghost" :disabled="trendBusy" @click="runTrend()">
            {{ trendBusy ? '统计中…' : '刷新统计' }}
          </button>
        </div>
      </div>

      <div class="rd-block">
        <div class="vol-section">任意方向剖切</div>
        <div class="vol-row">
          <span class="vol-label">启用剖切<ParamHint text="开启后可沿任意方位/倾角剖开体域，便于查看内部回波结构" /></span>
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

      <div class="rd-block">
        <div class="vol-section">渲染</div>
        <div class="vol-row">
          <span class="vol-label">不透明度<ParamHint text="体渲染整体透明度系数，值越大回波越实、越不透明" /></span>
          <input type="range" min="0.1" max="1" step="0.02" v-model.number="scene.ui.opacity" @input="scene.setOpacity()" />
          <span class="vol-value">{{ scene.ui.opacity.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">密度压缩<ParamHint text="调整高密度回波的视觉聚集程度，数值越大弱回波越透明" /></span>
          <input type="range" min="0.4" max="2" step="0.05" v-model.number="render.densityGamma" @input="onDensity(render.densityGamma)" />
          <span class="vol-value">{{ render.densityGamma.toFixed(2) }}</span>
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
.rd-block {
  margin-bottom: 10px;
}
.rd-tiers {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  margin-bottom: 4px;
}
.rd-tier-btn {
  padding: 5px 0;
  border: 1px solid rgba(157, 188, 224, 0.5);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #cfe0f2;
  font-size: 10px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}
.rd-tier-btn:hover {
  background: rgba(47, 128, 237, 0.28);
  color: #fff;
}
.rd-tier-btn.active {
  cursor: default;
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.28);
}
.rd-btn-row {
  display: flex;
  gap: 5px;
}
.rd-analyze {
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
.rd-analyze.ghost {
  background: rgba(47, 128, 237, 0.18);
  border: 1px solid rgba(47, 128, 237, 0.7);
  color: #9fd8ff;
}
.rd-analyze:disabled {
  opacity: 0.5;
  cursor: default;
}
.rd-trend {
  width: 100%;
  height: 64px;
  margin-top: 4px;
  border: 1px solid rgba(157, 188, 224, 0.22);
  border-radius: 4px;
  background: rgba(6, 16, 30, 0.6);
}
.rd-trend-key {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
  font-size: 9px;
  color: #9fb8d4;
}
.rd-trend-key i {
  display: inline-block;
  width: 9px;
  height: 3px;
  border-radius: 2px;
}
.rd-tier {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 10px;
  color: #c3d5e8;
}
.rd-tier i {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.rd-tier span {
  flex: 1 1 auto;
}
.rd-tier b {
  color: #65d3eb;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.rd-metrics {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
}
.rd-metrics-title {
  margin-bottom: 4px;
  font-size: 10px;
  font-weight: 700;
  color: #65d3eb;
}
.rd-metric {
  display: flex;
  justify-content: space-between;
  margin-top: 3px;
  font-size: 10px;
  color: #c3d5e8;
}
.rd-metric b {
  color: #9fe8b9;
  font-variant-numeric: tabular-nums;
}
.rd-cores {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
}
.rd-cores-title {
  font-size: 10px;
  font-weight: 700;
  color: #65d3eb;
  margin-bottom: 4px;
}
.rd-core {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: #c3d5e8;
  margin-top: 3px;
}
.rd-core span {
  flex: 0 0 22px;
}
.rd-core b {
  flex: 1 1 auto;
  color: #ff8f5e;
  font-variant-numeric: tabular-nums;
}
.rd-core em {
  color: #9fb8d4;
  font-style: normal;
  font-variant-numeric: tabular-nums;
}
</style>
