<script setup lang="ts">
/**
 * 海洋温盐深三维体 —— 黄海陆架水团结构分析工作台
 *
 * 温度 / 盐度 / 密度随深度的层化结构，叠加中尺度涡与海流粒子；支持深度分层浏览、
 * 多变量切换、季节演变、垂向层结剖面、温盐散点与水团判别，以及任意方向剖切。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import VolumeShell from '../../lib/volume-engine/VolumeShell.vue'
import { useVolumeScene } from '../../lib/volume-engine/useVolumeScene'
import { OCEAN_CONFIG, SCENES } from '../../lib/volume-engine/scenes'
import { gradientCss, buildTransferLut } from '../../lib/volume-engine/palette'
import type { PickedView, StatItem } from '../../lib/volume-engine/types'
import {
  drawOceanProfile,
  drawTSDiagram,
  runOceanIso,
  runOceanProfile,
  runOceanStats,
  type OceanChannel,
  type OceanProfileResult,
  type OceanStatsResult
} from './ocean-analysis'
import { installOceanOverlay, type OceanOverlayHandle } from './ocean-overlays'

const spec = SCENES.ocean
const config = OCEAN_CONFIG
const panelOpen = ref(true)
const V = spec.volume

const CAMERA_ORDER = ['overview', 'surface', 'thermocline', 'section', 'eddy'] as const
const camera = ref<(typeof CAMERA_ORDER)[number]>('overview')

const channel = ref<OceanChannel>('temperature')
const isoEnabled = ref(false)
const stationsVisible = ref(true)
const layerEnabled = ref(false)
const depthFrac = ref(0.3)
const layerThickness = ref(0.08)
const activeStationId = ref(config.stations[1]?.id ?? config.stations[0].id)
const stats = ref<OceanStatsResult | null>(null)
const busy = ref(false)
const profileCanvas = ref<HTMLCanvasElement | null>(null)
const tsCanvas = ref<HTMLCanvasElement | null>(null)
let overlay: OceanOverlayHandle | undefined
let initialized = false

const scene = useVolumeScene(spec, {
  onReady: (engine) => {
    engine.setRenderParams({ densityGamma: 1.15, thresholdSoft: 0.05, lighting: 0.4 })
    engine.setBackgroundMode('engineering')
    if (spec.vector) engine.setParticlesVisible(true)
    overlay?.destroy()
    overlay = installOceanOverlay(engine)
    overlay.update({ stationsVisible: stationsVisible.value, activeStationId: activeStationId.value })
    if (!initialized) {
      initialized = true
      const cam = config.camera.overview
      engine.flyToView(cam.heading, cam.pitch, cam.rangeFactor, 0)
    }
    applyLayer()
    void refreshAll()
  }
})
const { container, sliceCanvas } = scene

const meta = computed(() => scene.active())
const legendCss = computed(() => gradientCss(scene.ui.palette))
const activeStation = computed(() => config.stations.find((s) => s.id === activeStationId.value) ?? config.stations[0])
const thresholdList = computed(() => meta.value.thresholds ?? [])
const threshold = ref(thresholdList.value[0] ?? 0)

function colorAt(value: number): [number, number, number] {
  const lut = buildTransferLut(meta.value.palette)
  const t = Math.max(0, Math.min(1, (value - meta.value.min) / (meta.value.max - meta.value.min || 1)))
  const idx = Math.round(t * 255)
  return [lut[idx * 4] / 255, lut[idx * 4 + 1] / 255, lut[idx * 4 + 2] / 255]
}

/* ----------------------------- 分析 ----------------------------- */

async function refreshStats(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  try {
    stats.value = await runOceanStats(engine, {
      channel: channel.value,
      volSize: [V.width, V.depth, V.height],
      stations: config.stations.map((s) => ({ id: s.id, x: s.x, y: s.y }))
    })
    await nextTick()
    if (tsCanvas.value && stats.value) drawTSDiagram(tsCanvas.value, stats.value.stations, config.waterMasses)
    refreshOverlay()
  } catch {
    stats.value = null
  }
}

