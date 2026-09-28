<script setup lang="ts">
/**
 * 三维 PM2.5 浓度体
 *
 * 底座由 VolumeCase 驱动（SceneSpec = SCENES.pm25）；此处补充环境领域交互：
 * 以浓度着色的地表监测站点叠加与显隐，以及空气质量分级图例。
 */
import { ref } from 'vue'
import { Color } from 'cesium'
import VolumeCase from '../../lib/volume-engine/VolumeCase.vue'
import { SCENES } from '../../lib/volume-engine/scenes'
import { buildTransferLut } from '../../lib/volume-engine/palette'
import type { StationsResult, VolumeEngine } from '../../lib/volume-engine/VolumeEngine'

const spec = SCENES.pm25
const stationsVisible = ref(true)
const stationCount = ref(0)

const AQI_TIERS = [
  { label: '优', range: '0 ~ 35', color: '#00e400' },
  { label: '良', range: '35 ~ 75', color: '#ffff00' },
  { label: '轻度污染', range: '75 ~ 115', color: '#ff7e00' },
  { label: '中度污染', range: '115 ~ 150', color: '#ff0000' },
  { label: '重度污染', range: '150 ~ 250', color: '#8f3f97' },
  { label: '严重污染', range: '≥ 250', color: '#7e0023' }
]

function onStations(result: StationsResult, engine: VolumeEngine): void {
  stationCount.value = result.values.length
  const lut = buildTransferLut('aqi', { alphaFloor: 0.25, alphaGamma: 0.7 })
  engine.addSurfacePoints(result.positions, (i) => {
    const t = Math.min(1, result.values[i] / 300)
    const idx = Math.round(t * 255)
    return new Color(lut[idx * 4] / 255, lut[idx * 4 + 1] / 255, lut[idx * 4 + 2] / 255, 0.95)
  })
  engine.setSurfacePointsVisible(stationsVisible.value)
}

function toggleStations(engine: VolumeEngine | undefined): void {
  if (!engine) return
  stationsVisible.value = !stationsVisible.value
  engine.setSurfacePointsVisible(stationsVisible.value)
}
</script>

<template>
  <VolumeCase :spec="spec" @stations="onStations">
    <template #extra-controls="{ engine }">
      <div class="vol-section">地面监测</div>
      <div class="vol-row">
        <span class="vol-label">显示监测点</span>
        <button class="vol-switch" :class="{ 'is-on': stationsVisible }" @click="toggleStations(engine)"><span></span></button>
      </div>
      <div class="vol-stat">
        <span>监测站点数</span><b>{{ stationCount }}</b>
      </div>
    </template>

    <template #extra-legend>
      <div class="vol-tier" v-for="tier in AQI_TIERS" :key="tier.label">
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
