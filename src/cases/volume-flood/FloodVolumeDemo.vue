<script setup lang="ts">
/**
 * 洪水动力三维水深体 —— 流域洪水演进分析工作台
 *
 * 由地形、河道与洪水过程线驱动的三维水深 / 流速 / 水位体，叠加水文站与受影响城区；
 * 支持时间演变、洪峰时刻、淹没阈值、沿河道纵剖面、受影响对象统计与任意方向剖切。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import VolumeShell from '../../lib/volume-engine/VolumeShell.vue'
import { useVolumeScene } from '../../lib/volume-engine/useVolumeScene'
import { FLOOD_CONFIG, SCENES } from '../../lib/volume-engine/scenes'
import { gradientCss } from '../../lib/volume-engine/palette'
import type { PickedView, StatItem } from '../../lib/volume-engine/types'
import {
  drawFloodProfile,
  runFloodIso,
  runFloodProfile,
  runFloodStats,
  type FloodProfileResult,
  type FloodStatsResult
} from './flood-analysis'
import { installFloodOverlay, type FloodOverlayHandle } from './flood-overlays'

const spec = SCENES.flood
const config = FLOOD_CONFIG
const panelOpen = ref(true)
const V = spec.volume

const CAMERA_ORDER = ['overview', 'river', 'city', 'peak', 'section'] as const
const camera = ref<(typeof CAMERA_ORDER)[number]>('overview')

const depthThreshold = ref(config.depthThresholds[0])
const isoEnabled = ref(false)
const riverVisible = ref(true)
const gaugesVisible = ref(true)
const zonesVisible = ref(true)
const activeZoneId = ref<string | undefined>(config.zones[0]?.id)
const stats = ref<FloodStatsResult | null>(null)
const busy = ref(false)
const profileCanvas = ref<HTMLCanvasElement | null>(null)
let overlay: FloodOverlayHandle | undefined
let initialized = false

const scene = useVolumeScene(spec, {
  onReady: (engine) => {
    engine.setRenderParams({ densityGamma: 1.1, thresholdSoft: 0.06, lighting: 0.35 })
    engine.setBackgroundMode('engineering')
    if (spec.vector) engine.setParticlesVisible(true)
    overlay?.destroy()
    overlay = installFloodOverlay(engine)
    overlay.update({
      riverVisible: riverVisible.value,
      gaugesVisible: gaugesVisible.value,
      zonesVisible: zonesVisible.value,
      activeZoneId: activeZoneId.value
    })
    if (!initialized) {
      initialized = true
      const cam = config.camera.overview
      engine.flyToView(cam.heading, cam.pitch, cam.rangeFactor, 0)
    }
    void refreshAll()
  }
})
const { container, sliceCanvas } = scene

const meta = computed(() => scene.active())
const legendCss = computed(() => gradientCss(scene.ui.palette))

function zoneName(id: string): string {
  return config.zones.find((z) => z.id === id)?.name ?? id
}

function zoneKind(id: string): string {
  const kind = config.zones.find((z) => z.id === id)?.kind
  return kind === 'city' ? '城区' : kind === 'village' ? '村落' : kind === 'farm' ? '农田' : '基础设施'
}

/* ----------------------------- 分析 ----------------------------- */

async function refreshStats(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  try {
    stats.value = await runFloodStats(engine, {
      depthThreshold: depthThreshold.value,
      timeSteps: spec.timeSteps,
      volSize: [V.width, V.depth, V.height],
      zones: config.zones.map((z) => ({ id: z.id, x: z.x, y: z.y, r: z.r }))
    })
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
    const result = await runFloodIso(engine, depthThreshold.value, [V.width, V.depth, V.height])
    if (result && result.count) engine.setIsosurface(result.positions, result.normals, [0.24, 0.63, 1], 0.5, 'flood-iso')
  } finally {
    busy.value = false
  }
}

async function refreshProfile(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  const result: FloodProfileResult = await runFloodProfile(engine, 160)
  await nextTick()
  if (profileCanvas.value) drawFloodProfile(profileCanvas.value, result, depthThreshold.value)
}

