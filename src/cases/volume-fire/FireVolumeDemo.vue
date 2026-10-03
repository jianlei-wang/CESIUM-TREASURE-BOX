<script setup lang="ts">
/**
 * 火灾烟气与温度三维体 —— 城市建筑火灾态势研判工作台
 *
 * 多火源随时间的成长与浮升烟羽在环境风驱动下向下风向输运，生成三维温度 / 烟气 /
 * 能见度场，叠加建筑、危险阈值等值面、环境风与疏散方向，统计危险体积、烟羽顶高与下风向距离。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import VolumeShell from '../../lib/volume-engine/VolumeShell.vue'
import { useVolumeScene } from '../../lib/volume-engine/useVolumeScene'
import { FIRE_CONFIG, SCENES } from '../../lib/volume-engine/scenes'
import { gradientCss, buildTransferLut } from '../../lib/volume-engine/palette'
import type { PickedView, StatItem } from '../../lib/volume-engine/types'
import {
  drawFireProfile,
  runFireIso,
  runFireProfile,
  runFireStats,
  type FireChannel,
  type FireProfileResult,
  type FireStatsResult
} from './fire-analysis'
import { installFireOverlay, type FireOverlayHandle } from './fire-overlays'

const spec = SCENES.fire
const config = FIRE_CONFIG
const panelOpen = ref(true)
const V = spec.volume

const CAMERA_ORDER = ['overview', 'plume', 'source', 'section', 'evacuation'] as const
const camera = ref<(typeof CAMERA_ORDER)[number]>('overview')

const channel = ref<FireChannel>('temp')
const tempThreshold = ref(config.tempThresholds[1])
const smokeThreshold = ref(config.smokeThresholds[1])
const isoEnabled = ref(true)
const sourcesVisible = ref(true)
const buildingsVisible = ref(true)
const windVisible = ref(true)
const escapeVisible = ref(true)
const windDir = ref(spec.params.windDir ?? 235)
const windSpeed = ref(spec.params.windSpeed ?? 6)
const stats = ref<FireStatsResult | null>(null)
const busy = ref(false)
const profileCanvas = ref<HTMLCanvasElement | null>(null)
let overlay: FireOverlayHandle | undefined
let initialized = false

const scene = useVolumeScene(spec, {
  onReady: (engine) => {
    engine.setRenderParams({ densityGamma: 1.15, thresholdSoft: 0.05, lighting: 0.45 })
    engine.setBackgroundMode('engineering')
    if (spec.vector) engine.setParticlesVisible(true)
    overlay?.destroy()
    overlay = installFireOverlay(engine)
    refreshOverlay()
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
const activeThreshold = computed(() => (channel.value === 'temp' ? tempThreshold.value : smokeThreshold.value))
const thresholdList = computed(() => (channel.value === 'temp' ? config.tempThresholds : channel.value === 'smoke' ? config.smokeThresholds : []))

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
    stats.value = await runFireStats(engine, {
      tempThreshold: tempThreshold.value,
      smokeThreshold: smokeThreshold.value,
      volSize: [V.width, V.depth, V.height],
      buildings: config.buildings.map((b) => ({ id: b.id, x: b.x, y: b.y }))
    })
    refreshOverlay()
  } catch {
    stats.value = null
  }
}

async function refreshIso(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  engine.clearIsosurface()
  if (!isoEnabled.value || channel.value === 'visibility') return
  busy.value = true
  try {
    const result = await runFireIso(engine, channel.value, activeThreshold.value, [V.width, V.depth, V.height])
    if (result && result.count) {
      engine.setIsosurface(result.positions, result.normals, channel.value === 'temp' ? [1, 0.42, 0.12] : [0.62, 0.6, 0.55], 0.42, 'fire-iso')
    }
  } finally {
    busy.value = false
  }
}

let lastProfile: FireProfileResult | undefined
async function refreshProfile(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  const main = config.sources[0]
  const profileChannel: FireChannel = channel.value === 'visibility' ? 'temp' : channel.value
  lastProfile = await runFireProfile(engine, main.x, main.y, profileChannel, 60)
  await nextTick()
  if (profileCanvas.value && lastProfile) {
    drawFireProfile(profileCanvas.value, lastProfile, meta.value.max, activeThreshold.value, meta.value.label)
  }
}

function refreshOverlay(): void {
  overlay?.update({
    sourcesVisible: sourcesVisible.value,
    buildingsVisible: buildingsVisible.value,
    windVisible: windVisible.value,
    escapeVisible: escapeVisible.value,
    impacts: stats.value?.impacts ?? [],
    tempThreshold: tempThreshold.value,
    smokeThreshold: smokeThreshold.value,
    windDir: windDir.value
  })
}

function refreshAll(): void {
  void refreshStats()
  void refreshIso()
  void refreshProfile()
}

/* ----------------------------- 交互 ----------------------------- */

