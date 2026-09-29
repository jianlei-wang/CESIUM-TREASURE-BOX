<script setup lang="ts">
/**
 * 三维 PM2.5 浓度体 —— 场景化 UI
 *
 * 面向大气污染分析的三维浓度体工作台：污染物切换、AQI 超标体积分析、
 * 高度层水平切面、地面监测站叠加与暴露人口估算。
 */
import { computed, reactive, ref, watch } from 'vue'
import { Color } from 'cesium'
import VolumeShell from '../../lib/volume-engine/VolumeShell.vue'
import { useVolumeScene } from '../../lib/volume-engine/useVolumeScene'
import { SCENES } from '../../lib/volume-engine/scenes'
import { buildTransferLut, gradientCss } from '../../lib/volume-engine/palette'
import type { StationsResult } from '../../lib/volume-engine/VolumeEngine'
import type { PickedView, StatItem } from '../../lib/volume-engine/types'

type PmAnalysis = {
  count: number
  total: number
  min: number
  max: number
  mean: number
  p50: number
  p95: number
  threshold: number
  above: number
  exceedFraction: number
  classHist: Float32Array
  exposed: number
  exposedFraction: number
}

const spec = SCENES.pm25
const panelOpen = ref(true)

const AQI_TIERS = [
  { label: '优', range: '0 ~ 35', color: '#00e400' },
  { label: '良', range: '35 ~ 75', color: '#ffff00' },
  { label: '轻度', range: '75 ~ 115', color: '#ff7e00' },
  { label: '中度', range: '115 ~ 150', color: '#ff0000' },
  { label: '重度', range: '150 ~ 250', color: '#8f3f97' },
  { label: '严重', range: '≥ 250', color: '#7e0023' }
]
const BREAKPOINTS = [35, 75, 115, 150, 250]

const form = reactive({
  sources: spec.params.sources as number,
  windDir: spec.params.windDir as number,
  blh: spec.params.blh as number,
  threshold: 75,
  popDensity: 1600,
  areaKm2: 1600
})
const layer = reactive({ enabled: true, height: 55 })
const stationsOn = ref(true)
const stationCount = ref(0)
const analysis = ref<PmAnalysis | null>(null)
const busy = ref(false)

const scene = useVolumeScene(spec, {
  onStations: (result: StationsResult, engine) => {
    stationCount.value = result.values.length
    const lut = buildTransferLut('aqi', { alphaFloor: 0.25, alphaGamma: 0.7 })
    engine.addSurfacePoints(result.positions, (i) => {
      const t = Math.min(1, result.values[i] / 300)
      const idx = Math.round(t * 255)
      return new Color(lut[idx * 4] / 255, lut[idx * 4 + 1] / 255, lut[idx * 4 + 2] / 255, 0.95)
    })
    engine.setSurfacePointsVisible(stationsOn.value)
    void runAnalysis(engine)
  }
})
const { container, sliceCanvas } = scene

async function runAnalysis(engine = scene.engine.value): Promise<void> {
  if (!engine) return
  busy.value = true
  try {
    const result = await engine.analyze<PmAnalysis>({
      mode: 'pm25',
      res: 40,
      threshold: form.threshold,
      popDensity: form.popDensity,
      areaKm2: form.areaKm2
    })
    analysis.value = result ?? null
  } finally {
    busy.value = false
  }
}

function applyForm(): void {
  scene.engine.value?.setParams({ sources: form.sources, windDir: form.windDir, blh: form.blh })
}

function onLayer(): void {
  scene.setHorizontalLayer(layer.height, layer.enabled)
}

function toggleLayer(): void {
  layer.enabled = !layer.enabled
  onLayer()
}

function toggleStations(): void {
  stationsOn.value = !stationsOn.value
  scene.engine.value?.setSurfacePointsVisible(stationsOn.value)
}

function onChannel(key: string): void {
  scene.setChannel(key)
  void runAnalysis()
}

watch(
  () => scene.ui.timeStep,
  () => {
    if (analysis.value) void runAnalysis()
  }
)

const exceedStats = computed<StatItem[]>(() => {
  const a = analysis.value
  if (!a) return []
  const unit = scene.active().unit
  return [
    { label: '区域均值', value: `${a.mean.toFixed(0)} ${unit}` },
    { label: 'P95 浓度', value: `${a.p95.toFixed(0)} ${unit}` },
    { label: '峰值浓度', value: `${a.max.toFixed(0)} ${unit}` },
    { label: '超标体积占比', value: `${(a.exceedFraction * 100).toFixed(1)} %` },
    { label: '受影响面积', value: `${(a.exposedFraction * 16).toFixed(2)} km²` },
    { label: '暴露人口估算', value: `${(a.exposed / 1000).toFixed(1)} 千人` }
  ]
})

