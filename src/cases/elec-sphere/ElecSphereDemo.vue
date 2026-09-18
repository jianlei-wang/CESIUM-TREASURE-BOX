<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib'
import {
  createElecSphere,
  registerPrimitiveMaterials,
  removeElecSphere,
  updateElecSphere
} from '../primitive-effect-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const placing = ref(false)

const colorHex = ref('#33ff66')
const opacity = ref(0.8)
const speed = ref(5)
const radiusX = ref(80)
const radiusY = ref(80)
const radiusZ = ref(80)

const SPHERE_ID = 'elec-sphere'
const BASE_CENTER = { lon: 115.73, lat: 36.2 }
const CENTER = { lon: 115.73, lat: 36.2 }

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined

function buildOptions(): Parameters<typeof createElecSphere>[1] {
  return {
    id: SPHERE_ID,
    position: [CENTER.lon, CENTER.lat, 0],
    radiusX: radiusX.value,
    radiusY: radiusY.value,
    radiusZ: radiusZ.value,
    color: Color.fromCssColorString(colorHex.value).withAlpha(opacity.value),
    speed: speed.value
  }
}

function place(lon: number, lat: number): void {
  if (!viewer || viewer.isDestroyed()) return
  CENTER.lon = lon
  CENTER.lat = lat
  createElecSphere(viewer, buildOptions())
  resultMessage.value = `电弧球体已放置至 ${lon.toFixed(4)}, ${lat.toFixed(4)}`
}

function updateEffect(): void {
  if (!viewer || viewer.isDestroyed()) return
  updateElecSphere(viewer, SPHERE_ID, {
    radiusX: radiusX.value,
    radiusY: radiusY.value,
    radiusZ: radiusZ.value,
    color: Color.fromCssColorString(colorHex.value).withAlpha(opacity.value),
    speed: speed.value
  })
  resultMessage.value = '电弧球体参数已更新'
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !placing.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  const carto = Cartographic.fromCartesian(pos)
  place(CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude))
}

watch([colorHex, opacity, speed, radiusX, radiusY, radiusZ], () => {
  if (viewer && !viewer.isDestroyed()) updateEffect()
})

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    registerPrimitiveMaterials()
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(BASE_CENTER.lon, BASE_CENTER.lat, 30000)
    })

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)

    place(BASE_CENTER.lon, BASE_CENTER.lat)
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  handler?.destroy()
  handler = undefined
  removeElecSphere(viewer, SPHERE_ID)
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="elec-sphere-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">电弧球体效果</div>

      <button class="action-button primary" :class="{ active: placing }" @click="placing = !placing">
        {{ placing ? '放置中… 点击地图放置' : '点击地图放置球体' }}
      </button>
      <button class="action-button neutral" @click="place(BASE_CENTER.lon, BASE_CENTER.lat)">重置默认位置</button>

      <div class="section-title">电弧参数</div>
      <div class="control-row">
        <span class="row-label">颜色</span>
        <input v-model="colorHex" type="color" class="color-input" />
      </div>
      <div class="control-row">
        <span class="row-label">透明度</span>
        <input v-model.number="opacity" type="range" min="0.1" max="1" step="0.05" />
        <span class="row-value">{{ opacity.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">闪烁速度</span>
        <input v-model.number="speed" type="range" min="1" max="20" step="1" />
        <span class="row-value">{{ speed }}</span>
      </div>

      <div class="section-title">球体尺寸(米)</div>
      <div class="control-row">
        <span class="row-label">半径X</span>
        <input v-model.number="radiusX" type="range" min="20" max="300" step="5" />
        <span class="row-value">{{ radiusX }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">半径Y</span>
        <input v-model.number="radiusY" type="range" min="20" max="300" step="5" />
        <span class="row-value">{{ radiusY }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">半径Z</span>
        <input v-model.number="radiusZ" type="range" min="20" max="300" step="5" />
        <span class="row-value">{{ radiusZ }}</span>
      </div>

      <p class="hint">电弧闪烁球体，上半球面电弧实时随机跳动；开启放置后单击地图可重新定位。</p>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.elec-sphere-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 248px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 48px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row input[type="color"] { width: 40px; height: 24px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 5px; background: transparent; cursor: pointer; }
.action-button { width: 100%; height: 28px; margin-top: 6px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.primary.active { background: #1f6f96; }
.action-button.neutral { background: #2c3a52; color: #c3d5e8; }
.hint { margin: 8px 0 0; font-size: 11px; color: #7f96b3; line-height: 1.5; }
.result-message { margin-top: 6px; font-size: 11px; color: #8be0b2; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