async function refreshIso(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  engine.clearIsosurface()
  if (!isoEnabled.value) return
  busy.value = true
  try {
    const result = await runOceanIso(engine, channel.value, threshold.value, [V.width, V.depth, V.height])
    if (result && result.count) engine.setIsosurface(result.positions, result.normals, colorAt(threshold.value), 0.4, 'ocean-iso')
  } finally {
    busy.value = false
  }
}

let lastProfile: OceanProfileResult | undefined
async function refreshProfile(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  const st = activeStation.value
  lastProfile = await runOceanProfile(engine, st.x, st.y, channel.value, 64)
  await nextTick()
  if (profileCanvas.value && lastProfile) {
    drawOceanProfile(profileCanvas.value, lastProfile, meta.value.min, meta.value.max, stats.value?.thermoclineDepthM ?? 0, V.height)
  }
}

function refreshOverlay(): void {
  overlay?.update({ stationsVisible: stationsVisible.value, activeStationId: activeStationId.value })
}

function refreshAll(): void {
  void refreshStats()
  void refreshIso()
  void refreshProfile()
}

/* ----------------------------- 交互 ----------------------------- */

function onChannel(key: string): void {
  channel.value = key as OceanChannel
  scene.setChannel(key)
  threshold.value = meta.value.thresholds?.[0] ?? meta.value.min
  void refreshAll()
}

function applyLayer(): void {
  const engine = scene.engine.value
  if (!engine) return
  if (!layerEnabled.value) {
    engine.setHeightClip(0, 1, false)
    return
  }
  const center = 1 - depthFrac.value
  const half = layerThickness.value / 2
  engine.setHeightClip(Math.max(0, center - half), Math.min(1, center + half), true)
}

function pickStation(id: string): void {
  activeStationId.value = id
  refreshOverlay()
  const st = activeStation.value
  scene.engine.value?.flyToNormalized(st.x, st.y, 0.95, V.width * 0.4, 1)
  void refreshProfile()
}

function flyTo(key: (typeof CAMERA_ORDER)[number]): void {
  camera.value = key
  const cam = config.camera[key]
  scene.engine.value?.flyToView(cam.heading, cam.pitch, cam.rangeFactor, 1.1)
}

watch(
  () => scene.ui.timeStep,
  () => {
    void refreshStats()
    void refreshProfile()
    if (isoEnabled.value) void refreshIso()
  }
)

watch([depthFrac, layerThickness], () => {
  if (layerEnabled.value) applyLayer()
})

onBeforeUnmount(() => {
  overlay?.destroy()
  overlay = undefined
})

/* ----------------------------- 视图 ----------------------------- */

const kpiCards = computed(() => {
  const s = stats.value
  if (!s) return []
  const d = meta.value.decimals ?? 2
  return [
    { label: '最小值', value: s.minValue.toFixed(d), unit: meta.value.unit },
    { label: '最大值', value: s.maxValue.toFixed(d), unit: meta.value.unit },
    { label: '均值', value: s.meanValue.toFixed(d), unit: meta.value.unit },
    { label: '温跃层深度', value: s.thermoclineDepthM.toFixed(0), unit: 'm' }
  ]
})

const statsItems = computed<StatItem[]>(() => {
  const s = stats.value
  const items: StatItem[] = [
    { label: '海域', value: config.regionName },
    { label: '观测站', value: `${config.stations.length} 个` },
    { label: '水深', value: `${V.height} m` },
    { label: '当前变量', value: meta.value.label },
    { label: '季节', value: `${scene.ui.timeStep + 1}/${spec.timeSteps} ${spec.timeStepUnit}` }
  ]
  if (s) items.push({ label: '水团', value: `${config.waterMasses.length} 类` })
  return items
})

const clipRows = computed<StatItem[]>(() => [
  { label: '变量', value: meta.value.label },
  { label: '剖切方位', value: `${scene.ui.azimuth}°` },
  { label: '剖切倾角', value: `${scene.ui.tilt}°` },
  { label: '剖切偏移', value: `${scene.ui.offset}%` }
])

