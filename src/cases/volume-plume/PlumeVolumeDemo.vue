<script setup lang="ts">
/**
 * 地下水污染羽流三维体 —— 场地污染调查工作台
 *
 * 以平流—弥散—衰变模型生成三维污染羽流，叠加含水层分层、监测井网与地下水流向；
 * 支持 TCE / 六价铬 / TDS 多污染物切换、风险浓度等值面、沿井孔浓度曲线、
 * 污染体积 / 影响面积 / 前缘距离统计与任意方向剖切。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import VolumeShell from '../../lib/volume-engine/VolumeShell.vue'
import { useVolumeScene } from '../../lib/volume-engine/useVolumeScene'
import { PLUME_CONFIG, SCENES } from '../../lib/volume-engine/scenes'
import { buildTransferLut, gradientCss } from '../../lib/volume-engine/palette'
import type { PickedView, StatItem } from '../../lib/volume-engine/types'
import {
  drawWellProfile,
  runPlumeIso,
  runPlumeProfile,
  runPlumeStats,
  runPlumeStreamlines,
  type PlumeProfileResult,
  type PlumeStatsResult
} from './plume-analysis'
import { installPlumeOverlay, type PlumeOverlayHandle } from './plume-overlays'

const spec = SCENES.plume
const config = PLUME_CONFIG
const panelOpen = ref(true)
const V = spec.volume

const CAMERA_ORDER = ['site', 'plume', 'source', 'section', 'capture', 'top'] as const
const camera = ref<(typeof CAMERA_ORDER)[number]>('site')

const firstThreshold = spec.channels[0].thresholds?.[0] ?? 50
const threshold = ref(firstThreshold)
const isoEnabled = ref(true)
const flowVisible = ref(true)
const wellsVisible = ref(true)
const aquifersVisible = ref(true)
const aquiferBodiesVisible = ref(true)
const aquiferBodiesOpacity = ref(0.7)
const captureVisible = ref(true)
const selectedWellId = ref(config.wells[1]?.id ?? config.wells[0].id)
const stats = ref<PlumeStatsResult | null>(null)
const busy = ref(false)
const wellCanvas = ref<HTMLCanvasElement | null>(null)
const density = ref(spec.defaults.tileSize)
const DENSITY_PRESETS = [
  { tileSize: 16, levels: 4, label: '128³' },
  { tileSize: 24, levels: 4, label: '192³' },
  { tileSize: 32, levels: 4, label: '256³' }
] as const
let overlay: PlumeOverlayHandle | undefined
let flowLines: Awaited<ReturnType<typeof runPlumeStreamlines>> | null = null
const baselineCache = new Map<string, PlumeProfileResult>()

const scene = useVolumeScene(spec, {
  onReady: (engine) => {
    engine.setRenderParams({ densityGamma: 1.1, thresholdSoft: 0.05, lighting: 0.42 })
    engine.setBackgroundMode('engineering')
    overlay = installPlumeOverlay(engine)
    overlay.update({
      flowVisible: flowVisible.value,
      wellsVisible: wellsVisible.value,
      aquifersVisible: aquifersVisible.value,
      aquiferBodiesVisible: aquiferBodiesVisible.value,
      aquiferBodiesOpacity: aquiferBodiesOpacity.value,
      captureVisible: captureVisible.value,
      activeWellId: selectedWellId.value,
      timeStep: scene.ui.timeStep
    })
    const cam = config.camera.site
    engine.flyToView(cam.heading, cam.pitch, cam.rangeFactor, 0)
    const initialStep = Math.min(spec.timeSteps - 1, config.captureStartStep + 5)
    if (initialStep !== scene.ui.timeStep) scene.setTimeStep(initialStep)
    else void refreshAll()
  }
})
const { container } = scene

const meta = computed(() => scene.active())
const thresholdList = computed(() => meta.value.thresholds ?? [meta.value.min, meta.value.max])
const selectedWell = computed(() => config.wells.find((w) => w.id === selectedWellId.value) ?? config.wells[0])

const legendCss = computed(() => gradientCss(scene.ui.palette))

function colorAt(value: number): [number, number, number] {
  const lut = buildTransferLut(scene.ui.palette)
  const t = Math.max(0, Math.min(1, (value - scene.ui.valueMin) / (scene.ui.valueMax - scene.ui.valueMin || 1)))
  const idx = Math.round(t * 255)
  return [lut[idx * 4] / 255, lut[idx * 4 + 1] / 255, lut[idx * 4 + 2] / 255]
}

/* ----------------------------- 分析 ----------------------------- */

