<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Cartesian2, Cartesian3, EllipsoidGeodesic, type Viewer } from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

const BASE = [1, 2, 3, 5]
const DIS = [
  ...BASE,
  ...BASE.map((item) => item * 10),
  ...BASE.map((item) => item * 100),
  ...BASE.map((item) => item * 1000),
  ...BASE.map((item) => item * 10000),
  ...BASE.map((item) => item * 100000),
  ...BASE.map((item) => item * 1000000)
]

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const enabled = ref(true)
const label = ref('')
const barWidth = ref(0)
const legendVisible = ref(false)

let viewer: Viewer | undefined
let geodesic = new EllipsoidGeodesic()
let lastUpdate = 0

function updateContent(): void {
  if (!viewer || viewer.isDestroyed()) return
  const now = performance.now()
  if (now < lastUpdate + 250) return
  lastUpdate = now

  const scene = viewer.scene
  const width = scene.canvas.width
  const height = scene.canvas.height
  const leftRay = scene.camera.getPickRay(new Cartesian2((width / 2) | 0, height - 1))
  const rightRay = scene.camera.getPickRay(new Cartesian2((1 + width / 2) | 0, height - 1))
  if (!leftRay || !rightRay) return
  const leftPosition = scene.globe.pick(leftRay, scene)
  const rightPosition = scene.globe.pick(rightRay, scene)
  if (!leftPosition || !rightPosition) return

  geodesic.setEndPoints(
    scene.globe.ellipsoid.cartesianToCartographic(leftPosition),
    scene.globe.ellipsoid.cartesianToCartographic(rightPosition)
  )
  const pixelDistance = geodesic.surfaceDistance

  const maxBarWidth = 100
  let distance = 0
  for (let i = DIS.length - 1; i >= 0; --i) {
    if (DIS[i] / pixelDistance < maxBarWidth) {
      distance = DIS[i]
      break
    }
  }
  if (distance) {
    legendVisible.value = true
    label.value = distance >= 1000 ? `${distance / 1000} km` : `${distance} m`
    barWidth.value = (distance / pixelDistance) | 0
  } else {
    legendVisible.value = false
  }
}

function onEnableChange(value: boolean): void {
  if (!viewer || viewer.isDestroyed()) return
  legendVisible.value = value && enabled.value
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
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(118.8, 32.05, 260000) })
    viewer.scene.preRender.addEventListener(updateContent)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (viewer && !viewer.isDestroyed()) {
    viewer.scene.preRender.removeEventListener(updateContent)
  }
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="widget-shell">
    <div ref="container" class="cesium-container"></div>

    <div v-show="enabled && legendVisible" class="cesium-distance-legend">
      <div class="label">{{ label }}</div>
      <div class="scale-bar" :style="{ width: barWidth + 'px', left: (125 - barWidth) / 2 + 'px' }"></div>
    </div>

    <div class="control-panel">
      <div class="panel-title">距离比例尺控件</div>
      <div class="row">
        <span class="row-label">显示比例尺</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '隐藏比例尺' : '显示比例尺'" @click="enabled = !enabled; onEnableChange(enabled)"><i></i></button>
      </div>
      <p class="hint">
        比例尺按 1/2/3/5 序列自适应档位（米/千米），通过屏幕中心左右两侧的地面点测地线距离换算，随相机视角与缩放级别实时刷新。控件位于地图底部中央。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.widget-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.cesium-distance-legend { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); width: 125px; height: 25px; user-select: none; z-index: 10; }
.label { font-size: 13px; color: #ffffff; text-align: center; width: 100%; font-weight: 500; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6); }
.scale-bar { position: absolute; height: 10px; top: 10px; border-left: 1.5px solid #ffffff; border-right: 1.5px solid #ffffff; border-bottom: 1.5px solid #ffffff; }
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
