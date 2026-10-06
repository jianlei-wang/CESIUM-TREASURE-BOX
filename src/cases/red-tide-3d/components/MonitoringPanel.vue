<script setup lang="ts">
import { useRedTideStore } from '@rt/stores/red-tide'

const store = useRedTideStore()
</script>

<template>
  <section class="monitoring-panel panel-card">
    <div class="panel-header">
      <span>监测站点</span>
      <span class="panel-code">MONITORING / 05</span>
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
      点击 Cesium 海域中的监测站或下方列表查看实时观测参数。
    </section>

    <section class="control-section">
      <div class="section-title">浮标清单 <span>{{ store.stations.length }} 座</span></div>
      <button
        v-for="station in store.stations"
        :key="station.id"
        type="button"
        class="station-list-item"
        :class="{ active: store.selectedStation?.id === station.id }"
        @click="store.selectedStation = station"
      >
        <span class="station-list-id">{{ station.id }}</span>
        <span class="station-list-name">{{ station.name }}</span>
        <span class="station-list-value">{{ Math.round(station.concentration * 100) }}</span>
      </button>
    </section>

    <section class="mini-stats">
      <div><span>影响体积</span><strong>{{ store.stats.affectedVolumeKm3.toFixed(2) }} km³</strong></div>
      <div><span>影响面积</span><strong>{{ store.stats.affectedAreaKm2.toFixed(1) }} km²</strong></div>
      <div><span>最大影响深度</span><strong>{{ store.stats.affectedDepthM.toFixed(0) }} m</strong></div>
      <div><span>表层峰值</span><strong>{{ (store.stats.surfaceMax * 100).toFixed(1) }}</strong></div>
    </section>
  </section>
</template>