const coreThreshold = computed(() => {
  const cont = config.contaminants[scene.ui.channel as keyof typeof config.contaminants]
  return cont?.coreThreshold ?? threshold.value * 2
})

async function refreshStats(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  try {
    stats.value = await runPlumeStats(engine, {
      channel: scene.ui.channel,
      threshold: threshold.value,
      coreThreshold: coreThreshold.value,
      volSize: [V.width, V.depth, V.height]
    })
  } catch {
    stats.value = null
  }
}

async function refreshIso(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  engine.clearIsosurface('plume-iso')
  engine.clearIsosurface('plume-core')
  if (!isoEnabled.value) return
  busy.value = true
  try {
    const outer = await runPlumeIso(engine, scene.ui.channel, threshold.value, [V.width, V.depth, V.height])
    if (outer && outer.count) {
      engine.setIsosurface(outer.positions, outer.normals, colorAt(threshold.value), 0.3, 'plume-iso')
    }
    const core = await runPlumeIso(engine, scene.ui.channel, coreThreshold.value, [V.width, V.depth, V.height], 48)
    if (core && core.count) {
      engine.setIsosurface(core.positions, core.normals, colorAt(coreThreshold.value), 0.72, 'plume-core')
    }
  } finally {
    busy.value = false
  }
}

async function refreshWell(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  const well = selectedWell.value
  const cacheKey = `${scene.ui.channel}|${well.id}`
  let baseline = baselineCache.get(cacheKey)
  if (!baseline) {
    try {
      baseline = await runPlumeProfile(engine, well.x, well.y, scene.ui.channel, 60, Math.max(0, config.captureStartStep - 1))
      baselineCache.set(cacheKey, baseline)
    } catch {
      baseline = undefined
    }
  }
  const profile = await runPlumeProfile(engine, well.x, well.y, scene.ui.channel, 60)
  await nextTick()
  const canvas = wellCanvas.value
  if (canvas) {
    drawWellProfile(canvas, profile, {
      config,
      well,
      valueMax: meta.value.max,
      threshold: threshold.value,
      coreThreshold: coreThreshold.value,
      baseline,
      unit: meta.value.unit
    })
  }
}

async function refreshFlowLines(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  try {
    flowLines = await runPlumeStreamlines(engine, scene.ui.timeStep, [V.width, V.depth, V.height], 12)
  } catch {
    flowLines = null
  }
  overlay?.update({ flowLines })
}

function refreshOverlay(): void {
  overlay?.update({
    flowVisible: flowVisible.value,
    wellsVisible: wellsVisible.value,
    aquifersVisible: aquifersVisible.value,
    aquiferBodiesVisible: aquiferBodiesVisible.value,
    aquiferBodiesOpacity: aquiferBodiesOpacity.value,
    captureVisible: captureVisible.value,
    activeWellId: selectedWellId.value,
    timeStep: scene.ui.timeStep,
    flowLines
  })
}

/* ----------------------------- 交互 ----------------------------- */

function onChannel(key: string): void {
  baselineCache.clear()
  scene.setChannel(key)
  const ch = spec.channels.find((c) => c.key === key) ?? spec.channels[0]
  threshold.value = ch.thresholds?.[0] ?? ch.min
  isoEnabled.value = true
  void refreshAll()
}

