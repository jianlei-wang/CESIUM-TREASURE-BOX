<script setup lang="ts">
import { computed } from 'vue'
import { useRedTideStore } from '@rt/stores/red-tide'

const store = useRedTideStore()

const tickValues = computed(() => {
  const low = Math.min(store.thresholdLow, store.thresholdHigh)
  const high = Math.max(store.thresholdLow, store.thresholdHigh)
  const mid = (low + high) / 2
  return [0, low, mid, high, 1].map((value) => value.toFixed(2))
})

const particleLevels = ['#ffd166', '#ff9b13', '#ff5a1f', '#e02020', '#810023']
</script>

<template>
  <aside class="stage-legend" aria-label="图例">
    <div class="legend-title">图例</div>

    <div class="legend-block">
      <div class="legend-caption">
        <span>赤潮浓度指数</span>
        <strong>等值面阈值 {{ Math.round(store.isoValue * 100) }}%</strong>
      </div>
      <div class="legend-bar"></div>
      <div class="legend-labels">
        <span v-for="(value, index) in tickValues" :key="index">{{ value }}</span>
      </div>
    </div>

    <div class="legend-block">
      <div class="legend-caption"><span>海流粒子强度</span></div>
      <div class="legend-levels">
        <i v-for="(color, index) in particleLevels" :key="color" :style="{ background: color }" :title="`等级 ${index + 1}`"></i>
      </div>
    </div>

    <div class="legend-block">
      <div class="legend-rows">
        <div class="legend-row"><i class="dot dot-iso"></i><span>等值面 · 核心区</span></div>
        <div class="legend-row"><i class="dot dot-section"></i><span>垂向剖面</span></div>
        <div class="legend-row"><i class="dot dot-area"></i><span>研究区边界</span></div>
        <div class="legend-row"><i class="dot dot-station"></i><span>监测浮标</span></div>
      </div>
    </div>
  </aside>
</template>
