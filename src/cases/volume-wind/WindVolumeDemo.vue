<script setup lang="ts">
/**
 * 三维风场 Vector Volume —— 场景化 UI
 *
 * 标量体（风速 / 垂直速度）与向量表达（GPU 粒子 / 流线 / 高度层箭头）协同的风场工作台，
 * 并提供任意位置的垂直廓线曲线，支持按高度层与剖面分析风场结构。
 */
import { computed, reactive, ref, watch, nextTick } from 'vue'
import { Cartesian3, Color } from 'cesium'
import VolumeShell from '../../lib/volume-engine/VolumeShell.vue'
import { useVolumeScene } from '../../lib/volume-engine/useVolumeScene'
import { SCENES } from '../../lib/volume-engine/scenes'
import { gradientCss, PALETTES, lerpStops } from '../../lib/volume-engine/palette'
import type { LineOverlayResult, PickedInfo } from '../../lib/volume-engine/VolumeEngine'
import type { PickedView, StatItem } from '../../lib/volume-engine/types'
import { WindLayer3D } from '../../lib/vector-field-engine/windLayer3d'
import { buildWindData3D, createWindVortices, sampleWindField, type WindFieldParams } from '../../lib/vector-field-engine/windField'
import type { WindLayerOptions } from '../../lib/vector-field-engine/types'
import { createWindSkeleton, type WindSkeleton } from './windScene'

type ProfileResult = {
  x: number
  y: number
  levels: number
  values: Float32Array
  valid: Uint8Array
  u: Float32Array
  v: Float32Array
  w: Float32Array
}

const spec = SCENES.wind
const panelOpen = ref(true)
const V = spec.volume
/** 风速标量通道：GPGPU 粒子与体渲染共用同一值域，保证配色与强度一致 */
const SPEED_CHANNEL = spec.channels.find((c) => c.key === 'speed') ?? spec.channels[0]

const TIERS = [
  { label: '和风', range: '0 ~ 5', color: '#1470c8' },
  { label: '强风', range: '5 ~ 10', color: '#14c8a0' },
  { label: '疾风', range: '10 ~ 15', color: '#ffd21e' },
  { label: '大风以上', range: '≥ 15', color: '#ff5a14' }
]

const CAMERA_PRESETS = [
  { key: 'overview', label: '全局', heading: 35, pitch: -30, range: 1.05 },
  { key: 'low', label: '低空', heading: 35, pitch: -12, range: 0.5 },
  { key: 'mid', label: '中空', heading: 22, pitch: -22, range: 0.72 },
  { key: 'top', label: '俯视', heading: 0, pitch: -78, range: 0.95 },
  { key: 'profile', label: '剖面', heading: 90, pitch: -8, range: 0.85 },
  { key: 'flow', label: '顺流', heading: -1, pitch: -16, range: 0.8 }
] as const

const form = reactive({
  baseSpeed: spec.params.baseSpeed as number,
  baseDir: spec.params.baseDir as number,
  vortices: spec.params.vortices as number,
  gust: spec.params.gust as number
})
const overlay = ref<'none' | 'streamlines' | 'arrows' | 'crossflow'>('none')
const layerHeight = ref(50)
const streamLevels = ref(6)
const backgroundMode = ref<'engineering' | 'satellite' | 'dim'>('engineering')
const densityGamma = ref(1.6)
const analysisMs = ref(0)
const pickedNorm = ref<[number, number, number] | null>(null)
const profile = reactive({ x: 50, y: 50 })
const profileResult = ref<ProfileResult | null>(null)
const profileCanvas = ref<HTMLCanvasElement | null>(null)
const profileAt = ref<{ speed: number; u: number; v: number; w: number } | null>(null)
const busy = ref(false)

/* ---------------------------- GPGPU 风流粒子 ---------------------------- */
const GPU_GRID = { nx: 48, ny: 48, nz: 8 }
const gpuAvailable = ref(true)
const skeletonVisible = ref(true)
const particleDensity = ref(96)
let gpuLayer: WindLayer3D | undefined
let stopGpuRender: (() => void) | undefined
let skeleton: WindSkeleton | undefined

function windColors(count = 22): string[] {
  const stops = PALETTES.wind.stops
  return Array.from({ length: count }, (_, i) => {
    const [r, g, b] = lerpStops(stops, count === 1 ? 0 : i / (count - 1))
    return `rgb(${r}, ${g}, ${b})`
  })
}