function pickThreshold(value: number): void {
  threshold.value = value
  void refreshIso()
  void refreshStats()
  void refreshWell()
}

function selectDensity(tileSize: number, levels: number): void {
  density.value = tileSize
  scene.setPreset(tileSize, levels)
}

function zoomToWell(id: string): void {
  selectedWellId.value = id
  refreshOverlay()
  const well = selectedWell.value
  const engine = scene.engine.value
  if (engine) engine.flyToNormalized(well.x, well.y, 0.5, V.width * 0.5, 1)
  void refreshWell()
}

function flyTo(key: (typeof CAMERA_ORDER)[number]): void {
  camera.value = key
  const cam = config.camera[key]
  scene.engine.value?.flyToView(cam.heading, cam.pitch, cam.rangeFactor, 1.1)
}

function refreshAll(): void {
  void refreshStats()
  void refreshIso()
  void refreshWell()
  void refreshFlowLines()
}

watch(
  () => scene.ui.timeStep,
  () => {
    if (isoEnabled.value) void refreshIso()
    void refreshStats()
    void refreshWell()
    void refreshFlowLines()
    refreshOverlay()
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
  const cards = [
    { label: '污染体积', value: (s.volumeM3 / 10000).toFixed(1), unit: '万 m³' },
    { label: '核心体积', value: (s.coreVolumeM3 / 10000).toFixed(2), unit: '万 m³' },
    { label: '影响面积', value: (s.areaM2 / 10000).toFixed(1), unit: '万 m²' },
    { label: '前缘距离', value: s.frontDistanceM.toFixed(0), unit: 'm' },
    { label: '峰值浓度', value: s.maxConc.toFixed(meta.value.decimals ?? 0), unit: meta.value.unit }
  ]
  if (scene.ui.timeStep >= config.captureStartStep) {
    cards.push({ label: '抽采捕获率', value: (s.captureRate * 100).toFixed(0), unit: '%' })
  }
  return cards
})

const statsItems = computed<StatItem[]>(() => {
  const s = stats.value
  const aquiferCount = config.aquifers.filter((a) => a.type === 'aquifer').length
  const aquitardCount = config.aquifers.length - aquiferCount
  const items: StatItem[] = [
    { label: '场地', value: config.siteName },
    { label: '含水层 / 隔水层', value: `${aquiferCount} / ${aquitardCount} 层` },
    { label: '井位', value: `${config.wells.length} 口` },
    { label: '地下水流向', value: `${config.flowDir}°` },
    { label: '当前污染物', value: meta.value.label },
    { label: '模拟时间', value: `第 ${scene.ui.timeStep + 1} 个月` }
  ]
  if (s) {
    items.push({ label: '平均浓度', value: `${s.meanConc.toFixed(meta.value.decimals ?? 0)} ${meta.value.unit}` })
    items.push({ label: '超标体元', value: s.aboveCount.toLocaleString() })
    if (scene.ui.timeStep >= config.captureStartStep) {
      items.push({ label: '捕获体元', value: s.captureCount.toLocaleString() })
    }
  }
  return items
})

const aquiferRows = computed(() =>
  config.aquifers.map((a) => ({
    code: a.code,
    name: a.name,
    range: `${a.top}–${a.bottom} m`,
    type: a.type,
    role: a.role,
    color: a.color
  }))
)

const pickedView = computed<PickedView | null>(() => {
  const p = scene.picked.value
  if (!p) return null
  if (!p.valid) return { title: '羽流拾取', rows: [], empty: '该处浓度低于检出限' }
  const ch = scene.active()
  const rows: StatItem[] = [{ label: ch.label, value: `${p.value.toFixed(ch.decimals ?? 1)} ${ch.unit}` }]
  if (p.height !== undefined) rows.push({ label: '埋深', value: `${(V.height - (p.height - V.base)).toFixed(1)} m` })
  return { title: '羽流拾取', rows }
})
</script>

