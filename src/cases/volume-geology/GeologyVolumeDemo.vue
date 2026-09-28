<script setup lang="ts">
/**
 * 三维地层属性体
 *
 * 底座由 VolumeCase 驱动（SceneSpec = SCENES.geology）；此处补充地质领域交互：
 * 地层起伏与侵入体规模调节（重建体数据），以及岩性分类色板图例。
 */
import { reactive } from 'vue'
import VolumeCase from '../../lib/volume-engine/VolumeCase.vue'
import { SCENES } from '../../lib/volume-engine/scenes'
import type { VolumeEngine } from '../../lib/volume-engine/VolumeEngine'

const spec = SCENES.geology
const params = reactive({ undulation: spec.params.undulation, intrusion: spec.params.intrusion })
const categories = spec.categories ?? []

function apply(engine: VolumeEngine | undefined): void {
  if (!engine) return
  engine.setParams({ undulation: params.undulation, intrusion: params.intrusion })
}

function css(code: number): string {
  const hit = categories.find((c) => c.code === code)
  const color = hit ? hit.color : [120, 120, 120]
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`
}
</script>

<template>
  <VolumeCase :spec="spec">
    <template #extra-controls="{ engine }">
      <div class="vol-section">地层构造参数</div>
      <div class="vol-row">
        <span class="vol-label">地层起伏幅度</span>
        <input type="range" min="0" max="0.18" step="0.01" v-model.number="params.undulation" @change="apply(engine)" />
        <span class="vol-value">{{ params.undulation.toFixed(2) }}</span>
      </div>
      <div class="vol-row">
        <span class="vol-label">侵入体规模</span>
        <input type="range" min="0.04" max="0.24" step="0.01" v-model.number="params.intrusion" @change="apply(engine)" />
        <span class="vol-value">{{ params.intrusion.toFixed(2) }}</span>
      </div>
    </template>

    <template #extra-legend>
      <div class="vol-tier" v-for="cat in categories" :key="cat.code">
        <i :style="{ background: css(cat.code) }"></i>
        <span>{{ cat.label }}</span>
        <b>#{{ cat.code }}</b>
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
