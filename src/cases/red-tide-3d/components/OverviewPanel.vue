<script setup lang="ts">
import { computed } from 'vue'
import { useRedTideStore } from '@rt/stores/red-tide'

const store = useRedTideStore()
const displayHours = computed(() => store.elapsedSeconds / 3600)
const totalVolumeKm3 = computed(() => (store.grid.sizeX * store.grid.sizeY * (store.grid.depth + store.grid.surfaceHeight)) / 1e9)
const occupiedFraction = computed(() => totalVolumeKm3.value > 0 ? Math.min(100, store.stats.affectedVolumeKm3 / totalVolumeKm3.value * 100) : 0)
const computeMode = computed(() => store.simulationComputeMode === 'gpu-gpgpu' ? 'GPU GPGPU' : (store.simulationComputeMode === 'shared-array-buffer' ? 'Worker + SAB' : 'Worker + Transfer'))
</script>

<template>
  <section class="overview-panel panel-card">
    <div class="panel-header">
      <span>综合总览</span>
      <span class="panel-code">OVERVIEW / 01</span>
    </div>

    <section class="control-section">
      <div class="section-title">研究区 <span>{{ store.studyArea.id }}</span></div>
      <div class="study-name">{{ store.studyArea.name }}</div>
      <div class="hud-coord">E {{ store.studyArea.center.longitude.toFixed(3) }}° · N {{ store.studyArea.center.latitude.toFixed(3) }}° · 最大深度 {{ store.studyArea.minDepth }} m</div>
      <div class="overview-chips">
        <span>网格 {{ store.grid.nx }}×{{ store.grid.ny }}×{{ store.grid.nz }}</span>
        <span>范围 {{ (store.grid.sizeX / 1000).toFixed(0) }}×{{ (store.grid.sizeY / 1000).toFixed(0) }} km</span>
        <span>步长 15 min</span>
      </div>
    </section>

    <section class="control-section">
      <div class="section-title">核心指标 <span>{{ displayHours.toFixed(1) }} h</span></div>
      <div class="metric-grid">
        <div><span>最大浓度</span><strong>{{ (store.stats.max * 100).toFixed(1) }}</strong></div>
        <div><span>平均浓度</span><strong>{{ (store.stats.mean * 100).toFixed(1) }}</strong></div>
        <div><span>影响面积</span><strong>{{ store.stats.affectedAreaKm2.toFixed(1) }} km²</strong></div>
        <div><span>影响体积</span><strong>{{ store.stats.affectedVolumeKm3.toFixed(2) }} km³</strong></div>
        <div><span>最大影响深度</span><strong>{{ store.stats.affectedDepthM.toFixed(0) }} m</strong></div>
        <div><span>表层峰值</span><strong>{{ (store.stats.surfaceMax * 100).toFixed(1) }}</strong></div>
      </div>
    </section>

    <section class="control-section">
      <div class="section-title">水体占比 <span>{{ occupiedFraction.toFixed(2) }}%</span></div>
      <div class="progress-track"><i :style="{ width: occupiedFraction.toFixed(2) + '%' }"></i></div>
      <div class="hud-coord">受影响水体体积 / 研究区总体积</div>
    </section>

    <section class="control-section compact">
      <div class="section-title">计算与渲染管线</div>
      <div class="compute-status">
        <span>计算线程</span>
        <strong>{{ computeMode }}</strong>
        <em>{{ store.simulationComputeMs.toFixed(1) }} ms / step · 渲染 {{ store.renderGpuMs.toFixed(1) }} ms</em>
      </div>
    </section>
  </section>
</template>
