<script setup lang="ts">
/**
 * CFD 多物理场体 —— 场景化 UI
 *
 * 面向工程仿真的多物理场工作台：压力 / 速度 / 温度场切换，标量体与等值面、
 * GPU 粒子 / 流线 / 剖面箭头联合表达，并支持入射风速与热源工况调节与时间演化。
 */
import { computed, reactive, ref, watch } from 'vue'
import VolumeShell from '../../lib/volume-engine/VolumeShell.vue'
import { useVolumeScene } from '../../lib/volume-engine/useVolumeScene'
import { SCENES } from '../../lib/volume-engine/scenes'
import { buildTransferLut, gradientCss } from '../../lib/volume-engine/palette'
import type { LineOverlayResult } from '../../lib/volume-engine/VolumeEngine'
import type { PickedView, StatItem } from '../../lib/volume-engine/types'

type IsoResult = { positions: Float32Array; normals: Float32Array; count: number; res: number }
type FieldMeta = { key: string; label: string; range: string; color: string; iso: boolean }

const spec = SCENES.cfd
const panelOpen = ref(true)
const V = spec.volume

const FIELD_META: FieldMeta[] = [
  { key: 'speed', label: '速度', range: '0 ~ 15 m/s', color: '#ffd21e', iso: false },
  { key: 'pressure', label: '压力', range: '-120 ~ 120 Pa', color: '#8db0fe', iso: true },
  { key: 'temperature', label: '温度', range: '280 ~ 340 K', color: '#f06030', iso: true }
]

const form = reactive({ inflow: spec.params.inflow as number, sourceTemp: spec.params.sourceTemp as number })
const overlay = ref<'particles' | 'streamlines' | 'section'>('particles')
const iso = reactive({ enabled: false, threshold: 40 })
const busy = ref(false)

const scene = useVolumeScene(spec, {
  onReady: (engine) => {
    engine.setParticlesVisible(true)
  }
})
const { container, sliceCanvas } = scene

const meta = computed<FieldMeta>(() => FIELD_META.find((m) => m.key === scene.ui.channel) ?? FIELD_META[0])
const canIso = computed(() => meta.value.iso)

async function refreshOverlay(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  if (overlay.value === 'particles') {
    engine.setLines(undefined)
    engine.setParticlesVisible(true)
    return
  }
  engine.setParticlesVisible(false)
  busy.value = true
  try {
    if (overlay.value === 'streamlines') {
      const result = await engine.analyze<LineOverlayResult>({
        mode: 'streamlines',
        seeds: 180,
        steps: 170,
        step: 0.012,
        volMin: [-V.width / 2, -V.depth / 2, V.base],
        volSize: [V.width, V.depth, V.height]
      })
      engine.setLines(result, { speedPalette: 'wind', speedMin: 0, speedMax: 15, width: 1.4 })
    } else {
      const half = 0.5 * Math.sqrt(V.width * V.width + V.depth * V.depth + V.height * V.height)
      const result = await engine.analyze<LineOverlayResult>({
        mode: 'section',
        count: 12,
        normal: [0, 1, 0],
        point: [0, 0, V.base + V.height / 2],
        e1: [1, 0, 0],
        e2: [0, 0, 1],
        halfDiag: half,
        volMin: [-V.width / 2, -V.depth / 2, V.base],
        volSize: [V.width, V.depth, V.height],
        vectorScale: 1
      })
      engine.setLines(result, { speedPalette: 'wind', speedMin: 0, speedMax: 12, width: 2.2 })
    }
  } finally {
    busy.value = false
  }
}

async function runIso(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  if (!iso.enabled || !canIso.value) {
    engine.clearIsosurface()
    return
  }
  busy.value = true
  try {
    const result = await engine.analyze<IsoResult>({ mode: 'isosurface', iso: iso.threshold, res: 32 })
    if (!result || !result.count) {
      engine.clearIsosurface()
      return
    }
    const lut = buildTransferLut(scene.ui.palette)
    const t = Math.max(0, Math.min(1, (iso.threshold - scene.ui.valueMin) / (scene.ui.valueMax - scene.ui.valueMin || 1)))
    const idx = Math.round(t * 255)
    engine.setIsosurface(result.positions, result.normals, [lut[idx * 4] / 255, lut[idx * 4 + 1] / 255, lut[idx * 4 + 2] / 255], 0.5)
  } finally {
    busy.value = false
  }
}

