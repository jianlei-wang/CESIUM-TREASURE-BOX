<script setup lang="ts">
import { computed } from 'vue'
import { useRedTideStore } from '@rt/stores/red-tide'

const store = useRedTideStore()
const computeMode = computed(() => store.simulationComputeMode === 'gpu-gpgpu' ? 'GPU GPGPU' : (store.simulationComputeMode === 'shared-array-buffer' ? 'Worker + SAB' : 'Worker + Transfer'))
</script>

<template>
  <header class="topbar glass-panel">
    <div class="brand">
      <span class="brand-mark">RT</span>
      <div>
        <div class="brand-title">赤潮监测三维模拟仿真系统</div>
        <div class="brand-subtitle">FRONTEND SCIENTIFIC DIGITAL OCEAN · Cesium 1.144 + Three.js r186</div>
      </div>
    </div>
    <div class="top-status">
      <span class="status-dot"></span>
      前端本地仿真引擎
      <span class="divider"></span>
      {{ computeMode }}
      <span class="divider"></span>
      {{ store.depthOcclusionSupported ? '深度遮挡 ON' : '深度遮挡 FALLBACK' }}
    </div>
  </header>
</template>
