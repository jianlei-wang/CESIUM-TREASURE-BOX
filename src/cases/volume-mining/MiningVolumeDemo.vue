<script setup lang="ts">
/**
 * 三维矿体品位体 —— 露天矿资源解释工作台
 *
 * 以钻孔样品经 IDW 插值构建 Cu / Au / Fe 品位体，支持边界品位与工业品位阈值、
 * 矿体等值面、勘探线剖面、钻孔样品定位，并统计矿石量 / 吨位 / 平均品位 / 金属量。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import VolumeShell from '../../lib/volume-engine/VolumeShell.vue'
import { useVolumeScene } from '../../lib/volume-engine/useVolumeScene'
import { MINING_CONFIG, SCENES } from '../../lib/volume-engine/scenes'
import { buildTransferLut, gradientCss } from '../../lib/volume-engine/palette'
import type { PickedView, StatItem } from '../../lib/volume-engine/types'
import {
  drawGradeHistogram,
  drawGradeProfile,
  runMiningIso,
  runMiningProfile,
  runMiningStats,
  type MiningElement,
  type MiningProfileResult,
  type MiningStatsResult
} from './mining-analysis'
import { installMiningOverlay, type MiningOverlayHandle } from './mining-overlays'

const spec = SCENES.mining
const config = MINING_CONFIG
const panelOpen = ref(true)
const D = config.domain

const CAMERA_ORDER = ['overview', 'orebody', 'section', 'pit', 'top'] as const
const camera = ref<(typeof CAMERA_ORDER)[number]>('overview')

const channel = ref<MiningElement>('cu')
const cutoff = ref(config.elements.cu.cutoffs[0])
const density = ref(2.7)
const isoEnabled = ref(true)
const benchesVisible = ref(true)
const drillholesVisible = ref(true)
const activeDrillholeId = ref(config.drillholes[1]?.id ?? config.drillholes[0].id)
const stats = ref<MiningStatsResult | null>(null)
const busy = ref(false)
const profileCanvas = ref<HTMLCanvasElement | null>(null)
const histCanvas = ref<HTMLCanvasElement | null>(null)
let overlay: MiningOverlayHandle | undefined
let initialized = false

const scene = useVolumeScene(spec, {
  onReady: (engine) => {
    engine.setRenderParams({ densityGamma: 1.1, thresholdSoft: 0.05, lighting: 0.5 })
    engine.setBackgroundMode('engineering')
    overlay?.destroy()
    overlay = installMiningOverlay(engine)
    overlay.update({
      channel: channel.value,
      cutoff: cutoff.value,
      benchesVisible: benchesVisible.value,
      drillholesVisible: drillholesVisible.value,
      activeDrillholeId: activeDrillholeId.value
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
const cutoffs = computed(() => config.elements[channel.value].cutoffs)
const activeDrillhole = computed(() => config.drillholes.find((h) => h.id === activeDrillholeId.value) ?? config.drillholes[0])
const legendCss = computed(() => gradientCss(scene.ui.palette))

function colorAt(value: number): [number, number, number] {
  const el = config.elements[channel.value]
  const lut = buildTransferLut(el.palette)
  const t = Math.max(0, Math.min(1, value / Math.max(1e-6, el.max)))
  const idx = Math.round(t * 255)
  return [lut[idx * 4] / 255, lut[idx * 4 + 1] / 255, lut[idx * 4 + 2] / 255]
}

/* ----------------------------- 分析 ----------------------------- */

async function refreshStats(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  try {
    stats.value = await runMiningStats(engine, {
      channel: channel.value,
      cutoff: cutoff.value,
      density: density.value,
      volSize: [D.east, D.north, D.depth]
    })
    await nextTick()
    if (histCanvas.value && stats.value) drawGradeHistogram(histCanvas.value, stats.value.bins, config.elements[channel.value].max, cutoff.value)
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
    const result = await runMiningIso(engine, channel.value, cutoff.value, [D.east, D.north, D.depth])
    if (result && result.count) engine.setIsosurface(result.positions, result.normals, colorAt(cutoff.value), 0.62, 'ore-iso')
  } finally {
    busy.value = false
  }
}

