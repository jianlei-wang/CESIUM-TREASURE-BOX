<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ImageryLayer, Rectangle, SplitDirection, type ImageryProvider, type Viewer } from 'cesium'
import { createMapScene, destroyScene, type SceneCallbacks } from '../../lib/cesium-scene'
import { createBingImageryProvider } from '../../lib/bing'
import { createTiandituImageryProvider, createTiandituLabelProvider } from '../../lib/tianditu'

type ImagerySource = 'bing' | 'tianditu' | 'tianditu-label'
type Side = 'left' | 'right'

const sourceOptions: Array<{ value: ImagerySource; label: string }> = [
  { value: 'bing', label: 'Bing 地图' },
  { value: 'tianditu', label: '天地图影像' },
  { value: 'tianditu-label', label: '天地图影像注记' }
]
const container = ref<HTMLElement | null>(null)
const splitShell = ref<HTMLElement | null>(null)
const leftSource = ref<ImagerySource>('bing')
const rightSource = ref<ImagerySource>('tianditu')
const splitPosition = ref(0.5)
const statusMessage = ref('正在加载影像地图…')
const errorMessage = ref('')
const leftLabel = computed(() => sourceOptions.find((item) => item.value === leftSource.value)?.label ?? '')
const rightLabel = computed(() => sourceOptions.find((item) => item.value === rightSource.value)?.label ?? '')
const dragging = ref(false)

let viewer: Viewer | undefined
let leftLayer: ImageryLayer | undefined
let rightLayer: ImageryLayer | undefined

function createProvider(source: ImagerySource): ImageryProvider {
  if (source === 'bing') return createBingImageryProvider()
  if (source === 'tianditu-label') return createTiandituLabelProvider()
  return createTiandituImageryProvider()
}

function replaceLayer(side: Side, source: ImagerySource): void {
  if (!viewer || viewer.isDestroyed()) return
  const previousLayer = side === 'left' ? leftLayer : rightLayer
  if (previousLayer) viewer.imageryLayers.remove(previousLayer, true)
  const layer = viewer.imageryLayers.addImageryProvider(createProvider(source))
  layer.splitDirection = side === 'left' ? SplitDirection.LEFT : SplitDirection.RIGHT
  if (side === 'left') leftLayer = layer
  else rightLayer = layer
}

function applySplitPosition(): void {
  if (viewer && !viewer.isDestroyed()) {
    const scene = viewer.scene as typeof viewer.scene & { splitPosition: number }
    scene.splitPosition = splitPosition.value
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function setSplitFromPointer(clientX: number): void {
  const bounds = splitShell.value?.getBoundingClientRect()
  if (!bounds || bounds.width <= 0) return
  const position = (clientX - bounds.left) / bounds.width
  splitPosition.value = Math.min(0.98, Math.max(0.02, position))
}

function startHandleDrag(event: PointerEvent): void {
  dragging.value = true
  setSplitFromPointer(event.clientX)
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function moveHandleDrag(event: PointerEvent): void {
  if (dragging.value) setSplitFromPointer(event.clientX)
}

function stopHandleDrag(event: PointerEvent): void {
  dragging.value = false
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
}

watch(leftSource, (source) => {
  try { replaceLayer('left', source); errorMessage.value = '' } catch (error) { errorMessage.value = `左侧影像加载失败：${errorText(error)}` }
})
watch(rightSource, (source) => {
  try { replaceLayer('right', source); errorMessage.value = '' } catch (error) { errorMessage.value = `右侧影像加载失败：${errorText(error)}` }
})
watch(splitPosition, applySplitPosition)

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    replaceLayer('left', leftSource.value)
    replaceLayer('right', rightSource.value)
    applySplitPosition()
    viewer.camera.flyTo({ destination: Rectangle.fromDegrees(112, 28, 120, 36) })
    statusMessage.value = ''
  } catch (error) {
    errorMessage.value = errorText(error)
    statusMessage.value = ''
  }
})

