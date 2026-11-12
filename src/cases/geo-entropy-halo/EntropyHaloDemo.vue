<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { Cartesian3, type PostProcessStage, type Viewer } from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import {
  DEFAULT_HALO,
  createEntropyHaloStage,
  updateEntropyHaloStage,
  type HaloConfig
} from '../geo-intel-lib/entropy'
import '../geo-intel-lib/panel.css'

const container = ref<HTMLElement | null>(null)
const shell = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载底图…')

const ui = reactive({
  ...DEFAULT_HALO,
  tintHex: '#8cdcff'
})

const stage = shallowRef<PostProcessStage | undefined>()
const splitPosition = ref(0.5)
const dragging = ref(false)
const compareEnabled = ref(true)

let viewer: Viewer | undefined

const PRESETS = [
  { id: 'cyan', label: '冷光', hex: '#8cdcff' },
  { id: 'amber', label: '暖光', hex: '#ffc46b' },
  { id: 'green', label: '荧光', hex: '#7dffb0' },
  { id: 'violet', label: '紫光', hex: '#c3a4ff' }
]

const VIEW_PRESETS = [
  { id: 'top', label: '俯视', pitch: -88, height: 5200 },
  { id: 'oblique', label: '斜视', pitch: -46, height: 4200 },
  { id: 'level', label: '平视', pitch: -8, height: 1600 }
]

const activeView = ref('oblique')

function applyView(preset: (typeof VIEW_PRESETS)[number]): void {
  activeView.value = preset.id
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(121.4737, 31.2304, preset.height),
    orientation: { heading: (24 * Math.PI) / 180, pitch: (preset.pitch * Math.PI) / 180, roll: 0 }
  })
  viewer.scene.requestRender()
}

const splitPercent = computed(() => `${(splitPosition.value * 100).toFixed(1)}%`)

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255
  ]
}

function currentConfig(): HaloConfig {
  return {
    enabled: ui.enabled,
    radius: ui.radius,
    gain: ui.gain,
    threshold: ui.threshold,
    tint: hexToRgb(ui.tintHex),
    rimOnly: ui.rimOnly,
    split: compareEnabled.value ? splitPosition.value : 0,
    maskEnabled: compareEnabled.value
  }
}

function apply(): void {
  if (!stage.value || !viewer || viewer.isDestroyed()) return
  updateEntropyHaloStage(stage.value, currentConfig())
  viewer.scene.requestRender()
}

function setSplitFromPointer(clientX: number): void {
  const bounds = shell.value?.getBoundingClientRect()
  if (!bounds || bounds.width <= 0) return
  const position = (clientX - bounds.left) / bounds.width
  splitPosition.value = Math.min(0.98, Math.max(0.02, position))
}

