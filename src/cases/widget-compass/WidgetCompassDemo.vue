<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  Ray,
  SceneMode,
  Transforms,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const compassEl = ref<HTMLElement | null>(null)
const outerRef = ref<SVGSVGElement | null>(null)
const markerRef = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const enabled = ref(true)
const isLoaded = ref(false)

let viewer: Viewer | undefined
let compassRect: DOMRect | undefined
let orbitCursorAngle = 0
let orbitCursorOpacity = 0
let orbitLastTimestamp = 0
let orbitFrame: Matrix4 | undefined
let orbitIsLook = false
let rotateInitialCursorAngle: number | undefined
let rotateInitialCameraAngle = 0
let rotateFrame: Matrix4 | undefined
let mouseMoveHandler: ((e: MouseEvent) => void) | undefined
let mouseUpHandler: (() => void) | undefined
let disposed = false

function postRenderHandler(): void {
  if (!viewer || viewer.isDestroyed() || !outerRef.value) return
  const heading = viewer.camera.heading
  outerRef.value.style.transform = `rotate(${-heading}rad)`
}

function getVector(e: MouseEvent): Cartesian2 {
  if (!compassRect) return new Cartesian2(0, 0)
  const center = new Cartesian2(
    (compassRect.right - compassRect.left) / 2,
    (compassRect.bottom - compassRect.top) / 2
  )
  const click = new Cartesian2(e.clientX - compassRect.left, e.clientY - compassRect.top)
  return Cartesian2.subtract(click, center, new Cartesian2())
}

function getCameraFocus(inWorldCoordinates: boolean): Cartesian3 | undefined {
  if (!viewer || viewer.isDestroyed()) return undefined
  const scene = viewer.scene
  const camera = scene.camera
  if (scene.mode === SceneMode.MORPHING) return undefined
  let result: Cartesian3 | undefined
  if (viewer.trackedEntity) {
    result = viewer.trackedEntity.position?.getValue(viewer.clock.currentTime)
  } else {
    const rayScratch = new Ray(camera.positionWC, camera.directionWC)
    result = scene.globe.pick(rayScratch, scene) ?? undefined
  }
  if (!result) return undefined
  if (scene.mode === SceneMode.SCENE2D || scene.mode === SceneMode.COLUMBUS_VIEW) {
    result = camera.worldToCameraCoordinatesPoint(result)
    const carto = scene.mapProjection.unproject(result)
    result = scene.globe.ellipsoid.cartographicToCartesian(carto)
  } else if (!inWorldCoordinates) {
    result = camera.worldToCameraCoordinatesPoint(result)
  }
  return result
}

function updateAngleAndOpacity(vector: Cartesian2, compassWidth: number): void {
  const angle = Math.atan2(-vector.y, vector.x)
  orbitCursorAngle = CesiumMath.zeroToTwoPi(angle - CesiumMath.PI_OVER_TWO)
  const distance = Cartesian2.magnitude(vector)
  const maxDistance = compassWidth / 2
  const distanceFraction = Math.min(distance / maxDistance, 1)
  orbitCursorOpacity = 0.5 * distanceFraction * distanceFraction + 0.5
  if (markerRef.value) {
    markerRef.value.style.transform = `rotate(${-orbitCursorAngle}rad)`
    markerRef.value.style.opacity = `${orbitCursorOpacity}`
  }
}

function orbitTickFunction(): void {
  if (!viewer || viewer.isDestroyed()) return
  const scene = viewer.scene
  const camera = viewer.camera
  const timestamp = performance.now()
  const deltaT = timestamp - orbitLastTimestamp
  const rate = ((orbitCursorOpacity - 0.5) * 2.5) / 1000
  const distance = deltaT * rate
  const angle = orbitCursorAngle + CesiumMath.PI_OVER_TWO
  const x = Math.cos(angle) * distance
  const y = Math.sin(angle) * distance
  let oldTransform: Matrix4 | undefined
  if (orbitFrame) {
    oldTransform = Matrix4.clone(camera.transform)
    camera.lookAtTransform(orbitFrame)
  }
  if (scene.mode === SceneMode.SCENE2D) {
    camera.move(new Cartesian3(x, y, 0), (Math.max(scene.canvas.clientWidth, scene.canvas.clientHeight) / 100) * camera.positionCartographic.height * distance)
  } else if (orbitIsLook) {
    camera.look(Cartesian3.UNIT_Z, -x)
    camera.look(camera.right, -y)
  } else {
    camera.rotateLeft(x)
    camera.rotateUp(y)
  }
  if (orbitFrame && oldTransform) {
    camera.lookAtTransform(oldTransform)
  }
  orbitLastTimestamp = timestamp
}