let lastProfile: MiningProfileResult | undefined
async function refreshProfile(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  const hole = activeDrillhole.value
  lastProfile = await runMiningProfile(engine, hole.x, hole.y, channel.value, 64)
  await nextTick()
  if (profileCanvas.value && lastProfile) drawGradeProfile(profileCanvas.value, lastProfile, config.elements[channel.value].max, cutoff.value)
}

function refreshOverlay(): void {
  overlay?.update({
    channel: channel.value,
    cutoff: cutoff.value,
    benchesVisible: benchesVisible.value,
    drillholesVisible: drillholesVisible.value,
    activeDrillholeId: activeDrillholeId.value
  })
}

function refreshAll(): void {
  void refreshStats()
  void refreshIso()
  void refreshProfile()
}

/* ----------------------------- 交互 ----------------------------- */

function onChannel(key: MiningElement): void {
  channel.value = key
  cutoffsChange(key)
  void refreshAll()
}

function cutoffsChange(key: MiningElement): void {
  cutoff.value = config.elements[key].cutoffs[0]
  refreshOverlay()
}

function pickCutoff(value: number): void {
  cutoff.value = value
  void refreshIso()
  void refreshStats()
  void refreshProfile()
  refreshOverlay()
}

function commitCutoff(): void {
  void refreshIso()
  void refreshStats()
  void refreshProfile()
  refreshOverlay()
}

function pickDrillhole(id: string): void {
  activeDrillholeId.value = id
  refreshOverlay()
  const hole = activeDrillhole.value
  scene.engine.value?.flyToNormalized(hole.x, hole.y, 0.5, D.east * 0.45, 1)
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
    if (isoEnabled.value) void refreshIso()
  }
)

onBeforeUnmount(() => {
  overlay?.destroy()
  overlay = undefined
})

/* ----------------------------- 视图 ----------------------------- */

const el = computed(() => config.elements[channel.value])

const kpiCards = computed(() => {
  const s = stats.value
  if (!s) return []
  return [
    { label: '矿石量', value: (s.oreVolumeM3 / 10000).toFixed(1), unit: '万 m³' },
    { label: '矿石吨位', value: (s.tonnage / 10000).toFixed(1), unit: '万 t' },
    { label: '平均品位', value: s.avgGrade.toFixed(el.value.max > 10 ? 1 : 2), unit: el.value.unit },
    { label: `金属量(${s.metalUnit})`, value: s.metalAmount >= 10000 ? (s.metalAmount / 10000).toFixed(2) + '万' : s.metalAmount.toFixed(1), unit: s.metalUnit }
  ]
})

const statsItems = computed<StatItem[]>(() => {
  const s = stats.value
  const items: StatItem[] = [
    { label: '矿区', value: config.pitName },
    { label: '元素', value: el.value.name },
    { label: '边界品位', value: `${config.cutoff.boundary} %` },
    { label: '工业品位', value: `${config.cutoff.industrial} %` },
    { label: '密度', value: `${density.value.toFixed(2)} t/m³` }
  ]
  if (s) {
    items.push({ label: '矿石占比', value: `${(s.oreFraction * 100).toFixed(1)}%` })
    items.push({ label: '最高品位', value: `${s.maxGrade.toFixed(el.value.max > 10 ? 1 : 2)} ${el.value.unit}` })
  }
  return items
})

const clipRows = computed<StatItem[]>(() => [
  { label: '元素', value: el.value.name },
  { label: '剖切方位', value: `${scene.ui.azimuth}°` },
  { label: '剖切倾角', value: `${scene.ui.tilt}°` },
  { label: '剖切偏移', value: `${scene.ui.offset}%` }
])

const pickedView = computed<PickedView | null>(() => {
  const p = scene.picked.value
  if (!p) return null
  if (!p.valid) return { title: '品位拾取', rows: [], empty: '该处低于检出限' }
  const rows: StatItem[] = [{ label: el.value.name, value: `${p.value.toFixed(el.value.max > 10 ? 1 : 2)} ${el.value.unit}` }]
  if (p.norm) rows.push({ label: '深度', value: `${((1 - p.norm[2]) * D.depth).toFixed(0)} m` })
  return { title: '品位拾取', rows }
})
</script>

