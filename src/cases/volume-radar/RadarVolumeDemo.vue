<script setup lang="ts">
/**
 * 三维气象雷达回波体 —— 场景化 UI
 *
 * 面向雷达业务的三维回波体工作台：回波分级、回波顶高/强对流核心分析、高度带裁剪、
 * 时间轴回放与经纬高拾取。所有体渲染底座来自 useVolumeScene，界面按雷达分析流程编排。
 */
import { computed, reactive, ref, watch } from 'vue'
import { Color } from 'cesium'
import VolumeShell from '../../lib/volume-engine/VolumeShell.vue'
import { useVolumeScene } from '../../lib/volume-engine/useVolumeScene'
import { SCENES } from '../../lib/volume-engine/scenes'
import { buildTransferLut, gradientCss } from '../../lib/volume-engine/palette'
import type { PickedView, StatItem } from '../../lib/volume-engine/types'

type RadarAnalysis = {
  grid: number
  maxTop: number
  meanTop: number
  topGrid: Float32Array
  corePos: Float32Array
  corePeak: Float32Array
  coreCount: number
}

const spec = SCENES.radar

const panelOpen = ref(true)
const TIERS = [
  { label: '弱回波', range: '< 20', value: 20, color: '#0d7fe0' },
  { label: '中等回波', range: '20 ~ 35', value: 35, color: '#2ecc40' },
  { label: '强回波', range: '35 ~ 45', value: 45, color: '#ffd21e' },
  { label: '特强回波', range: '≥ 45', value: 55, color: '#ff2a1e' }
]

const form = reactive({
  cells: spec.params.cells as number,
  wind: spec.params.wind as number,
  topThreshold: 20,
  showCores: true
})
const band = reactive({ enabled: false, min: 0, max: 100 })
const analysis = ref<RadarAnalysis | null>(null)
const busy = ref(false)

const coreColor = (dbz: number): Color => {
  const lut = buildTransferLut('radar', { alphaFloor: 0.1, alphaGamma: 0.6 })
  const t = Math.max(0, Math.min(1, dbz / 70))
  const idx = Math.round(t * 255)
  return new Color(lut[idx * 4] / 255, lut[idx * 4 + 1] / 255, lut[idx * 4 + 2] / 255, 0.98)
}

const scene = useVolumeScene(spec, {
  onReady: (engine) => {
    void runAnalysis(engine)
  }
})
const { container, sliceCanvas } = scene

async function runAnalysis(engine = scene.engine.value): Promise<void> {
  const e = engine
  if (!e) return
  busy.value = true
  try {
    const result = await e.analyze<RadarAnalysis>({
      mode: 'radar',
      res: 44,
      vertical: 48,
      threshold: form.topThreshold
    })
    if (!result) return
    analysis.value = result
    if (form.showCores && result.coreCount) {
      e.setOverlayPoints(
        Array.from({ length: result.coreCount }, (_, i) => ({
          position: e.localFromNormalized(
            result.corePos[i * 3],
            result.corePos[i * 3 + 1],
            result.corePos[i * 3 + 2]
          ),
          color: coreColor(result.corePeak[i]),
          pixelSize: 11
        }))
      )
    } else {
      e.clearOverlayPoints()
    }
  } finally {
    busy.value = false
  }
}

function applyForm(): void {
  scene.engine.value?.setParams({ cells: form.cells, wind: form.wind })
}

function onTier(value: number): void {
  scene.ui.valueMin = value
  scene.ui.valueMax = spec.channels[0].max
  scene.setRange()
}

function onBand(): void {
  scene.engine.value?.setHeightClip(band.min / 100, band.max / 100, band.enabled)
}

function toggleBand(): void {
  band.enabled = !band.enabled
  onBand()
}

function onCores(): void {
  form.showCores = !form.showCores
  if (form.showCores) void runAnalysis()
  else scene.engine.value?.clearOverlayPoints()
}

watch(
  () => scene.ui.timeStep,
  () => {
    if (analysis.value) void runAnalysis()
  }
)

const legendCss = computed(() => gradientCss('radar'))