function orbit(vector: Cartesian2): void {
  if (!viewer || viewer.isDestroyed()) return
  const scene = viewer.scene
  const sscc = scene.screenSpaceCameraController
  const camera = scene.camera
  if (scene.mode === SceneMode.MORPHING || !sscc.enableInputs) return
  if (scene.mode === SceneMode.COLUMBUS_VIEW) {
    if (sscc.enableLook) return
    if (!sscc.enableTranslate || !sscc.enableTilt) return
  } else if (scene.mode === SceneMode.SCENE3D) {
    if (!sscc.enableTilt || !sscc.enableRotate) return
  } else if (scene.mode === SceneMode.SCENE2D && !sscc.enableTranslate) {
    return
  }

  mouseMoveHandler = (e: MouseEvent) => {
    updateAngleAndOpacity(getVector(e), compassRect?.width ?? 55)
  }
  mouseUpHandler = () => {
    orbitMouseUp()
  }
  document.removeEventListener('mousemove', mouseMoveHandler, false)
  document.removeEventListener('mouseup', mouseUpHandler, false)

  orbitLastTimestamp = performance.now()
  if (viewer.trackedEntity) {
    orbitFrame = undefined
    orbitIsLook = false
  } else {
    const center = getCameraFocus(true)
    if (!center) {
      orbitFrame = Transforms.eastNorthUpToFixedFrame(camera.positionWC, scene.globe.ellipsoid)
      orbitIsLook = true
    } else {
      orbitFrame = Transforms.eastNorthUpToFixedFrame(center, scene.globe.ellipsoid)
      orbitIsLook = false
    }
  }
  if (markerRef.value) markerRef.value.style.visibility = 'visible'
  document.addEventListener('mousemove', mouseMoveHandler, false)
  document.addEventListener('mouseup', mouseUpHandler, false)
  viewer.clock.onTick.addEventListener(orbitTickFunction)
  updateAngleAndOpacity(vector, compassRect?.width ?? 55)
}

function orbitMouseUp(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (mouseMoveHandler) document.removeEventListener('mousemove', mouseMoveHandler, false)
  if (mouseUpHandler) document.removeEventListener('mouseup', mouseUpHandler, false)
  mouseMoveHandler = undefined
  mouseUpHandler = undefined
  viewer.clock.onTick.removeEventListener(orbitTickFunction)
  if (markerRef.value) {
    markerRef.value.style.visibility = 'hidden'
  }
}

function rotate(vector: Cartesian2): void {
  if (!viewer || viewer.isDestroyed()) return
  const scene = viewer.scene
  const camera = scene.camera
  const sscc = scene.screenSpaceCameraController
  if (scene.mode === SceneMode.MORPHING || scene.mode === SceneMode.SCENE2D || !sscc.enableInputs) return
  if (!sscc.enableLook && (scene.mode === SceneMode.COLUMBUS_VIEW || (scene.mode === SceneMode.SCENE3D && !sscc.enableRotate))) return

  mouseMoveHandler = (e: MouseEvent) => {
    rotateMouseMove(e)
  }
  mouseUpHandler = () => {
    if (mouseMoveHandler) document.removeEventListener('mousemove', mouseMoveHandler, false)
    if (mouseUpHandler) document.removeEventListener('mouseup', mouseUpHandler, false)
    mouseMoveHandler = undefined
    mouseUpHandler = undefined
  }
  document.removeEventListener('mousemove', mouseMoveHandler, false)
  document.removeEventListener('mouseup', mouseUpHandler, false)

  rotateInitialCursorAngle = Math.atan2(-vector.y, vector.x)
  if (viewer.trackedEntity) {
    rotateFrame = undefined
  } else {
    const center = getCameraFocus(true)
    if (!center || (scene.mode === SceneMode.COLUMBUS_VIEW && !sscc.enableLook && !sscc.enableTranslate)) {
      rotateFrame = Transforms.eastNorthUpToFixedFrame(camera.positionWC, scene.globe.ellipsoid)
    } else {
      rotateFrame = Transforms.eastNorthUpToFixedFrame(center, scene.globe.ellipsoid)
    }
  }
  let oldTransform: Matrix4 | undefined
  if (rotateFrame) {
    oldTransform = Matrix4.clone(camera.transform)
    camera.lookAtTransform(rotateFrame)
  }
  rotateInitialCameraAngle = -camera.heading
  if (rotateFrame && oldTransform) {
    camera.lookAtTransform(oldTransform)
  }
  document.addEventListener('mousemove', mouseMoveHandler, false)
  document.addEventListener('mouseup', mouseUpHandler, false)
}

