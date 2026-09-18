<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  Ellipsoid,
  IntersectionTests,
  Ray,
  SceneMode,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const enabled = ref(true)

let viewer: Viewer | undefined

function getCameraFocus(scene: Viewer['scene']): Cartesian3 | undefined {
  const ray = new Ray(scene.camera.positionWC, scene.camera.directionWC)
  const intersections = IntersectionTests.rayEllipsoid(ray, Ellipsoid.WGS84)
  if (intersections) {
    return Ray.getPoint(ray, intersections.start)
  }
  return IntersectionTests.grazingAltitudeLocation(ray, Ellipsoid.WGS84) ?? undefined
}

function getCameraPosition(camera: Viewer['camera'], focus: Cartesian3, scalar: number): Cartesian3 {
  const scratch = new Cartesian3()
  const direction = Cartesian3.subtract(focus, camera.position, scratch)
  const movementVector = Cartesian3.multiplyByScalar(direction, scalar, scratch)
  return Cartesian3.add(camera.position, movementVector, scratch)
}

function zoomIn(): void {
  if (!viewer || viewer.isDestroyed()) return
  const scene = viewer.scene
  const camera = scene.camera
  const sscc = scene.screenSpaceCameraController
  if (scene.mode === SceneMode.MORPHING || !sscc.enableInputs || scene.mode === SceneMode.COLUMBUS_VIEW) return
  if (scene.mode === SceneMode.SCENE2D) {
    camera.zoomIn(camera.positionCartographic.height * 0.5)
    return
  }
  if (scene.mode === SceneMode.SCENE3D) {
    const focus = getCameraFocus(scene)
    if (!focus) return
    const destination = getCameraPosition(camera, focus, 1 / 2)
    camera.flyTo({ destination, orientation: { heading: camera.heading, pitch: camera.pitch, roll: camera.roll }, duration: 0.5, convert: false })
  }
}

function zoomOut(): void {
  if (!viewer || viewer.isDestroyed()) return
  const scene = viewer.scene
  const camera = scene.camera
  const sscc = scene.screenSpaceCameraController
  if (scene.mode === SceneMode.MORPHING || !sscc.enableInputs || scene.mode === SceneMode.COLUMBUS_VIEW) return
  if (scene.mode === SceneMode.SCENE2D) {
    camera.zoomOut(camera.positionCartographic.height)
    return
  }
  if (scene.mode === SceneMode.SCENE3D) {
    const focus = getCameraFocus(scene)
    if (!focus) return
    const destination = getCameraPosition(camera, focus, -1)
    camera.flyTo({ destination, orientation: { heading: camera.heading, pitch: camera.pitch, roll: camera.roll }, duration: 0.5, convert: false })
  }
}

function refresh(): void {
  if (viewer && !viewer.isDestroyed()) viewer.camera.flyHome(1.5)
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
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="widget-shell">
    <div ref="container" class="cesium-container"></div>

    <div v-show="enabled" class="cesium-zoom-controller">
      <button class="btn" title="放大" @click="zoomIn">
        <svg viewBox="0 0 12 12"><path d="M6 2 L6 10 M2 6 L10 6" stroke="#fff" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>
      </button>
      <button class="btn" title="回到默认视角" @click="refresh">
        <svg viewBox="0 0 12 12"><path d="M6 1.5 A4.5 4.5 0 1 1 4.2 2.4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M6 1.5 L6 4 L3.4 2.4 Z" fill="#fff"/></svg>
      </button>
      <button class="btn" title="缩小" @click="zoomOut">
        <svg viewBox="0 0 12 12"><path d="M2 6 L10 6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>
    </div>

    <div class="control-panel">
      <div class="panel-title">缩放控制器控件</div>
      <div class="row">
        <span class="row-label">显示缩放按钮</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '隐藏缩放按钮' : '显示缩放按钮'" @click="enabled = !enabled"><i></i></button>
      </div>
      <p class="hint">
        右上角纵向按钮组：上「＋」朝视线焦点方向前进 1/2 距离实现放大，下「－」朝反方向拉远一倍，中间「刷新」飞回默认视角。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.widget-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.cesium-zoom-controller { position: absolute; top: 96px; right: 24px; z-index: 10; display: flex; flex-direction: column; gap: 2px; padding: 4px; background: rgba(63, 72, 84, 0.92); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 14px; user-select: none; box-sizing: border-box; }
.btn { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; background: transparent; cursor: pointer; }
.btn:hover { background: rgba(104, 173, 254, 0.35); border-radius: 8px; }
.btn svg { width: 12px; height: 12px; }
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