<template>
  <VolumeShell
    title="地下水污染羽流体"
    :status="scene.status.value"
    :panel-open="panelOpen"
    :show-clip-panel="false"
    :left-width="'min(276px, calc(100% - 24px))'"
    :legend-css="legendCss"
    :legend-min="String(scene.active().min)"
    :legend-max="`${scene.active().max} ${scene.active().unit}`"
    :stats="statsItems"
    :picked="pickedView"
    @toggle-panel="panelOpen = !panelOpen"
  >
    <template #scene>
      <div ref="container" class="vol-cesium"></div>
      <div v-if="kpiCards.length" class="pl-kpi">
        <div v-for="card in kpiCards" :key="card.label" class="pl-kpi-card">
          <span>{{ card.label }}</span>
          <b>{{ card.value }}<i>{{ card.unit }}</i></b>
        </div>
      </div>
    </template>

    <template #legend>
      <div class="pl-site">{{ config.siteName }}</div>
      <div class="pl-aquifers">
        <div v-for="a in aquiferRows" :key="a.code" class="pl-aquifer" :title="a.role">
          <span class="pl-aquifer-swatch" :style="{ background: a.color, opacity: a.type === 'aquifer' ? 0.85 : 0.95 }"></span>
          <span class="pl-aquifer-name">{{ a.name }}</span>
          <b>{{ a.range }}</b>
        </div>
      </div>
      <div class="pl-thresholds">
        <button
          v-for="t in thresholdList"
          :key="t"
          type="button"
          class="pl-thr-chip"
          :class="{ active: threshold === t }"
          @click="pickThreshold(t)"
        >
          {{ t }} {{ meta.unit }}
        </button>
      </div>
      <div class="pl-well-block">
        <div class="pl-well-title">{{ selectedWell.name }} · 分层浓度曲线</div>
        <canvas ref="wellCanvas" width="240" height="150" class="pl-well-canvas"></canvas>
        <div class="pl-dock-caption">
          筛管 {{ selectedWell.screenTop }}–{{ selectedWell.screenBottom }} m · 监测
          {{ selectedWell.monitorLayerCodes.map((c) => config.aquifers.find((a) => a.code === c)?.name).join(' / ') }}
        </div>
        <div class="pl-well-chips">
          <button
            v-for="well in config.wells"
            :key="well.id"
            type="button"
            class="pl-well-chip"
            :class="{ active: well.id === selectedWellId }"
            @click="zoomToWell(well.id)"
          >
            {{ well.id }}
          </button>
        </div>
      </div>
      <div class="pl-note">
        三维体由多层含水层中的平流—弥散—衰减模型生成：源区持续释放，沿地下水流向迁移、侧向弥散、沿程衰减；
        弱透水层按越流系数抑制垂向穿透。等值面外圈为{{ threshold }} {{ meta.unit }}风险边界、内圈为{{ coreThreshold.toFixed(0) }} {{ meta.unit }}污染核心；
        {{ scene.ui.timeStep >= config.captureStartStep ? '抽出处理井 EW-01 已投运，形成捕获区。' : '抽采井将在第 ' + (config.captureStartStep + 1) + ' 个月投运。' }}
      </div>
    </template>

    <template #controls>
      <div class="pl-block">
        <div class="vol-section">污染物类型</div>
        <div class="pl-chips">
          <button
            v-for="ch in spec.channels"
            :key="ch.key"
            type="button"
            class="pl-chip"
            :class="{ active: scene.ui.channel === ch.key }"
            @click="onChannel(ch.key)"
          >
            {{ ch.label }}
          </button>
        </div>
        <div class="pl-hint">{{ config.contaminants[(scene.ui.channel as 'tce' | 'cr6' | 'tds')].hint }}</div>
      </div>

      <div class="pl-block">
        <div class="vol-section">风险浓度等值面</div>
        <div class="vol-row">
          <span class="vol-label">显示等值面</span>
          <button class="vol-switch" :class="{ 'is-on': isoEnabled }" @click="isoEnabled = !isoEnabled; refreshIso()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">阈值</span>
          <input
            type="range"
            :min="meta.min"
            :max="meta.max"
            :step="(meta.max - meta.min) / 200"
            v-model.number="threshold"
            @change="refreshIso(); refreshStats(); refreshWell()"
          />
          <span class="vol-value">{{ threshold.toFixed(meta.decimals ?? 0) }}</span>
        </div>
        <div class="pl-hint">阈值以上为羽流主体（风险区），可结合监测井曲线判断垂直赋存层位。</div>
      </div>

      <div class="pl-block">
        <div class="vol-section">地层与调查对象</div>
        <div class="vol-row">
          <span class="vol-label">含水层骨架</span>
          <button class="vol-switch" :class="{ 'is-on': aquifersVisible }" @click="aquifersVisible = !aquifersVisible; refreshOverlay()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">含水层地质体</span>
          <button class="vol-switch" :class="{ 'is-on': aquiferBodiesVisible }" @click="aquiferBodiesVisible = !aquiferBodiesVisible; refreshOverlay()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">地质体不透明度</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="aquiferBodiesOpacity"
            @input="aquiferBodiesOpacity = Number(($event.target as HTMLInputElement).value); refreshOverlay()"
          />
          <span class="vol-value">{{ Math.round(aquiferBodiesOpacity * 100) }}%</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">地下水流线</span>
          <button class="vol-switch" :class="{ 'is-on': flowVisible }" @click="flowVisible = !flowVisible; refreshOverlay()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">监测井网</span>
          <button class="vol-switch" :class="{ 'is-on': wellsVisible }" @click="wellsVisible = !wellsVisible; refreshOverlay()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">抽采捕获区</span>
          <button class="vol-switch" :class="{ 'is-on': captureVisible }" @click="captureVisible = !captureVisible; refreshOverlay()"><span></span></button>
        </div>
        <div class="pl-hint">地下水流向约 {{ config.flowDir }}°，流线按含水层分层；抽出井 EW-01 自第 {{ config.captureStartStep + 1 }} 个月起形成捕获区。</div>
      </div>

      <div class="pl-block">
        <div class="vol-section">时间演变（{{ spec.timeStepUnit }}）</div>
        <div class="vol-row">
          <span class="vol-label">模拟月份</span>
          <input
            type="range"
            min="0"
            :max="spec.timeSteps - 1"
            step="1"
            :value="scene.ui.timeStep"
            @input="scene.setTimeStep(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="vol-value">第 {{ scene.ui.timeStep + 1 }}/{{ spec.timeSteps }} 月</span>
        </div>
        <button class="pl-btn ghost" @click="scene.togglePlay()">{{ scene.ui.playing ? '暂停' : '自动播放' }}</button>
        <div class="pl-hint">
          {{ scene.ui.timeStep >= config.captureStartStep
            ? '抽采井运行中：井周快速汇流、下游浓度持续削弱。'
            : `再经过 ${config.captureStartStep - scene.ui.timeStep} 个月抽采井投运。` }}
        </div>
      </div>

      <div class="pl-block">
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
          <span class="vol-label">密度</span>
          <div class="pl-seg">
            <button
              v-for="preset in DENSITY_PRESETS"
              :key="preset.label"
              type="button"
              class="pl-seg-btn"
              :class="{ active: density === preset.tileSize }"
              @click="selectDensity(preset.tileSize, preset.levels)"
            >
              {{ preset.label }}
            </button>
          </div>
        </div>
      </div>

      <div class="pl-block">
        <div class="vol-section">视角预设</div>
        <div class="pl-cams">
          <button
            v-for="key in CAMERA_ORDER"
            :key="key"
            type="button"
            class="pl-seg-btn"
            :class="{ active: camera === key }"
            @click="flyTo(key)"
          >
            {{ config.camera[key].label }}
          </button>
        </div>
      </div>

      <div class="pl-block">
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
      <button class="vol-action ghost" @click="flyTo('site')">恢复视图</button>
    </template>
  </VolumeShell>