function onChannel(key: string): void {
  channel.value = key as FireChannel
  scene.setChannel(key)
  void refreshAll()
}

function pickThreshold(value: number): void {
  if (channel.value === 'temp') tempThreshold.value = value
  else if (channel.value === 'smoke') smokeThreshold.value = value
  void refreshIso()
  void refreshStats()
  void refreshProfile()
}

function commitThreshold(): void {
  void refreshIso()
  void refreshStats()
  void refreshProfile()
}

function applyWind(): void {
  scene.engine.value?.setParams({ windDir: windDir.value, windSpeed: windSpeed.value })
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
    { label: '危险体积', value: (s.dangerVolumeM3 / 10000).toFixed(1), unit: '万 m³' },
    { label: '烟气体积', value: (s.smokeVolumeM3 / 10000).toFixed(1), unit: '万 m³' },
    { label: '最高温度', value: s.maxTemp.toFixed(0), unit: '°C' },
    { label: '烟羽顶高', value: s.plumeTopM.toFixed(0), unit: 'm' },
    { label: '下风向距离', value: s.downwindM.toFixed(0), unit: 'm' }
  ]
})

const statsItems = computed<StatItem[]>(() => {
  const s = stats.value
  const items: StatItem[] = [
    { label: '场所', value: config.siteName },
    { label: '火源', value: `${config.sources.length} 处` },
    { label: '周边建筑', value: `${config.buildings.length} 栋` },
    { label: '环境风', value: `${windSpeed.value} m/s / ${windDir.value}°` },
    { label: '时间', value: `${scene.ui.timeStep + 1}/${spec.timeSteps} ${spec.timeStepUnit}` }
  ]
  if (s) {
    items.push({ label: '危险阈温', value: `${tempThreshold.value} °C` })
    items.push({ label: '烟气阈值', value: `${smokeThreshold.value} mg/m³` })
  }
  return items
})

const clipRows = computed<StatItem[]>(() => [
  { label: '变量', value: meta.value.label },
  { label: '剖切方位', value: `${scene.ui.azimuth}°` },
  { label: '剖切倾角', value: `${scene.ui.tilt}°` },
  { label: '剖切偏移', value: `${scene.ui.offset}%` }
])

const impactRows = computed(() => {
  const s = stats.value
  if (!s) return []
  const byId = new Map(s.impacts.map((im) => [im.id, im]))
  return config.buildings.map((b) => {
    const im = byId.get(b.id)
    const temp = im?.temp ?? 0
    const smoke = im?.smoke ?? 0
    return { id: b.id, name: b.name, temp, smoke, threat: temp >= tempThreshold.value || smoke >= smokeThreshold.value }
  })
})

const pickedView = computed<PickedView | null>(() => {
  const p = scene.picked.value
  if (!p) return null
  if (!p.valid) return { title: '火场拾取', rows: [], empty: '该处未检出' }
  const rows: StatItem[] = [{ label: meta.value.label, value: `${p.value.toFixed(meta.value.decimals ?? 0)} ${meta.value.unit}` }]
  if (p.norm) rows.push({ label: '高度', value: `${(p.norm[2] * V.height).toFixed(0)} m` })
  return { title: '火场拾取', rows }
})
</script>

