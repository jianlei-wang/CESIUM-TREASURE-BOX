<script setup lang="ts">
/**
 * CFD 多物理场体 —— 工程仿真工作台
 *
 * 以程序化街区建筑为工程骨架，速度 / 压力 / 温度三场共享同一解析流场模型；
 * 叠加仿真域、出入口、主风向、入口粒子 / 流线 / 剖面箭头、多张等值面，并给出
 * 尾流长度、热羽高度、压力极值等工程 KPI 与时间过程回放。
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import VolumeShell from '../../lib/volume-engine/VolumeShell.vue'
import { useVolumeScene } from '../../lib/volume-engine/useVolumeScene'
import { SCENES } from '../../lib/volume-engine/scenes'
import { buildTransferLut, gradientCss } from '../../lib/volume-engine/palette'
import type { BackgroundMode, CameraPreset, LineOverlayResult } from '../../lib/volume-engine/VolumeEngine'
import type { PickedView, StatItem } from '../../lib/volume-engine/types'
import { CFD_BUILDINGS, cfdGeometryPayload, installCfdEngineering, type CfdEngineeringLayer } from './cfd-engineering'

type IsoResult = { positions: Float32Array; normals: Float32Array; count: number; res: number; nz?: number }
type FieldMeta = { key: string; label: string; range: string; color: string; iso: boolean }
type CfdMetrics = {
  inflow: number
  meanSpeed: number
  maxSpeed: number
  p95Speed: number
  pressureMin: number
  pressureMax: number
  maxTemp: number
  overheat: number
  plumeTopM: number
  wakeLengthM: number
  wakeRatio: number
  buildingHeightM: number
}

const spec = SCENES.cfd
const panelOpen = ref(true)
const V = spec.volume

const FIELD_META: FieldMeta[] = [
  { key: 'speed', label: '速度', range: '0 ~ 20 m/s', color: '#ffd21e', iso: false },
  { key: 'pressure', label: '压力', range: '-120 ~ 120 Pa', color: '#8db0fe', iso: true },
  { key: 'temperature', label: '温度', range: '280 ~ 360 K', color: '#f06030', iso: true }
]

const form = reactive({
  inflow: spec.params.inflow as number,
  sourceTemp: spec.params.sourceTemp as number,
  ambientTemp: spec.params.ambientTemp as number,
  heat: spec.params.heat as number
})

const render = reactive({ densityGamma: 1.15, thresholdSoft: 0.06, lighting: 0.45 })
const overlay = ref<'particles' | 'streamlines' | 'section'>('particles')
const lineWidth = ref(1.8)
const iso = reactive({ enabled: false, threshold: 40, doubleSided: true })
const background = ref<BackgroundMode>('engineering')
const camera = ref<CameraPreset>('overview')
const busy = ref(false)
const kpi = ref<CfdMetrics | null>(null)
let layer: CfdEngineeringLayer | undefined

const scene = useVolumeScene(spec, {
  geometry: cfdGeometryPayload(),
  onReady: (engine) => {
    engine.setRenderParams({ ...render })
    engine.setBackgroundMode(background.value)
    if (!layer) {
      layer = installCfdEngineering(engine)
      engine.flyToPreset('overview', 0)
    }
    engine.setParticlesVisible(true)
    void refreshIso(engine)
    void refreshMetrics(engine)
  }
})
const { container, sliceCanvas } = scene

const meta = computed<FieldMeta>(() => FIELD_META.find((m) => m.key === scene.ui.channel) ?? FIELD_META[0])
const canIso = computed(() => meta.value.iso)

/* --------------------------- 向量表达 --------------------------- */

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
        seeds: 190,
        steps: 220,
        step: 0.006,
        volMin: [-V.width / 2, -V.depth / 2, V.base],
        volSize: [V.width, V.depth, V.height]
      })
      engine.setLines(result, { speedPalette: 'wind', speedMin: 0, speedMax: 20, width: lineWidth.value, segments: 24 })
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
      engine.setLines(result, { speedPalette: 'wind', speedMin: 0, speedMax: 20, width: lineWidth.value + 0.4 })
    }
  } finally {
    busy.value = false
  }
}

/* ---------------------------- 等值面 ---------------------------- */

function colorAt(value: number): [number, number, number] {
  const lut = buildTransferLut(scene.ui.palette)
  const t = Math.max(0, Math.min(1, (value - scene.ui.valueMin) / (scene.ui.valueMax - scene.ui.valueMin || 1)))
  const idx = Math.round(t * 255)
  return [lut[idx * 4] / 255, lut[idx * 4 + 1] / 255, lut[idx * 4 + 2] / 255]
}