</template>

<style scoped>
.pl-block {
  margin-bottom: 10px;
}
.pl-chips {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.pl-chip {
  padding: 6px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.pl-chip.active {
  border-color: #ffd21e;
  background: rgba(255, 210, 30, 0.2);
  color: #fff;
  font-weight: 600;
}
.pl-seg {
  display: flex;
  gap: 4px;
  flex: 1 1 auto;
}
.pl-seg-btn {
  flex: 1 1 0;
  padding: 5px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.pl-seg-btn:hover {
  border-color: #2f80ed;
  color: #fff;
}
.pl-seg-btn.active {
  border-color: #65d3eb;
  background: rgba(101, 211, 235, 0.24);
  color: #fff;
  font-weight: 600;
}
.pl-cams {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.pl-btn {
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
.pl-btn.ghost {
  background: rgba(47, 128, 237, 0.18);
  border: 1px solid rgba(47, 128, 237, 0.7);
  color: #9fd8ff;
}
.pl-hint {
  margin-top: 4px;
  font-size: 9px;
  line-height: 1.5;
  color: #7f96b3;
}
.pl-site {
  font-size: 12px;
  font-weight: 700;
  color: #ffd21e;
  margin-bottom: 6px;
}
.pl-aquifers {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 8px;
}
.pl-aquifer {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: #c3d5e8;
}
.pl-aquifer-swatch {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  flex: 0 0 auto;
}
.pl-aquifer-name {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pl-aquifer b {
  color: #9fb8d4;
  font-variant-numeric: tabular-nums;
}
.pl-thresholds {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.pl-thr-chip {
  flex: 1 1 44%;
  padding: 4px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.06);
  color: #b9d2ea;
  font-size: 9px;
  cursor: pointer;
}
.pl-thr-chip.active {
  border-color: #ff5a3c;
  background: rgba(255, 90, 60, 0.22);
  color: #fff;
  font-weight: 600;
}
.pl-note {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
  font-size: 9px;
  line-height: 1.6;
  color: #9fb8d4;
}
.pl-kpi {
  position: absolute;
  top: 12px;
  left: calc(24px + min(276px, calc(100% - 24px)));
  right: calc(22px + min(276px, calc(100% - 24px)));
  z-index: 9;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  pointer-events: none;
}
.pl-kpi-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 74px;
  padding: 4px 9px;
  border: 1px solid rgba(255, 210, 30, 0.28);
  border-radius: 6px;
  background: rgba(8, 24, 48, 0.82);
  backdrop-filter: blur(5px);
}
.pl-kpi-card span {
  font-size: 9px;
  color: #9fb8d4;
}
.pl-kpi-card b {
  margin-top: 1px;
  color: #ffd21e;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.pl-kpi-card b i {
  margin-left: 2px;
  color: #7f96b3;
  font-size: 8px;
  font-style: normal;
  font-weight: 500;
}
.pl-well-block {
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid rgba(157, 188, 224, 0.2);
}
.pl-well-title {
  font-size: 11px;
  font-weight: 700;
  color: #ffd21e;
  margin-bottom: 6px;
}
.pl-well-canvas {
  display: block;
  width: 100%;
  border-radius: 6px;
  border: 1px solid rgba(157, 188, 224, 0.3);
  background: #0b1f3a;
}
.pl-dock-caption {
  margin: 4px 0 6px;
  font-size: 9px;
  color: #9fb8d4;
}
.pl-well-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.pl-well-chip {
  padding: 3px 6px;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: #b9d2ea;
  font-size: 9px;
  cursor: pointer;
}
.pl-well-chip.active {
  border-color: #65d3eb;
  background: rgba(101, 211, 235, 0.22);
  color: #fff;
}
@media (max-width: 860px) {
  .pl-kpi {
    left: 12px;
    right: 12px;
    top: auto;
    bottom: 52px;
  }
}
</style>
