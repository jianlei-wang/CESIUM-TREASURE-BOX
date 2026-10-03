<script setup lang="ts">
/**
 * 火灾烟气与温度三维体 —— 城市建筑火灾态势研判工作台
 *
 * 事件驱动的多火源按时间曲线成长，浮升烟羽在环境风驱动下绕避三维建筑向下风向输运，
 * 生成温度 / 烟气 / 能见度复合体场。支持复合态势 / 温度场 / 烟气浓度 / 风险分级四种
 * 显示模式，三维建筑道路、火源火焰柱、环境风箭头与疏散指引，T+ 事件阶段时间轴、
 * 阈值等值面、火源垂向剖面与风险分级体积统计。播放与分析解耦，时间轴拖动即时更新
 * 叠加层、分析结果按需去抖并丢弃过期返回。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import VolumeShell from '../../lib/volume-engine/VolumeShell.vue'
import { useVolumeScene } from '../../lib/volume-engine/useVolumeScene'
import { FIRE_CONFIG, SCENES } from '../../lib/volume-engine/scenes'
import { gradientCss } from '../../lib/volume-engine/palette'
import type { FireDisplayMode } from '../../lib/volume-engine/VolumeEngine'
import type { PickedView, StatItem } from '../../lib/volume-engine/types'
import {
  drawFireProfile,
  drawRiskBars,
  runFireIso,
  runFireProfile,
  runFireStats,
  type FireStatsResult
} from './fire-analysis'
import { installFireEngineering, firePayload, type FireEngineeringLayer } from './fire-engineering'
import { installFireOverlay, type FireOverlayHandle } from './fire-overlays'

const spec = SCENES.fire
const config = FIRE_CONFIG
const panelOpen = ref(true)
const V = spec.volume

const tempChannel = spec.channels.find((c) => c.key === 'temp')
const tempMax = tempChannel?.max ?? 900
const riskTemps = config.riskBands.slice(1).map((b) => b.temp)
const riskSmokes = config.riskBands.slice(1).map((b) => b.smoke)

const CAMERA_ORDER = ['overview', 'source', 'plume', 'downwind', 'top'] as const
const camera = ref<(typeof CAMERA_ORDER)[number]>('overview')

const MODES: { key: FireDisplayMode; label: string }[] = [
  { key: 'composite', label: '复合态势' },
  { key: 'temperature', label: '温度场' },
  { key: 'smoke', label: '烟气浓度' },
  { key: 'risk', label: '风险分级' }
]

const mode = ref<FireDisplayMode>('composite')
const tempThreshold = ref(config.tempThresholds[1])
const smokeThreshold = ref(config.smokeThresholds[1])
const isoEnabled = ref(true)
const sourcesVisible = ref(true)
const buildingsVisible = ref(true)
const roadsVisible = ref(true)
const windVisible = ref(true)
const escapeVisible = ref(true)
const particleVisible = ref(true)
const precision = ref(spec.defaults.tileSize)
const heat = ref(spec.params.heat ?? 1)
const spread = ref(spec.params.spread ?? 0.5)
const windDir = ref(spec.params.windDir ?? 235)
const windSpeed = ref(spec.params.windSpeed ?? 6)
const stats = ref<FireStatsResult | null>(null)
const busy = ref(false)
const profileCanvas = ref<HTMLCanvasElement | null>(null)
const riskCanvas = ref<HTMLCanvasElement | null>(null)

let engineering: FireEngineeringLayer | undefined
let overlay: FireOverlayHandle | undefined
let initialized = false
let analysisTimer: ReturnType<typeof setTimeout> | undefined
let analysisToken = 0

const scene = useVolumeScene(spec, {
  fire: firePayload(spec.timeSteps),
  timeInterpolation: true,
  onReady: (engine) => {
    engine.setBackgroundMode('engineering')
    engine.setRenderParams({ lighting: 0.28, fireMode: mode.value, fireSmokeExtinction: 2.8, fireTempEmission: 0.9 })
    engine.setFireThresholds(riskTemps, riskSmokes)
    if (spec.vector) engine.setParticlesVisible(particleVisible.value)
    engineering?.destroy()
    engineering = installFireEngineering(engine)
    overlay?.destroy()
    overlay = installFireOverlay(engine)
    if (!initialized) {
      initialized = true
      const cam = config.camera.overview
      engine.flyToView(cam.heading, cam.pitch, cam.rangeFactor, 0)
    }
    syncLayers()
    scheduleAnalysis(0)
  }
})
const { container } = scene

const legendCss = computed(() => {
  if (mode.value === 'composite') return 'linear-gradient(90deg,#15130f,#4a4a46,#8a3a12,#ff5a1f,#ffd166)'
  if (mode.value === 'risk') {
    return `linear-gradient(90deg,${config.riskBands.map((b) => b.color).join(',')})`
  }
  return gradientCss(mode.value === 'smoke' ? 'smoke' : 'thermal')
})
const legendMin = computed(() => (mode.value === 'smoke' ? '0 mg/m³' : mode.value === 'risk' ? '安全' : '低温烟气'))
const legendMax = computed(() => (mode.value === 'smoke' ? '400 mg/m³' : mode.value === 'risk' ? '极高危' : '高温核心'))

const currentMinute = computed(() => scene.ui.timeStep * config.timeStepMinutes)
const activePhase = computed(() => {
  let idx = 0
  config.eventPhases.forEach((p, i) => {
    if (p.atMinute <= currentMinute.value) idx = i
  })
  return idx
})

function activeAnalysisChannel(): 'temp' | 'smoke' {
  return mode.value === 'smoke' ? 'smoke' : 'temp'
}
function activeThreshold(): number {
  return mode.value === 'smoke' ? smokeThreshold.value : tempThreshold.value
}

/* ----------------------------- 分析（去抖 + 丢弃过期） ----------------------------- */

