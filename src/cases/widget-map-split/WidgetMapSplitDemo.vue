<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  ImageryLayer,
  SplitDirection,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const splitterWrap = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const enabled = ref(true)
const compareType = ref<'none' | 'streets' | 'imagery'>('streets')

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let moveActive = false
let compareLayer: ImageryLayer | undefined

function syncSplitter(): void {
  if (!viewer || viewer.isDestroyed() || !splitterWrap.value) return
  const position = viewer.scene.splitPosition
  splitterWrap.value.style.left = `${position * 100}%`
}

async function setCompare(type: 'none' | 'streets' | 'imagery'): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  if (compareLayer) {
    viewer.imageryLayers.remove(compareLayer)
    compareLayer = undefined
  }
  if (type === 'none') return
  const url =
    type === 'streets'
      ? 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}'
      : 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x={x}&y={y}&z={z}'
  try {
    const provider = new UrlTemplateImageryProvider({
      url,
      subdomains: ['1', '2', '3', '4'],
      maximumLevel: 18
    })
    if (!viewer || viewer.isDestroyed()) return
    compareLayer = viewer.imageryLayers.addImageryProvider(provider)
    compareLayer.splitDirection = SplitDirection.LEFT
    viewer.scene.splitPosition = viewer.scene.splitPosition || 0.5
    syncSplitter()
  } catch {
    // 对比图层加载失败时忽略
  }
}

function onEnableChange(value: boolean): void {
  if (!viewer || viewer.isDestroyed() || !splitterWrap.value) return
  if (value) {
    splitterWrap.value.style.display = 'block'
    viewer.scene.splitPosition = 0.5
  } else {
    splitterWrap.value.style.display = 'none'
    viewer.scene.splitPosition = 1
  }
  syncSplitter()
  viewer.scene.requestRender()
}

function moveHandler(movement: { endPosition: { x: number } }): void {
  if (!viewer || viewer.isDestroyed() || !splitterWrap.value || !moveActive || !enabled.value) return
  const relativeOffset = movement.endPosition.x
  const splitPosition = (splitterWrap.value.offsetLeft + relativeOffset) / splitterWrap.value.parentElement!.offsetWidth
  splitterWrap.value.style.left = `${100 * splitPosition}%`
  viewer.scene.splitPosition = splitPosition
}

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => {
      statusMessage.value = ''
      void setCompare(compareType.value)
      if (viewer && !viewer.isDestroyed()) viewer.scene.splitPosition = 0.5
      syncSplitter()
    }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks, (layer) => {
      layer.splitDirection = SplitDirection.RIGHT
    })
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(118.8, 32.05, 260000) })

    if (splitterWrap.value) {
      handler = new ScreenSpaceEventHandler(splitterWrap.value as unknown as HTMLCanvasElement)
      handler.setInputAction(() => { moveActive = true }, ScreenSpaceEventType.LEFT_DOWN)
      handler.setInputAction(() => { moveActive = true }, ScreenSpaceEventType.PINCH_START)
      handler.setInputAction(moveHandler, ScreenSpaceEventType.MOUSE_MOVE)
      handler.setInputAction(moveHandler, ScreenSpaceEventType.PINCH_MOVE)
      handler.setInputAction(() => { moveActive = false }, ScreenSpaceEventType.LEFT_UP)
      handler.setInputAction(() => { moveActive = false }, ScreenSpaceEventType.PINCH_END)
    }
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

    <div ref="splitterWrap" v-show="enabled" class="cesium-slider">
      <div class="splitter">
        <svg viewBox="0 0 16 16" width="16" height="16">
          <path d="M3 3 L7 8 L3 13" fill="none" stroke="#3a4a5f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M13 3 L9 8 L13 13" fill="none" stroke="#3a4a5f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>

    <div class="control-panel">
      <div class="panel-title">地图卷帘控件</div>
      <div class="row">
        <span class="row-label">启用卷帘</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '关闭卷帘' : '启用卷帘'" @click="enabled = !enabled; onEnableChange(enabled)"><i></i></button>
      </div>
      <div class="row">
        <span class="row-label">左侧对比底图</span>
        <select v-model="compareType" class="select" @change="setCompare(compareType)">
          <option value="streets">高德街道图</option>
          <option value="imagery">高德影像图</option>
          <option value="none">无</option>
        </select>
      </div>
      <p class="hint">
        按住中央圆形滑块左右拖动，可对比左右两侧不同底图：右侧为 Bing 影像，左侧为高德街道/影像图。松开即固定分割位置。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.widget-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.cesium-slider { position: absolute; top: 0; bottom: 0; left: 50%; z-index: 20; width: 5px; background-color: #d3d3d3; }
.splitter { position: absolute; left: -21px; top: calc(50% - 22px); width: 42px; height: 42px; background: #fff; border: 1px solid lightgrey; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); }
.splitter:hover { cursor: ew-resize; }
.control-panel { position: absolute; top: 12px; left: 12px; z-index: 30; width: 260px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.row-label { color: #c3d5e8; font-size: 11px; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }
.toggle.on { background: #2f80ed; }
.toggle.on i { transform: translateX(18px); }
.select { background: rgba(20, 40, 70, 0.9); border: 1px solid rgba(157, 188, 224, 0.35); color: #dce8f5; font-size: 11px; border-radius: 4px; padding: 2px 4px; }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