async function refreshIso(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  engine.clearIsosurface()
  if (!iso.enabled || !canIso.value) return
  busy.value = true
  try {
    const channel = scene.ui.channel
    const volMin = [-V.width / 2, -V.depth / 2, V.base]
    const volSize = [V.width, V.depth, V.height]
    const result = await engine.analyze<IsoResult>({ mode: 'isosurface', channel, iso: iso.threshold, res: 64, volMin, volSize })
    if (!result || !result.count) return
    engine.setIsosurface(result.positions, result.normals, colorAt(iso.threshold), 0.5, `${channel}-pos`)
    if (channel === 'pressure' && iso.doubleSided) {
      const neg = await engine.analyze<IsoResult>({ mode: 'isosurface', channel, iso: -iso.threshold, res: 64, volMin, volSize })
      if (neg && neg.count) {
        engine.setIsosurface(neg.positions, neg.normals, [0.36, 0.72, 1], 0.42, `${channel}-neg`)
      }
    }
  } finally {
    busy.value = false
  }
}

/* --------------------------- 工程指标 --------------------------- */

async function refreshMetrics(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  try {
    const result = await engine.analyze<CfdMetrics>({
      mode: 'cfd',
      res: 36,
      volMin: [-V.width / 2, -V.depth / 2, V.base],
      volSize: [V.width, V.depth, V.height]
    })
    if (result) kpi.value = result
  } catch {
    kpi.value = null
  }
}

/* ----------------------------- 交互 ----------------------------- */

function onChannel(key: string): void {
  scene.setChannel(key)
  iso.enabled = false
  scene.engine.value?.clearIsosurface()
  if (key === 'pressure') iso.threshold = 40
  else if (key === 'temperature') iso.threshold = 315
  void refreshOverlay()
}

function applyForm(): void {
  scene.engine.value?.setParams({
    inflow: form.inflow,
    sourceTemp: form.sourceTemp,
    ambientTemp: form.ambientTemp,
    heat: form.heat
  })
  void refreshOverlay()
}

function applyRender(): void {
  scene.engine.value?.setRenderParams({ ...render })
}

function pickOverlay(mode: 'particles' | 'streamlines' | 'section'): void {
  overlay.value = mode
  void refreshOverlay()
}

function toggleIso(): void {
  iso.enabled = !iso.enabled
  void refreshIso()
}

function flyTo(preset: CameraPreset): void {
  camera.value = preset
  scene.engine.value?.flyToPreset(preset, 1)
}

function setBackground(mode: BackgroundMode): void {
  background.value = mode
  scene.engine.value?.setBackgroundMode(mode)
}

watch(
  () => scene.ui.timeStep,
  () => {
    if (overlay.value !== 'particles') void refreshOverlay()
    if (iso.enabled) void refreshIso()
    void refreshMetrics()
  }
)

onBeforeUnmount(() => {
  layer?.destroy()
  layer = undefined
})

const legendCss = computed(() => gradientCss(scene.ui.palette))

const stats = computed<StatItem[]>(() => {
  const items: StatItem[] = [
    { label: '等效分辨率', value: scene.engine.value ? `${scene.engine.value.fullDims}³` : '—' },
    { label: '已加载瓦片', value: scene.stats.tilesReady.toLocaleString() },
    { label: '建筑体块', value: `${CFD_BUILDINGS.length} 栋` },
    { label: '向量表达', value: overlay.value === 'particles' ? 'GPU 粒子' : overlay.value === 'streamlines' ? '流线' : '剖面箭头' },
    { label: '当前场量', value: meta.value.label }
  ]
  return items
})