function scheduleAnalysis(delay = 180): void {
  if (analysisTimer) clearTimeout(analysisTimer)
  analysisTimer = setTimeout(() => {
    void refreshAll()
  }, delay)
}

async function refreshAll(): Promise<void> {
  const token = ++analysisToken
  await Promise.all([refreshStats(token), refreshIso(token), refreshProfile(token)])
}

async function refreshStats(token: number): Promise<void> {
  const engine = scene.engine.value
  if (!engine) return
  try {
    const result = await runFireStats(engine, {
      tempThreshold: tempThreshold.value,
      smokeThreshold: smokeThreshold.value,
      volSize: [V.width, V.depth, V.height],
      buildings: config.buildings.map((b) => ({ id: b.id, x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, height: b.height })),
      riskTemp: riskTemps,
      riskSmoke: riskSmokes
    })
    if (token !== analysisToken) return
    stats.value = result
    syncLayers()
    await nextTick()
    if (riskCanvas.value) drawRiskBars(riskCanvas.value, result.bandsM3, config.riskBands)
  } catch {
    if (token === analysisToken) stats.value = null
  }
}

async function refreshIso(token: number): Promise<void> {
  const engine = scene.engine.value
  if (!engine) return
  engine.clearIsosurface('fire-iso')
  if (!isoEnabled.value) return
  busy.value = true
  try {
    const channel = activeAnalysisChannel()
    const threshold = activeThreshold()
    const result = await runFireIso(engine, channel, threshold, [V.width, V.depth, V.height])
    if (token !== analysisToken) return
    if (result && result.count) {
      engine.setIsosurface(result.positions, result.normals, channel === 'temp' ? [1, 0.42, 0.12] : [0.72, 0.7, 0.66], 0.38, 'fire-iso')
    }
  } finally {
    if (token === analysisToken) busy.value = false
  }
}

async function refreshProfile(token: number): Promise<void> {
  const engine = scene.engine.value
  if (!engine) return
  const main = config.sources[0]
  const profile = await runFireProfile(engine, main.x, main.y, 'temp', 60)
  if (token !== analysisToken) return
  await nextTick()
  if (profileCanvas.value) drawFireProfile(profileCanvas.value, profile, tempMax, tempThreshold.value, '温度')
}

