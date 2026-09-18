<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Viewer } from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const errorMessage = ref('')
const statusMessage = ref('正在加载 Bing 地图…')
let viewer: Viewer | undefined
let disposed = false
let handleUnhandledRejection: ((event: PromiseRejectionEvent) => void) | undefined

const sceneCallbacks: SceneCallbacks = {
  onStatus: (message) => {
    statusMessage.value = message
  },
  onBasemapReady: () => {
    statusMessage.value = ''
  }
}

onMounted(() => {
  if (!container.value) return

  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Cesium Viewer 初始化失败'
  }

  handleUnhandledRejection = (event) => {
    if (disposed || !viewer || viewer.isDestroyed()) return
    event.preventDefault()
    const reason = event.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    statusMessage.value = `影像服务响应异常：${message}`
  }
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
})

onBeforeUnmount(() => {
  disposed = true
  if (handleUnhandledRejection) {
    window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    handleUnhandledRejection = undefined
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="cesium-shell">
    <div ref="container" class="cesium-container"></div>
    <div v-if="errorMessage" class="cesium-error">
      <strong>Cesium 场景初始化失败</strong>
      <span>{{ errorMessage }}</span>
    </div>
    <div v-else-if="statusMessage" class="cesium-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.cesium-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  border-radius: 8px;
  background: #152b4c;
}
.cesium-container {
  width: 100%;
  height: 100%;
}
.cesium-status,
.cesium-error {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  padding: 24px;
  color: #dce8f5;
  background: rgba(8, 21, 40, 0.72);
  font-size: 12px;
}
.cesium-error {
  align-content: center;
  gap: 8px;
  background: rgba(42, 14, 22, 0.82);
}
.cesium-error strong { color: #ff9d9d; font-size: 14px; }
.cesium-error span { overflow-wrap: anywhere; color: #e9baba; }
</style>
