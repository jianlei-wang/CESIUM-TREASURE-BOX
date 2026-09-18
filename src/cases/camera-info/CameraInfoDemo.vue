<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Math as CesiumMath, type Viewer } from 'cesium'
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
const headingText = ref('--')
const pitchText = ref('--')
const rollText = ref('--')
const westText = ref('--')
const southText = ref('--')
const eastText = ref('--')
const northText = ref('--')
const copyStatus = ref('')
let viewer: Viewer | undefined
let removePostUpdate: (() => void) | undefined

function formatDegrees(value: number): string {
  return `${CesiumMath.toDegrees(value).toFixed(5)}°`
}

function formatMeters(value: number): string {
  return `${Math.round(value)} m`
}

function formatAngle(value: number): string {
  return `${CesiumMath.toDegrees(value).toFixed(2)}°`
}

function buildSetViewCode(): string {
  if (!viewer) return ''
  const camera = viewer.camera
  const carto = camera.positionCartographic
  const height = Math.round(carto.height)
  const rect = camera.computeViewRectangle()
  const rectText = rect
    ? `west: ${CesiumMath.toDegrees(rect.west).toFixed(6)}, south: ${CesiumMath.toDegrees(rect.south).toFixed(6)}, east: ${CesiumMath.toDegrees(rect.east).toFixed(6)}, north: ${CesiumMath.toDegrees(rect.north).toFixed(6)}`
    : '当前视角无有效地表范围'
  return `// 相机位置（十进制度）
// longitude: ${CesiumMath.toDegrees(carto.longitude).toFixed(6)}, latitude: ${CesiumMath.toDegrees(carto.latitude).toFixed(6)}, height: ${height}
// 当前视口四至（十进制度）
// ${rectText}
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(${CesiumMath.toDegrees(carto.longitude).toFixed(6)}, ${CesiumMath.toDegrees(carto.latitude).toFixed(6)}, ${height}),
  orientation: {
    heading: Cesium.Math.toRadians(${CesiumMath.toDegrees(camera.heading).toFixed(2)}),
    pitch: Cesium.Math.toRadians(${CesiumMath.toDegrees(camera.pitch).toFixed(2)}),
    roll: ${camera.roll.toFixed(4)}
  }
})`
}

async function copyCameraCode(): Promise<void> {
  const code = buildSetViewCode()
  if (!code) {
    copyStatus.value = '暂无相机参数可复制'
    return
  }
  try {
    await navigator.clipboard.writeText(code)
    copyStatus.value = '已复制相机参数代码'
  } catch {
    copyStatus.value = '复制失败，请手动复制'
  }
  setTimeout(() => { copyStatus.value = '' }, 2000)
}

function updatePanel(): void {
  if (!viewer || viewer.isDestroyed()) return
  const camera = viewer.camera
  const carto = camera.positionCartographic
  lonText.value = formatDegrees(carto.longitude)
  latText.value = formatDegrees(carto.latitude)
  heightText.value = formatMeters(carto.height)
  headingText.value = formatAngle(camera.heading)
  pitchText.value = formatAngle(camera.pitch)
  rollText.value = formatAngle(camera.roll)

  const rectangle = camera.computeViewRectangle()
  if (rectangle) {
    westText.value = formatDegrees(rectangle.west)
    southText.value = formatDegrees(rectangle.south)
    eastText.value = formatDegrees(rectangle.east)
    northText.value = formatDegrees(rectangle.north)
  } else {
    westText.value = '--'
    southText.value = '--'
    eastText.value = '--'
    northText.value = '--'
  }
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
    const onPostUpdate = () => updatePanel()
    viewer.scene.postUpdate.addEventListener(onPostUpdate)
    removePostUpdate = () => viewer?.scene.postUpdate.removeEventListener(onPostUpdate)
    updatePanel()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  removePostUpdate?.()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="camera-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="camera-panel">
      <div class="panel-title">相机参数</div>
      <div class="group-title">相机位置</div>
      <div class="info-row"><span class="info-label">经度</span><span class="info-value">{{ lonText }}</span></div>
      <div class="info-row"><span class="info-label">纬度</span><span class="info-value">{{ latText }}</span></div>
      <div class="info-row"><span class="info-label">海拔</span><span class="info-value">{{ heightText }}</span></div>
      <div class="group-title">相机朝向</div>
      <div class="info-row"><span class="info-label">航向角</span><span class="info-value">{{ headingText }}</span></div>
      <div class="info-row"><span class="info-label">俯仰角</span><span class="info-value">{{ pitchText }}</span></div>
      <div class="info-row"><span class="info-label">翻滚角</span><span class="info-value">{{ rollText }}</span></div>
      <div class="group-title">当前视口四至</div>
      <div class="info-row"><span class="info-label">西</span><span class="info-value">{{ westText }}</span></div>
      <div class="info-row"><span class="info-label">南</span><span class="info-value">{{ southText }}</span></div>
      <div class="info-row"><span class="info-label">东</span><span class="info-value">{{ eastText }}</span></div>
      <div class="info-row"><span class="info-label">北</span><span class="info-value">{{ northText }}</span></div>
      <button class="copy-button" @click="copyCameraCode">一键复制相机参数</button>
      <div v-if="copyStatus" class="copy-status">{{ copyStatus }}</div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.camera-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.camera-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 280px; padding: 12px; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 32, 49, 0.84); backdrop-filter: blur(6px); color: #ddf2f8; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.group-title { margin: 8px 0 4px; font-size: 10px; font-weight: 700; color: #7fb6c9; letter-spacing: 0.05em; }
.info-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; }
.info-label { font-size: 11px; color: #bdd9e4; }
.info-value { font: 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #d9eff6; }
.copy-button { margin-top: 10px; width: 100%; height: 26px; border: 0; border-radius: 5px; background: #257f9e; color: #edfaff; cursor: pointer; font-size: 11px; }
.copy-status { margin-top: 6px; text-align: center; font-size: 11px; color: #8be0b2; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