const stats = computed<StatItem[]>(() => {
  const items: StatItem[] = [
    { label: '等效分辨率', value: scene.engine.value ? `${scene.engine.value.fullDims}³` : '—' },
    { label: '已加载瓦片', value: scene.stats.tilesReady.toLocaleString() }
  ]
  const a = analysis.value
  if (a) {
    items.push({ label: '回波顶高（最高）', value: `${(a.maxTop * 20).toFixed(1)} km` })
    items.push({ label: '回波顶高（平均）', value: `${(a.meanTop * 20).toFixed(1)} km` })
    items.push({ label: '强对流核心', value: `${a.coreCount} 个` })
  }
  return items
})

const clipRows = computed<StatItem[]>(() => [
  { label: '方位角', value: `${scene.ui.azimuth}°` },
  { label: '倾角', value: `${scene.ui.tilt}°` },
  { label: '偏移', value: `${scene.ui.offset}%` },
  { label: '高度带', value: band.enabled ? `${band.min}% ~ ${band.max}%` : '关闭' }
])

const pickedView = computed<PickedView | null>(() => {
  const p = scene.picked.value
  if (!p) return null
  if (!p.valid) return { title: '体元素信息', rows: [], empty: '该处为空体元素 / 无回波' }
  const rows: StatItem[] = [{ label: '反射率', value: `${p.value.toFixed(1)} dBZ` }]
  if (p.lon !== undefined && p.lat !== undefined) {
    rows.push({ label: '经度', value: `${p.lon.toFixed(4)}°` })
    rows.push({ label: '纬度', value: `${p.lat.toFixed(4)}°` })
    rows.push({ label: '高度', value: `${((p.height ?? 0) / 1000).toFixed(2)} km` })
  }
  rows.push({ label: '瓦片 / 样本', value: `${p.tileIndex} / ${p.sampleIndex}` })
  return { title: '雷达回波拾取', rows }
})

const coreList = computed(() => {
  const a = analysis.value
  if (!a) return []
  return Array.from({ length: a.coreCount }, (_, i) => ({
    index: i + 1,
    dbz: a.corePeak[i],
    top: a.corePos[i * 3 + 2] * 20
  })).sort((x, y) => y.dbz - x.dbz)
})
</script>

