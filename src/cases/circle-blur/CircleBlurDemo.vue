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
import { CIRCLE_BLUR_TYPE, registerDcEffectsMaterials } from '../dc-effects-lib'
import { createDcEffectEntity, updateDcEffectEntity, removeDcEffectEntity } from '../dc-effects-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const placing = ref(false)

const colorHex = ref('#ff4d4f')
const speed = ref(3)
const radius = ref(1500)
const height = ref(0)

const DEFAULT_LON = 120.38
const DEFAULT_LAT = 36.08

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined

function place(lon: number, lat: number): void {
  if (!viewer || viewer.isDestroyed()) return
  removeDcEffectEntity(viewer, CIRCLE_BLUR_TYPE)
  createDcEffectEntity(viewer, {
    type: CIRCLE_BLUR_TYPE,
    lon,
    lat,
    height: height.value,
    radius: radius.value,
    color: Color.fromCssColorString(colorHex.value),
    speed: speed.value
  })
  resultMessage.value = `模糊圆已放置于 ${lon.toFixed(4)}, ${lat.toFixed(4)}`
}

function updateEffect(): void {
  if (!viewer || viewer.isDestroyed()) return
  const entity = viewer.entities.getById(`dc-effect-${CIRCLE_BLUR_TYPE}`)
  if (!entity) {
    place(DEFAULT_LON, DEFAULT_LAT)
    return
  }
  updateDcEffectEntity(viewer, CIRCLE_BLUR_TYPE, {
    radius: radius.value,
    height: height.value,
    color: Color.fromCssColorString(colorHex.value),
    speed: speed.value
  })
  resultMessage.value = '模糊圆参数已更新'
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !placing.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  const carto = Cartographic.fromCartesian(pos)
  place(CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude))
}

watch([colorHex, speed, radius, height], () => {
  if (viewer && !viewer.isDestroyed()) updateEffect()
})

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    registerDcEffectsMaterials()
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(DEFAULT_LON, DEFAULT_LAT, 8000)
    })

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)

    place(DEFAULT_LON, DEFAULT_LAT)
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  handler?.destroy()
  handler = undefined
  removeDcEffectEntity(viewer, CIRCLE_BLUR_TYPE)
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="blur-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">模糊圆效果</div>

      <button class="action-button primary" :class="{ active: placing }" @click="placing = !placing">
        {{ placing ? '放置中… 点击地图定位' : '点击地图放置模糊圆' }}
      </button>
      <button class="action-button neutral" @click="place(DEFAULT_LON, DEFAULT_LAT)">重置默认位置</button>

      <div class="section-title">圆环参数</div>
      <div class="control-row">
        <span class="row-label">颜色</span>
        <input v-model="colorHex" type="color" class="color-input" />
      </div>
      <div class="control-row">
        <span class="row-label">速度</span>
        <input v-model.number="speed" type="range" min="1" max="20" step="0.5" />
        <span class="row-value">{{ speed.toFixed(1) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">半径(m)</span>
        <input v-model.number="radius" type="range" min="300" max="5000" step="100" />
        <span class="row-value">{{ radius }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">高度(m)</span>
        <input v-model.number="height" type="range" min="0" max="500" step="10" />
        <span class="row-value">{{ height }}</span>
      </div>

      <p class="hint">开启放置后单击地图定位圆环；参数修改实时生效。</p>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.blur-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
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