const pickedView = computed<PickedView | null>(() => {
  const p = scene.picked.value
  if (!p) return null
  if (!p.valid) return { title: '海区拾取', rows: [], empty: '该处无数据' }
  const rows: StatItem[] = [{ label: meta.value.label, value: `${p.value.toFixed(meta.value.decimals ?? 2)} ${meta.value.unit}` }]
  if (p.norm) rows.push({ label: '水深', value: `${((1 - p.norm[2]) * V.height).toFixed(0)} m` })
  return { title: '海区拾取', rows }
})
</script>

<template>
  <VolumeShell
    title="海洋温盐深三维体"
    :status="scene.status.value"
    :panel-open="panelOpen"
    :legend-css="legendCss"
    :legend-min="`${scene.active().min} ${scene.active().unit}`"
    :legend-max="`${scene.active().max} ${scene.active().unit}`"
    :stats="statsItems"
    :clip-rows="clipRows"
    :has-slice="scene.hasSlice.value"
    :picked="pickedView"
    @toggle-panel="panelOpen = !panelOpen"
    @download-slice="scene.downloadSlice()"
  >
    <template #scene>
      <div ref="container" class="vol-cesium"></div>
      <div v-if="kpiCards.length" class="oc-kpi">
        <div v-for="card in kpiCards" :key="card.label" class="oc-kpi-card">
          <span>{{ card.label }}</span>
          <b>{{ card.value }}<i>{{ card.unit }}</i></b>
        </div>
      </div>
      <div class="oc-cam">
        <button
          v-for="key in CAMERA_ORDER"
          :key="key"
          type="button"
          class="oc-cam-btn"
          :class="{ active: camera === key }"
          @click="flyTo(key)"
        >
          {{ config.camera[key].label }}
        </button>
      </div>
    </template>

    <template #slice>
      <canvas ref="sliceCanvas" :class="{ hidden: !scene.hasSlice.value }"></canvas>
    </template>

    <template #dock>
      <div class="oc-dock">
        <div class="oc-dock-title">站位层结 · {{ activeStation.id }}</div>
        <canvas ref="profileCanvas" width="206" height="118" class="oc-canvas"></canvas>
        <div class="oc-dock-title" style="margin-top: 6px">温盐散点（T-S）</div>
        <canvas ref="tsCanvas" width="206" height="118" class="oc-canvas"></canvas>
        <div class="oc-dock-chips">
          <button
            v-for="st in config.stations"
            :key="st.id"
            type="button"
            class="oc-dock-chip"
            :class="{ active: st.id === activeStationId }"
            @click="pickStation(st.id)"
          >
            {{ st.id }}
          </button>
        </div>
      </div>
    </template>

    <template #legend>
      <div class="oc-region">{{ config.regionName }}</div>
      <div class="oc-masses">
        <div v-for="wm in config.waterMasses" :key="wm.name" class="oc-mass">
          <span class="oc-dot" :style="{ background: wm.color }"></span>
          <span>{{ wm.name }}</span>
          <b>{{ wm.tRange[0] }}~{{ wm.tRange[1] }}°C</b>
        </div>
      </div>
      <div class="oc-depth">
        <span v-for="d in config.depthMarks" :key="d">{{ d }}m</span>
      </div>
      <div class="oc-note">
        温跃层处温度梯度最大，其深度随季节与中尺度涡变化；上层暖而淡、深层冷而咸，
        温盐点落在对应水团范围内。可通过深度分层浏览任意水层，结合海流粒子判读输运结构。
      </div>
    </template>

    <template #controls>
      <div class="oc-block">
        <div class="vol-section">水文变量</div>
        <div class="oc-chips">
          <button
            v-for="ch in spec.channels"
            :key="ch.key"
            type="button"
            class="oc-chip"
            :class="{ active: scene.ui.channel === ch.key }"
            @click="onChannel(ch.key)"
          >
            {{ ch.label }}
          </button>
        </div>
      </div>

      <div class="oc-block">
        <div class="vol-section">季节演变（{{ spec.timeStepUnit }}）</div>
        <div class="vol-row">
          <span class="vol-label">时间步</span>
          <input
            type="range"
            min="0"
            :max="spec.timeSteps - 1"
            step="1"
            :value="scene.ui.timeStep"
            @input="scene.setTimeStep(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="vol-value">{{ scene.ui.timeStep + 1 }}/{{ spec.timeSteps }}</span>
        </div>
        <button class="oc-btn ghost" @click="scene.togglePlay()">{{ scene.ui.playing ? '暂停' : '自动播放' }}</button>
      </div>

      <div class="oc-block">
        <div class="vol-section">深度分层浏览</div>
        <div class="vol-row">
          <span class="vol-label">启用分层</span>
          <button class="vol-switch" :class="{ 'is-on': layerEnabled }" @click="layerEnabled = !layerEnabled; applyLayer()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">深度</span>
          <input type="range" min="0" max="1" step="0.01" v-model.number="depthFrac" />
          <span class="vol-value">{{ (depthFrac * V.height).toFixed(0) }} m</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">层厚</span>
          <input type="range" min="0.02" max="0.4" step="0.01" v-model.number="layerThickness" />
          <span class="vol-value">{{ (layerThickness * V.height).toFixed(0) }} m</span>
        </div>
        <div class="oc-hint">深度自海表向下递增；分层仅保留所选水层，便于判读垂向结构。</div>
      </div>

      <div class="oc-block">
        <div class="vol-section">等值面</div>
        <div class="vol-row">
          <span class="vol-label">显示阈值面</span>
          <button class="vol-switch" :class="{ 'is-on': isoEnabled }" @click="isoEnabled = !isoEnabled; refreshIso()"><span></span></button>
        </div>
        <div v-if="thresholdList.length" class="oc-thr-chips">
          <button
            v-for="t in thresholdList"
            :key="t"
            type="button"
            class="oc-thr"
            :class="{ active: threshold === t }"
            @click="threshold = t; refreshIso()"
          >
            {{ t }} {{ meta.unit }}
          </button>
        </div>
      </div>

      <div class="oc-block">
        <div class="vol-section">叠加与流场</div>
        <div class="vol-row">
          <span class="vol-label">观测站位</span>
          <button class="vol-switch" :class="{ 'is-on': stationsVisible }" @click="stationsVisible = !stationsVisible; refreshOverlay()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">海流粒子</span>
          <button class="vol-switch" :class="{ 'is-on': scene.ui.particleVisible }" @click="scene.setParticlesVisible(!scene.ui.particleVisible)"><span></span></button>
        </div>
      </div>

      <div class="oc-block">
        <div class="vol-section">体渲染</div>
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
          <span class="vol-label">精度</span>
          <div class="oc-seg">
            <button type="button" class="oc-seg-btn" @click="scene.setPreset(16, 4)">128³</button>
            <button type="button" class="oc-seg-btn" @click="scene.setPreset(24, 4)">192³</button>
            <button type="button" class="oc-seg-btn" @click="scene.setPreset(32, 4)">256³</button>
          </div>
        </div>
      </div>

      <div class="oc-block">
        <div class="vol-section">任意方向剖切</div>
        <div class="vol-row">
          <span class="vol-label">启用剖切</span>
          <button class="vol-switch" :class="{ 'is-on': scene.ui.clipEnabled }" @click="scene.ui.clipEnabled = !scene.ui.clipEnabled; scene.setClip()"><span></span></button>
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
    </template>

    <template #actions>
      <button class="vol-action" :disabled="busy" @click="refreshAll()">重新分析</button>
      <button class="vol-action ghost" @click="flyTo('overview')">恢复视图</button>
    </template>
  </VolumeShell>
