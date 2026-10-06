<script setup lang="ts">
import { computed } from 'vue'
import { SIMULATION_MAX_HOURS, useRedTideStore } from '@rt/stores/red-tide'

const store = useRedTideStore()
const totalVolumeKm3 = computed(() => (store.grid.sizeX * store.grid.sizeY * (store.grid.depth + store.grid.surfaceHeight)) / 1e9)
const occupiedFraction = computed(() => totalVolumeKm3.value > 0 ? Math.min(100, store.stats.affectedVolumeKm3 / totalVolumeKm3.value * 100) : 0)
const history = computed(() => store.metricsHistory.slice(-48))

const maxRange = computed(() => Math.max(1, ...history.value.map((item) => item.max)))
const areaRange = computed(() => Math.max(1, ...history.value.map((item) => item.areaKm2)))

function sparkline(values: number[], maxValue: number, width = 240, height = 42): string {
  if (values.length === 0) return ''
  if (values.length === 1) return `0,${height * 0.5} ${width},${height * (1 - values[0] / maxValue)}`
  return values.map((value, index) => {
    const x = index / (values.length - 1) * width
    const y = height - (value / maxValue) * height
    return `${x.toFixed(1)},${Math.max(1, Math.min(height - 1, y)).toFixed(1)}`
  }).join(' ')
}

const maxSparkline = computed(() => sparkline(history.value.map((item) => item.max), maxRange.value))
const areaSparkline = computed(() => sparkline(history.value.map((item) => item.areaKm2), areaRange.value))
const latestDelta = computed(() => {
  const items = history.value
  if (items.length < 2) return 0
  const previous = items[items.length - 2].max
  return previous > 0 ? (store.stats.max - previous) / previous * 100 : 0
})
</script>

<template>
  <section class="analysis-panel panel-card">
    <div class="panel-header">
      <span>科研分析</span>
      <span class="panel-code">ANALYSIS / 04</span>
    </div>

    <div class="science-model-line">
      <span class="science-led"></span>
      <span>Eulerian Advection–Diffusion–Growth</span>
      <b>{{ store.simulationComputeMode === 'gpu-gpgpu' ? 'GPU' : 'CPU FALLBACK' }}</b>
    </div>

    <div class="science-chart-card">
      <div class="science-chart-head">
        <span>最大浓度演化</span>
        <strong>{{ (store.stats.max * 100).toFixed(1) }}</strong>
      </div>
      <svg viewBox="0 0 240 42" preserveAspectRatio="none" aria-label="最大浓度趋势">
        <polyline :points="maxSparkline" fill="none" stroke="rgba(255,104,44,.95)" stroke-width="2" />
        <line x1="0" x2="240" y1="39" y2="39" stroke="rgba(160,220,235,.10)" />
      </svg>
      <div class="science-chart-foot"><span>0 h</span><span>{{ SIMULATION_MAX_HOURS }} h</span><em :class="{ down: latestDelta < 0 }">{{ latestDelta >= 0 ? '+' : '' }}{{ latestDelta.toFixed(1) }}%</em></div>
    </div>

    <div class="science-chart-card">
      <div class="science-chart-head">
        <span>影响面积演化</span>
        <strong>{{ store.stats.affectedAreaKm2.toFixed(1) }} km²</strong>
      </div>
      <svg viewBox="0 0 240 42" preserveAspectRatio="none" aria-label="影响面积趋势">
        <polyline :points="areaSparkline" fill="none" stroke="rgba(90,232,218,.95)" stroke-width="2" />
        <line x1="0" x2="240" y1="39" y2="39" stroke="rgba(160,220,235,.10)" />
      </svg>
      <div class="science-chart-foot"><span>历史/当前</span><span>{{ history.length }} samples</span><em>阈值 {{ Math.round(store.thresholdLow * 100) }}%</em></div>
    </div>

    <div class="science-grid">
      <div><span>有效体积分数</span><strong>{{ occupiedFraction.toFixed(2) }}%</strong></div>
      <div><span>最大影响深度</span><strong>{{ store.stats.affectedDepthM.toFixed(0) }} m</strong></div>
      <div><span>表层峰值</span><strong>{{ (store.stats.surfaceMax * 100).toFixed(1) }}</strong></div>
      <div><span>积分体积</span><strong>{{ store.stats.affectedVolumeKm3.toFixed(2) }} km³</strong></div>
    </div>

    <div class="scientific-note">
      <b>表达规则</b>
      <span>颜色：浓度分级 · 等值面：核心区 · 剖切：垂向结构 · 粒子：输运方向 · 深度：地形遮挡</span>
    </div>
  </section>
</template>
