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
  createPolylineEntity,
  DEFAULT_LINE_POSITIONS,
  registerPolylineMaterials,
  removePolylineEntity,
  updatePolylineEntity,
  type PolylineEntityOptions
} from '../polyline-effects-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const placing = ref(false)

const colorHex = ref('#ffcc33')
const opacity = ref(0.8)
const speed = ref(5)
const lineWidth = ref(20)

const LINE_ID = 'line-lighting-trail'

const BASE_CENTER = { lon: 115.73, lat: 36.2 }
const CENTER = { lon: 115.73, lat: 36.2 }

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined

function buildPositions(): Array<[number, number, number]> {
  const dLon = CENTER.lon - BASE_CENTER.lon
  const dLat = CENTER.lat - BASE_CENTER.lat
  return DEFAULT_LINE_POSITIONS.map(([lon, lat, height]) => [lon + dLon, lat + dLat, height])
}

function buildOptions(): PolylineEntityOptions {
  return {
    id: LINE_ID,
    positions: buildPositions(),
    kind: 'PolylineLightingTrail',
    width: lineWidth.value,
    material: {
      color: Color.fromCssColorString(colorHex.value).withAlpha(opacity.value),
      speed: speed.value,
      image: '/images/lighting.png'
    }
  }
}

function place(lon: number, lat: number): void {
  if (!viewer || viewer.isDestroyed()) return
  CENTER.lon = lon
  CENTER.lat = lat
  createPolylineEntity(viewer, buildOptions())
  resultMessage.value = `发光轨迹线已平移至 ${lon.toFixed(4)}, ${lat.toFixed(4)}`
}

function updateEffect(): void {
  if (!viewer || viewer.isDestroyed()) return
  const entity = viewer.entities.getById(`dc-polyline-${LINE_ID}`)
  if (!entity) {
    place(BASE_CENTER.lon, BASE_CENTER.lat)
    return
  }
  updatePolylineEntity(viewer, LINE_ID, {
    width: lineWidth.value,
    material: {
      color: Color.fromCssColorString(colorHex.value).withAlpha(opacity.value),
      speed: speed.value
    }
  })
  resultMessage.value = '发光轨迹线参数已更新'
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !placing.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  const carto = Cartographic.fromCartesian(pos)
  place(CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude))
}

watch([colorHex, opacity, speed, lineWidth], () => {
  if (viewer && !viewer.isDestroyed()) updateEffect()
})

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    registerPolylineMaterials()
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(BASE_CENTER.lon, BASE_CENTER.lat, 2600000)
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
  removePolylineEntity(viewer, LINE_ID)
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="line-lighting-trail-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">发光轨迹线效果</div>

      <button class="action-button primary" :class="{ active: placing }" @click="placing = !placing">
        {{ placing ? '放置中… 点击地图平移' : '点击地图平移折线' }}
      </button>
      <button class="action-button neutral" @click="place(BASE_CENTER.lon, BASE_CENTER.lat)">重置默认位置</button>

      <div class="section-title">线条参数</div>
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
        <span class="row-label">流动速度</span>
        <input v-model.number="speed" type="range" min="0.5" max="10" step="0.5" />
        <span class="row-value">{{ speed.toFixed(1) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">线宽(px)</span>
        <input v-model.number="lineWidth" type="range" min="1" max="40" step="1" />
        <span class="row-value">{{ lineWidth }}</span>
      </div>

      <p class="hint">光照贴图配合中心高亮亮线沿路径流动发光；开启放置后单击地图可整体平移折线，参数修改实时生效。</p>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.line-lighting-trail-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 248px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
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