</template>

<style scoped>
.oc-block {
  margin-bottom: 10px;
}
.oc-chips {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.oc-chip {
  padding: 6px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.oc-chip.active {
  border-color: #39c6d6;
  background: rgba(57, 198, 214, 0.22);
  color: #fff;
  font-weight: 600;
}
.oc-btn {
  width: 100%;
  height: 26px;
  margin-top: 4px;
  border: 0;
  border-radius: 5px;
  background: #2f80ed;
  color: #eef4ff;
  font-size: 11px;
  cursor: pointer;
}
.oc-btn.ghost {
  background: rgba(57, 198, 214, 0.16);
  border: 1px solid rgba(57, 198, 214, 0.6);
  color: #9fe6ee;
}
.oc-thr-chips {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.oc-thr {
  padding: 4px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 9px;
  cursor: pointer;
}
.oc-thr.active {
  border-color: #39c6d6;
  background: rgba(57, 198, 214, 0.22);
  color: #fff;
}
.oc-hint {
  margin-top: 4px;
  font-size: 9px;
  line-height: 1.5;
  color: #7f96b3;
}
.oc-seg {
  display: flex;
  gap: 4px;
  flex: 1 1 auto;
}
.oc-seg-btn {
  flex: 1 1 0;
  padding: 5px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.oc-seg-btn:hover {
  border-color: #39c6d6;
  color: #fff;
}
.oc-region {
  font-size: 12px;
  font-weight: 700;
  color: #39c6d6;
  margin-bottom: 6px;
}
.oc-masses {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 8px;
}
.oc-mass {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: #c3d5e8;
}
.oc-mass b {
  margin-left: auto;
  color: #dce8f5;
  font-variant-numeric: tabular-nums;
}
.oc-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.oc-depth {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.oc-depth span {
  padding: 2px 5px;
  border-radius: 4px;
  background: rgba(57, 198, 214, 0.14);
  color: #9fe6ee;
  font-size: 9px;
}
.oc-note {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
  font-size: 9px;
  line-height: 1.6;
  color: #9fb8d4;
}
.oc-kpi {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9;
  display: flex;
  justify-content: center;
  gap: 4px;
  max-width: min(560px, calc(100% - 360px));
  pointer-events: none;
}
.oc-kpi-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 80px;
  padding: 4px 9px;
  border: 1px solid rgba(57, 198, 214, 0.3);
  border-radius: 6px;
  background: rgba(4, 20, 30, 0.82);
  backdrop-filter: blur(5px);
}
.oc-kpi-card span {
  font-size: 9px;
  color: #9fc6d0;
}
.oc-kpi-card b {
  margin-top: 1px;
  color: #65d3eb;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.oc-kpi-card b i {
  margin-left: 2px;
  color: #6f8b96;
  font-size: 8px;
  font-style: normal;
  font-weight: 500;
}
.oc-cam {
  position: absolute;
  bottom: 14px;
  right: 14px;
  z-index: 9;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-width: 300px;
  justify-content: flex-end;
}
.oc-cam-btn {
  padding: 5px 10px;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 6px;
  background: rgba(4, 20, 30, 0.85);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.oc-cam-btn.active,
.oc-cam-btn:hover {
  border-color: #39c6d6;
  background: rgba(57, 198, 214, 0.22);
  color: #fff;
}
.oc-dock {
  width: 226px;
  padding: 10px 12px;
  border: 1px solid rgba(57, 198, 214, 0.3);
  border-radius: 9px;
  background: rgba(4, 20, 30, 0.9);
  backdrop-filter: blur(6px);
  color: #d8eef2;
}
.oc-dock-title {
  font-size: 11px;
  font-weight: 700;
  color: #39c6d6;
  margin-bottom: 5px;
}
.oc-canvas {
  display: block;
  width: 100%;
  border-radius: 6px;
  border: 1px solid rgba(57, 198, 214, 0.3);
  background: #061a24;
}
.oc-dock-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 6px;
}
.oc-dock-chip {
  padding: 3px 6px;
  border: 1px solid rgba(57, 198, 214, 0.35);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  color: #bfe3ea;
  font-size: 9px;
  cursor: pointer;
}
.oc-dock-chip.active {
  border-color: #39c6d6;
  background: rgba(57, 198, 214, 0.22);
  color: #fff;
}
@media (max-width: 860px) {
  .oc-kpi {
    max-width: calc(100% - 24px);
    top: auto;
    bottom: 52px;
  }
}
</style>
