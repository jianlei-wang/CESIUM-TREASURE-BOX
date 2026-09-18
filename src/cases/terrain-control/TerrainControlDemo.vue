<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  EllipsoidTerrainProvider,
  type TerrainProvider,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  loadWorldTerrain,
  type SceneCallbacks
} from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const terrainVisible = ref(true)
const exaggeration = ref(1)
const statusMessage = ref('正在加载 Bing 地图…')
let viewer: Viewer | undefined
let worldTerrain: TerrainProvider | undefined
let disposed = false

function updateTerrainVisibility(): void {
  if (!viewer || !worldTerrain) return
  viewer.terrainProvider = terrainVisible.value ? worldTerrain : new EllipsoidTerrainProvider()
  viewer.scene.requestRender()
}

function updateExaggeration(): void {
  if (!viewer) return
  viewer.scene.verticalExaggeration = exaggeration.value
  viewer.scene.requestRender()
}

watch(terrainVisible, updateTerrainVisibility)
watch(exaggeration, updateExaggeration)

async function mountScene(): Promise<void> {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }

  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.globe.maximumScreenSpaceError = 2
    viewer.scene.verticalExaggeration = exaggeration.value
    statusMessage.value = '正在加载Cesium World Terrain...'
    worldTerrain = await loadWorldTerrain(viewer)
    if (disposed || !viewer || viewer.isDestroyed()) return
    viewer.terrainProvider = worldTerrain
    viewer.camera.flyHome(1.2)
    statusMessage.value = ''
  } catch (error) {
    if (!disposed) {
      statusMessage.value = error instanceof Error ? error.message : String(error)
    }
  }
}

onMounted(() => {
  void mountScene()
})

onBeforeUnmount(() => {
  disposed = true
  worldTerrain = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="terrain-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="terrain-panel">
      <div class="panel-title">地形控制</div>
      <div class="toggle-row">
        <span class="toggle-label">显示地形</span>
        <button class="toggle" :class="{ on: terrainVisible }" :aria-label="terrainVisible ? '隐藏地形' : '显示地形'" @click="terrainVisible = !terrainVisible">
          <i></i>
        </button>
      </div>
      <div class="param-row">
        <span class="param-label">夸张</span>
        <input v-model.number="exaggeration" class="param-slider" type="range" min="1" max="5" step="0.1" />
        <span class="param-value">{{ exaggeration.toFixed(1) }}x</span>
      </div>
      <div class="hint">地形加载完成后，可拖动地图观察山地起伏。</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.terrain-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #172c3c; }
.cesium-container { width: 100%; height: 100%; }
.terrain-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 10px; width: 236px; padding: 11px; border: 1px solid rgba(163, 204, 222, 0.25); border-radius: 9px; background: rgba(13, 34, 49, 0.84); backdrop-filter: blur(6px); color: #deeff5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; }.toggle-label, .param-label { font-size: 11px; color: #c3dce5; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(163, 204, 222, 0.35); cursor: pointer; }.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }.toggle.on { background: #5795ae; }.toggle.on i { transform: translateX(18px); }
.param-row { display: flex; align-items: center; gap: 8px; }.param-label { flex: 0 0 38px; }.param-slider { flex: 1; min-width: 0; height: 4px; accent-color: #79b7cd; }.param-value { flex: 0 0 34px; color: #9fc2cf; font-size: 10px; text-align: right; }.hint { color: #8eacb8; font-size: 10px; line-height: 1.4; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
