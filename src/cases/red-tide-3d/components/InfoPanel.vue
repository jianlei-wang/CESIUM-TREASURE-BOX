<script setup lang="ts">
import { useRedTideStore } from '@rt/stores/red-tide'

const store = useRedTideStore()
</script>

<template>
  <aside class="info-panel glass-panel">
    <div class="panel-header">
      <span>监测信息</span>
      <span class="panel-code">OBS / 01</span>
    </div>

    <section v-if="store.selectedStation" class="station-card">
      <div class="station-title">
        <span class="station-icon">●</span>
        <strong>{{ store.selectedStation.name }}</strong>
        <span class="station-id">{{ store.selectedStation.id }}</span>
      </div>
      <div class="station-grid">
        <div><span>Chl-a</span><b>{{ store.selectedStation.chlA }} μg/L</b></div>
        <div><span>赤潮指数</span><b>{{ Math.round(store.selectedStation.concentration * 100) }}</b></div>
        <div><span>温度</span><b>{{ store.selectedStation.temperature }} ℃</b></div>
        <div><span>盐度</span><b>{{ store.selectedStation.salinity }} PSU</b></div>
        <div><span>溶解氧</span><b>{{ store.selectedStation.dissolvedOxygen }} mg/L</b></div>
        <div><span>采样深度</span><b>{{ store.selectedStation.depth }} m</b></div>
      </div>
    </section>

    <section v-else class="empty-card">
      点击 Cesium 海域中的监测站查看实时观测参数。
    </section>

    <section class="science-status">
      <div class="section-title">渲染管线</div>
      <div class="pipeline-line"><i :class="{ ok: store.depthOcclusionSupported }"></i>{{ store.renderPipeline }}</div>
      <div class="pipeline-line small">等值面 {{ Math.round(store.isoValue * 100) }}% · 剖切 {{ store.clipEnabled ? `${store.clipDepth}m` : '关闭' }}</div>
    </section>

    <section class="legend-section">
      <div class="section-title">赤潮浓度图例</div>
      <div class="legend-bar"></div>
      <div class="legend-labels"><span>低</span><span>中</span><span>高</span><span>核心</span></div>
    </section>

    <section class="mini-stats">
      <div><span>影响体积</span><strong>{{ store.stats.affectedVolumeKm3.toFixed(2) }} km³</strong></div>
      <div><span>影响面积</span><strong>{{ store.stats.affectedAreaKm2.toFixed(1) }} km²</strong></div>
      <div><span>最大影响深度</span><strong>{{ store.stats.affectedDepthM.toFixed(0) }} m</strong></div>
      <div><span>表层峰值</span><strong>{{ (store.stats.surfaceMax * 100).toFixed(1) }}</strong></div>
      <div><span>网格</span><strong>{{ store.grid.nx }}×{{ store.grid.ny }}×{{ store.grid.nz }}</strong></div>
      <div><span>时间步长</span><strong>15 min</strong></div>
    </section>
  </aside>
</template>
