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
import { SANDSTORM_FRAGMENT } from '../../lib/weather'

const container = ref<HTMLElement | null>(null)
const enabled = ref(true)
const density = ref(1)
const haze = ref(0.55)
const wind = ref(0.4)
const speed = ref(2)
const tint = ref(0.65)
const darken = ref(0.45)
const statusMessage = ref('正在加载 Bing 地图…')
let viewer: Viewer | undefined
let stage: PostProcessStage | undefined
let removePostUpdate: (() => void) | undefined
let elapsed = 0
let lastFrameTime = 0

function updateStage(): void {
  if (!stage) return
  stage.enabled = enabled.value
  stage.uniforms.density = density.value
  stage.uniforms.haze = haze.value
  stage.uniforms.wind = wind.value
  stage.uniforms.speed = speed.value
  stage.uniforms.tint = tint.value
  stage.uniforms.darken = darken.value
}

watch([enabled, density, haze, wind, speed, tint, darken], updateStage)

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
      fragmentShader: SANDSTORM_FRAGMENT,
      uniforms: {
        time: 0,
        density: density.value,
        haze: haze.value,
        wind: wind.value,
        speed: speed.value,
        tint: tint.value,
        darken: darken.value
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
  <div class="sandstorm-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="sandstorm-panel">
      <div class="panel-title">沙尘暴效果</div>
      <div class="toggle-row">
        <span class="toggle-label">效果开关</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '关闭沙尘暴' : '开启沙尘暴'" @click="enabled = !enabled">
          <i></i>
        </button>
      </div>
      <div class="param-row">
        <span class="param-label">浓度</span>
        <input v-model.number="density" class="param-slider" type="range" min="0.2" max="3" step="0.1" />
        <span class="param-value">{{ density.toFixed(1) }}</span>
      </div>
      <div class="param-row">
        <span class="param-label">雾障</span>
        <input v-model.number="haze" class="param-slider" type="range" min="0" max="1" step="0.05" />
        <span class="param-value">{{ haze.toFixed(2) }}</span>
      </div>
      <div class="param-row">
        <span class="param-label">风向</span>
        <input v-model.number="wind" class="param-slider" type="range" min="-0.9" max="0.9" step="0.05" />
        <span class="param-value">{{ wind.toFixed(2) }}</span>
      </div>
      <div class="param-row">
        <span class="param-label">风速</span>
        <input v-model.number="speed" class="param-slider" type="range" min="0.5" max="8" step="0.1" />
        <span class="param-value">{{ speed.toFixed(1) }}</span>
      </div>
      <div class="param-row">
        <span class="param-label">沙黄</span>
        <input v-model.number="tint" class="param-slider" type="range" min="0" max="1" step="0.05" />
        <span class="param-value">{{ tint.toFixed(2) }}</span>
      </div>
      <div class="param-row">
        <span class="param-label">压暗</span>
        <input v-model.number="darken" class="param-slider" type="range" min="0" max="1" step="0.05" />
        <span class="param-value">{{ darken.toFixed(2) }}</span>
      </div>
      <p class="hint">程序化全屏沙尘后处理：沙粒丝、滚动卷尘与沙黄偏色均由着色器实时生成，沙尘浓度/雾障/风向/风速均可调。</p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.sandstorm-shell {
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
.sandstorm-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 9px;
  width: 236px;
  padding: 11px;
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.8);
  border: 1px solid rgba(157, 188, 224, 0.22);
  backdrop-filter: blur(6px);
  color: #dce8f5;
}
.panel-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.toggle-label {
  font-size: 11px;
  color: #c4d3e8;
}
.toggle {
  width: 36px;
  height: 18px;
  padding: 0;
  border-radius: 999px;
  border: 0;
  background: rgba(157, 188, 224, 0.35);
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
}
.toggle i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #dce8f5;
  transition: transform 0.2s;
}
.toggle.on {
  background: #2f80ed;
}
.toggle.on i {
  transform: translateX(18px);
}
.param-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.param-label {
  flex: 0 0 38px;
  font-size: 11px;
  color: #c4d3e8;
}
.param-slider {
  flex: 1;
  min-width: 0;
  accent-color: #2f80ed;
  height: 4px;
}
.param-value {
  flex: 0 0 34px;
  text-align: right;
  font-size: 10px;
  color: #8ea5c2;
}
.hint {
  margin: 0;
  font-size: 10px;
  line-height: 1.5;
  color: #8ea5c2;
}
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
