<script setup lang="ts">
/**
 * 三维风场向量体
 *
 * 底座由 VolumeCase 驱动（SceneSpec = SCENES.wind）；此处补充风场领域交互：
 * 基础风速与涡旋数量调节（重建向量场），以及蒲福式风速分级图例。
 */
import { reactive } from 'vue'
import VolumeCase from '../../lib/volume-engine/VolumeCase.vue'
import { SCENES } from '../../lib/volume-engine/scenes'
import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'

const spec = SCENES.wind
const params = reactive({ baseSpeed: spec.params.baseSpeed, vortices: spec.params.vortices })

const TIERS = [
  { label: '和风', range: '0 ~ 5 m/s', color: '#1470c8' },
  { label: '强风', range: '5 ~ 10 m/s', color: '#14c8a0' },
  { label: '疾风', range: '10 ~ 15 m/s', color: '#ffd21e' },
  { label: '大风以上', range: '≥ 15 m/s', color: '#ff5a14' }
]

function apply(engine: VolumeEngine | undefined): void {
  if (!engine) return
  engine.setParams({ baseSpeed: params.baseSpeed, vortices: params.vortices })
}
</script>

<template>
  <VolumeCase :spec="spec">
    <template #extra-controls="{ engine }">
      <div class="vol-section">风场形态参数</div>
      <div class="vol-row">
        <span class="vol-label">基础风速</span>
        <input type="range" min="2" max="18" step="1" v-model.number="params.baseSpeed" @change="apply(engine)" />
        <span class="vol-value">{{ params.baseSpeed }} m/s</span>
      </div>
      <div class="vol-row">
        <span class="vol-label">涡旋数量</span>
        <input type="range" min="0" max="6" step="1" v-model.number="params.vortices" @change="apply(engine)" />
        <span class="vol-value">{{ params.vortices }}</span>
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