function buildFieldParams(): WindFieldParams {
  return {
    baseSpeed: form.baseSpeed,
    baseDir: form.baseDir,
    vortices: form.vortices,
    gust: form.gust,
    seed: spec.params.seed
  }
}

function currentWindData() {
  return buildWindData3D({
    params: buildFieldParams(),
    center: spec.center,
    volume: V,
    ...GPU_GRID
  })
}

/** 气象来向 → 指南针方位文字（8 方位） */
const COMPASS_POINTS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
function compassText(fromDeg: number): string {
  const idx = Math.round((((fromDeg % 360) + 360) % 360) / 45) % 8
  return COMPASS_POINTS[idx]
}

/** 依据共享向量场推测的铅直风切变代表值（体域中心水平位置） */
const shearRows = computed(() => {
  const params = buildFieldParams()
  const vortices = createWindVortices(params)
  return [0.1, 0.3, 0.5, 0.8].map((f) => {
    const s = sampleWindField(0.5, 0.5, f, params, vortices)
    return { height: Math.round(V.base + f * V.height), speed: Math.sqrt(s.u * s.u + s.v * s.v + s.w * s.w) }
  })
})

/** 拾取点处的向量：直接复用主线程共享风场，保证与粒子/流线同一套语义 */
const pickedVector = computed(() => {
  const n = pickedNorm.value
  if (!n) return null
  const params = buildFieldParams()
  const vortices = createWindVortices(params)
  const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
  const s = sampleWindField(clamp(n[0]), clamp(n[1]), clamp(n[2]), params, vortices)
  const speed = Math.sqrt(s.u * s.u + s.v * s.v + s.w * s.w)
  const flowAz = ((Math.atan2(s.u, s.v) * 180) / Math.PI + 360) % 360
  const fromAz = (flowAz + 180) % 360
  return { u: s.u, v: s.v, w: s.w, speed, fromAz }
})

function gpuOptions(): Partial<WindLayerOptions> {
  return {
    colors: windColors(),
    particlesTextureSize: particleDensity.value,
    lineWidth: { min: 0.4, max: 0.7 + scene.ui.particleSize * 0.18 },
    lineLength: { min: 24, max: 120 },
    speedFactor: 0.6,
    dropRate: 0.003,
    dropRateBump: 0.001,
    heightScale: 1,
    // 粒子场锁定在体域包围盒内，不随相机缩放漂移，确保与标量体空间配准一致
    useViewerBounds: false,
    // 颜色索引域与标量通道值域对齐，避免粒子配色随数据极值变化而与体素配色脱节
    domain: { min: SPEED_CHANNEL.min, max: SPEED_CHANNEL.max },
    pixelSizeMode: 'screen',
    dynamic: true,
    flipY: false
  }
}

function startGpuLoop(): void {
  stopGpuLoop()
  stopGpuRender = scene.engine.value?.requestRenderLoop()
}

function stopGpuLoop(): void {
  stopGpuRender?.()
  stopGpuRender = undefined
}

function disposeGpuLayer(): void {
  stopGpuLoop()
  if (gpuLayer && !gpuLayer.isDestroyed()) {
    try {
      gpuLayer.destroy()
    } catch {
      /* Viewer 可能已销毁 */
    }
  }
  gpuLayer = undefined
}

function createGpuLayer(): void {
  const engine = scene.engine.value
  const viewer = engine?.viewer
  if (!engine || !viewer || viewer.isDestroyed()) return
  disposeGpuLayer()
  try {
    gpuLayer = new WindLayer3D(viewer, currentWindData(), gpuOptions())
    gpuLayer.show = scene.ui.particleVisible
    gpuAvailable.value = true
    startGpuLoop()
  } catch (error) {
    gpuLayer = undefined
    gpuAvailable.value = false
    console.warn('[volume-wind] GPGPU 粒子层初始化失败，回退到 CPU 粒子', error)
    engine.setParticlesVisible(scene.ui.particleVisible)
  }
}

function toggleParticles(): void {
  const next = !scene.ui.particleVisible
  scene.ui.particleVisible = next
  if (gpuLayer) gpuLayer.show = next
  else scene.engine.value?.setParticlesVisible(next)
}

function setParticleSize(): void {
  if (!gpuLayer) {
    scene.setParticleSize()
    return
  }
  gpuLayer.updateOptions({ lineWidth: { min: 0.4, max: 0.7 + scene.ui.particleSize * 0.18 } })
}