function rotateMouseMove(e: MouseEvent): void {
  if (!viewer || viewer.isDestroyed()) return
  const camera = viewer.camera
  const vector = getVector(e)
  const angle = Math.atan2(-vector.y, vector.x)
  const angleDifference = angle - (rotateInitialCursorAngle ?? 0)
  const newCameraAngle = CesiumMath.zeroToTwoPi(rotateInitialCameraAngle - angleDifference)
  let oldTransform: Matrix4 | undefined
  if (rotateFrame) {
    oldTransform = Matrix4.clone(camera.transform)
    camera.lookAtTransform(rotateFrame)
  }
  const currentCameraAngle = -camera.heading
  camera.rotateRight(newCameraAngle - currentCameraAngle)
  if (rotateFrame && oldTransform) {
    camera.lookAtTransform(oldTransform)
  }
}

function onMouseDown(e: MouseEvent): void {
  if (!viewer || viewer.isDestroyed() || !compassEl.value) return
  const scene = viewer.scene
  if (scene.mode === SceneMode.MORPHING) return
  compassRect = compassEl.value.getBoundingClientRect()
  const maxDistance = compassRect.width / 2
  const vector = getVector(e)
  const distanceFraction = Cartesian2.magnitude(vector) / maxDistance
  if (distanceFraction < 0.45) {
    orbit(vector)
  } else if (distanceFraction < 1) {
    rotate(vector)
  }
}

function onDoubleClick(): void {
  if (!viewer || viewer.isDestroyed()) return
  const scene = viewer.scene
  const camera = scene.camera
  const sscc = scene.screenSpaceCameraController
  if (scene.mode === SceneMode.MORPHING || !sscc.enableInputs) return
  if (scene.mode === SceneMode.COLUMBUS_VIEW && !sscc.enableTranslate) return
  if (scene.mode === SceneMode.SCENE3D || scene.mode === SceneMode.COLUMBUS_VIEW) {
    if (!sscc.enableLook) return
    if (scene.mode === SceneMode.SCENE3D && !sscc.enableRotate) return
  }
  const center = getCameraFocus(true)
  if (!center) return
  const cameraPosition = scene.globe.ellipsoid.cartographicToCartesian(camera.positionCartographic)
  const surfaceNormal = scene.globe.ellipsoid.geodeticSurfaceNormal(center)
  const focusBoundingSphere = new BoundingSphere(center, 0)
  camera.flyToBoundingSphere(focusBoundingSphere, {
    offset: new HeadingPitchRange(0, CesiumMath.PI_OVER_TWO - Cartesian3.angleBetween(surfaceNormal, camera.directionWC), Cartesian3.distance(cameraPosition, center)),
    duration: 1.5
  })
}

