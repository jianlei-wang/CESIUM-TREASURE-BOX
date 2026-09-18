<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Ellipsoid,
  Math as CesiumMath,
  SceneMode,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const enabled = ref(true)

const mouseLng = ref(0)
const mouseLat = ref(0)
const mouseAlt = ref(0)
const cameraPitch = ref(0)
const cameraHeight = ref(0)

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let lastMouseUpdate = 0
let lastCameraUpdate = 0

function moveHandler(movement: { endPosition: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed()) return
  const now = performance.now()
  if (now < lastMouseUpdate + 300) return
  lastMouseUpdate = now

  const scene = viewer.scene
  const ellipsoid = Ellipsoid.WGS84
  let surfacePosition: Cartesian3 | undefined
  if (scene.mode === SceneMode.SCENE3D) {
    const ray = scene.camera.getPickRay(movement.endPosition)
    surfacePosition = ray ? scene.globe.pick(ray, scene) ?? undefined : undefined
  } else {
    surfacePosition = scene.camera.pickEllipsoid(movement.endPosition, ellipsoid) ?? undefined
  }

  const cartographic = surfacePosition ? ellipsoid.cartesianToCartographic(surfacePosition) : undefined
  mouseLng.value = CesiumMath.toDegrees(cartographic?.longitude ?? 0)
  mouseLat.value = CesiumMath.toDegrees(cartographic?.latitude ?? 0)
  mouseAlt.value = cartographic ? scene.globe.getHeight(cartographic) ?? 0 : 0
}

function cameraHandler(): void {
  if (!viewer || viewer.isDestroyed()) return
  const now = performance.now()
  if (now < lastCameraUpdate + 300) return
  lastCameraUpdate = now

  const position = Ellipsoid.WGS84.cartesianToCartographic(viewer.camera.positionWC)
  cameraPitch.value = CesiumMath.toDegrees(viewer.camera.pitch)
  cameraHeight.value = position.height
}

function onEnableChange(value: boolean): void {
  if (!viewer || viewer.isDestroyed()) return
  if (value) {
    handler?.setInputAction(moveHandler, ScreenSpaceEventType.MOUSE_MOVE)
    viewer.camera.changed.addEventListener(cameraHandler)
  } else {
    handler?.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE)
    viewer.camera.changed.removeEventListener(cameraHandler)
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
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(118.8, 32.05, 260000) })
    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction(moveHandler, ScreenSpaceEventType.MOUSE_MOVE)
    viewer.camera.changed.addEventListener(cameraHandler)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (handler && !handler.isDestroyed()) handler.destroy()
  handler = undefined
  if (viewer && !viewer.isDestroyed()) {
    viewer.camera.changed.removeEventListener(cameraHandler)
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="widget-shell">
    <div ref="container" class="cesium-container"></div>

    <div v-if="enabled" class="cesium-location-bar">
      <span class="mouse-location">经度：{{ mouseLng.toFixed(6) }}</span>
      <span class="mouse-location">纬度：{{ mouseLat.toFixed(6) }}</span>
      <span class="mouse-location">海拔：{{ mouseAlt.toFixed(1) }} 米</span>
      <span>视角：{{ cameraPitch.toFixed(1) }}°</span>
      <span>视高：{{ cameraHeight.toFixed(1) }} 米</span>
    </div>

    <div class="control-panel">
      <div class="panel-title">位置信息栏控件</div>
      <div class="row">
        <span class="row-label">显示状态栏</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '隐藏状态栏' : '显示状态栏'" @click="enabled = !enabled; onEnableChange(enabled)"><i></i></button>
      </div>
      <p class="hint">
        底部状态栏实时显示鼠标所在位置的经度、纬度、海拔（地形高度），以及当前相机的俯仰角与视高。数据每 300ms 节流刷新。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.widget-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.cesium-location-bar { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 10; display: flex; gap: 4px; padding: 3px 8px; border-radius: 4px; background: rgba(0, 0, 0, 0.62); font-size: 12px; color: #ffffff; user-select: none; white-space: nowrap; }
.cesium-location-bar span { margin: 0 4px; }
.mouse-location { color: #cfe6ff; }
.control-panel { position: absolute; top: 12px; left: 12px; z-index: 10; width: 260px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.row-label { color: #c3d5e8; font-size: 11px; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }
.toggle.on { background: #2f80ed; }
.toggle.on i { transform: translateX(18px); }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
