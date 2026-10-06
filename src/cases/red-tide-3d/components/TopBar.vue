<script setup lang="ts">
import { computed } from 'vue'
import { RED_TIDE_MODULES, useRedTideStore } from '@rt/stores/red-tide'

const props = defineProps<{ fps: number }>()

const store = useRedTideStore()
const computeMode = computed(() => store.simulationComputeMode === 'gpu-gpgpu' ? 'GPU GPGPU' : (store.simulationComputeMode === 'shared-array-buffer' ? 'Worker + SAB' : 'Worker + Transfer'))
const dateText = computed(() => {
  const date = new Date('2026-06-15T00:00:00Z')
  date.setUTCSeconds(store.elapsedSeconds)
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
})
</script>

<template>
  <header class="topbar glass-panel">
    <div class="brand">
      <span class="brand-mark">RT</span>
      <div class="brand-copy">
        <div class="brand-title">赤潮监测三维模拟仿真系统</div>
        <div class="brand-subtitle">FRONTEND SCIENTIFIC DIGITAL OCEAN</div>
      </div>
    </div>

    <nav class="system-nav" aria-label="系统一级菜单">
      <button
        v-for="module in RED_TIDE_MODULES"
        :key="module.id"
        type="button"
        class="nav-item"
        :class="{ active: store.activeModule === module.id }"
        @click="store.activeModule = module.id"
      >
        <span class="nav-code">{{ module.code }}</span>
        <span class="nav-text">{{ module.label }}</span>
        <span class="nav-en">{{ module.en }}</span>
      </button>
    </nav>

    <div class="top-status">
      <span class="status-pill">{{ dateText }}</span>
      <span class="status-pill">{{ props.fps }} FPS</span>
      <span class="status-pill"><i class="status-dot"></i>{{ computeMode }}</span>
      <span class="status-pill">{{ store.depthOcclusionSupported ? '深度遮挡 ON' : '深度遮挡 FALLBACK' }}</span>
    </div>
  </header>
</template>