<template>
  <VolumeShell
    title="三维矿体品位体"
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
      <div v-if="kpiCards.length" class="mn-kpi">
        <div v-for="card in kpiCards" :key="card.label" class="mn-kpi-card">
          <span>{{ card.label }}</span>
          <b>{{ card.value }}<i>{{ card.unit }}</i></b>
        </div>
      </div>
      <div class="mn-cam">
        <button
          v-for="key in CAMERA_ORDER"
          :key="key"
          type="button"
          class="mn-cam-btn"
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
      <div class="mn-dock">
        <div class="mn-dock-title">勘探线品位 · {{ activeDrillhole.id }}</div>
        <canvas ref="profileCanvas" width="210" height="150" class="mn-canvas"></canvas>
        <div class="mn-dock-caption">地表 ↑ 孔深 {{ activeDrillhole.depth }} m ↓ · 边界 {{ config.cutoff.boundary }} %</div>
        <div class="mn-dock-title" style="margin-top: 6px">品位分布</div>
        <canvas ref="histCanvas" width="210" height="72" class="mn-canvas"></canvas>
        <div class="mn-dock-chips">
          <button
            v-for="hole in config.drillholes"
            :key="hole.id"
            type="button"
            class="mn-dock-chip"
            :class="{ active: hole.id === activeDrillholeId }"
            @click="pickDrillhole(hole.id)"
          >
            {{ hole.id }}
          </button>
        </div>
      </div>
    </template>

    <template #legend>
      <div class="mn-pit">{{ config.pitName }}</div>
      <div class="mn-elements">
        <div v-for="(e, k) in config.elements" :key="k" class="mn-element">
          <span>{{ e.name }}</span><b>{{ e.cutoffs[0] }}{{ e.unit.includes('%') ? '%' : '' }}</b>
        </div>
      </div>
      <div class="mn-note">
        品位体由钻孔样品经反距离加权（IDW）插值构建：接触带与断裂交汇处富集，深部原生带品位升高；
        边界品位圈定矿体后按块体模型累计矿石量、吨位与金属量，工业品位用于区分表内 / 表外矿石。
      </div>
    </template>

    <template #controls>
      <div class="mn-block">
        <div class="vol-section">成矿元素</div>
        <div class="mn-chips">
          <button
            v-for="(e, k) in config.elements"
            :key="k"
            type="button"
            class="mn-chip"
            :class="{ active: channel === k }"
            @click="onChannel(k as MiningElement)"
          >
            {{ e.name }}
          </button>
        </div>
        <div class="mn-hint">{{ el.hint }}</div>
      </div>

      <div class="mn-block">
        <div class="vol-section">边界品位 / 矿体等值面</div>
        <div class="mn-thr-chips">
          <button
            v-for="c in cutoffs"
            :key="c"
            type="button"
            class="mn-thr"
            :class="{ active: cutoff === c }"
            @click="pickCutoff(c)"
          >
            {{ c }} {{ el.unit }}
          </button>
        </div>
        <div class="vol-row">
          <span class="vol-label">边界品位</span>
          <input type="range" :min="0" :max="el.max" :step="el.max / 200" v-model.number="cutoff" @change="commitCutoff()" />
          <span class="vol-value">{{ cutoff.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">显示等值面</span>
          <button class="vol-switch" :class="{ 'is-on': isoEnabled }" @click="isoEnabled = !isoEnabled; refreshIso()"><span></span></button>
        </div>
      </div>

      <div class="mn-block">
        <div class="vol-section">块体模型参数</div>
        <div class="vol-row">
          <span class="vol-label">矿石密度</span>
          <input type="range" min="2" max="3.6" step="0.05" v-model.number="density" @change="refreshStats()" />
          <span class="vol-value">{{ density.toFixed(2) }}</span>
        </div>
        <div class="mn-hint">密度用于吨位换算；边界品位以上体元计入矿石量，平均品位按体元加权。</div>
      </div>

      <div class="mn-block">
        <div class="vol-section">钻孔与采坑</div>
        <div class="vol-row">
          <span class="vol-label">钻孔轨迹</span>
          <button class="vol-switch" :class="{ 'is-on': drillholesVisible }" @click="drillholesVisible = !drillholesVisible; refreshOverlay()"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">采坑台阶</span>
          <button class="vol-switch" :class="{ 'is-on': benchesVisible }" @click="benchesVisible = !benchesVisible; refreshOverlay()"><span></span></button>
        </div>
      </div>

      <div class="mn-block">
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
          <div class="mn-seg">
            <button type="button" class="mn-seg-btn" @click="scene.setPreset(16, 4)">128³</button>
            <button type="button" class="mn-seg-btn" @click="scene.setPreset(24, 4)">192³</button>
            <button type="button" class="mn-seg-btn" @click="scene.setPreset(32, 4)">256³</button>
          </div>
        </div>
      </div>

      <div class="mn-block">
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
      <button class="vol-action" :disabled="busy" @click="refreshAll()">重新估算</button>
      <button class="vol-action ghost" @click="flyTo('overview')">恢复视图</button>
    </template>
  </VolumeShell>
</template>

<style scoped>
.mn-block {
  margin-bottom: 10px;
}
.mn-chips {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.mn-chip {
  padding: 6px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.mn-chip.active {
  border-color: #d4a94a;
  background: rgba(212, 169, 74, 0.22);
  color: #fff;
  font-weight: 600;
}
.mn-thr-chips {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-bottom: 4px;
}
.mn-thr {
  padding: 4px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 9px;
  cursor: pointer;
}
.mn-thr.active {
  border-color: #7ee787;
  background: rgba(126, 231, 135, 0.2);
  color: #fff;
}
.mn-hint {
  margin-top: 4px;
  font-size: 9px;
  line-height: 1.5;
  color: #7f96b3;
}
.mn-seg {
  display: flex;
  gap: 4px;
  flex: 1 1 auto;
}
.mn-seg-btn {
  flex: 1 1 0;
  padding: 5px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.mn-seg-btn:hover {
  border-color: #d4a94a;
  color: #fff;
}
.mn-pit {
  font-size: 12px;
  font-weight: 700;
  color: #d4a94a;
  margin-bottom: 6px;
}
.mn-elements {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 8px;
}
.mn-element {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #c3d5e8;
}
.mn-element b {
  color: #f3e6c2;
  font-variant-numeric: tabular-nums;
}
.mn-note {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
  font-size: 9px;
  line-height: 1.6;
  color: #9fb8d4;
}
.mn-kpi {
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
.mn-kpi-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 82px;
  padding: 4px 9px;
  border: 1px solid rgba(212, 169, 74, 0.3);
  border-radius: 6px;
  background: rgba(20, 16, 6, 0.82);
  backdrop-filter: blur(5px);
}
.mn-kpi-card span {
  font-size: 9px;
  color: #c9b98f;
}
.mn-kpi-card b {
  margin-top: 1px;
  color: #ffd21e;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.mn-kpi-card b i {
  margin-left: 2px;
  color: #9a8c66;
  font-size: 8px;
  font-style: normal;
  font-weight: 500;
}
.mn-cam {
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
.mn-cam-btn {
  padding: 5px 10px;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 6px;
  background: rgba(20, 16, 6, 0.85);
  color: #d8cfa8;
  font-size: 10px;
  cursor: pointer;
}
.mn-cam-btn.active,
.mn-cam-btn:hover {
  border-color: #d4a94a;
  background: rgba(212, 169, 74, 0.22);
  color: #fff;
}
.mn-dock {
  width: 226px;
  padding: 10px 12px;
  border: 1px solid rgba(212, 169, 74, 0.3);
  border-radius: 9px;
  background: rgba(20, 16, 6, 0.9);
  backdrop-filter: blur(6px);
  color: #ece3c6;
}
.mn-dock-title {
  font-size: 11px;
  font-weight: 700;
  color: #d4a94a;
  margin-bottom: 5px;
}
.mn-canvas {
  display: block;
  width: 100%;
  border-radius: 6px;
  border: 1px solid rgba(212, 169, 74, 0.3);
  background: #17130a;
}
.mn-dock-caption {
  margin: 4px 0 4px;
  font-size: 9px;
  color: #c9b98f;
}
.mn-dock-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 6px;
}
.mn-dock-chip {
  padding: 3px 6px;
  border: 1px solid rgba(212, 169, 74, 0.35);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  color: #d8cfa8;
  font-size: 9px;
  cursor: pointer;
}
.mn-dock-chip.active {
  border-color: #ffd21e;
  background: rgba(255, 210, 30, 0.2);
  color: #fff;
}
@media (max-width: 860px) {
  .mn-kpi {
    max-width: calc(100% - 24px);
    top: auto;
    bottom: 52px;
    flex-wrap: wrap;
  }
}
</style>
