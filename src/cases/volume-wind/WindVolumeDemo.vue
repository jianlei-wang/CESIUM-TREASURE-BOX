<script setup lang="ts">
/**
 * 三维风场 Vector Volume —— 场景化 UI
 *
 * 标量体（风速 / 垂直速度）与向量表达（GPU 粒子 / 流线 / 高度层箭头）协同的风场工作台，
 * 并提供任意位置的垂直廓线曲线，支持按高度层与剖面分析风场结构。
 */
import { computed, reactive, ref, watch, nextTick } from 'vue'
import VolumeShell from '../../lib/volume-engine/VolumeShell.vue'
import { useVolumeScene } from '../../lib/volume-engine/useVolumeScene'
import { SCENES } from '../../lib/volume-engine/scenes'
import { gradientCss } from '../../lib/volume-engine/palette'
import type { LineOverlayResult } from '../../lib/volume-engine/VolumeEngine'
import type { PickedView, StatItem } from '../../lib/volume-engine/types'

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

const TIERS = [
  { label: '和风', range: '0 ~ 5', color: '#1470c8' },
  { label: '强风', range: '5 ~ 10', color: '#14c8a0' },
  { label: '疾风', range: '10 ~ 15', color: '#ffd21e' },
  { label: '大风以上', range: '≥ 15', color: '#ff5a14' }
]

const form = reactive({
  baseSpeed: spec.params.baseSpeed as number,
  baseDir: spec.params.baseDir as number,
  vortices: spec.params.vortices as number,
  gust: spec.params.gust as number
})
const overlay = ref<'none' | 'streamlines' | 'arrows'>('streamlines')
const layerHeight = ref(50)
const profile = reactive({ x: 50, y: 50 })
const profileResult = ref<ProfileResult | null>(null)
const profileCanvas = ref<HTMLCanvasElement | null>(null)
const profileAt = ref<{ speed: number; u: number; v: number; w: number } | null>(null)
const busy = ref(false)

const scene = useVolumeScene(spec, {
  onReady: (engine) => {
    engine.setParticlesVisible(true)
    void refreshOverlay(engine)
    void runProfile(engine)
  }
})
const { container, sliceCanvas } = scene

async function refreshOverlay(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  if (overlay.value === 'none') {
    engine.setLines(undefined)
    return
  }
  busy.value = true
  try {
    if (overlay.value === 'streamlines') {
      const result = await engine.analyze<LineOverlayResult>({
        mode: 'streamlines',
        seeds: 160,
        steps: 170,
        step: 0.011,
        volMin: [-V.width / 2, -V.depth / 2, V.base],
        volSize: [V.width, V.depth, V.height]
      })
      engine.setLines(result, { speedPalette: 'wind', speedMin: 0, speedMax: 20, width: 1.5 })
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
      engine.setLines(result, { speedPalette: 'wind', speedMin: 0, speedMax: 18, width: 2.2 })
    }
  } finally {
    busy.value = false
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
  for (let i = 0; i < result.levels; i += 1) {
    if (!result.valid[i]) {
      started = false
      continue
    }
    const x = 26 + ((w - 34) * Math.min(1, result.values[i] / 20))
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
  ctx.fillText('风速 20', w - 46, h - 3)
}

function applyForm(): void {
  scene.engine.value?.setParams({
    baseSpeed: form.baseSpeed,
    baseDir: form.baseDir,
    vortices: form.vortices,
    gust: form.gust
  })
}

function pickOverlay(mode: 'none' | 'streamlines' | 'arrows'): void {
  overlay.value = mode
  void refreshOverlay()
}

function onLayer(): void {
  if (overlay.value === 'arrows') void refreshOverlay()
}

function onProfile(): void {
  void runProfile()
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
    { label: '等效分辨率', value: scene.engine.value ? `${scene.engine.value.fullDims}³` : '—' },
    { label: '已加载瓦片', value: scene.stats.tilesReady.toLocaleString() },
    { label: '叠加方式', value: overlay.value === 'none' ? '无' : overlay.value === 'streamlines' ? '流线' : '高度层箭头' }
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
  return { title: '风场拾取', rows }
})
</script>

<template>
  <VolumeShell
    title="三维风场 Vector Volume"
    :status="scene.status.value"
    :panel-open="panelOpen"
    :legend-css="legendCss"
    legend-min="0 m/s"
    legend-max="20 m/s"
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
        <div class="wd-profile-hint">剖面位置 X {{ profile.x }}% · Y {{ profile.y }}%</div>
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
        <div class="vol-section">向量叠加</div>
        <div class="wd-seg">
          <button type="button" class="wd-seg-btn" :class="{ active: overlay === 'none' }" @click="pickOverlay('none')">仅标量</button>
          <button type="button" class="wd-seg-btn" :class="{ active: overlay === 'streamlines' }" @click="pickOverlay('streamlines')">流线</button>
          <button type="button" class="wd-seg-btn" :class="{ active: overlay === 'arrows' }" @click="pickOverlay('arrows')">层箭头</button>
        </div>
        <div v-if="overlay === 'arrows'" class="vol-row">
          <span class="vol-label">箭头所在高度</span>
          <input type="range" min="5" max="95" step="1" v-model.number="layerHeight" @input="onLayer" />
          <span class="vol-value">{{ layerHeight }}%</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">GPU 粒子</span>
          <button class="vol-switch" :class="{ 'is-on': scene.ui.particleVisible }" @click="scene.setParticlesVisible(!scene.ui.particleVisible)"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">粒子尺寸</span>
          <input type="range" min="1" max="6" step="1" v-model.number="scene.ui.particleSize" @input="scene.setParticleSize()" />
          <span class="vol-value">{{ scene.ui.particleSize }}px</span>
        </div>
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
          <span class="vol-label">主导风向</span>
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
      </div>
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
</style>
