<script setup lang="ts">
/**
 * 三维气象雷达回波体
 *
 * 底座由 VolumeCase 驱动（SceneSpec = SCENES.radar）；此处仅补充雷达领域交互：
 * 对流单体数量与风移速度调节，以及 dBZ 分级图例说明。
 */
import { reactive } from 'vue'
import VolumeCase from '../../lib/volume-engine/VolumeCase.vue'
import { SCENES } from '../../lib/volume-engine/scenes'
import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'

const spec = SCENES.radar
const params = reactive({ cells: spec.params.cells, wind: spec.params.wind })

const TIERS = [
  { label: '弱回波', range: '< 20 dBZ', color: '#0d7fe0' },
  { label: '中等回波', range: '20 ~ 35 dBZ', color: '#2ecc40' },
  { label: '强回波', range: '35 ~ 45 dBZ', color: '#ffd21e' },
  { label: '特强回波', range: '≥ 45 dBZ', color: '#ff2a1e' }
]

function apply(engine: VolumeEngine | undefined): void {
  if (!engine) return
  engine.setParams({ cells: params.cells, wind: params.wind })
}
</script>

<template>
  <VolumeCase :spec="spec">
    <template #extra-controls="{ engine }">
      <div class="vol-section">回波形态参数</div>
      <div class="vol-row">
        <span class="vol-label">对流单体数</span>
        <input type="range" min="2" max="12" step="1" v-model.number="params.cells" @change="apply(engine)" />
        <span class="vol-value">{{ params.cells }}</span>
      </div>
      <div class="vol-row">
        <span class="vol-label">风移速度</span>
        <input type="range" min="0" max="1.2" step="0.05" v-model.number="params.wind" @change="apply(engine)" />
        <span class="vol-value">{{ params.wind.toFixed(2) }}</span>
      </div>
    </template>

    <template #extra-legend>
      <div class="vol-tier" v-for="tier in TIERS" :key="tier.label">
        <i :style="{ background: tier.color }"></i>
        <span>{{ tier.label }}</span>
        <b>{{ tier.range }}</b>
      </div>
    </template>
  </VolumeCase>
</template>

<style scoped>
.vol-tier {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 10px;
  color: #c3d5e8;
}
.vol-tier i {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.vol-tier span {
  flex: 1 1 auto;
}
.vol-tier b {
  color: #65d3eb;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