<template>
  <VolumeShell
    title="三维气象雷达回波体"
    :status="scene.status.value"
    :panel-open="panelOpen"
    :legend-css="legendCss"
    legend-min="0 dBZ"
    legend-max="70 dBZ"
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
      <div class="rd-tier" v-for="tier in TIERS" :key="tier.label">
        <i :style="{ background: tier.color }"></i>
        <span>{{ tier.label }}</span>
        <b>{{ tier.range }} dBZ</b>
      </div>
      <div v-if="coreList.length" class="rd-cores">
        <div class="rd-cores-title">强对流核心</div>
        <div class="rd-core" v-for="core in coreList" :key="core.index">
          <span>#{{ core.index }} 核心</span>
          <b>{{ core.dbz.toFixed(0) }} dBZ</b>
          <em>{{ core.top.toFixed(1) }} km</em>
        </div>
      </div>
    </template>

    <template #controls>
      <div class="rd-block">
        <div class="vol-section">回波分级定位</div>
        <div class="rd-tiers">
          <button
            v-for="tier in TIERS"
            :key="tier.value"
            type="button"
            class="rd-tier-btn"
            :style="{ borderColor: tier.color }"
            @click="onTier(tier.value)"
          >
            {{ tier.label }}
          </button>
        </div>
        <div class="vol-row">
          <span class="vol-label">值域下限</span>
          <input type="range" :min="0" :max="70" step="1" v-model.number="scene.ui.valueMin" @input="scene.setRange()" />
          <span class="vol-value">{{ scene.ui.valueMin.toFixed(0) }} dBZ</span>
        </div>
      </div>

      <div class="rd-block">
        <div class="vol-section">回波顶高 / 强对流核心</div>
        <div class="vol-row">
          <span class="vol-label">顶高阈值</span>
          <input type="range" min="5" max="45" step="1" v-model.number="form.topThreshold" @change="runAnalysis()" />
          <span class="vol-value">≥ {{ form.topThreshold }} dBZ</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">叠加核心点</span>
          <button class="vol-switch" :class="{ 'is-on': form.showCores }" @click="onCores"><span></span></button>
        </div>
        <button class="rd-analyze" :disabled="busy" @click="runAnalysis()">
          {{ busy ? '分析中…' : '重新分析回波顶高' }}
        </button>
      </div>

      <div class="rd-block">
        <div class="vol-section">高度带裁剪</div>
        <div class="vol-row">
          <span class="vol-label">启用</span>
          <button class="vol-switch" :class="{ 'is-on': band.enabled }" @click="toggleBand"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">下界</span>
          <input type="range" min="0" max="100" step="1" v-model.number="band.min" @input="onBand" />
          <span class="vol-value">{{ band.min }}%</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">上界</span>
          <input type="range" min="0" max="100" step="1" v-model.number="band.max" @input="onBand" />
          <span class="vol-value">{{ band.max }}%</span>
        </div>
        <div class="rd-hint">上界对应回波顶高，向上截去无回波体元素</div>
      </div>

      <div class="rd-block">
        <div class="vol-section">对流形态</div>
        <div class="vol-row">
          <span class="vol-label">对流单体数</span>
          <input type="range" min="2" max="12" step="1" v-model.number="form.cells" @change="applyForm" />
          <span class="vol-value">{{ form.cells }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">风移速度</span>
          <input type="range" min="0" max="1.2" step="0.05" v-model.number="form.wind" @change="applyForm" />
          <span class="vol-value">{{ form.wind.toFixed(2) }}</span>
        </div>
      </div>

      <div class="rd-block">
        <div class="vol-section">时间轴</div>
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
          <span class="vol-value">{{ scene.ui.timeStep + 1 }}/{{ spec.timeSteps }} min</span>
        </div>
        <button class="rd-analyze ghost" @click="scene.togglePlay()">
          {{ scene.ui.playing ? '暂停回放' : '自动播放' }}
        </button>
      </div>

      <div class="rd-block">
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

      <div class="rd-block">
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
      <button class="vol-action" @click="scene.engine.value?.rebuild()">重新生成</button>
      <button class="vol-action ghost" @click="scene.engine.value?.resetCamera(1)">恢复视图</button>
    </template>
  </VolumeShell>
</template>

<style scoped>
.rd-block {
  margin-bottom: 10px;
}
.rd-tiers {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  margin-bottom: 4px;
}
.rd-tier-btn {
  padding: 5px 0;
  border: 1px solid rgba(157, 188, 224, 0.5);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #cfe0f2;
  font-size: 10px;
  cursor: pointer;
}
.rd-tier-btn:hover {
  background: rgba(47, 128, 237, 0.28);
  color: #fff;
}
.rd-analyze {
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
.rd-analyze.ghost {
  background: rgba(47, 128, 237, 0.18);
  border: 1px solid rgba(47, 128, 237, 0.7);
  color: #9fd8ff;
}
.rd-analyze:disabled {
  opacity: 0.5;
  cursor: default;
}
.rd-hint {
  margin-top: 4px;
  font-size: 9px;
  line-height: 1.5;
  color: #7f96b3;
}
.rd-tier {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 10px;
  color: #c3d5e8;
}
.rd-tier i {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.rd-tier span {
  flex: 1 1 auto;
}
.rd-tier b {
  color: #65d3eb;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.rd-cores {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
}
.rd-cores-title {
  font-size: 10px;
  font-weight: 700;
  color: #65d3eb;
  margin-bottom: 4px;
}
.rd-core {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: #c3d5e8;
  margin-top: 3px;
}
.rd-core span {
  flex: 1 1 auto;
}
.rd-core b {
  color: #ff8f5e;
  font-variant-numeric: tabular-nums;
}
.rd-core em {
  color: #9fb8d4;
  font-style: normal;
  font-variant-numeric: tabular-nums;
}
</style>