function syncLayers(): void {
  engineering?.update({
    buildingsVisible: buildingsVisible.value,
    roadsVisible: roadsVisible.value,
    sourcesVisible: sourcesVisible.value,
    windVisible: windVisible.value,
    escapeVisible: escapeVisible.value,
    impacts: stats.value?.impacts ?? [],
    tempThreshold: tempThreshold.value,
    smokeThreshold: smokeThreshold.value,
    windDir: windDir.value,
    windSpeed: windSpeed.value,
    timeStep: scene.ui.timeStep
  })
  overlay?.update({
    windVisible: windVisible.value,
    windDir: windDir.value,
    windSpeed: windSpeed.value,
    downwindM: stats.value?.downwindM ?? 0
  })
}

/* ----------------------------- 交互 ----------------------------- */

function setMode(next: FireDisplayMode): void {
  mode.value = next
  scene.setFireMode(next)
  scheduleAnalysis(60)
}

function setPrecision(tile: number): void {
  precision.value = tile
  scene.setPreset(tile, 4)
}

function pickTemp(value: number): void {
  tempThreshold.value = value
  scheduleAnalysis(40)
}
function pickSmoke(value: number): void {
  smokeThreshold.value = value
  scheduleAnalysis(40)
}
function commitThreshold(): void {
  scheduleAnalysis(40)
}

function gotoPhase(index: number): void {
  scene.setTimeStep(Math.round(config.eventPhases[index].atMinute / config.timeStepMinutes))
}

function applyWind(): void {
  scene.engine.value?.setParams({ windDir: windDir.value, windSpeed: windSpeed.value })
}
function applyScenario(): void {
  scene.engine.value?.setParams({ heat: heat.value, spread: spread.value })
}

function flyTo(key: (typeof CAMERA_ORDER)[number]): void {
  camera.value = key
  const cam = config.camera[key]
  scene.engine.value?.flyToView(cam.heading, cam.pitch, cam.rangeFactor, 1.1)
}

watch(
  () => scene.ui.timeStep,
  () => {
    // 播放/拖动即时更新火焰柱与风场指示，分析结果去抖后台计算
    syncLayers()
    if (isoEnabled.value) scene.engine.value?.clearIsosurface('fire-iso')
    scheduleAnalysis(220)
  }
)

onBeforeUnmount(() => {
  if (analysisTimer) clearTimeout(analysisTimer)
  engineering?.destroy()
  engineering = undefined
  overlay?.destroy()
  overlay = undefined
})

/* ----------------------------- 视图 ----------------------------- */

const kpiCards = computed(() => {
  const s = stats.value
  if (!s) return []
  const threatened = impactRows.value.filter((r) => r.threat).length
  return [
    { label: '最高温度', value: s.maxTemp.toFixed(0), unit: '°C' },
    { label: '危险体积', value: (s.dangerVolumeM3 / 10000).toFixed(1), unit: '万m³' },
    { label: '烟气体积', value: (s.smokeVolumeM3 / 10000).toFixed(1), unit: '万m³' },
    { label: '烟羽顶高', value: s.plumeTopM.toFixed(0), unit: 'm' },
    { label: '下风向距离', value: s.downwindM.toFixed(0), unit: 'm' },
    { label: '受威胁建筑', value: String(threatened), unit: '栋' }
  ]
})

const statsItems = computed<StatItem[]>(() => {
  const items: StatItem[] = [
    { label: '场所', value: config.siteName },
    { label: '火源', value: `${config.sources.length} 处` },
    { label: '建筑 / 道路', value: `${config.buildings.length} 栋 / ${config.roads.length} 条` },
    { label: '环境风', value: `${windSpeed.value} m/s / ${windDir.value}°` },
    { label: '时间', value: `T+${currentMinute.value} min (${scene.ui.timeStep + 1}/${spec.timeSteps})` }
  ]
  if (stats.value) {
    items.push({ label: '危险阈温', value: `${tempThreshold.value} °C` })
    items.push({ label: '烟气阈值', value: `${smokeThreshold.value} mg/m³` })
  }
  return items
})