function refreshOverlay(): void {
  overlay?.update({
    riverVisible: riverVisible.value,
    gaugesVisible: gaugesVisible.value,
    zonesVisible: zonesVisible.value,
    activeZoneId: activeZoneId.value
  })
}

function refreshAll(): void {
  void refreshStats()
  void refreshIso()
  void refreshProfile()
}

/* ----------------------------- 交互 ----------------------------- */

function onChannel(key: string): void {
  scene.setChannel(key)
  void refreshAll()
}

function pickThreshold(value: number): void {
  depthThreshold.value = value
  void refreshIso()
  void refreshStats()
  void refreshProfile()
}

function commitThreshold(): void {
  void refreshIso()
  void refreshStats()
  void refreshProfile()
}

function jumpPeak(): void {
  scene.setTimeStep(Math.round((spec.timeSteps - 1) * 0.6))
}

function focusZone(id: string): void {
  activeZoneId.value = id
  refreshOverlay()
  const zone = config.zones.find((z) => z.id === id)
  if (zone) scene.engine.value?.flyToNormalized(zone.x, zone.y, 0.3, V.width * 0.35, 1)
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

onBeforeUnmount(() => {
  overlay?.destroy()
  overlay = undefined
})

/* ----------------------------- 视图 ----------------------------- */

const kpiCards = computed(() => {
  const s = stats.value
  if (!s) return []
  return [
    { label: '淹没面积', value: (s.floodedAreaM2 / 1e6).toFixed(2), unit: 'km²' },
    { label: '淹没水量', value: (s.floodedVolumeM3 / 10000).toFixed(0), unit: '万 m³' },
    { label: '最大水深', value: s.maxDepthM.toFixed(2), unit: 'm' },
    { label: '最大流速', value: s.maxSpeed.toFixed(2), unit: 'm/s' }
  ]
})

const statsItems = computed<StatItem[]>(() => {
  const s = stats.value
  const items: StatItem[] = [
    { label: '流域', value: config.basinName },
    { label: '水文站', value: `${config.gauges.length} 座` },
    { label: '受影响对象', value: `${config.zones.length} 处` },
    { label: '当前变量', value: meta.value.label },
    { label: '时间', value: `${scene.ui.timeStep + 1}/${spec.timeSteps} ${spec.timeStepUnit}` }
  ]
  if (s) {
    items.push({ label: '平均水深', value: `${s.meanDepthM.toFixed(2)} m` })
    items.push({ label: '淹没占比', value: `${(s.floodedFraction * 100).toFixed(1)}%` })
  }
  return items
})

const clipRows = computed<StatItem[]>(() => [
  { label: '变量', value: meta.value.label },
  { label: '剖切方位', value: `${scene.ui.azimuth}°` },
  { label: '剖切倾角', value: `${scene.ui.tilt}°` },
  { label: '剖切偏移', value: `${scene.ui.offset}%` }
])

const zoneRows = computed(() => stats.value?.zoneStats ?? [])

const pickedView = computed<PickedView | null>(() => {
  const p = scene.picked.value
  if (!p) return null
  if (!p.valid) return { title: '洪水拾取', rows: [], empty: '该处为干出区' }
  const rows: StatItem[] = [{ label: meta.value.label, value: `${p.value.toFixed(2)} ${meta.value.unit}` }]
  if (p.lon !== undefined && p.lat !== undefined) rows.push({ label: '坐标', value: `${p.lon.toFixed(3)}, ${p.lat.toFixed(3)}` })
  return { title: '洪水拾取', rows }
})
</script>

<template>
  <VolumeShell
    title="洪水动力水深体"
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
      <div v-if="kpiCards.length" class="fl-kpi">
        <div v-for="card in kpiCards" :key="card.label" class="fl-kpi-card">
          <span>{{ card.label }}</span>
          <b>{{ card.value }}<i>{{ card.unit }}</i></b>
        </div>
      </div>
      <div class="fl-cam">
        <button
          v-for="key in CAMERA_ORDER"
          :key="key"
          type="button"
          class="fl-cam-btn"
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
      <div class="fl-dock">
        <div class="fl-dock-title">沿河道纵剖面 · {{ spec.timeStepUnit === 'h' ? `T+${scene.ui.timeStep + 1}h` : '' }}</div>
        <canvas ref="profileCanvas" width="212" height="132" class="fl-canvas"></canvas>
        <div class="fl-dock-title" style="margin-top: 6px">受影响对象</div>
        <div class="fl-zone-list">
          <div v-for="z in zoneRows" :key="z.id" class="fl-zone" :class="{ active: z.id === activeZoneId }" @click="focusZone(z.id)">
            <span class="fl-zone-name">{{ zoneName(z.id) }}<i>{{ zoneKind(z.id) }}</i></span>
            <b>{{ z.maxDepthM.toFixed(2) }}m / {{ z.arrivalStep >= 0 ? `T+${z.arrivalStep}h` : '未淹没' }}</b>
          </div>
        </div>
      </div>
    </template>

    <template #legend>
      <div class="fl-basin">{{ config.basinName }}</div>
      <div class="fl-warning">
        <div v-for="w in config.warningLevels" :key="w.level" class="fl-warning-row">
          <span class="fl-dot" :style="{ background: w.color }"></span>
          <span>{{ w.level }}</span><b>{{ w.depth }} m</b>
        </div>
      </div>
      <div class="fl-note">
        三维水深体由地形、河道与洪水过程线共同驱动：主槽行洪流速高，堤外低洼区积水深、退水慢；
        水面随时间演进，淹没范围以水深阈值判定，受影响对象按最大水深与到达时间评估。
      </div>
    </template>

    <template #controls>
      <div class="fl-block">
        <div class="vol-section">水文变量</div>
        <div class="fl-chips">
          <button
            v-for="ch in spec.channels"
            :key="ch.key"
            type="button"
            class="fl-chip"
            :class="{ active: scene.ui.channel === ch.key }"
            @click="onChannel(ch.key)"
          >
            {{ ch.label }}
          </button>
        </div>
      </div>

      <div class="fl-block">
        <div class="vol-section">时间演变（{{ spec.timeStepUnit }}）</div>
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
        <div class="fl-time-btns">
          <button class="fl-btn ghost" @click="scene.togglePlay()">{{ scene.ui.playing ? '暂停' : '自动播放' }}</button>
          <button class="fl-btn ghost" @click="jumpPeak()">洪峰时刻</button>
        </div>
      </div>

      <div class="fl-block">
        <div class="vol-section">淹没阈值 / 等值面</div>
        <div class="fl-thr-chips">
          <button
            v-for="t in config.depthThresholds"
            :key="t"
            type="button"
            class="fl-thr"
            :class="{ active: depthThreshold === t }"
            @click="pickThreshold(t)"
          >
            {{ t }} m
          </button>
        </div>
        <div class="vol-row">
          <span class="vol-label">水深阈值</span>
          <input type="range" min="0.2" max="4" step="0.1" v-model.number="depthThreshold" @change="commitThreshold()" />
          <span class="vol-value">{{ depthThreshold.toFixed(1) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">预警等值面</span>
          <button class="vol-switch" :class="{ 'is-on': isoEnabled }" @click="isoEnabled = !isoEnabled; refreshIso()"><span></span></button>
        </div>
      </div>

      <div class="fl-block">
        <div class="vol-section">叠加图层</div>
        <div class="vol-row">
          <span class="vol-label">河道中心线</span>
          <button class="vol-switch" :class="{ 'is-on': riverVisible }" @click="riverVisible = !riverVisible; refreshOverlay()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">水文站</span>
          <button class="vol-switch" :class="{ 'is-on': gaugesVisible }" @click="gaugesVisible = !gaugesVisible; refreshOverlay()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">受影响对象</span>
          <button class="vol-switch" :class="{ 'is-on': zonesVisible }" @click="zonesVisible = !zonesVisible; refreshOverlay()"><span></span></button>
        </div>
        <div class="fl-hint">对象点大小反映影响半径；点击列表可定位到对应区域并读取最大水深与到达时间。</div>
      </div>

      <div class="fl-block">
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
          <div class="fl-seg">
            <button type="button" class="fl-seg-btn" @click="scene.setPreset(16, 4)">128³</button>
            <button type="button" class="fl-seg-btn" @click="scene.setPreset(24, 4)">192³</button>
            <button type="button" class="fl-seg-btn" @click="scene.setPreset(32, 4)">256³</button>
          </div>
        </div>
      </div>

      <div class="fl-block">
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
.fl-block {
  margin-bottom: 10px;
}
.fl-chips {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.fl-chip {
  padding: 6px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.fl-chip.active {
  border-color: #39a0ff;
  background: rgba(57, 160, 255, 0.22);
  color: #fff;
  font-weight: 600;
}
.fl-time-btns {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}
.fl-btn {
  flex: 1 1 0;
  height: 26px;
  border: 0;
  border-radius: 5px;
  background: #2f80ed;
  color: #eef4ff;
  font-size: 11px;
  cursor: pointer;
}
.fl-btn.ghost {
  background: rgba(57, 160, 255, 0.16);
  border: 1px solid rgba(57, 160, 255, 0.65);
  color: #9fd8ff;
}
.fl-thr-chips {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-bottom: 4px;
}
.fl-thr {
  padding: 4px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 9px;
  cursor: pointer;
}
.fl-thr.active {
  border-color: #eb5757;
  background: rgba(235, 87, 87, 0.22);
  color: #fff;
}
.fl-hint {
  margin-top: 4px;
  font-size: 9px;
  line-height: 1.5;
  color: #7f96b3;
}
.fl-seg {
  display: flex;
  gap: 4px;
  flex: 1 1 auto;
}
.fl-seg-btn {
  flex: 1 1 0;
  padding: 5px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.fl-seg-btn:hover {
  border-color: #39a0ff;
  color: #fff;
}
.fl-basin {
  font-size: 12px;
  font-weight: 700;
  color: #39a0ff;
  margin-bottom: 6px;
}
.fl-warning {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 8px;
}
.fl-warning-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: #c3d5e8;
}
.fl-warning-row b {
  margin-left: auto;
  color: #dce8f5;
  font-variant-numeric: tabular-nums;
}
.fl-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.fl-note {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
  font-size: 9px;
  line-height: 1.6;
  color: #9fb8d4;
}
.fl-kpi {
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
.fl-kpi-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 80px;
  padding: 4px 9px;
  border: 1px solid rgba(57, 160, 255, 0.3);
  border-radius: 6px;
  background: rgba(6, 18, 36, 0.82);
  backdrop-filter: blur(5px);
}
.fl-kpi-card span {
  font-size: 9px;
  color: #9fb8d4;
}
.fl-kpi-card b {
  margin-top: 1px;
  color: #65d3eb;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.fl-kpi-card b i {
  margin-left: 2px;
  color: #6f8bab;
  font-size: 8px;
  font-style: normal;
  font-weight: 500;
}
.fl-cam {
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
.fl-cam-btn {
  padding: 5px 10px;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 6px;
  background: rgba(6, 18, 36, 0.85);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.fl-cam-btn.active,
.fl-cam-btn:hover {
  border-color: #39a0ff;
  background: rgba(57, 160, 255, 0.22);
  color: #fff;
}
.fl-dock {
  width: 228px;
  padding: 10px 12px;
  border: 1px solid rgba(57, 160, 255, 0.3);
  border-radius: 9px;
  background: rgba(6, 18, 36, 0.9);
  backdrop-filter: blur(6px);
  color: #dce8f5;
}
.fl-dock-title {
  font-size: 11px;
  font-weight: 700;
  color: #39a0ff;
  margin-bottom: 5px;
}
.fl-canvas {
  display: block;
  width: 100%;
  border-radius: 6px;
  border: 1px solid rgba(57, 160, 255, 0.3);
  background: #081a30;
}
.fl-zone-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 128px;
  overflow-y: auto;
}
.fl-zone {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 9px;
  cursor: pointer;
}
.fl-zone.active {
  background: rgba(57, 160, 255, 0.24);
}
.fl-zone-name {
  color: #cfe0f0;
}
.fl-zone-name i {
  margin-left: 3px;
  color: #7f96b3;
  font-style: normal;
}
.fl-zone b {
  color: #65d3eb;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 860px) {
  .fl-kpi {
    max-width: calc(100% - 24px);
    top: auto;
    bottom: 52px;
    flex-wrap: wrap;
  }
}
</style>