function setParticleDensity(): void {
  gpuLayer?.updateOptions({ particlesTextureSize: particleDensity.value })
}

function createSkeleton(): void {
  const engine = scene.engine.value
  const viewer = engine?.viewer
  if (!engine || !viewer || viewer.isDestroyed()) return
  skeleton?.dispose()
  skeleton = createWindSkeleton({
    viewer,
    modelMatrix: engine.getLocalFrame(),
    width: V.width,
    depth: V.depth,
    height: V.height,
    base: V.base,
    anchorHeight: engine.anchorHeight,
    tickCount: 6,
    dominantFrom: form.baseDir,
    fieldParams: buildFieldParams()
  })
  skeleton.setVisible(skeletonVisible.value)
}

function toggleSkeleton(): void {
  skeletonVisible.value = !skeletonVisible.value
  skeleton?.setVisible(skeletonVisible.value)
}

function setBackground(): void {
  scene.engine.value?.setBackgroundMode(backgroundMode.value)
}

function setDensityGamma(): void {
  scene.engine.value?.setRenderParams({ densityGamma: densityGamma.value })
}

function handlePick(info: PickedInfo | null): void {
  const engine = scene.engine.value
  if (!info || !info.valid || !info.norm || !info.local || !engine) {
    pickedNorm.value = null
    engine?.clearOverlayPoints()
    return
  }
  pickedNorm.value = info.norm
  profile.x = Math.round(info.norm[0] * 100)
  profile.y = Math.round(info.norm[1] * 100)
  engine.setOverlayPoints([
    { position: new Cartesian3(info.local[0], info.local[1], info.local[2]), color: Color.fromCssColorString('#ffd21e'), pixelSize: 11 }
  ])
  onProfile()
}

const scene = useVolumeScene(spec, {
  onReady: (engine) => {
    engine.setParticlesVisible(false)
    engine.setBackgroundMode(backgroundMode.value)
    engine.setRenderParams({ densityGamma: densityGamma.value })
    createGpuLayer()
    createSkeleton()
    void refreshOverlay(engine)
    void runProfile(engine)
  },
  onPicked: (info) => handlePick(info),
  onDispose: () => {
    if (profileTimer) clearTimeout(profileTimer)
    if (overlayTimer) clearTimeout(overlayTimer)
    scene.engine.value?.clearOverlayPoints()
    disposeGpuLayer()
    skeleton?.dispose()
    skeleton = undefined
  }
})
const { container, sliceCanvas } = scene

async function refreshOverlay(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  if (overlay.value === 'none') {
    engine.setLines(undefined)
    return
  }
  const t0 = performance.now()
  busy.value = true
  try {
    if (overlay.value === 'streamlines') {
      const result = await engine.analyze<LineOverlayResult>({
        mode: 'streamlines',
        seeds: 240,
        steps: 210,
        step: 0.009,
        levels: streamLevels.value,
        bidirectional: true,
        volMin: [-V.width / 2, -V.depth / 2, V.base],
        volSize: [V.width, V.depth, V.height]
      })
      engine.setLines(result, {
        speedPalette: 'wind',
        speedMin: SPEED_CHANNEL.min,
        speedMax: SPEED_CHANNEL.max,
        segments: 30,
        width: 2.6,
        widthStart: 0.6,
        alphaStart: 0.06,
        alphaEnd: 0.96,
        widthBySpeed: true
      })
    } else if (overlay.value === 'crossflow') {
      // 沿主导风向的垂直剖面：平面法向水平垂直于流向，面内轴为流向与垂向
      const flowAz = ((form.baseDir + 180) * Math.PI) / 180
      const flow = { x: Math.sin(flowAz), y: Math.cos(flowAz) }
      const normal = { x: Math.cos(flowAz), y: -Math.sin(flowAz) }
      const half = 0.5 * Math.sqrt(V.width * V.width + V.depth * V.depth + V.height * V.height)
      const result = await engine.analyze<LineOverlayResult>({
        mode: 'section',
        count: 15,
        normal: [normal.x, normal.y, 0],
        point: [0, 0, V.base + V.height / 2],
        e1: [flow.x, flow.y, 0],
        e2: [0, 0, 1],
        halfDiag: half,
        volMin: [-V.width / 2, -V.depth / 2, V.base],
        volSize: [V.width, V.depth, V.height],
        vectorScale: 1
      })
      engine.setLines(result, {
        speedPalette: 'wind',
        speedMin: SPEED_CHANNEL.min,
        speedMax: SPEED_CHANNEL.max,
        segments: 16,
        width: 2.8,
        widthStart: 1.0,
        alphaStart: 0.35,
        alphaEnd: 0.96,
        widthBySpeed: true
      })
    } else {
      const half = 0.5 * Math.sqrt(V.width * V.width + V.depth * V.depth + V.height * V.height)
      const z = V.base + (layerHeight.value / 100) * V.height
      const result = await engine.analyze<LineOverlayResult>({
        mode: 'section',
        count: 13,
        normal: [0, 0, 1],
        point: [0, 0, z],
        e1: [1, 0, 0],
        e2: [0, 1, 0],
        halfDiag: half,
        volMin: [-V.width / 2, -V.depth / 2, V.base],
        volSize: [V.width, V.depth, V.height],
        vectorScale: 1
      })
      engine.setLines(result, {
        speedPalette: 'wind',
        speedMin: SPEED_CHANNEL.min,
        speedMax: SPEED_CHANNEL.max,
        segments: 20,
        width: 2.6,
        widthStart: 1.2,
        alphaStart: 0.4,
        alphaEnd: 0.95,
        widthBySpeed: true
      })
    }
  } finally {
    busy.value = false
    analysisMs.value = Math.round(performance.now() - t0)
  }
}