const impactRows = computed(() => {
  const s = stats.value
  const byId = new Map((s?.impacts ?? []).map((im) => [im.id, im]))
  return config.buildings.map((b) => {
    const im = byId.get(b.id)
    const temp = im?.temp ?? 0
    const smoke = im?.smoke ?? 0
    return { id: b.id, name: b.name, temp, smoke, threat: temp >= tempThreshold.value || smoke >= smokeThreshold.value }
  })
})

const riskRows = computed(() => {
  const bands = stats.value?.bandsM3 ?? [0, 0, 0, 0, 0]
  const total = bands.reduce((a, b) => a + b, 0) || 1
  return config.riskBands.map((band, i) => ({
    label: band.label,
    color: band.color,
    volume: bands[i] ?? 0,
    ratio: (bands[i] ?? 0) / total
  }))
})

const pickedView = computed<PickedView | null>(() => {
  const p = scene.picked.value
  if (!p) return null
  if (!p.valid) return { title: '火场拾取', rows: [], empty: '该处未检出' }
  const rows: StatItem[] = [{ label: '温度', value: `${p.value.toFixed(0)} °C` }]
  if (p.norm) rows.push({ label: '高度', value: `${(p.norm[2] * V.height).toFixed(0)} m` })
  return { title: '火场拾取', rows }
})
</script>

