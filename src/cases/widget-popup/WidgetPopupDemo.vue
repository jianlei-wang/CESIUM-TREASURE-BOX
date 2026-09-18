<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Ellipsoid,
  Math as CesiumMath,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

interface PopupData {
  title: string
  lng: number
  lat: number
  alt: number
}

const container = ref<HTMLElement | null>(null)
const popupEl = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const enabled = ref(true)

const popupData = ref<PopupData | null>(null)
const popupVisible = ref(false)
const popupLeft = ref(0)
const popupTop = ref(0)

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let anchorPosition: Cartesian3 | undefined

const pois = [
  { name: '紫峰大厦', lng: 118.7822, lat: 32.0667, alt: 0 },
  { name: '玄武湖', lng: 118.7951, lat: 32.0736, alt: 0 },
  { name: '新街口', lng: 118.7783, lat: 32.0417, alt: 0 },
  { name: '南京眼', lng: 118.6655, lat: 32.0071, alt: 0 }
]

function updateWindowCoord(): void {
  if (!viewer || viewer.isDestroyed() || !popupEl.value || !popupVisible.value || !anchorPosition) return
  const windowCoord = SceneTransforms.worldToWindowCoordinates(viewer.scene, anchorPosition)
  if (!windowCoord) return
  const rect = popupEl.value.getBoundingClientRect()
  popupLeft.value = windowCoord.x - rect.width / 2
  popupTop.value = windowCoord.y - rect.height - 14
}

function showPopup(data: PopupData, position: Cartesian3): void {
  anchorPosition = position
  popupData.value = data
  popupVisible.value = true
  updateWindowCoord()
}

function hidePopup(): void {
  popupVisible.value = false
  anchorPosition = undefined
}

function onLeftClick(movement: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !enabled.value) return
  const scene = viewer.scene
  const ray = scene.camera.getPickRay(movement.position)
  const surface = ray ? scene.globe.pick(ray, scene) ?? undefined : undefined
  if (!surface) return
  const carto = Ellipsoid.WGS84.cartesianToCartographic(surface)
  if (!carto) return
  showPopup(
    {
      title: '点击位置',
      lng: CesiumMath.toDegrees(carto.longitude),
      lat: CesiumMath.toDegrees(carto.latitude),
      alt: carto.height
    },
    surface
  )
}

function flyToPoi(poi: { name: string; lng: number; lat: number; alt: number }): void {
  if (!viewer || viewer.isDestroyed()) return
  const position = Cartesian3.fromDegrees(poi.lng, poi.lat, 8000)
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(poi.lng, poi.lat, 8000),
    duration: 1.2
  })
  const ground = Cartesian3.fromDegrees(poi.lng, poi.lat, 0)
  showPopup({ title: poi.name, lng: poi.lng, lat: poi.lat, alt: 0 }, ground)
}

function onEnableChange(value: boolean): void {
  if (!handler || !viewer || viewer.isDestroyed()) return
  if (value) {
    handler.setInputAction(onLeftClick, ScreenSpaceEventType.LEFT_CLICK)
  } else {
    handler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK)
    hidePopup()
  }
}

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(118.78, 32.05, 260000) })
    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction(onLeftClick, ScreenSpaceEventType.LEFT_CLICK)
    viewer.scene.postRender.addEventListener(updateWindowCoord)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (handler && !handler.isDestroyed()) handler.destroy()
  handler = undefined
  if (viewer && !viewer.isDestroyed()) {
    viewer.scene.postRender.removeEventListener(updateWindowCoord)
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="widget-shell">
    <div ref="container" class="cesium-container"></div>

    <div ref="popupEl" v-show="popupVisible" class="cesium-popup" :style="{ left: popupLeft + 'px', top: popupTop + 'px' }">
      <div class="popup-title">
        {{ popupData?.title }}
        <span class="popup-close" @click="hidePopup">&times;</span>
      </div>
      <div class="popup-body" v-if="popupData">
        <div class="popup-row">经度 {{ popupData.lng.toFixed(6) }}°</div>
        <div class="popup-row">纬度 {{ popupData.lat.toFixed(6) }}°</div>
        <div class="popup-row">高程 {{ popupData.alt.toFixed(1) }} m</div>
      </div>
    </div>

    <div class="control-panel">
      <div class="panel-title">气泡弹窗控件</div>
      <div class="row">
        <span class="row-label">启用点击弹窗</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '关闭点击弹窗' : '启用点击弹窗'" @click="enabled = !enabled; onEnableChange(enabled)"><i></i></button>
      </div>
      <div class="poi-list">
        <button v-for="poi in pois" :key="poi.name" class="poi-btn" @click="flyToPoi(poi)">{{ poi.name }}</button>
      </div>
      <p class="hint">
        单击地图任意位置，在拾取点上方弹出坐标信息气泡；气泡随相机移动贴附地面点。点击预设地标可飞行过去并弹出对应信息。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.widget-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.cesium-popup { position: absolute; top: 0; left: 0; z-index: 30; min-width: 150px; padding: 10px 12px; background: rgba(255, 255, 255, 0.97); border-radius: 6px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35); color: #26364a; font-size: 12px; cursor: default; }
.cesium-popup::after { content: ''; position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); border-left: 8px solid transparent; border-right: 8px solid transparent; border-top: 8px solid rgba(255, 255, 255, 0.97); }
.popup-title { font-weight: 700; font-size: 13px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.popup-close { cursor: pointer; color: #7f96b3; font-size: 16px; line-height: 1; padding: 0 2px; }
.popup-close:hover { color: #2f80ed; }
.popup-row { line-height: 1.7; color: #4a5f78; }
.control-panel { position: absolute; top: 12px; left: 12px; z-index: 20; width: 260px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.row-label { color: #c3d5e8; font-size: 11px; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }
.toggle.on { background: #2f80ed; }
.toggle.on i { transform: translateX(18px); }
.poi-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.poi-btn { padding: 4px 10px; border: 1px solid rgba(157, 188, 224, 0.4); border-radius: 999px; background: rgba(47, 128, 237, 0.2); color: #dce8f5; font-size: 11px; cursor: pointer; }
.poi-btn:hover { background: rgba(47, 128, 237, 0.45); }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
