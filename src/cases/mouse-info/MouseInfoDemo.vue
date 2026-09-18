<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Cartesian2, Cartographic, Math as CesiumMath, ScreenSpaceEventType, ScreenSpaceEventHandler, type Cartesian3, type Viewer } from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const lonText = ref('--')
const latText = ref('--')
const heightText = ref('--')
const levelText = ref('--')
const scaleText = ref('--')
let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let removePostUpdate: (() => void) | undefined
let lastLevel = 0
let lastScale = 0
let lastScaleUnit = 'm'

const PIXELS_PER_CENTIMETER = 96 / 2.54

function formatDegrees(value: number): string {
  return `${CesiumMath.toDegrees(value).toFixed(6)}°`
}

function toCartographic(position: Cartesian3 | undefined): Cartographic | undefined {
  if (!position) return undefined
  return Cartographic.fromCartesian(position)
}

function pickGround(windowPosition: Cartesian2): Cartesian3 | undefined {
  if (!viewer || viewer.isDestroyed()) return undefined
  const scene = viewer.scene
  let position: Cartesian3 | undefined
  if (scene.pickPositionSupported) {
    try {
      position = scene.pickPosition(windowPosition)
    } catch {
      position = undefined
    }
  }
  if (!position) {
    const ray = viewer.camera.getPickRay(windowPosition)
    if (ray) position = scene.globe.pick(ray, scene)
  }
  if (!position) {
    position = viewer.camera.pickEllipsoid(windowPosition)
  }
  return position
}

function estimateLevel(metersPerPixel: number, latitude: number): number {
  if (metersPerPixel <= 0 || !Number.isFinite(metersPerPixel)) return 0
  const latitudeScale = Math.max(Math.cos(latitude), 0.01)
  const level = Math.round(Math.log2(40075016.686 / (256 * metersPerPixel) * latitudeScale))
  return Math.max(0, Math.min(22, level))
}
function computeScale(): void {
  if (!viewer || viewer.isDestroyed()) return
  const canvas = viewer.canvas
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width <= 0 || height <= 0) return
  const center = new Cartesian2(width / 2, height / 2)
  const offset = new Cartesian2(center.x + 60, center.y)
  const start = pickGround(center)
  const end = pickGround(offset)
  if (!start || !end) return
  const startCarto = toCartographic(start)
  const endCarto = toCartographic(end)
  if (!startCarto || !endCarto) return
  const deltaLon = (endCarto.longitude - startCarto.longitude) * Math.cos(startCarto.latitude)
  const deltaLat = endCarto.latitude - startCarto.latitude
  const metersPerPixel = Math.sqrt(deltaLon * deltaLon + deltaLat * deltaLat) * 6371000 / 60
  if (metersPerPixel <= 0 || !Number.isFinite(metersPerPixel)) return
  const metersPerCentimeter = metersPerPixel * PIXELS_PER_CENTIMETER
  if (metersPerCentimeter >= 1000) {
    lastScale = metersPerCentimeter / 1000
    lastScaleUnit = 'km'
  } else {
    lastScale = metersPerCentimeter
    lastScaleUnit = 'm'
  }
  lastLevel = estimateLevel(metersPerPixel, startCarto.latitude)
  levelText.value = String(lastLevel)
  scaleText.value = lastScaleUnit === 'km' ? `1 厘米 ≈ ${lastScale.toFixed(2)} km` : `1 厘米 ≈ ${lastScale.toFixed(1)} m`
}

function updateHeightFallback(windowPosition: Cartesian2): void {
  if (!viewer || viewer.isDestroyed()) return
  const position = viewer.camera.pickEllipsoid(windowPosition)
  const carto = toCartographic(position)
  if (carto) {
    lonText.value = formatDegrees(carto.longitude)
    latText.value = formatDegrees(carto.latitude)
    heightText.value = `${Math.round(carto.height)} m`
  }
}

function updateReadings(windowPosition: Cartesian2): void {
  const position = pickGround(windowPosition)
  const carto = toCartographic(position)
  if (carto) {
    lonText.value = formatDegrees(carto.longitude)
    latText.value = formatDegrees(carto.latitude)
    heightText.value = `${Math.round(carto.height)} m`
  } else {
    updateHeightFallback(windowPosition)
  }
}

function updateDerived(): void {
  if (!viewer || viewer.isDestroyed()) return
  const carto = viewer.camera.positionCartographic
  if (!carto || carto.height <= 0) {
    levelText.value = '--'
    scaleText.value = '--'
    return
  }
  computeScale()
}

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
      updateReadings(movement.endPosition)
    }, ScreenSpaceEventType.MOUSE_MOVE)
    const onPostUpdate = () => updateDerived()
    viewer.scene.postUpdate.addEventListener(onPostUpdate)
    removePostUpdate = () => viewer?.scene.postUpdate.removeEventListener(onPostUpdate)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  removePostUpdate?.()
  handler?.destroy()
  handler = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="mouse-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="mouse-panel">
      <div class="panel-title">鼠标位置信息</div>
      <div class="info-row"><span class="info-label">经度</span><span class="info-value">{{ lonText }}</span></div>
      <div class="info-row"><span class="info-label">纬度</span><span class="info-value">{{ latText }}</span></div>
      <div class="info-row"><span class="info-label">海拔</span><span class="info-value">{{ heightText }}</span></div>
      <div class="group-title">当前地图状态</div>
      <div class="info-row"><span class="info-label">缩放层级</span><span class="info-value">{{ levelText }}</span></div>
      <div class="info-row"><span class="info-label">比例尺</span><span class="info-value">{{ scaleText }}</span></div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.mouse-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.mouse-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 270px; padding: 12px; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 32, 49, 0.84); backdrop-filter: blur(6px); color: #ddf2f8; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.group-title { margin: 8px 0 4px; font-size: 10px; font-weight: 700; color: #7fb6c9; letter-spacing: 0.05em; }
.info-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; }
.info-label { font-size: 11px; color: #bdd9e4; }
.info-value { font: 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #d9eff6; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
