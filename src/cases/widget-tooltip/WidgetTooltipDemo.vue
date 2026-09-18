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
const tooltipEl = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const enabled = ref(true)
const followMouse = ref(true)
const customText = ref('')

const tooltipVisible = ref(false)
const tooltipLeft = ref(0)
const tooltipTop = ref(0)
const tooltipContent = ref('')

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined

function updateWindowCoord(pos: { x: number; y: number }): void {
  tooltipLeft.value = pos.x + 12
  tooltipTop.value = pos.y - 15
}

function onMouseMove(movement: { endPosition: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !enabled.value) return
  if (!followMouse.value) {
    tooltipVisible.value = false
    return
  }
  const scene = viewer.scene
  let surfacePosition: Cartesian3 | undefined
  if (scene.mode === SceneMode.SCENE3D) {
    const ray = scene.camera.getPickRay(movement.endPosition)
    surfacePosition = ray ? scene.globe.pick(ray, scene) ?? undefined : undefined
  } else {
    surfacePosition = scene.camera.pickEllipsoid(movement.endPosition, Ellipsoid.WGS84) ?? undefined
  }

  let content = customText.value.trim()
  if (surfacePosition) {
    const carto = Ellipsoid.WGS84.cartesianToCartographic(surfacePosition)
    if (carto) {
      const lng = CesiumMath.toDegrees(carto.longitude).toFixed(5)
      const lat = CesiumMath.toDegrees(carto.latitude).toFixed(5)
      if (!content) content = `经度 ${lng}° / 纬度 ${lat}°`
      else content += `（${lng}°, ${lat}°）`
    }
  } else if (!content) {
    content = '未拾取到地面点'
  }

  tooltipContent.value = content
  updateWindowCoord(movement.endPosition)
  tooltipVisible.value = true
}

function onEnableChange(value: boolean): void {
  if (!handler || !viewer || viewer.isDestroyed()) return
  if (value) {
    handler.setInputAction(onMouseMove, ScreenSpaceEventType.MOUSE_MOVE)
  } else {
    handler.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE)
    tooltipVisible.value = false
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
    handler.setInputAction(onMouseMove, ScreenSpaceEventType.MOUSE_MOVE)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (handler && !handler.isDestroyed()) handler.destroy()
  handler = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="widget-shell">
    <div ref="container" class="cesium-container"></div>

    <div ref="tooltipEl" v-show="tooltipVisible" class="cesium-tool-tip" :style="{ left: tooltipLeft + 'px', top: tooltipTop + 'px' }">
      {{ tooltipContent }}
    </div>

    <div class="control-panel">
      <div class="panel-title">提示浮层控件</div>
      <div class="row">
        <span class="row-label">启用提示</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '关闭提示' : '启用提示'" @click="enabled = !enabled; onEnableChange(enabled)"><i></i></button>
      </div>
      <div class="row">
        <span class="row-label">跟随鼠标</span>
        <button class="toggle" :class="{ on: followMouse }" aria-label="切换跟随鼠标" @click="followMouse = !followMouse"><i></i></button>
      </div>
      <input v-model="customText" class="text-input" placeholder="自定义提示内容（可选）" />
      <p class="hint">
        鼠标移动时浮层跟随光标右侧显示信息：默认显示拾取点经纬度，也可在上方输入自定义文本，文本后自动追加坐标。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.widget-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.cesium-tool-tip { position: absolute; top: 0; left: 0; z-index: 30; max-width: 320px; height: 30px; line-height: 30px; white-space: nowrap; color: #fff; padding: 0 12px; background: rgba(0, 0, 0, 0.72); border-radius: 4px; pointer-events: none; font-size: 12px; }
.cesium-tool-tip::before { content: ''; display: block; position: absolute; left: -10px; top: 5px; border-top: 10px solid transparent; border-bottom: 10px solid transparent; border-right: 10px solid rgba(0, 0, 0, 0.72); }
.control-panel { position: absolute; top: 12px; left: 12px; z-index: 20; width: 260px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.row-label { color: #c3d5e8; font-size: 11px; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }
.toggle.on { background: #2f80ed; }
.toggle.on i { transform: translateX(18px); }
.text-input { margin-top: 10px; width: 100%; box-sizing: border-box; padding: 5px 8px; border: 1px solid rgba(157, 188, 224, 0.35); border-radius: 5px; background: rgba(20, 40, 70, 0.9); color: #dce8f5; font-size: 11px; }
.text-input::placeholder { color: #5c7390; }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