const kpiCards = computed(() => {
  const k = kpi.value
  if (!k) return []
  return [
    { label: '平均风速', value: k.meanSpeed.toFixed(2), unit: 'm/s' },
    { label: '最大风速', value: k.maxSpeed.toFixed(2), unit: 'm/s' },
    { label: 'P95 风速', value: k.p95Speed.toFixed(2), unit: 'm/s' },
    { label: '压力极值', value: `${k.pressureMin.toFixed(0)} / ${k.pressureMax.toFixed(0)}`, unit: 'Pa' },
    { label: '峰值温升', value: `+${k.overheat.toFixed(1)}`, unit: 'K' },
    { label: '热羽高度', value: k.plumeTopM.toFixed(0), unit: 'm' },
    { label: '尾流长度', value: k.wakeLengthM.toFixed(0), unit: 'm' },
    { label: '尾流/楼高', value: k.wakeRatio.toFixed(1), unit: '×' }
  ]
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
      <div v-if="kpiCards.length" class="cf-kpi">
        <div v-for="card in kpiCards" :key="card.label" class="cf-kpi-card">
          <span>{{ card.label }}</span>
          <b>{{ card.value }}<i>{{ card.unit }}</i></b>
        </div>
      </div>
      <div class="cf-cam">
        <button
          v-for="preset in (['overview', 'inlet', 'top', 'wake'] as CameraPreset[])"
          :key="preset"
          type="button"
          class="cf-cam-btn"
          :class="{ active: camera === preset }"
          @click="flyTo(preset)"
        >
          {{ { overview: '总览', inlet: '入口', top: '顶视', wake: '尾流' }[preset] }}
        </button>
      </div>
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
      <div class="cf-note">
        建筑为实体区域，速度 / 压力 / 温度三场由同一流场模型一致生成：迎风驻点高压、绕流加速、尾流回压与卡门涡街、热源热羽随流输运。
      </div>
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
        <div class="vol-row" v-if="overlay === 'particles'">
          <span class="vol-label">粒子尺寸</span>
          <input type="range" min="1" max="6" step="1" v-model.number="scene.ui.particleSize" @input="scene.setParticleSize()" />
          <span class="vol-value">{{ scene.ui.particleSize }}px</span>
        </div>
        <div class="vol-row" v-else>
          <span class="vol-label">线宽</span>
          <input type="range" min="1" max="4" step="0.2" v-model.number="lineWidth" @change="refreshOverlay()" />
          <span class="vol-value">{{ lineWidth.toFixed(1) }}px</span>
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
            @change="refreshIso()"
          />
          <span class="vol-value">{{ iso.threshold.toFixed(0) }}</span>
        </div>
        <div class="vol-row" v-if="scene.ui.channel === 'pressure'">
          <span class="vol-label">正负压双面</span>
          <button class="vol-switch" :class="{ 'is-on': iso.doubleSided }" @click="iso.doubleSided = !iso.doubleSided; refreshIso()"><span></span></button>
        </div>
        <div class="cf-hint">{{ canIso ? '提取等压面 / 等温面，观察绕流分离、尾涡与热羽结构' : '速度场无等值面语义，切换压力或温度场' }}</div>
      </div>

      <div class="cf-block">
        <div class="vol-section">工况参数</div>
        <div class="vol-row">
          <span class="vol-label">入射风速</span>
          <input type="range" min="2" max="16" step="1" v-model.number="form.inflow" @change="applyForm" />
          <span class="vol-value">{{ form.inflow }} m/s</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">环境温度</span>
          <input type="range" min="280" max="305" step="1" v-model.number="form.ambientTemp" @change="applyForm" />
          <span class="vol-value">{{ form.ambientTemp }} K</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">热源温度</span>
          <input type="range" min="305" max="360" step="2" v-model.number="form.sourceTemp" @change="applyForm" />
          <span class="vol-value">{{ form.sourceTemp }} K</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">热源强度</span>
          <input type="range" min="0.4" max="1.6" step="0.1" v-model.number="form.heat" @change="applyForm" />
          <span class="vol-value">{{ form.heat.toFixed(1) }}×</span>
        </div>
      </div>

      <div class="cf-block">
        <div class="vol-section">体渲染</div>
        <div class="vol-row">
          <span class="vol-label">密度压缩</span>
          <input type="range" min="0.5" max="2" step="0.05" v-model.number="render.densityGamma" @input="applyRender" />
          <span class="vol-value">γ {{ render.densityGamma.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">低端软阈值</span>
          <input type="range" min="0" max="0.4" step="0.01" v-model.number="render.thresholdSoft" @input="applyRender" />
          <span class="vol-value">{{ render.thresholdSoft.toFixed(2) }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">方向光照</span>
          <input type="range" min="0" max="1" step="0.05" v-model.number="render.lighting" @input="applyRender" />
          <span class="vol-value">{{ render.lighting.toFixed(2) }}</span>
        </div>
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
          <span class="vol-label">场景背景</span>
          <div class="cf-seg">
            <button type="button" class="cf-seg-btn" :class="{ active: background === 'engineering' }" @click="setBackground('engineering')">深色</button>
            <button type="button" class="cf-seg-btn" :class="{ active: background === 'satellite' }" @click="setBackground('satellite')">卫星</button>
            <button type="button" class="cf-seg-btn" :class="{ active: background === 'dim' }" @click="setBackground('dim')">弱影像</button>
          </div>
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
    </template>

    <template #actions>
      <button class="vol-action" :disabled="busy" @click="refreshOverlay()">刷新向量表达</button>
      <button class="vol-action" :disabled="busy" @click="refreshMetrics(); refreshIso()">重算工程指标</button>
      <button class="vol-action ghost" @click="flyTo('overview')">恢复视图</button>
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

.cf-kpi {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  max-width: min(640px, calc(100% - 340px));
  pointer-events: none;
}
.cf-kpi-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 66px;
  padding: 4px 8px;
  border: 1px solid rgba(101, 211, 235, 0.28);
  border-radius: 6px;
  background: rgba(8, 24, 48, 0.82);
  backdrop-filter: blur(5px);
}
.cf-kpi-card span {
  font-size: 9px;
  color: #9fb8d4;
}
.cf-kpi-card b {
  margin-top: 1px;
  color: #65d3eb;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.cf-kpi-card b i {
  margin-left: 2px;
  color: #7f96b3;
  font-size: 8px;
  font-style: normal;
  font-weight: 500;
}
.cf-cam {
  position: absolute;
  bottom: 14px;
  right: 14px;
  z-index: 9;
  display: flex;
  gap: 4px;
}
.cf-cam-btn {
  padding: 5px 10px;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 6px;
  background: rgba(8, 24, 48, 0.85);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.cf-cam-btn.active,
.cf-cam-btn:hover {
  border-color: #2f80ed;
  background: #2f80ed;
  color: #fff;
}
@media (max-width: 860px) {
  .cf-kpi {
    max-width: calc(100% - 24px);
    top: auto;
    bottom: 52px;
  }
}
</style>
