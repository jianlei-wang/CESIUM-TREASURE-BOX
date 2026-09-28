<script setup lang="ts">
/**
 * CFD 多物理场体
 *
 * 底座由 VolumeCase 驱动（SceneSpec = SCENES.cfd）；此处补充 CFD 领域交互：
 * 入射风速与热源温度调节（重建多物理场），以及三场量程说明图例。
 */
import { reactive } from 'vue'
import VolumeCase from '../../lib/volume-engine/VolumeCase.vue'
import { SCENES } from '../../lib/volume-engine/scenes'
import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'

const spec = SCENES.cfd
const params = reactive({ inflow: spec.params.inflow, sourceTemp: spec.params.sourceTemp })

const FIELDS = [
  { label: '速度', range: '0 ~ 15 m/s', color: '#ffd21e' },
  { label: '压力', range: '-120 ~ 120 Pa', color: '#8db0fe' },
  { label: '温度', range: '280 ~ 340 K', color: '#f06030' }
]

function apply(engine: VolumeEngine | undefined): void {
  if (!engine) return
  engine.setParams({ inflow: params.inflow, sourceTemp: params.sourceTemp })
}
</script>

<template>
  <VolumeCase :spec="spec">
    <template #extra-controls="{ engine }">
      <div class="vol-section">工况参数</div>
      <div class="vol-row">
        <span class="vol-label">入射风速</span>
        <input type="range" min="2" max="14" step="1" v-model.number="params.inflow" @change="apply(engine)" />
        <span class="vol-value">{{ params.inflow }} m/s</span>
      </div>
      <div class="vol-row">
        <span class="vol-label">热源温度</span>
        <input type="range" min="300" max="340" step="2" v-model.number="params.sourceTemp" @change="apply(engine)" />
        <span class="vol-value">{{ params.sourceTemp }} K</span>
      </div>
    </template>

    <template #extra-legend>
      <div class="vol-tier" v-for="field in FIELDS" :key="field.label">
        <i :style="{ background: field.color }"></i>
        <span>{{ field.label }}</span>
        <b>{{ field.range }}</b>
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
