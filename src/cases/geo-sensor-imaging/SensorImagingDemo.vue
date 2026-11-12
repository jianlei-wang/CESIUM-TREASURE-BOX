<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import { Cartesian3, type PostProcessStage, type Viewer } from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import {
  DEFAULT_IMAGING,
  IMAGING_MODES,
  createSensorImagingStage,
  updateSensorImagingStage,
  type ImagingConfig,
  type ImagingMode
} from '../geo-intel-lib/imaging'
import '../geo-intel-lib/panel.css'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载底图…')

const ui = reactive<ImagingConfig>({ ...DEFAULT_IMAGING })
const stage = shallowRef<PostProcessStage | undefined>()
const modes = IMAGING_MODES
const isNormal = computed(() => ui.mode === 'normal')

let viewer: Viewer | undefined
let raf = 0
let startedAt = performance.now()

function currentConfig(): ImagingConfig {
  return {
    enabled: true,
    mode: ui.mode,
    gain: ui.gain,
    noise: ui.noise,
    vignette: ui.vignette,
    scanlines: ui.scanlines,
    bloom: ui.bloom
  }
}

function apply(): void {
  if (!stage.value || !viewer || viewer.isDestroyed()) return
  updateSensorImagingStage(stage.value, currentConfig(), (performance.now() - startedAt) / 1000)
  viewer.scene.requestRender()
}

function tick(): void {
  raf = requestAnimationFrame(tick)
  if (!stage.value || !viewer || viewer.isDestroyed()) return
  stage.value.uniforms.u_time = (performance.now() - startedAt) / 1000
  viewer.scene.requestRender()
}

function setMode(mode: ImagingMode): void {
  ui.mode = mode
  apply()
}

onMounted(() => {
  if (!container.value) return
  const callbacks: SceneCallbacks = {
    onStatus: (m) => {
      statusMessage.value = m
    },
    onBasemapReady: () => {
      statusMessage.value = ''
    }
  }
  try {
    viewer = createMapScene(container.value, callbacks)
    loadBingImagery(viewer, callbacks)
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(121.4901, 31.2397, 3200),
      orientation: { heading: (32 * Math.PI) / 180, pitch: (-52 * Math.PI) / 180, roll: 0 }
    })
    viewer.scene.globe.enableLighting = true
    startedAt = performance.now()
    stage.value = createSensorImagingStage(currentConfig(), 0)
    viewer.scene.postProcessStages.add(stage.value)
    tick()
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  if (stage.value && viewer && !viewer.isDestroyed()) {
    viewer.scene.postProcessStages.remove(stage.value)
  }
  stage.value = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="gi-shell">
    <div ref="container" class="gi-canvas"></div>

    <div class="gi-panel">
      <div class="gi-title">传感器成像</div>

      <div class="gi-section">成像模式</div>
      <div class="mode-grid">
        <button
          v-for="mode in modes"
          :key="mode.id"
          class="mode-btn"
          :class="{ active: ui.mode === mode.id }"
          @click="setMode(mode.id)"
        >
          {{ mode.label }}
        </button>
      </div>

      <div class="gi-section">成像参数</div>
      <div class="gi-row" :class="{ 'is-disabled': isNormal }">
        <span class="gi-label">增益</span>
        <input v-model.number="ui.gain" type="range" min="0.4" max="3.2" step="0.05" :disabled="isNormal" @input="apply" />
        <span class="gi-value">{{ ui.gain.toFixed(2) }}</span>
      </div>
      <div class="gi-row" :class="{ 'is-disabled': isNormal }">
        <span class="gi-label">噪声</span>
        <input v-model.number="ui.noise" type="range" min="0" max="0.25" step="0.005" :disabled="isNormal" @input="apply" />
        <span class="gi-value">{{ ui.noise.toFixed(3) }}</span>
      </div>
      <div class="gi-row" :class="{ 'is-disabled': isNormal }">
        <span class="gi-label">暗角</span>
        <input v-model.number="ui.vignette" type="range" min="0" max="1" step="0.02" :disabled="isNormal" @input="apply" />
        <span class="gi-value">{{ ui.vignette.toFixed(2) }}</span>
      </div>
      <div class="gi-row" :class="{ 'is-disabled': isNormal }">
        <span class="gi-label">扫描线</span>
        <input v-model.number="ui.scanlines" type="range" min="0" max="0.6" step="0.01" :disabled="isNormal" @input="apply" />
        <span class="gi-value">{{ ui.scanlines.toFixed(2) }}</span>
      </div>
      <div class="gi-row" :class="{ 'is-disabled': isNormal }">
        <span class="gi-label">光晕</span>
        <input v-model.number="ui.bloom" type="range" min="0" max="1.2" step="0.02" :disabled="isNormal" @input="apply" />
        <span class="gi-value">{{ ui.bloom.toFixed(2) }}</span>
      </div>

      <p class="gi-hint">
        正常成像模式直接输出原始画面，便于与其他成像风格对照；其余模式基于场景颜色与深度缓冲，天空区域单独压暗，避免整体过曝。
      </p>
    </div>

    <div v-if="statusMessage" class="gi-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.mode-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}

.mode-btn {
  height: 26px;
  border: 1px solid rgba(157, 188, 224, 0.28);
  border-radius: 5px;
  background: #1a2b45;
  color: #c3d5e8;
  font-size: 11px;
  cursor: pointer;
}

.mode-btn.active {
  border-color: #3f9cff;
  background: #1f4b7a;
  color: #eaf4ff;
}

.gi-row.is-disabled {
  opacity: 0.45;
}

.gi-row.is-disabled input {
  cursor: not-allowed;
}
</style>