const classBars = computed(() => {
  const a = analysis.value
  if (!a || !a.count) return []
  return AQI_TIERS.map((tier, i) => ({
    ...tier,
    ratio: a.classHist[i] / a.count
  }))
})

const legendCss = computed(() => gradientCss('aqi'))

const stats = computed<StatItem[]>(() => {
  const items: StatItem[] = [
    { label: '等效分辨率', value: scene.engine.value ? `${scene.engine.value.fullDims}³` : '—' },
    { label: '已加载瓦片', value: scene.stats.tilesReady.toLocaleString() },
    { label: '监测站点', value: `${stationCount.value} 个` }
  ]
  if (analysis.value) items.push({ label: '超标阈值', value: `${analysis.value.threshold} µg/m³` })
  return items
})

const clipRows = computed<StatItem[]>(() => [
  { label: '切面类型', value: '水平层' },
  { label: '切面高度', value: `${layer.height}%` },
  { label: '方位角', value: `${scene.ui.azimuth}°` },
  { label: '偏移', value: `${scene.ui.offset}%` }
])

const pickedView = computed<PickedView | null>(() => {
  const p = scene.picked.value
  if (!p) return null
  if (!p.valid) return { title: '浓度拾取', rows: [], empty: '该处为空体元素 / 无数据' }
  const ch = scene.active()
  const rows: StatItem[] = [{ label: ch.label, value: `${p.value.toFixed(0)} ${ch.unit}` }]
  if (p.lon !== undefined && p.lat !== undefined) {
    rows.push({ label: '经度 / 纬度', value: `${p.lon.toFixed(3)}, ${p.lat.toFixed(3)}` })
    rows.push({ label: '高度', value: `${(p.height ?? 0).toFixed(0)} m` })
  }
  return { title: '浓度拾取', rows }
})
</script>

