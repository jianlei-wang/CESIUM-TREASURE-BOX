<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Viewer } from 'cesium'
import { PostProcessStage } from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { LIGHTNING_FRAGMENT } from '../../lib/weather'

const container = ref<HTMLElement | null>(null)
const enabled = ref(true)
const frequency = ref(0.55)
const intensity = ref(1)
const cloudCover = ref(0.75)
const brightness = ref(0.82)
const statusMessage = ref('正在加载 Bing 地图…')
let viewer: Viewer | undefined
let stage: PostProcessStage | undefined
let removePostUpdate: (() => void) | undefined
let elapsed = 0
let lastFrameTime = 0

function updateStage(): void {
  if (!stage) return
  stage.enabled = enabled.value
  stage.uniforms.frequency = frequency.value
  stage.uniforms.intensity = intensity.value
  stage.uniforms.cloudCover = cloudCover.value
  stage.uniforms.brightness = brightness.value
}

watch([enabled, frequency, intensity, cloudCover, brightness], updateStage)

onMounted(() => {
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
    stage = new PostProcessStage({
      fragmentShader: LIGHTNING_FRAGMENT,
      uniforms: {
        time: 0,
        frequency: frequency.value,
        intensity: intensity.value,
        cloudCover: cloudCover.value,
        brightness: brightness.value
      }
    })
    viewer.scene.postProcessStages.add(stage)
    const onPostUpdate = () => {
      if (!stage?.enabled) return
      const now = performance.now()
      if (lastFrameTime > 0) {
        elapsed += Math.min((now - lastFrameTime) / 1000, 0.1)
      }
      lastFrameTime = now
      stage.uniforms.time = elapsed
    }
    viewer.scene.postUpdate.addEventListener(onPostUpdate)
    removePostUpdate = () => viewer?.scene.postUpdate.removeEventListener(onPostUpdate)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  removePostUpdate?.()
  if (viewer && stage) {
    viewer.scene.postProcessStages.remove(stage)
  }
  stage = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="lightning-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="lightning-panel">
      <div class="panel-title">闪电效果</div>
      <div class="toggle-row">
        <span class="toggle-label">效果开关</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '关闭闪电' : '开启闪电'" @click="enabled = !enabled">
          <i></i>
        </button>
      </div>
      <div class="param-row">
        <span class="param-label">频率</span>
        <input v-model.number="frequency" class="param-slider" type="range" min="0.1" max="1" step="0.05" />
        <span class="param-value">{{ frequency.toFixed(2) }}</span>
      </div>
      <div class="param-row">
        <span class="param-label">强度</span>
        <input v-model.number="intensity" class="param-slider" type="range" min="0.2" max="2" step="0.05" />
        <span class="param-value">{{ intensity.toFixed(2) }}</span>
      </div>
      <div class="param-row">
        <span class="param-label">云层</span>
        <input v-model.number="cloudCover" class="param-slider" type="range" min="0.3" max="1" step="0.05" />
        <span class="param-value">{{ cloudCover.toFixed(2) }}</span>
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
.lightning-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #101b34; }
.cesium-container { width: 100%; height: 100%; }
.lightning-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 9px; width: 236px; padding: 11px; border: 1px solid rgba(157, 188, 224, 0.22); border-radius: 9px; background: rgba(10, 26, 52, 0.82); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; }
.toggle-label, .param-label { font-size: 11px; color: #c4d3e8; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #dce8f5; transition: transform 0.2s; }
.toggle.on { background: #6d7cff; }
.toggle.on i { transform: translateX(18px); }
.param-row { display: flex; align-items: center; gap: 8px; }
.param-label { flex: 0 0 38px; }
.param-slider { flex: 1; min-width: 0; height: 4px; accent-color: #7d82ff; }
.param-value { flex: 0 0 34px; color: #8ea5c2; font-size: 10px; text-align: right; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
