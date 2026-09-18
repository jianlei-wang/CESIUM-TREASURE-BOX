<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Color,
  Ellipsoid,
  Math as CesiumMath,
  NearFarScalar,
  PointPrimitiveCollection,
  SceneTransforms,
  ScreenSpaceEventType,
  ScreenSpaceEventHandler,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const showPopups = ref(true)
const resultMessage = ref('')

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let removePreRender: (() => void) | undefined
let points: PointPrimitiveCollection | undefined

type PopupEntry = {
  position: Cartesian3
  lon: number
  lat: number
  height: number
  el: HTMLDivElement
}

const popups: PopupEntry[] = []

function createPopupDom(index: number): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'html-popup-item'
  el.innerHTML = `
    <div class="popup-title">HTML 弹窗 ${index}</div>
    <div class="popup-lines">
      <div>经度: --</div>
      <div>纬度: --</div>
      <div>高度: --</div>
    </div>
  `
  container.value?.appendChild(el)
  return el
}

function updatePopupDom(entry: PopupEntry): void {
  const lines = entry.el.querySelector('.popup-lines')
  if (lines) {
    lines.innerHTML = `
      <div>经度: ${CesiumMath.toDegrees(entry.lon).toFixed(6)}°</div>
      <div>纬度: ${CesiumMath.toDegrees(entry.lat).toFixed(6)}°</div>
      <div>高度: ${entry.height.toFixed(1)} m</div>
    `
  }
}

function addPopup(windowPosition: Cartesian2): void {
  if (!viewer || !points) return
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
  if (!position) return
  addPopupAt(position)
}

function addPopupAt(position: Cartesian3): void {
  if (!viewer || !points) return
  const carto = Ellipsoid.WGS84.cartesianToCartographic(position)
  const index = popups.length + 1
  const el = createPopupDom(index)
  const entry: PopupEntry = {
    position,
    lon: carto.longitude,
    lat: carto.latitude,
    height: carto.height,
    el
  }
  updatePopupDom(entry)
  popups.push(entry)

  points.add({
    position,
    color: Color.fromCssColorString('#ffc96b'),
    pixelSize: 10,
    outlineColor: Color.WHITE,
    outlineWidth: 2,
    scaleByDistance: new NearFarScalar(1000, 1.2, 5_000_000, 0.4),
    disableDepthTestDistance: Number.POSITIVE_INFINITY
  })

  if (!showPopups.value) el.style.display = 'none'
  resultMessage.value = `已添加弹窗 ${index}`
}

function updatePopupScreenPositions(): void {
  if (!viewer) return
  const scene = viewer.scene
  for (const entry of popups) {
    const windowPosition = SceneTransforms.worldToWindowCoordinates(scene, entry.position)
    if (!windowPosition) {
      entry.el.style.display = 'none'
      continue
    }
    entry.el.style.left = `${windowPosition.x - entry.el.offsetWidth / 2}px`
    entry.el.style.top = `${windowPosition.y - entry.el.offsetHeight - 18}px`
    entry.el.style.display = showPopups.value ? 'block' : 'none'
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
    points = viewer.scene.primitives.add(new PointPrimitiveCollection())
    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((movement: { position: Cartesian2 }) => {
      addPopup(movement.position)
    }, ScreenSpaceEventType.LEFT_CLICK)

    const onPreRender = () => updatePopupScreenPositions()
    viewer.scene.preRender.addEventListener(onPreRender)
    removePreRender = () => viewer?.scene.preRender.removeEventListener(onPreRender)
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(116.39, 39.9, 500_000)
    })
    addPopupAt(Cartesian3.fromDegrees(116.3913, 39.9075, 0))
    addPopupAt(Cartesian3.fromDegrees(116.4013, 39.8975, 0))
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  removePreRender?.()
  handler?.destroy()
  handler = undefined
  if (points && viewer) {
    viewer.scene.primitives.remove(points)
  }
  points = undefined
  for (const entry of popups) {
    entry.el.remove()
  }
  popups.length = 0
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="html-popup-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="control-panel">
      <div class="panel-title">自定义 HTML 弹窗</div>
      <div class="hint">点击地图添加弹窗，拖动地球弹窗跟随移动</div>
      <div class="control-row">
        <label class="switch-label">显示弹窗</label>
        <input v-model="showPopups" type="checkbox" @change="updatePopupScreenPositions" />
      </div>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.html-popup-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 240px; padding: 12px; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 32, 49, 0.84); backdrop-filter: blur(6px); color: #ddf2f8; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.hint { margin-top: 6px; font-size: 11px; color: #7fb6c9; }
.control-row { display: flex; align-items: center; justify-content: space-between; padding: 3px 0; }
.switch-label { font-size: 11px; color: #bdd9e4; }
.result-message { margin-top: 8px; font-size: 11px; color: #8be0b2; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>

<style>
.html-popup-shell .html-popup-item { position: absolute; z-index: 20; width: 170px; padding: 8px 10px; border: 1px solid rgba(255, 201, 107, 0.55); border-radius: 8px; background: rgba(16, 43, 64, 0.92); color: #fff6e0; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4); pointer-events: none; }
.html-popup-shell .popup-title { font-size: 12px; font-weight: 700; margin-bottom: 5px; color: #ffc96b; }
.html-popup-shell .popup-lines { font-size: 11px; line-height: 1.6; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