function startDrag(event: PointerEvent): void {
  dragging.value = true
  setSplitFromPointer(event.clientX)
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function moveDrag(event: PointerEvent): void {
  if (dragging.value) setSplitFromPointer(event.clientX)
}

function stopDrag(event: PointerEvent): void {
  dragging.value = false
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
}

watch(splitPosition, apply)
watch(compareEnabled, apply)

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
    // 后处理阶段读取的 depthTexture 只包含被地球写入的深度。未开启该选项时，
    // 俯视视角下整个地表深度保持清屏值 1.0，深度通道完全失效；开启后地形与底图
    // 深度才会写入，俯视、斜视、平视都能取到有效结构信息。
    viewer.scene.globe.depthTestAgainstTerrain = true
    loadBingImagery(viewer, callbacks)
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(121.4737, 31.2304, 4200),
      orientation: { heading: (24 * Math.PI) / 180, pitch: (-46 * Math.PI) / 180, roll: 0 }
    })

    stage.value = createEntropyHaloStage(currentConfig())
    viewer.scene.postProcessStages.add(stage.value)
    apply()
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (stage.value && viewer && !viewer.isDestroyed()) {
    viewer.scene.postProcessStages.remove(stage.value)
  }
  stage.value = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div ref="shell" class="gi-shell">
    <div ref="container" class="gi-canvas"></div>

    <div v-if="compareEnabled" class="split-badge left-badge">左侧 · 原始场景</div>
    <div v-if="compareEnabled" class="split-badge right-badge">右侧 · 结构熵光晕</div>
    <div v-else class="split-badge right-badge">全屏 · 结构熵光晕</div>

    <div v-if="compareEnabled" class="split-divider" :class="{ dragging }" :style="{ left: splitPercent }">
      <span
        class="split-handle"
        :class="{ dragging }"
        role="slider"
        aria-label="调整对比卷帘位置"
        :aria-valuenow="Math.round(splitPosition * 100)"
        aria-valuemin="2"
        aria-valuemax="98"
        tabindex="0"
        @pointerdown.prevent="startDrag"
        @pointermove="moveDrag"
        @pointerup="stopDrag"
        @pointercancel="stopDrag"
        @keydown.left.prevent="splitPosition = Math.max(0.02, splitPosition - 0.01)"
        @keydown.right.prevent="splitPosition = Math.min(0.98, splitPosition + 0.01)"
      >↔</span>
    </div>

    <div class="gi-panel">
      <div class="gi-title">结构熵光晕对比</div>

      <div class="gi-row">
        <span class="gi-label">对比卷帘</span>
        <input v-model="compareEnabled" type="checkbox" />
      </div>
      <div v-if="compareEnabled" class="gi-row">
        <span class="gi-label">分割位置</span>
        <input v-model.number="splitPosition" type="range" min="0.02" max="0.98" step="0.01" />
        <span class="gi-value">{{ Math.round(splitPosition * 100) }}%</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">启用效果</span>
        <input v-model="ui.enabled" type="checkbox" @change="apply" />
      </div>

      <div class="gi-section">检测参数</div>
      <div class="gi-row">
        <span class="gi-label">采样半径</span>
        <input v-model.number="ui.radius" type="range" min="1" max="8" step="0.1" @input="apply" />
        <span class="gi-value">{{ ui.radius.toFixed(1) }}</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">光晕增益</span>
        <input v-model.number="ui.gain" type="range" min="0.2" max="2.6" step="0.05" @input="apply" />
        <span class="gi-value">{{ ui.gain.toFixed(1) }}</span>
      </div>
      <div class="gi-row">
        <span class="gi-label">触发阈值</span>
        <input v-model.number="ui.threshold" type="range" min="1.2" max="6" step="0.1" @input="apply" />
        <span class="gi-value">{{ ui.threshold.toFixed(2) }}</span>
      </div>

      <div class="gi-section">外观</div>
      <div class="gi-row">
        <span class="gi-label">自定义色</span>
        <input v-model="ui.tintHex" type="color" @input="apply" />
      </div>
      <div class="gi-row">
        <span class="gi-label">仅描边</span>
        <input v-model="ui.rimOnly" type="checkbox" @change="apply" />
      </div>

      <div class="gi-section">预设</div>
      <div>
        <button
          v-for="preset in PRESETS"
          :key="preset.id"
          class="gi-button neutral"
          style="display: inline-block; width: auto; margin: 2px 4px 2px 0; padding: 3px 8px"
          @click="ui.tintHex = preset.hex; apply()"
        >
          {{ preset.label }}
        </button>
      </div>

      <div class="gi-section">视角验证</div>
      <div>
        <button
          v-for="preset in VIEW_PRESETS"
          :key="preset.id"
          class="gi-button neutral"
          :class="{ active: activeView === preset.id }"
          style="display: inline-block; width: auto; margin: 2px 4px 2px 0; padding: 3px 8px"
          @click="applyView(preset)"
        >
          {{ preset.label }}
        </button>
      </div>

      <p class="gi-hint">颜色梯度、局部纹理与深度跃变共同构成结构响应，俯视、斜视与平视均可稳定描边。拖动中间滑块对比处理前后差异。</p>
    </div>

    <div v-if="statusMessage" class="gi-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.split-badge {
  position: absolute;
  top: 12px;
  z-index: 9;
  padding: 5px 9px;
  border: 1px solid rgba(235, 249, 255, 0.28);
  border-radius: 4px;
  background: rgba(8, 35, 52, 0.76);
  color: #ecf9ff;
  font-size: 11px;
  pointer-events: none;
}

.left-badge {
  left: 12px;
}

.right-badge {
  right: 276px;
}

.split-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 8;
  width: 2px;
  transform: translateX(-1px);
  background: #f5fbff;
  box-shadow: 0 0 0 1px rgba(10, 41, 57, 0.55);
  pointer-events: none;
}

.split-handle {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  transform: translate(-50%, -50%);
  border: 2px solid #fff;
  border-radius: 50%;
  background: #176b89;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  cursor: ew-resize;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
}

.split-handle.dragging,
.split-divider.dragging .split-handle {
  background: #32a8c8;
  box-shadow: 0 0 0 5px rgba(50, 168, 200, 0.22);
}

@media (max-width: 700px) {
  .split-badge {
    font-size: 10px;
    padding: 4px 6px;
  }

  .right-badge {
    right: 12px;
    top: 40px;
  }
}
</style>