function onEnableChange(value: boolean): void {
  if (!viewer || viewer.isDestroyed() || !compassEl.value) return
  if (value) {
    compassEl.value.style.display = 'block'
    viewer.scene.postRender.addEventListener(postRenderHandler)
  } else {
    compassEl.value.style.display = 'none'
    viewer.scene.postRender.removeEventListener(postRenderHandler)
  }
  viewer.scene.requestRender()
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
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(118.8, 32.05, 220000) })
    isLoaded.value = true
    viewer.scene.postRender.addEventListener(postRenderHandler)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (viewer && !viewer.isDestroyed()) {
    viewer.scene.postRender.removeEventListener(postRenderHandler)
    viewer.clock.onTick.removeEventListener(orbitTickFunction)
    if (mouseMoveHandler) document.removeEventListener('mousemove', mouseMoveHandler, false)
    if (mouseUpHandler) document.removeEventListener('mouseup', mouseUpHandler, false)
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="widget-shell">
    <div ref="container" class="cesium-container"></div>

    <div ref="compassEl" class="widget-compass" @mousedown.prevent="onMouseDown" @dblclick.prevent="onDoubleClick">
      <svg ref="outerRef" class="compass-outer" viewBox="0 0 162 162">
        <circle cx="81" cy="81" r="81" fill="#2b3f5e" stroke="#4a90d9" stroke-width="3" fill-opacity="0.9"/>
        <circle cx="81" cy="81" r="70" fill="none" stroke="#9ec4ef" stroke-width="1" stroke-opacity="0.35"/>
        <path d="M84.9 23.1 L84.9 13.1 L82.6 13.1 L82.6 19.3 L78 13.1 L75.7 13.1 L75.7 23.1 L78.1 23.1 L78.1 17 L82.7 23.1 Z" fill="#e8f2ff"/>
        <path d="M143.4 82.1 L152.6 82.1 L152.6 81.3 L143.4 81.3 Z" fill="#e8f2ff"/>
        <path d="M9.2 82.1 L18.5 82.1 L18.5 81.3 L9.2 81.3 Z" fill="#e8f2ff"/>
        <circle cx="129.5" cy="128" r="1.6" fill="#e8f2ff"/>
        <circle cx="129.5" cy="35.5" r="1.6" fill="#e8f2ff"/>
        <circle cx="30.8" cy="128" r="1.6" fill="#e8f2ff"/>
        <circle cx="30.8" cy="35.5" r="1.6" fill="#e8f2ff"/>
      </svg>
      <div class="compass-gyro">
        <svg viewBox="0 0 17 17">
          <path d="M8.5 16.5 C4.1 16.5 0.5 12.9 0.5 8.5 C0.5 4.1 4.1 0.5 8.5 0.5 C12.9 0.5 16.5 4.1 16.5 8.5 C16.5 12.9 12.9 16.5 8.5 16.5 Z M8.5 15.5 C12.4 15.5 15.5 12.4 15.5 8.5 C15.5 4.6 12.4 1.5 8.5 1.5 C4.6 1.5 1.5 4.6 1.5 8.5 C1.5 12.4 4.6 15.5 8.5 15.5 Z" fill="#eef4ff"/>
          <path d="M9.926 7.091 C12.712 9.877 14.371 12.545 13.45 13.466 C12.529 14.388 9.86 12.729 7.074 9.943 C4.288 7.156 2.629 4.488 3.55 3.567 C4.472 2.646 7.14 4.304 9.926 7.091 Z M9.219 7.798 C6.928 5.507 4.521 4.011 4.257 4.274 C3.994 4.537 5.491 6.945 7.781 9.236 C10.072 11.526 12.479 13.023 12.743 12.759 C13.006 12.496 11.509 10.088 9.219 7.798 Z" fill="#7ea6d8"/>
          <path d="M9.926 9.943 C7.14 12.729 4.471 14.388 3.55 13.466 C2.629 12.545 4.288 9.877 7.074 7.091 C9.86 4.304 12.529 2.646 13.45 3.567 C14.371 4.488 12.712 7.156 9.926 9.943 Z M9.219 9.236 C11.509 6.945 13.006 4.537 12.743 4.274 C12.479 4.011 10.072 5.507 7.781 7.798 C5.491 10.088 3.994 12.496 4.257 12.759 C4.521 13.022 6.928 11.526 9.219 9.236 Z" fill="#4a90d9"/>
          <circle cx="15" cy="2" r="1" fill="#4a90d9"/>
          <circle cx="2" cy="15" r="1" fill="#4a90d9"/>
        </svg>
      </div>
      <div ref="markerRef" class="compass-rotation-marker">
        <svg viewBox="0 0 53 53">
          <circle cx="26.2" cy="26.2" r="26.2" fill="none" stroke="#e2a549" stroke-width="9" stroke-opacity="0.2"/>
          <path d="M26.2 26.2 L26.2 9 A 17.2 17.2 0 0 1 38 16.5 Z" fill="#4990e2" fill-opacity="0.7"/>
        </svg>
      </div>
    </div>

    <div class="control-panel">
      <div class="panel-title">罗盘控件</div>
      <div class="row">
        <span class="row-label">启用罗盘</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '关闭罗盘' : '启用罗盘'" @click="enabled = !enabled; onEnableChange(enabled)"><i></i></button>
      </div>
      <p class="hint">
        外圈随相机航向自动旋转（指向 N）；拖拽外圈内侧旋转视角航向；拖拽外圈外侧（远离中心）漫游移动视野；双击罗盘将相机回正至俯视视角。右下角为罗盘控件。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.widget-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.widget-compass { position: absolute; right: 22px; bottom: 60px; width: 62px; height: 62px; cursor: pointer; user-select: none; z-index: 10; }
.compass-outer { position: absolute; inset: 0; width: 62px; height: 62px; border-radius: 50%; will-change: transform; }
.compass-gyro { position: absolute; top: 50%; left: 50%; width: 26px; height: 26px; transform: translate(-50%, -50%); border-radius: 50%; background: #eef4ff; padding: 3px; box-sizing: border-box; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45); pointer-events: none; }
.compass-gyro svg { width: 100%; height: 100%; display: block; }
.compass-rotation-marker { position: absolute; top: 3px; left: 3px; width: 56px; height: 56px; border-radius: 50%; visibility: hidden; will-change: transform; pointer-events: none; }
.compass-rotation-marker svg { width: 100%; height: 100%; display: block; }
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
