<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Cartesian2, Cartographic, Math as CesiumMath, ScreenSpaceEventType, ScreenSpaceEventHandler, type Viewer } from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { MouseTooltip } from '../measure-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const showTip = ref(true)
const precision = ref(6)
let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let tooltip: MouseTooltip | undefined

function formatCoord(value: number): string {
  return CesiumMath.toDegrees(value).toFixed(precision.value)
}

function onMouseMove(event: { endPosition: Cartesian2 }): void {
  if (!viewer || !tooltip || !showTip.value) return
  const scene = viewer.scene
  let position: ReturnType<typeof scene.pickPosition> | undefined

  if (scene.pickPositionSupported) {
    try {
      position = scene.pickPosition(event.endPosition)
    } catch {
      position = undefined
    }
  }
  if (!position) {
    const ray = viewer.camera.getPickRay(event.endPosition)
    if (ray) position = scene.globe.pick(ray, scene)
  }
  if (!position) {
    position = viewer.camera.pickEllipsoid(event.endPosition)
  }

  if (!position) {
    tooltip.hide()
    return
  }
  const carto = Cartographic.fromCartesian(position)
  tooltip.setContent(
    `经度 ${formatCoord(carto.longitude)}°<br>` +
    `纬度 ${formatCoord(carto.latitude)}°<br>` +
    `高度 ${carto.height.toFixed(1)} m`
  )
  tooltip.setPosition(event.endPosition.x, event.endPosition.y)
  tooltip.show()
}

watch(showTip, (value) => {
  if (!value) tooltip?.hide()
})

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    tooltip = new MouseTooltip(container.value)
    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
      onMouseMove(movement)
    }, ScreenSpaceEventType.MOUSE_MOVE)
    viewer.scene.requestRender()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  handler?.destroy()
  handler = undefined
  tooltip?.destroy()
  tooltip = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="mouse-tip-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="control-panel">
      <div class="panel-title">鼠标移动提示</div>
      <div class="control-row">
        <label class="switch-label">跟随提示</label>
        <input v-model="showTip" type="checkbox" />
      </div>
      <div class="control-row">
        <label class="switch-label">精度(小数位)</label>
        <select v-model.number="precision" class="precision-select">
          <option :value="4">4</option>
          <option :value="5">5</option>
          <option :value="6">6</option>
        </select>
      </div>
      <div class="hint">移动鼠标，气泡跟随显示点位经纬度与高度</div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.mouse-tip-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 240px; padding: 12px; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 32, 49, 0.84); backdrop-filter: blur(6px); color: #ddf2f8; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.control-row { display: flex; align-items: center; justify-content: space-between; padding: 3px 0; }
.switch-label { font-size: 11px; color: #bdd9e4; }
.precision-select { background: #143548; color: #d9eff6; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 4px; font-size: 11px; padding: 2px 4px; }
.hint { margin-top: 8px; font-size: 11px; color: #7fb6c9; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>

<style>
.mouse-tip-shell .measure-tooltip { position: absolute; padding: 5px 8px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 5px; background: rgba(8, 32, 49, 0.92); color: #d9eff6; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.5; white-space: nowrap; pointer-events: none; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); }
</style>