<template>
  <VolumeShell
    title="火灾烟气温度体"
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
      <div v-if="kpiCards.length" class="fr-kpi">
        <div v-for="card in kpiCards" :key="card.label" class="fr-kpi-card">
          <span>{{ card.label }}</span>
          <b>{{ card.value }}<i>{{ card.unit }}</i></b>
        </div>
      </div>
      <div class="fr-cam">
        <button
          v-for="key in CAMERA_ORDER"
          :key="key"
          type="button"
          class="fr-cam-btn"
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
      <div class="fr-dock">
        <div class="fr-dock-title">火源垂向剖面 · {{ meta.label }}</div>
        <canvas ref="profileCanvas" width="210" height="132" class="fr-canvas"></canvas>
        <div class="fr-dock-title" style="margin-top: 6px">建筑受威胁度</div>
        <div class="fr-impacts">
          <div v-for="b in impactRows" :key="b.id" class="fr-impact" :class="{ threat: b.threat }">
            <span>{{ b.name }}</span>
            <b>{{ b.temp.toFixed(0) }}°C / {{ b.smoke.toFixed(0) }}</b>
          </div>
        </div>
      </div>
    </template>

    <template #legend>
      <div class="fr-site">{{ config.siteName }}</div>
      <div class="fr-sources">
        <div v-for="s in config.sources" :key="s.id" class="fr-source-row">
          <span>{{ s.name }}</span><b>燃料 {{ s.fuel.toFixed(2) }}</b>
        </div>
      </div>
      <div class="fr-note">
        多火源浮升烟羽在环境风作用下向下风向拉长：火灾初期近火源高温高烟，随时间火势增强、
        烟羽顶高抬升、下风向影响距离增大；温度阈值圈定危险区，烟气阈值圈定有毒烟气区。
      </div>
    </template>

    <template #controls>
      <div class="fr-block">
        <div class="vol-section">场变量</div>
        <div class="fr-chips">
          <button
            v-for="ch in spec.channels"
            :key="ch.key"
            type="button"
            class="fr-chip"
            :class="{ active: scene.ui.channel === ch.key }"
            @click="onChannel(ch.key)"
          >
            {{ ch.label }}
          </button>
        </div>
      </div>

      <div class="fr-block">
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
        <button class="fr-btn ghost" @click="scene.togglePlay()">{{ scene.ui.playing ? '暂停' : '自动播放' }}</button>
      </div>

      <div class="fr-block">
        <div class="vol-section">环境风</div>
        <div class="vol-row">
          <span class="vol-label">风速</span>
          <input type="range" min="0" max="12" step="0.5" v-model.number="windSpeed" @change="applyWind()" />
          <span class="vol-value">{{ windSpeed.toFixed(1) }} m/s</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">风向</span>
          <input type="range" min="0" max="360" step="5" v-model.number="windDir" @change="applyWind()" />
          <span class="vol-value">{{ windDir }}°</span>
        </div>
        <div class="fr-hint">风向变化将重建体数据；粒子与叠加图层会自动恢复。</div>
      </div>

      <div class="fr-block">
        <div class="vol-section">危险阈值 / 等值面</div>
        <div v-if="thresholdList.length" class="fr-thr-chips">
          <button
            v-for="t in thresholdList"
            :key="t"
            type="button"
            class="fr-thr"
            :class="{ active: activeThreshold === t }"
            @click="pickThreshold(t)"
          >
            {{ t }}
          </button>
        </div>
        <div v-if="channel !== 'visibility'" class="vol-row">
          <span class="vol-label">阈值</span>
          <input
            type="range"
            :min="meta.min"
            :max="meta.max"
            :step="(meta.max - meta.min) / 200"
            :value="activeThreshold"
            @input="channel === 'temp' ? (tempThreshold = Number(($event.target as HTMLInputElement).value)) : (smokeThreshold = Number(($event.target as HTMLInputElement).value))"
            @change="commitThreshold()"
          />
          <span class="vol-value">{{ activeThreshold.toFixed(0) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">阈值等值面</span>
          <button class="vol-switch" :class="{ 'is-on': isoEnabled }" @click="isoEnabled = !isoEnabled; refreshIso()"><span></span></button>
        </div>
      </div>

      <div class="fr-block">
        <div class="vol-section">叠加图层</div>
        <div class="vol-row">
          <span class="vol-label">火源</span>
          <button class="vol-switch" :class="{ 'is-on': sourcesVisible }" @click="sourcesVisible = !sourcesVisible; refreshOverlay()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">周边建筑</span>
          <button class="vol-switch" :class="{ 'is-on': buildingsVisible }" @click="buildingsVisible = !buildingsVisible; refreshOverlay()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">环境风箭头</span>
          <button class="vol-switch" :class="{ 'is-on': windVisible }" @click="windVisible = !windVisible; refreshOverlay()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">疏散方向</span>
          <button class="vol-switch" :class="{ 'is-on': escapeVisible }" @click="escapeVisible = !escapeVisible; refreshOverlay()"><span></span></button>
        </div>
      </div>

      <div class="fr-block">
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
          <div class="fr-seg">
            <button type="button" class="fr-seg-btn" @click="scene.setPreset(16, 4)">128³</button>
            <button type="button" class="fr-seg-btn" @click="scene.setPreset(24, 4)">192³</button>
            <button type="button" class="fr-seg-btn" @click="scene.setPreset(32, 4)">256³</button>
          </div>
        </div>
      </div>

      <div class="fr-block">
        <div class="vol-section">垂直剖面 / 剖切</div>
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
.fr-block {
  margin-bottom: 10px;
}
.fr-chips {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.fr-chip {
  padding: 6px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.fr-chip.active {
  border-color: #ff7a2f;
  background: rgba(255, 122, 47, 0.22);
  color: #fff;
  font-weight: 600;
}
.fr-btn {
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
.fr-btn.ghost {
  background: rgba(255, 122, 47, 0.16);
  border: 1px solid rgba(255, 122, 47, 0.6);
  color: #ffb98a;
}
.fr-thr-chips {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-bottom: 4px;
}
.fr-thr {
  padding: 4px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 9px;
  cursor: pointer;
}
.fr-thr.active {
  border-color: #ff3b1f;
  background: rgba(255, 59, 31, 0.22);
  color: #fff;
}
.fr-hint {
  margin-top: 4px;
  font-size: 9px;
  line-height: 1.5;
  color: #7f96b3;
}
.fr-seg {
  display: flex;
  gap: 4px;
  flex: 1 1 auto;
}
.fr-seg-btn {
  flex: 1 1 0;
  padding: 5px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.fr-seg-btn:hover {
  border-color: #ff7a2f;
  color: #fff;
}
.fr-site {
  font-size: 12px;
  font-weight: 700;
  color: #ff7a2f;
  margin-bottom: 6px;
}
.fr-sources {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 8px;
}
.fr-source-row {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #c3d5e8;
}
.fr-source-row b {
  color: #ffb98a;
  font-variant-numeric: tabular-nums;
}
.fr-note {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
  font-size: 9px;
  line-height: 1.6;
  color: #9fb8d4;
}
.fr-kpi {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  max-width: min(600px, calc(100% - 360px));
  pointer-events: none;
}
.fr-kpi-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 74px;
  padding: 4px 9px;
  border: 1px solid rgba(255, 122, 47, 0.3);
  border-radius: 6px;
  background: rgba(26, 12, 6, 0.82);
  backdrop-filter: blur(5px);
}
.fr-kpi-card span {
  font-size: 9px;
  color: #dfb69a;
}
.fr-kpi-card b {
  margin-top: 1px;
  color: #ffb347;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.fr-kpi-card b i {
  margin-left: 2px;
  color: #9a7a66;
  font-size: 8px;
  font-style: normal;
  font-weight: 500;
}
.fr-cam {
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
.fr-cam-btn {
  padding: 5px 10px;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 6px;
  background: rgba(26, 12, 6, 0.85);
  color: #dfb69a;
  font-size: 10px;
  cursor: pointer;
}
.fr-cam-btn.active,
.fr-cam-btn:hover {
  border-color: #ff7a2f;
  background: rgba(255, 122, 47, 0.22);
  color: #fff;
}
.fr-dock {
  width: 226px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 122, 47, 0.3);
  border-radius: 9px;
  background: rgba(26, 12, 6, 0.9);
  backdrop-filter: blur(6px);
  color: #f0e0d4;
}
.fr-dock-title {
  font-size: 11px;
  font-weight: 700;
  color: #ff7a2f;
  margin-bottom: 5px;
}
.fr-canvas {
  display: block;
  width: 100%;
  border-radius: 6px;
  border: 1px solid rgba(255, 122, 47, 0.3);
  background: #1a0f08;
}
.fr-impacts {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.fr-impact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 9px;
}
.fr-impact span {
  color: #cfe0f0;
}
.fr-impact b {
  color: #7fb2e8;
  font-variant-numeric: tabular-nums;
}
.fr-impact.threat {
  background: rgba(255, 59, 31, 0.2);
}
.fr-impact.threat b {
  color: #ff8a5c;
}
@media (max-width: 860px) {
  .fr-kpi {
    max-width: calc(100% - 24px);
    top: auto;
    bottom: 52px;
  }
}
</style>