<template>
  <VolumeShell
    title="三维 PM2.5 浓度体"
    :status="scene.status.value"
    :panel-open="panelOpen"
    :legend-css="legendCss"
    legend-min="0"
    legend-max="300+ µg/m³"
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
      <div class="pm-tier" v-for="tier in AQI_TIERS" :key="tier.label">
        <i :style="{ background: tier.color }"></i>
        <span>{{ tier.label }}</span>
        <b>{{ tier.range }}</b>
      </div>
      <div v-if="classBars.length" class="pm-bars">
        <div class="pm-bars-title">垂直分级体积占比</div>
        <div class="pm-bar" v-for="bar in classBars" :key="bar.label">
          <span>{{ bar.label }}</span>
          <div class="pm-bar-track"><i :style="{ width: `${(bar.ratio * 100).toFixed(1)}%`, background: bar.color }"></i></div>
          <em>{{ (bar.ratio * 100).toFixed(0) }}%</em>
        </div>
      </div>
    </template>

    <template #controls>
      <div class="pm-block">
        <div class="vol-section">污染物指标</div>
        <div class="pm-seg">
          <button
            v-for="ch in spec.channels"
            :key="ch.key"
            type="button"
            class="pm-seg-btn"
            :class="{ active: scene.ui.channel === ch.key }"
            @click="onChannel(ch.key)"
          >
            {{ ch.label }}
          </button>
        </div>
      </div>

      <div class="pm-block">
        <div class="vol-section">AQI 超标分析</div>
        <div class="pm-breakpoints">
          <button
            v-for="b in BREAKPOINTS"
            :key="b"
            type="button"
            class="vol-chip"
            :class="{ active: form.threshold === b }"
            @click="form.threshold = b; runAnalysis()"
          >
            ≥{{ b }}
          </button>
        </div>
        <div class="vol-row">
          <span class="vol-label">人口密度</span>
          <input type="range" min="200" max="6000" step="100" v-model.number="form.popDensity" @change="runAnalysis()" />
          <span class="vol-value">{{ form.popDensity }}/km²</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">评估面积</span>
          <input type="range" min="400" max="4000" step="100" v-model.number="form.areaKm2" @change="runAnalysis()" />
          <span class="vol-value">{{ form.areaKm2 }} km²</span>
        </div>
        <div v-if="exceedStats.length" class="pm-stat-grid">
          <div v-for="row in exceedStats" :key="row.label" class="pm-stat-cell">
            <span>{{ row.label }}</span>
            <b>{{ row.value }}</b>
          </div>
        </div>
        <button class="pm-btn" :disabled="busy" @click="runAnalysis()">
          {{ busy ? '分析中…' : '重新分析超标体积' }}
        </button>
      </div>

      <div class="pm-block">
        <div class="vol-section">高度层水平切面</div>
        <div class="vol-row">
          <span class="vol-label">启用水平层</span>
          <button class="vol-switch" :class="{ 'is-on': layer.enabled }" @click="toggleLayer"><span></span></button>
        </div>
        <div class="vol-row">
          <span class="vol-label">切面高度</span>
          <input type="range" min="2" max="98" step="1" v-model.number="layer.height" @input="onLayer" />
          <span class="vol-value">{{ layer.height }}%</span>
        </div>
        <div class="pm-hint">用于查看边界层内某高度的水平浓度分布</div>
      </div>

      <div class="pm-block">
        <div class="vol-section">污染源 / 气象</div>
        <div class="vol-row">
          <span class="vol-label">污染源数量</span>
          <input type="range" min="1" max="10" step="1" v-model.number="form.sources" @change="applyForm" />
          <span class="vol-value">{{ form.sources }}</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">风向</span>
          <input type="range" min="0" max="359" step="1" v-model.number="form.windDir" @change="applyForm" />
          <span class="vol-value">{{ form.windDir }}°</span>
        </div>
        <div class="vol-row">
          <span class="vol-label">边界层高度</span>
          <input type="range" min="0.1" max="0.6" step="0.01" v-model.number="form.blh" @change="applyForm" />
          <span class="vol-value">{{ (form.blh * 1.5).toFixed(2) }} km</span>
        </div>
      </div>

      <div class="pm-block">
        <div class="vol-section">地面监测</div>
        <div class="vol-row">
          <span class="vol-label">显示监测点</span>
          <button class="vol-switch" :class="{ 'is-on': stationsOn }" @click="toggleStations"><span></span></button>
        </div>
      </div>

      <div class="pm-block">
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
          <span class="vol-value">{{ scene.ui.timeStep + 1 }}/{{ spec.timeSteps }} h</span>
        </div>
        <button class="pm-btn ghost" @click="scene.togglePlay()">
          {{ scene.ui.playing ? '暂停回放' : '自动播放' }}
        </button>
      </div>

      <div class="pm-block">
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
.pm-block {
  margin-bottom: 10px;
}
.pm-seg {
  display: flex;
  gap: 4px;
}
.pm-seg-btn {
  flex: 1 1 0;
  padding: 6px 0;
  border: 1px solid rgba(157, 188, 224, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  color: #b9d2ea;
  font-size: 10px;
  cursor: pointer;
}
.pm-seg-btn.active {
  border-color: #2f80ed;
  background: #2f80ed;
  color: #fff;
  font-weight: 600;
}
.pm-breakpoints {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}
.pm-breakpoints .vol-chip {
  flex: 1 1 28%;
}
.pm-stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin-top: 6px;
}
.pm-stat-cell {
  padding: 5px 6px;
  border: 1px solid rgba(157, 188, 224, 0.22);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.04);
}
.pm-stat-cell span {
  display: block;
  font-size: 9px;
  color: #8ea5c2;
}
.pm-stat-cell b {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: #65d3eb;
  font-variant-numeric: tabular-nums;
}
.pm-btn {
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
.pm-btn.ghost {
  background: rgba(47, 128, 237, 0.18);
  border: 1px solid rgba(47, 128, 237, 0.7);
  color: #9fd8ff;
}
.pm-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.pm-hint {
  margin-top: 4px;
  font-size: 9px;
  line-height: 1.5;
  color: #7f96b3;
}
.pm-tier {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 10px;
  color: #c3d5e8;
}
.pm-tier i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.pm-tier span {
  flex: 1 1 auto;
}
.pm-tier b {
  color: #65d3eb;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.pm-bars {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed rgba(157, 188, 224, 0.3);
}
.pm-bars-title {
  font-size: 10px;
  font-weight: 700;
  color: #65d3eb;
  margin-bottom: 4px;
}
.pm-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 9px;
  color: #c3d5e8;
  margin-top: 3px;
}
.pm-bar span {
  flex: 0 0 30px;
}
.pm-bar-track {
  flex: 1 1 auto;
  height: 7px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.pm-bar-track i {
  display: block;
  height: 100%;
}
.pm-bar em {
  flex: 0 0 30px;
  text-align: right;
  font-style: normal;
  color: #9fb8d4;
  font-variant-numeric: tabular-nums;
}
</style>
