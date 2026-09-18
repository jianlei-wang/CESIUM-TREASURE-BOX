<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  Cartographic,
  Color,
  Rectangle,
  SceneMode,
  ScreenSpaceEventType,
  Viewer,
  type Viewer as ViewerType
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import { createBingRoadImageryProvider } from '../../lib/bing'

const container = ref<HTMLElement | null>(null)
const miniContainer = ref<HTMLElement | null>(null)
const rangeOverlay = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const enabled = ref(true)

let viewer: Viewer | undefined
let miniViewer: ViewerType | undefined

const DEG = 180 / Math.PI
const MAX_LATITUDE = 85.05112878

function clampLatitude(value: number): number {
  return Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, value))
}

function wrapLongitude(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180
}

interface PlaneExtent {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function planeExtent(w: number, s: number, e: number, n: number): PlaneExtent {
  if (!miniViewer || miniViewer.isDestroyed()) {
    return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  }
  const miniScene = miniViewer.scene
  const project = (lon: number, lat: number) =>
    miniScene.mapProjection.project(Cartographic.fromDegrees(wrapLongitude(lon), lat))
  const xs = [project(w, s).x, project(e, s).x, project(w, n).x, project(e, n).x]
  const ys = [project(w, s).y, project(e, s).y, project(w, n).y, project(e, n).y]
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  }
}

function syncMap(): void {
  if (!viewer || viewer.isDestroyed() || !miniViewer || miniViewer.isDestroyed()) return
  const scene = viewer.scene
  const viewRect = scene.camera.computeViewRectangle(scene.globe.ellipsoid)
  if (!viewRect || viewRect.west >= viewRect.east || viewRect.south >= viewRect.north) return

  const mainWest = wrapLongitude(viewRect.west * DEG)
  const mainEast = wrapLongitude(viewRect.east * DEG)
  const mainSouth = viewRect.south * DEG
  const mainNorth = viewRect.north * DEG
  const mainCenterX = (mainWest + mainEast) / 2
  const mainCenterY = (mainSouth + mainNorth) / 2
  const mainSpanX = mainEast - mainWest
  const mainSpanY = mainNorth - mainSouth

  const extWest = wrapLongitude(mainCenterX - mainSpanX)
  const extEast = wrapLongitude(mainCenterX + mainSpanX)
  const extSouth = clampLatitude(mainCenterY - mainSpanY)
  const extNorth = clampLatitude(mainCenterY + mainSpanY)

  miniViewer.camera.setView({ destination: Rectangle.fromDegrees(extWest, extSouth, extEast, extNorth) })

  const mainExtent = planeExtent(mainWest, mainSouth, mainEast, mainNorth)
  const extExtent = planeExtent(extWest, extSouth, extEast, extNorth)
  const spanX = extExtent.maxX - extExtent.minX
  const spanY = extExtent.maxY - extExtent.minY
  if (spanX <= 0 || spanY <= 0) return
  const pct = (value: number, min: number, max: number): number => ((value - min) / (max - min)) * 100
  if (rangeOverlay.value) {
    rangeOverlay.value.style.left = `${pct(mainExtent.minX, extExtent.minX, extExtent.maxX)}%`
    rangeOverlay.value.style.top = `${pct(extExtent.maxY, extExtent.minY, extExtent.maxY)}%`
    rangeOverlay.value.style.width = `${(mainExtent.maxX - mainExtent.minX) / spanX * 100}%`
    rangeOverlay.value.style.height = `${(mainExtent.maxY - mainExtent.minY) / spanY * 100}%`
  }
  miniViewer.scene.requestRender()
}

function setupMiniViewer(): void {
  if (!miniContainer.value || !viewer || viewer.isDestroyed()) return
  miniViewer = new Viewer(miniContainer.value, {
    animation: false,
    baseLayerPicker: false,
    baseLayer: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    navigationInstructionsInitiallyVisible: false,
    creditContainer: undefined,
    sceneMode: SceneMode.SCENE2D,
    shouldAnimate: false
  })
  miniViewer.imageryLayers.removeAll()
  const miniCredit = miniViewer.cesiumWidget.creditContainer as HTMLElement | undefined
  if (miniCredit) miniCredit.style.display = 'none'
  const handler = miniViewer.cesiumWidget.screenSpaceEventHandler
  handler?.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
  miniViewer.scene.backgroundColor = Color.TRANSPARENT
  const miniController = miniViewer.scene.screenSpaceCameraController
  miniController.enableRotate = false
  miniController.enableTranslate = false
  miniController.enableZoom = false
  miniController.enableTilt = false
  miniController.enableLook = false
  try {
    miniViewer.imageryLayers.addImageryProvider(createBingRoadImageryProvider())
  } catch {
    // 小地图底图加载失败时保持纯色背景
  }
  viewer.camera.percentageChanged = 0.01
  viewer.camera.changed.addEventListener(syncMap)
  syncMap()
}

function onEnableChange(value: boolean): void {
  if (!miniContainer.value) return
  miniContainer.value.style.display = value ? 'block' : 'none'
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
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(118.8, 32.05, 260000) })
    setupMiniViewer()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (viewer && !viewer.isDestroyed()) {
    viewer.camera.changed.removeEventListener(syncMap)
  }
  if (miniViewer && !miniViewer.isDestroyed()) {
    miniViewer.destroy()
  }
  miniViewer = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="widget-shell">
    <div ref="container" class="cesium-container"></div>

    <div ref="miniContainer" v-show="enabled" class="cesium-hawkeye-map">
      <div ref="rangeOverlay" class="hawkeye-range"></div>
    </div>

    <div class="control-panel">
      <div class="panel-title">鹰眼小地图控件</div>
      <div class="row">
        <span class="row-label">显示鹰眼</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '隐藏鹰眼' : '显示鹰眼'" @click="enabled = !enabled; onEnableChange(enabled)"><i></i></button>
      </div>
      <p class="hint">
        左下角圆形小窗为 2D 鹰眼视图，叠加 Bing 街道底图；缩放级别比主地图低 2 级（视野为 4 倍范围），黄色矩形框标出主地图当前视野；随主相机移动自动同步中心与缩放，仅作位置参考、不可交互。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.widget-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.cesium-hawkeye-map { position: absolute; left: 16px; bottom: 16px; z-index: 10; width: 150px; height: 150px; overflow: hidden; border: 2px solid #ffa726; border-radius: 50%; box-shadow: 2px 2px 8px rgba(0, 0, 0, 0.5); pointer-events: none; background: #0d1e38; }
.cesium-hawkeye-map :deep(.cesium-widget) { border-radius: 50%; }
.hawkeye-range { position: absolute; box-sizing: border-box; border: 2px solid #ffd54d; background: rgba(255, 213, 77, 0.14); pointer-events: none; }
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
