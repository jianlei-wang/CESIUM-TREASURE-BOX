<script setup lang="ts">
import { computed } from 'vue'
import { oceanGradientCss } from '../ocean-tsd.palette'

const props = defineProps<{
  paletteId: string
  colorRange: [number, number]
  unit: string
  label: string
}>()

const gradient = computed(() => oceanGradientCss(props.paletteId))
const decimals = computed(() => (Math.abs(props.colorRange[1] - props.colorRange[0]) < 2 ? 2 : 1))
</script>

<template>
  <div class="legend">
    <div class="legend-title">{{ label }}</div>
    <div class="legend-bar" :style="{ background: gradient }"></div>
    <div class="legend-scale">
      <span>{{ colorRange[0].toFixed(decimals) }}</span>
      <span class="unit">{{ unit }}</span>
      <span>{{ colorRange[1].toFixed(decimals) }}</span>
    </div>
  </div>
</template>

<style scoped>
.legend {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.legend-title {
  font-size: 11px;
  color: #cfe5ff;
}
.legend-bar {
  height: 10px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.22);
}
.legend-scale {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #9fb8d4;
  font-variant-numeric: tabular-nums;
}
.legend-scale .unit {
  color: #6f8bab;
}
</style>