function onChannel(key: string): void {
  scene.setChannel(key)
  const m = FIELD_META.find((item) => item.key === key)
  iso.enabled = false
  scene.engine.value?.clearIsosurface()
  if (key === 'pressure') iso.threshold = 40
  else if (key === 'temperature') iso.threshold = 315
  if (m) void refreshOverlay()
}

function applyForm(): void {
  scene.engine.value?.setParams({ inflow: form.inflow, sourceTemp: form.sourceTemp })
}

function pickOverlay(mode: 'particles' | 'streamlines' | 'section'): void {
  overlay.value = mode
  void refreshOverlay()
}

function toggleIso(): void {
  iso.enabled = !iso.enabled
  void runIso()
}

watch(
  () => scene.ui.timeStep,
  () => {
    if (overlay.value !== 'particles') void refreshOverlay()
    if (iso.enabled) void runIso()
  }
)

const legendCss = computed(() => gradientCss(scene.ui.palette))

const stats = computed<StatItem[]>(() => {
  const items: StatItem[] = [
    { label: '等效分辨率', value: scene.engine.value ? `${scene.engine.value.fullDims}³` : '—' },
    { label: '已加载瓦片', value: scene.stats.tilesReady.toLocaleString() },
    { label: '向量表达', value: overlay.value === 'particles' ? 'GPU 粒子' : overlay.value === 'streamlines' ? '流线' : '剖面箭头' },
    { label: '当前场量', value: meta.value.label }
  ]
  return items
})

const clipRows = computed<StatItem[]>(() => [
  { label: '场量', value: meta.value.label },
  { label: '剖切方位', value: `${scene.ui.azimuth}°` },
  { label: '剖切倾角', value: `${scene.ui.tilt}°` },
  { label: '剖切偏移', value: `${scene.ui.offset}%` }
])

const pickedView = computed<PickedView | null>(() => {
  const p = scene.picked.value
  if (!p) return null
  if (!p.valid) return { title: '场量拾取', rows: [], empty: '该处为障碍物 / 无数据' }
  const ch = scene.active()
  const rows: StatItem[] = [{ label: ch.label, value: `${p.value.toFixed(ch.decimals ?? 1)} ${ch.unit}` }]
  if (p.lon !== undefined && p.lat !== undefined) {
    rows.push({ label: '经度 / 纬度', value: `${p.lon.toFixed(3)}, ${p.lat.toFixed(3)}` })
    rows.push({ label: '高度', value: `${(p.height ?? 0).toFixed(1)} m` })
  }
  return { title: '场量拾取', rows }
})
</script>

