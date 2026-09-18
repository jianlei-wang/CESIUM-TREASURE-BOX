<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Cartesian3, Color, PostProcessStage, type Viewer } from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  loadWorldTerrain,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { FOG_FRAGMENT } from '../../lib/weather'

const container = ref<HTMLElement | null>(null)
const enabled = ref(true)
const density = ref(0.62)
const fogHeight = ref(900)
const brightness = ref(0.9)
const statusMessage = ref('正在加载 Bing 地图…')
const fogColor = Color.fromCssColorString('#ccd2d6')
let viewer: Viewer | undefined
let stage: PostProcessStage | undefined
let disposed = false

function updateStage(): void {
  if (!stage) return
  stage.enabled = enabled.value
}

watch([enabled, density, fogHeight, brightness], updateStage)

async function mountScene(): Promise<void> {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => {
      statusMessage.value = message
    },
    onBasemapReady: () => {
      statusMessage.value = ''
    }
  }

  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.globe.maximumScreenSpaceError = 2
    statusMessage.value = '正在加载Cesium World Terrain...'
    try {
      await loadWorldTerrain(viewer)
    } catch (error) {
      if (!disposed) {
        statusMessage.value = '地形加载失败，正在使用基础地球…'
        console.warn('Cesium World Terrain 加载失败', error)
      }
    }
    if (disposed || !viewer || viewer.isDestroyed()) return

    stage = new PostProcessStage({
      fragmentShader: FOG_FRAGMENT,
      uniforms: {
        u_earthRadiusOnCamera: () => {
          if (!viewer) return 6378137
          return Cartesian3.magnitude(viewer.camera.positionWC) - viewer.camera.positionCartographic.height
        },
        u_cameraHeight: () => viewer?.camera.positionCartographic.height ?? 0,
        u_fogHeight: () => fogHeight.value,
        u_fogColor: () => fogColor,
        u_globalDensity: () => density.value,
        brightness: () => brightness.value
      }
    })
    viewer.scene.postProcessStages.add(stage)
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
  if (viewer && stage) {
    viewer.scene.postProcessStages.remove(stage)
  }
  stage = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="fog-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="fog-panel">
       <div class="panel-title">深度高度雾</div>
      <div class="toggle-row">
        <span class="toggle-label">效果开关</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '关闭雾效' : '开启雾效'" @click="enabled = !enabled">
          <i></i>
        </button>
      </div>
      <div class="param-row">
        <span class="param-label">浓度</span>
        <input v-model.number="density" class="param-slider" type="range" min="0.1" max="1.2" step="0.05" />
        <span class="param-value">{{ density.toFixed(2) }}</span>
      </div>
      <div class="param-row">
        <span class="param-label">高度</span>
        <input v-model.number="fogHeight" class="param-slider" type="range" min="100" max="3000" step="50" />
        <span class="param-value">{{ fogHeight }}m</span>
      </div>
      <div class="param-row">
        <span class="param-label">亮度</span>
        <input v-model.number="brightness" class="param-slider" type="range" min="0.3" max="1.4" step="0.05" />
        <span class="param-value">{{ brightness.toFixed(2) }}</span>
      </div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.fog-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #162a3a; }
.cesium-container { width: 100%; height: 100%; }
.fog-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 9px; width: 236px; padding: 11px; border: 1px solid rgba(173, 200, 215, 0.25); border-radius: 9px; background: rgba(18, 35, 48, 0.82); backdrop-filter: blur(6px); color: #d9e8ee; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; }
.toggle-label, .param-label { font-size: 11px; color: #c4d4dc; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(173, 200, 215, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e2f0f4; transition: transform 0.2s; }
.toggle.on { background: #5d9bb6; }
.toggle.on i { transform: translateX(18px); }
.param-row { display: flex; align-items: center; gap: 8px; }
.param-label { flex: 0 0 38px; }
.param-slider { flex: 1; min-width: 0; height: 4px; accent-color: #79afc3; }
.param-value { flex: 0 0 38px; color: #9bb5c1; font-size: 10px; text-align: right; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