<template>
  <VolumeShell
    title="火灾烟气温度体 · 态势研判"
    :status="scene.status.value"
    :panel-open="panelOpen"
    :legend-css="legendCss"
    :legend-min="legendMin"
    :legend-max="legendMax"
    :show-clip-panel="false"
    :picked="pickedView"
    @toggle-panel="panelOpen = !panelOpen"
  >
    <template #scene>
      <div ref="container" class="vol-cesium"></div>
      <div class="fr-hud-top">
        <div class="fr-phase-badge">T+{{ currentMinute }} min · {{ config.eventPhases[activePhase].label }}</div>
        <div v-if="kpiCards.length" class="fr-kpi">
          <div v-for="card in kpiCards" :key="card.label" class="fr-kpi-card">
            <span>{{ card.label }}</span>
            <b>{{ card.value }}<i>{{ card.unit }}</i></b>
          </div>
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

    <template #legend>
      <div class="fr-site">{{ config.siteName }}</div>
      <div class="fr-risk-legend">
        <span v-for="r in riskRows" :key="r.label" class="fr-risk-item">
          <i :style="{ background: r.color }"></i>{{ r.label }} {{ (r.ratio * 100).toFixed(0) }}%
        </span>
      </div>
      <div class="fr-data">
        <div v-for="row in statsItems" :key="row.label" class="fr-data-row">
          <span>{{ row.label }}</span><b>{{ row.value }}</b>
        </div>
      </div>
      <div class="fr-sources">
        <div v-for="s in config.sources" :key="s.id" class="fr-source-row">
          <span>{{ s.name }}</span><b>{{ s.sourceType === 'primary' ? '主火' : s.sourceType === 'ignition' ? '引燃' : '飞火' }}</b>
        </div>
      </div>

      <div class="fr-dock-title">火源垂向温度剖面</div>
      <canvas ref="profileCanvas" width="212" height="120" class="fr-canvas"></canvas>
      <div class="fr-dock-title" style="margin-top: 8px">风险分级体积（万 m³）</div>
      <canvas ref="riskCanvas" width="212" height="112" class="fr-canvas"></canvas>
      <div class="fr-dock-title" style="margin-top: 8px">建筑受威胁度</div>
      <div class="fr-impacts">
        <div v-for="b in impactRows" :key="b.id" class="fr-impact" :class="{ threat: b.threat }">
          <span>{{ b.name }}</span>
          <b>{{ b.temp.toFixed(0) }}°C / {{ b.smoke.toFixed(0) }}</b>
        </div>
      </div>
      <div class="fr-note">
        事件驱动火源按时间曲线成长：烟气在近火源高温高烟，随高度抬升并被环境风拉向下风向；
        三维建筑作为障碍物屏蔽内部烟气形成绕流；温度与烟气危险阈值圈定危险区，风险分级给出复合危险程度。
      </div>
    </template>

    <template #controls>
      <div class="fr-block">
        <div class="vol-section">显示模式</div>
        <div class="fr-chips">
          <button
            v-for="m in MODES"
            :key="m.key"
            type="button"
            class="fr-chip"
            :class="{ active: mode === m.key }"
            @click="setMode(m.key)"
          >
            {{ m.label }}
          </button>
        </div>
      </div>

      <div class="fr-block">
        <div class="vol-section">事件阶段 T+（分钟）</div>
        <div class="fr-timeline">
          <button
            v-for="(phase, i) in config.eventPhases"
            :key="phase.atMinute"
            type="button"
            class="fr-phase"
            :class="{ active: activePhase === i, reached: i <= activePhase }"
            @click="gotoPhase(i)"
          >
            <b>{{ phase.atMinute }}</b><span>{{ phase.label }}</span>
          </button>
        </div>
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
        <div class="vol-section">火场场景</div>
        <div class="vol-row">
          <span class="vol-label">热释放</span>
          <input type="range" min="0.4" max="1.6" step="0.05" v-model.number="heat" @change="applyScenario()" />
          <span class="vol-value">{{ heat.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">蔓延系数</span>
          <input type="range" min="0" max="1" step="0.05" v-model.number="spread" @change="applyScenario()" />
          <span class="vol-value">{{ spread.toFixed(2) }}</span>
        </div>
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
        <div class="fr-hint">调整火场场景参数将重建体数据；火焰柱、粒子与工程图层会自动恢复。</div>
      </div>

      <div class="fr-block">
        <div class="vol-section">危险阈值 / 等值面</div>
        <div class="fr-thr-row">
          <span>温度</span>
          <div class="fr-thr-chips">
            <button
              v-for="t in config.tempThresholds"
              :key="t"
              type="button"
              class="fr-thr"
              :class="{ active: tempThreshold === t }"
              @click="pickTemp(t)"
            >
              {{ t }}
            </button>
          </div>
        </div>
        <div class="fr-thr-row">
          <span>烟气</span>
          <div class="fr-thr-chips">
            <button
              v-for="t in config.smokeThresholds"
              :key="t"
              type="button"
              class="fr-thr"
              :class="{ active: smokeThreshold === t }"
              @click="pickSmoke(t)"
            >
              {{ t }}
            </button>
          </div>
        </div>
        <div class="vol-row" v-if="mode !== 'risk'">
          <span class="vol-label">{{ mode === 'smoke' ? '烟气阈值' : '温度阈值' }}</span>
          <input
            type="range"
            :min="mode === 'smoke' ? 0 : 20"
            :max="mode === 'smoke' ? 400 : 900"
            step="5"
            :value="mode === 'smoke' ? smokeThreshold : tempThreshold"
            @input="mode === 'smoke' ? (smokeThreshold = Number(($event.target as HTMLInputElement).value)) : (tempThreshold = Number(($event.target as HTMLInputElement).value))"
            @change="commitThreshold()"
          />
          <span class="vol-value">{{ (mode === 'smoke' ? smokeThreshold : tempThreshold).toFixed(0) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">阈值等值面</span>
          <button class="vol-switch" :class="{ 'is-on': isoEnabled }" @click="isoEnabled = !isoEnabled; scheduleAnalysis(40)"><span></span></button>
        </div>
      </div>

      <div class="fr-block">
        <div class="vol-section">叠加图层</div>
        <div class="vol-row">
          <span class="vol-label">火源火焰柱</span>
          <button class="vol-switch" :class="{ 'is-on': sourcesVisible }" @click="sourcesVisible = !sourcesVisible; syncLayers()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">建筑模型</span>
          <button class="vol-switch" :class="{ 'is-on': buildingsVisible }" @click="buildingsVisible = !buildingsVisible; syncLayers()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">道路网络</span>
          <button class="vol-switch" :class="{ 'is-on': roadsVisible }" @click="roadsVisible = !roadsVisible; syncLayers()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">环境风箭头</span>
          <button class="vol-switch" :class="{ 'is-on': windVisible }" @click="windVisible = !windVisible; syncLayers()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">疏散指引</span>
          <button class="vol-switch" :class="{ 'is-on': escapeVisible }" @click="escapeVisible = !escapeVisible; syncLayers()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">风场粒子</span>
          <button class="vol-switch" :class="{ 'is-on': particleVisible }" @click="particleVisible = !particleVisible; scene.setParticlesVisible(particleVisible)"><span></span></button>
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
          <span class="vol-label">精度</span>
          <div class="fr-seg">
            <button type="button" class="fr-seg-btn" :class="{ active: precision === 16 }" @click="setPrecision(16)">128³</button>
            <button type="button" class="fr-seg-btn" :class="{ active: precision === 24 }" @click="setPrecision(24)">192³</button>
            <button type="button" class="fr-seg-btn" :class="{ active: precision === 32 }" @click="setPrecision(32)">256³</button>
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
  grid-template-columns: repeat(4, 1fr);
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
.fr-timeline {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 3px;
  margin-bottom: 6px;
}
.fr-phase {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 3px 0 2px;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  color: #8fa6bf;
  cursor: pointer;
}
.fr-phase b {
  font-size: 10px;
  color: inherit;
}
.fr-phase span {
  font-size: 8px;
  transform: scale(0.92);
  white-space: nowrap;
}
.fr-phase.reached {
  border-color: rgba(255, 150, 60, 0.5);
  color: #e6b07f;
}
.fr-phase.active {
  border-color: #ff7a2f;
  background: rgba(255, 122, 47, 0.25);
  color: #fff;
}
.fr-thr-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}
.fr-thr-row > span {
  width: 34px;
  font-size: 9px;
  color: #8fa6bf;
}
.fr-thr-chips {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
  flex: 1 1 auto;
}
.fr-thr {
  padding: 3px 0;
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
.fr-seg-btn.active {
  border-color: #ff7a2f;
  background: rgba(255, 122, 47, 0.22);
  color: #fff;
  font-weight: 600;
}
.fr-site {
  font-size: 12px;
  font-weight: 700;
  color: #ff7a2f;
  margin-bottom: 6px;
}
.fr-risk-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-bottom: 8px;
}
.fr-risk-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 9px;
  color: #c3d5e8;
}
.fr-risk-item i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
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
.fr-hud-top {
  position: absolute;
  top: 12px;
  left: 248px;
  right: 300px;
  z-index: 9;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  pointer-events: none;
}
.fr-phase-badge {
  max-width: 100%;
  padding: 4px 12px;
  border: 1px solid rgba(255, 122, 47, 0.4);
  border-radius: 999px;
  background: rgba(26, 12, 6, 0.85);
  color: #ffb347;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fr-kpi {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  max-width: 100%;
}
.fr-kpi-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 72px;
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
  left: 50%;
  transform: translateX(-50%);
  z-index: 9;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-width: min(440px, calc(100% - 40px));
  justify-content: center;
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
.fr-data {
  margin: 2px 0 8px;
}
.fr-data-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 3px;
  font-size: 10px;
}
.fr-data-row span {
  color: #9fb8d4;
}
.fr-data-row b {
  color: #ffd0a8;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
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
  height: auto;
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
:deep(.vol-pick) {
  bottom: 58px;
}
@media (max-width: 1120px) {
  .fr-hud-top {
    left: 240px;
    right: 292px;
  }
}
@media (max-width: 900px) {
  .fr-hud-top {
    left: 12px;
    right: 12px;
  }
}
@media (max-width: 720px) {
  .fr-phase-badge {
    display: none;
  }
  .fr-cam {
    max-width: calc(100% - 24px);
  }
}
@media (max-width: 560px) {
  .fr-hud-top {
    top: auto;
    bottom: 54px;
  }
}
</style>