<template>
  <VolumeShell
    title="CFD 多物理场体"
    :status="scene.status.value"
    :panel-open="panelOpen"
    :legend-css="legendCss"
    :legend-min="String(scene.active().min)"
    :legend-max="`${scene.active().max} ${scene.active().unit}`"
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
      <div class="cf-field" v-for="f in FIELD_META" :key="f.key" :class="{ active: scene.ui.channel === f.key }">
        <i :style="{ background: f.color }"></i>
        <span>{{ f.label }}</span>
        <b>{{ f.range }}</b>
      </div>
      <div class="cf-note">障碍物为实体区域，体元素在其内部不可见；绕流加速区与尾流低压区由传递函数体现。</div>
    </template>

    <template #controls>
      <div class="cf-block">
        <div class="vol-section">物理场变量</div>
        <div class="cf-fields">
          <button
            v-for="f in FIELD_META"
            :key="f.key"
            type="button"
            class="cf-field-btn"
            :style="{ borderColor: scene.ui.channel === f.key ? f.color : undefined }"
            :class="{ active: scene.ui.channel === f.key }"
            @click="onChannel(f.key)"
          >
            <i :style="{ background: f.color }"></i>{{ f.label }}
          </button>
        </div>
      </div>

      <div class="cf-block">
        <div class="vol-section">向量表达</div>
        <div class="cf-seg">
          <button type="button" class="cf-seg-btn" :class="{ active: overlay === 'particles' }" @click="pickOverlay('particles')">粒子</button>
          <button type="button" class="cf-seg-btn" :class="{ active: overlay === 'streamlines' }" @click="pickOverlay('streamlines')">流线</button>
          <button type="button" class="cf-seg-btn" :class="{ active: overlay === 'section' }" @click="pickOverlay('section')">剖面箭头</button>
        </div>
        <div class="vol-row">
          <span class="vol-label">粒子尺寸</span>
          <input type="range" min="1" max="6" step="1" v-model.number="scene.ui.particleSize" @input="scene.setParticleSize()" />
          <span class="vol-value">{{ scene.ui.particleSize }}px</span>
        </div>
      </div>

      <div class="cf-block">
        <div class="vol-section">等值面</div>
        <div class="vol-row">
          <span class="vol-label">显示等值面</span>
          <button class="vol-switch" :class="{ 'is-on': iso.enabled }" :disabled="!canIso" @click="toggleIso"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">等值阈值</span>
          <input
            type="range"
            :min="scene.active().min"
            :max="scene.active().max"
            :step="(scene.active().max - scene.active().min) / 100"
            v-model.number="iso.threshold"
            :disabled="!canIso"
            @change="runIso()"
          />
          <span class="vol-value">{{ iso.threshold.toFixed(0) }}</span>
        </div>
        <div class="cf-hint">{{ canIso ? '提取等压面 / 等温面，观察绕流分离与热羽结构' : '速度场无等值面语义，切换压力或温度场' }}</div>
      </div>

      <div class="cf-block">
        <div class="vol-section">工况参数</div>
        <div class="vol-row">
          <span class="vol-label">入射风速</span>
          <input type="range" min="2" max="14" step="1" v-model.number="form.inflow" @change="applyForm" />
          <span class="vol-value">{{ form.inflow }} m/s</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">热源温度</span>
          <input type="range" min="300" max="340" step="2" v-model.number="form.sourceTemp" @change="applyForm" />
          <span class="vol-value">{{ form.sourceTemp }} K</span>
        </div>
      </div>

      <div class="cf-block">
        <div class="vol-section">时间演化</div>
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
          <span class="vol-value">{{ scene.ui.timeStep + 1 }}/{{ spec.timeSteps }} s</span>
        </div>
        <button class="cf-btn ghost" @click="scene.togglePlay()">{{ scene.ui.playing ? '暂停' : '自动播放' }}</button>
      </div>

      <div class="cf-block">
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

      <div class="cf-block">
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
      <button class="vol-action" :disabled="busy" @click="refreshOverlay()">刷新向量表达</button>
      <button class="vol-action ghost" @click="scene.engine.value?.resetCamera(1)">恢复视图</button>
    </template>
  </VolumeShell>
</template>

<style scoped>
.cf-block {
  margin-bottom: 10px;
}
.cf-fields {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.cf-field-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.cf-field-btn i {
  width: 14px;
  height: 3px;
  border-radius: 2px;
}
.cf-field-btn.active {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-weight: 600;
}
.cf-seg {
  display: flex;
  gap: 4px;
}
.cf-seg-btn {
  flex: 1 1 0;
  padding: 6px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.cf-seg-btn.active {
  border-color: #2f80ed;
  background: #2f80ed;
  color: #fff;
  font-weight: 600;
}
.cf-btn {
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
.cf-btn.ghost {
  background: rgba(47, 128, 237, 0.18);
  border: 1px solid rgba(47, 128, 237, 0.7);
  color: #9fd8ff;
}
.cf-hint {
  margin-top: 4px;
  font-size: 9px;
  line-height: 1.5;
  color: #7f96b3;
}
.cf-field {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 10px;
  color: #c3d5e8;
}
.cf-field i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.cf-field span {
  flex: 1 1 auto;
}
.cf-field b {
  color: #65d3eb;
  font-weight: 600;
}
.cf-field.active b {
  color: #fff;
}
.cf-note {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
  font-size: 9px;
  line-height: 1.6;
  color: #9fb8d4;
}
</style>