async function runProfile(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  const result = await engine.analyze<ProfileResult>({
    mode: 'profile',
    levels: 56,
    x: profile.x / 100,
    y: profile.y / 100
  })
  if (!result) return
  profileResult.value = result
  const mid = Math.floor(result.levels / 2)
  profileAt.value = {
    speed: result.values[mid],
    u: result.u[mid],
    v: result.v[mid],
    w: result.w[mid]
  }
  await nextTick()
  drawProfile()
}

function drawProfile(): void {
  const canvas = profileCanvas.value
  const result = profileResult.value
  if (!canvas || !result) return
  const w = 200
  const h = 128
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(8, 22, 44, 0.5)'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(157, 188, 224, 0.2)'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i += 1) {
    const y = 8 + ((h - 20) * i) / 4
    ctx.beginPath()
    ctx.moveTo(26, y)
    ctx.lineTo(w - 8, y)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.strokeStyle = '#3fd0ff'
  ctx.lineWidth = 2
  let started = false
  const speedMax = scene.active().max || 24
  for (let i = 0; i < result.levels; i += 1) {
    if (!result.valid[i]) {
      started = false
      continue
    }
    const x = 26 + ((w - 34) * Math.min(1, result.values[i] / speedMax))
    const y = h - 12 - ((h - 20) * i) / (result.levels - 1)
    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
  ctx.fillStyle = '#9fb8d4'
  ctx.font = '9px sans-serif'
  ctx.fillText('高度', 4, 14)
  ctx.fillText(`风速 ${speedMax}`, w - 52, h - 3)
}

function applyForm(): void {
  scene.engine.value?.setParams({
    baseSpeed: form.baseSpeed,
    baseDir: form.baseDir,
    vortices: form.vortices,
    gust: form.gust
  })
  if (gpuLayer) gpuLayer.updateWindData(currentWindData())
  skeleton?.setDominantDirection(form.baseDir)
  skeleton?.setFieldParams(buildFieldParams())
  if (overlay.value !== 'none') scheduleOverlay()
}

function pickOverlay(mode: 'none' | 'streamlines' | 'arrows' | 'crossflow'): void {
  overlay.value = mode
  void refreshOverlay()
}

function onLayer(): void {
  if (overlay.value === 'arrows') scheduleOverlay()
}

function onStreamLevels(): void {
  if (overlay.value === 'streamlines') scheduleOverlay()
}

let overlayTimer: ReturnType<typeof setTimeout> | undefined

function scheduleOverlay(): void {
  if (overlayTimer) clearTimeout(overlayTimer)
  overlayTimer = setTimeout(() => {
    void refreshOverlay()
  }, 160)
}

let profileTimer: ReturnType<typeof setTimeout> | undefined

function onProfile(): void {
  if (profileTimer) clearTimeout(profileTimer)
  profileTimer = setTimeout(() => {
    void runProfile()
  }, 140)
}

type CameraPreset = (typeof CAMERA_PRESETS)[number]

function flyView(preset: CameraPreset): void {
  const engine = scene.engine.value
  if (!engine) return
  const heading = preset.key === 'flow' ? (form.baseDir + 180) % 360 : preset.heading
  engine.flyToView(heading, preset.pitch, preset.range, 1)
}

watch(
  () => scene.ui.channel,
  () => {
    void runProfile()
  }
)

const legendCss = computed(() => gradientCss('wind'))

const stats = computed<StatItem[]>(() => {
  const items: StatItem[] = [
    { label: '主导风向（来向）', value: `${compassText(form.baseDir)} ${form.baseDir}°` },
    { label: '基准风速', value: `${form.baseSpeed.toFixed(0)} m/s` },
    { label: '粒子数', value: gpuAvailable.value ? (particleDensity.value * particleDensity.value).toLocaleString() : scene.ui.particleCount.toLocaleString() },
    { label: '叠加方式', value: overlay.value === 'none' ? '无' : overlay.value === 'streamlines' ? '流线' : overlay.value === 'crossflow' ? '风向剖面' : '高度层箭头' },
    { label: '分析耗时', value: analysisMs.value ? `${analysisMs.value} ms` : '—' },
    { label: '等效分辨率', value: scene.engine.value ? `${scene.engine.value.fullDims}³` : '—' }
  ]
  const p = profileAt.value
  if (p) {
    items.push({ label: '剖面中层风速', value: `${p.speed.toFixed(1)} m/s` })
    items.push({ label: 'u / v / w', value: `${p.u.toFixed(1)} / ${p.v.toFixed(1)} / ${p.w.toFixed(1)}` })
  }
  return items
})

const clipRows = computed<StatItem[]>(() => [
  { label: '方位角', value: `${scene.ui.azimuth}°` },
  { label: '倾角', value: `${scene.ui.tilt}°` },
  { label: '偏移', value: `${scene.ui.offset}%` },
  { label: '高度层', value: `${layerHeight.value}%` }
])

const pickedView = computed<PickedView | null>(() => {
  const p = scene.picked.value
  if (!p) return null
  if (!p.valid) return { title: '风场拾取', rows: [], empty: '该处为空体元素' }
  const ch = scene.active()
  const rows: StatItem[] = [{ label: ch.label, value: `${p.value.toFixed(2)} ${ch.unit}` }]
  if (p.lon !== undefined && p.lat !== undefined) {
    rows.push({ label: '经度 / 纬度', value: `${p.lon.toFixed(3)}, ${p.lat.toFixed(3)}` })
    rows.push({ label: '高度', value: `${(p.height ?? 0).toFixed(0)} m` })
  }
  const v = pickedVector.value
  if (v) {
    rows.push({ label: '风矢量 u/v/w', value: `${v.u.toFixed(1)} / ${v.v.toFixed(1)} / ${v.w.toFixed(1)}` })
    rows.push({ label: '风速 / 风向', value: `${v.speed.toFixed(1)} m/s · ${compassText(v.fromAz)} ${v.fromAz.toFixed(0)}°` })
  }
  return { title: '风场拾取（点击场景定位廓线）', rows }
})
</script>

<template>
  <VolumeShell
    title="三维风场 Vector Volume"
    :status="scene.status.value"
    :panel-open="panelOpen"
    :legend-css="legendCss"
    legend-min="0 m/s"
    legend-max="24 m/s"
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
      <div class="wd-tier" v-for="tier in TIERS" :key="tier.label">
        <i :style="{ background: tier.color }"></i>
        <span>{{ tier.label }}</span>
        <b>{{ tier.range }} m/s</b>
      </div>
      <div class="wd-profile">
        <div class="wd-profile-title">垂直廓线（风速）</div>
        <canvas ref="profileCanvas"></canvas>
        <div class="wd-profile-hint">剖面位置 X {{ profile.x }}% · Y {{ profile.y }}%（移动/点击场景探测）</div>
      </div>
      <div class="wd-shear">
        <div class="wd-profile-title">风切变参考（体域中心）</div>
        <div class="wd-shear-row" v-for="row in shearRows" :key="row.height">
          <span>{{ row.height }} m</span>
          <b>{{ row.speed.toFixed(1) }} m/s</b>
        </div>
      </div>
    </template>

    <template #controls>
      <div class="wd-block">
        <div class="vol-section">标量通道</div>
        <div class="wd-seg">
          <button
            v-for="ch in spec.channels"
            :key="ch.key"
            type="button"
            class="wd-seg-btn"
            :class="{ active: scene.ui.channel === ch.key }"
            @click="scene.setChannel(ch.key)"
          >
            {{ ch.label }}
          </button>
        </div>
      </div>

      <div class="wd-block">
        <div class="vol-section">相机视角</div>
        <div class="wd-seg">
          <button
            v-for="preset in CAMERA_PRESETS"
            :key="preset.key"
            type="button"
            class="wd-seg-btn"
            @click="flyView(preset)"
          >
            {{ preset.label }}
          </button>
        </div>
      </div>

      <div class="wd-block">
        <div class="vol-section">场景背景</div>
        <div class="wd-seg">
          <button type="button" class="wd-seg-btn" :class="{ active: backgroundMode === 'engineering' }" @click="backgroundMode = 'engineering'; setBackground()">天气深色</button>
          <button type="button" class="wd-seg-btn" :class="{ active: backgroundMode === 'satellite' }" @click="backgroundMode = 'satellite'; setBackground()">卫星参考</button>
          <button type="button" class="wd-seg-btn" :class="{ active: backgroundMode === 'dim' }" @click="backgroundMode = 'dim'; setBackground()">极简</button>
        </div>
      </div>

      <div class="wd-block">
        <div class="vol-section">向量叠加</div>
        <div class="wd-seg">
          <button type="button" class="wd-seg-btn" :class="{ active: overlay === 'none' }" @click="pickOverlay('none')">仅标量</button>
          <button type="button" class="wd-seg-btn" :class="{ active: overlay === 'streamlines' }" @click="pickOverlay('streamlines')">流线</button>
          <button type="button" class="wd-seg-btn" :class="{ active: overlay === 'arrows' }" @click="pickOverlay('arrows')">层箭头</button>
          <button type="button" class="wd-seg-btn" :class="{ active: overlay === 'crossflow' }" @click="pickOverlay('crossflow')">风向剖面</button>
        </div>
        <div v-if="overlay === 'arrows'" class="vol-row">
          <span class="vol-label">箭头所在高度</span>
          <input type="range" min="5" max="95" step="1" v-model.number="layerHeight" @input="onLayer" />
          <span class="vol-value">{{ layerHeight }}%</span>
        </div>
        <div v-if="overlay === 'streamlines'" class="vol-row">
          <span class="vol-label">流线层数</span>
          <input type="range" min="1" max="12" step="1" v-model.number="streamLevels" @change="onStreamLevels" />
          <span class="vol-value">{{ streamLevels }} 层</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">GPU 粒子</span>
          <button class="vol-switch" :class="{ 'is-on': scene.ui.particleVisible }" @click="toggleParticles()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">粒子尺寸</span>
          <input type="range" min="1" max="6" step="1" v-model.number="scene.ui.particleSize" @input="setParticleSize()" />
          <span class="vol-value">{{ scene.ui.particleSize }}px</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">粒子密度</span>
          <input type="range" min="48" max="192" step="16" v-model.number="particleDensity" @change="setParticleDensity()" />
          <span class="vol-value">{{ particleDensity }}²</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">场景骨架</span>
          <button class="vol-switch" :class="{ 'is-on': skeletonVisible }" @click="toggleSkeleton()"><span></span></button>
        </div>
        <div v-if="!gpuAvailable" class="wd-note">当前环境不支持 GPGPU 三维粒子，已回退 CPU 粒子</div>
      </div>

      <div class="wd-block">
        <div class="vol-section">垂直廓线采样</div>
        <div class="vol-row">
          <span class="vol-label">剖面 X</span>
          <input type="range" min="0" max="100" step="1" v-model.number="profile.x" @input="onProfile" />
          <span class="vol-value">{{ profile.x }}%</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">剖面 Y</span>
          <input type="range" min="0" max="100" step="1" v-model.number="profile.y" @input="onProfile" />
          <span class="vol-value">{{ profile.y }}%</span>
        </div>
      </div>

      <div class="wd-block">
        <div class="vol-section">风场形态参数</div>
        <div class="vol-row">
          <span class="vol-label">基础风速</span>
          <input type="range" min="2" max="18" step="1" v-model.number="form.baseSpeed" @change="applyForm" />
          <span class="vol-value">{{ form.baseSpeed }} m/s</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">主导风向（来向）</span>
          <input type="range" min="0" max="359" step="1" v-model.number="form.baseDir" @change="applyForm" />
          <span class="vol-value">{{ form.baseDir }}°</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">涡旋数量</span>
          <input type="range" min="0" max="6" step="1" v-model.number="form.vortices" @change="applyForm" />
          <span class="vol-value">{{ form.vortices }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">阵风强度</span>
          <input type="range" min="0" max="0.6" step="0.02" v-model.number="form.gust" @change="applyForm" />
          <span class="vol-value">{{ form.gust.toFixed(2) }}</span>
        </div>
      </div>

      <details class="wd-advanced">
        <summary>高级设置</summary>
      <div class="wd-block">
        <div class="vol-section">任意方向剖切</div>
        <div class="vol-row">
          <span class="vol-label">启用剖切</span>
          <button
            class="vol-switch"
            :class="{ 'is-on': scene.ui.clipEnabled }"
            @click="scene.ui.clipEnabled = !scene.ui.clipEnabled; scene.setClip()"
          ><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">方位角</span>
          <input type="range" min="0" max="360" step="1" v-model.number="scene.ui.azimuth" @input="scene.setClip()" />
          <span class="vol-value">{{ scene.ui.azimuth }}°</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">倾角</span>
          <input type="range" min="0" max="90" step="1" v-model.number="scene.ui.tilt" @input="scene.setClip()" />
          <span class="vol-value">{{ scene.ui.tilt }}°</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">偏移</span>
          <input type="range" min="-100" max="100" step="1" v-model.number="scene.ui.offset" @input="scene.setClip()" />
          <span class="vol-value">{{ scene.ui.offset }}%</span>
        </div>
      </div>

      <div class="wd-block">
        <div class="vol-section">渲染</div>
        <div class="vol-row">
          <span class="vol-label">不透明度</span>
          <input type="range" min="0.1" max="1" step="0.02" v-model.number="scene.ui.opacity" @input="scene.setOpacity()" />
          <span class="vol-value">{{ scene.ui.opacity.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">覆盖基底</span>
          <input type="range" min="0" max="0.9" step="0.02" v-model.number="scene.ui.coverage" @input="scene.setCoverage()" />
          <span class="vol-value">{{ scene.ui.coverage.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">密度压缩</span>
          <input type="range" min="0.6" max="2.6" step="0.1" v-model.number="densityGamma" @change="setDensityGamma()" />
          <span class="vol-value">{{ densityGamma.toFixed(1) }}</span>
        </div>
      </div>
      </details>
    </template>

    <template #actions>
      <button class="vol-action" :disabled="busy" @click="refreshOverlay()">刷新矢量叠加</button>
      <button class="vol-action ghost" @click="scene.engine.value?.resetCamera(1)">恢复视图</button>
    </template>
  </VolumeShell>
</template>

<style scoped>
.wd-block {
  margin-bottom: 10px;
}
.wd-advanced {
  margin-top: 4px;
}
.wd-advanced > summary {
  cursor: pointer;
  font-size: 10px;
  font-weight: 700;
  color: #65d3eb;
  padding: 6px 0;
  outline: none;
}
.wd-note {
  margin-top: 6px;
  padding: 5px 7px;
  border-radius: 5px;
  background: rgba(255, 176, 32, 0.12);
  border: 1px solid rgba(255, 176, 32, 0.35);
  color: #f0c674;
  font-size: 9px;
  line-height: 1.4;
}
.wd-seg {
  display: flex;
  gap: 4px;
}
.wd-seg-btn {
  flex: 1 1 0;
  padding: 6px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.wd-seg-btn.active {
  border-color: #2f80ed;
  background: #2f80ed;
  color: #fff;
  font-weight: 600;
}
.wd-tier {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 10px;
  color: #c3d5e8;
}
.wd-tier i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.wd-tier span {
  flex: 1 1 auto;
}
.wd-tier b {
  color: #65d3eb;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.wd-profile {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
}
.wd-profile-title {
  font-size: 10px;
  font-weight: 700;
  color: #65d3eb;
  margin-bottom: 4px;
}
.wd-profile canvas {
  display: block;
  width: 100%;
  border-radius: 5px;
  border: 1px solid rgba(157, 188, 224, 0.25);
}
.wd-profile-hint {
  margin-top: 4px;
  font-size: 9px;
  color: #7f96b3;
}
.wd-shear {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
}
.wd-shear-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  color: #c3d5e8;
  margin-top: 3px;
}
.wd-shear-row b {
  color: #65d3eb;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