onBeforeUnmount(() => {
  leftLayer = undefined
  rightLayer = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div ref="splitShell" class="split-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="split-divider" :class="{ dragging }" :style="{ left: `${splitPosition * 100}%` }">
      <span
        class="split-handle"
        :class="{ dragging }"
        role="slider"
        aria-label="调整卷帘位置"
        :aria-valuenow="Math.round(splitPosition * 100)"
        aria-valuemin="2"
        aria-valuemax="98"
        tabindex="0"
        @pointerdown.prevent="startHandleDrag"
        @pointermove="moveHandleDrag"
        @pointerup="stopHandleDrag"
        @pointercancel="stopHandleDrag"
        @keydown.left.prevent="splitPosition = Math.max(0.02, splitPosition - 0.01)"
        @keydown.right.prevent="splitPosition = Math.min(0.98, splitPosition + 0.01)"
      >↔</span>
    </div>
    <div class="source-badge left-badge">左侧 · {{ leftLabel }}</div>
    <div class="source-badge right-badge">右侧 · {{ rightLabel }}</div>
    <section class="split-panel" aria-label="卷帘分析控制面板">
      <div class="panel-title">影像卷帘对比</div>
      <label class="select-row"><span>左侧影像</span><select v-model="leftSource"><option v-for="option in sourceOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
      <label class="select-row"><span>右侧影像</span><select v-model="rightSource"><option v-for="option in sourceOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
      <label class="position-row" for="split-position"><span>卷帘位置</span><output>{{ Math.round(splitPosition * 100) }}%</output></label>
      <input id="split-position" v-model.number="splitPosition" class="position-slider" type="range" min="0.02" max="0.98" step="0.01" />
      <p class="panel-help">拖动滑块或使用方向键查看两侧影像差异</p>
      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    </section>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.split-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.split-divider { position: absolute; top: 0; bottom: 0; z-index: 5; width: 2px; transform: translateX(-1px); background: #f5fbff; box-shadow: 0 0 0 1px rgba(10, 41, 57, 0.55); pointer-events: none; }
.split-handle { position: absolute; top: 50%; left: 50%; display: grid; width: 32px; height: 32px; place-items: center; transform: translate(-50%, -50%); border: 2px solid #fff; border-radius: 50%; background: #176b89; color: #fff; font-size: 17px; font-weight: 700; cursor: ew-resize; pointer-events: auto; touch-action: none; user-select: none; }
.split-handle.dragging, .split-divider.dragging .split-handle { background: #32a8c8; box-shadow: 0 0 0 5px rgba(50, 168, 200, 0.22); }
.source-badge { position: absolute; top: 14px; z-index: 4; padding: 5px 8px; border: 1px solid rgba(235, 249, 255, 0.28); border-radius: 4px; background: rgba(8, 35, 52, 0.76); color: #ecf9ff; font-size: 11px; pointer-events: none; }
.left-badge { left: 14px; }.right-badge { right: 14px; }
.split-panel { position: absolute; right: 14px; bottom: 14px; z-index: 10; display: flex; flex-direction: column; gap: 9px; width: 254px; padding: 12px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 8px; background: rgba(8, 32, 49, 0.88); backdrop-filter: blur(7px); color: #e5f6fb; pointer-events: auto; }
.panel-title { font-size: 12px; font-weight: 700; }.select-row, .position-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #bdd9e4; font-size: 11px; }
select { min-width: 145px; height: 26px; padding: 0 6px; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 4px; background: #102f43; color: #e5f6fb; font-size: 11px; }
output { color: #9bd8e9; font-variant-numeric: tabular-nums; }.position-slider { position: relative; z-index: 11; display: block; width: 100%; height: 18px; margin: 0; cursor: ew-resize; accent-color: #52c4e8; pointer-events: auto; touch-action: pan-y; }.panel-help { margin: 0; color: #91b7c5; font-size: 10px; line-height: 1.4; }.error-message { margin: 0; color: #ffb6a9; font-size: 10px; line-height: 1.4; }.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
@media (max-width: 600px) { .split-panel { right: 8px; bottom: 8px; left: 8px; width: auto; }.source-badge { top: 8px; font-size: 10px; }.left-badge { left: 8px; }.right-badge { right: 8px; } }
</style>
