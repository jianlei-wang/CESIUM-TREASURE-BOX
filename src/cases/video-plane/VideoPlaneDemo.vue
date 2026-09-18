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
import {
  createVideoElement,
  disposeVideoElement,
  moveVideoPrimitive,
  removeVideoPrimitive,
  updateVideoPrimitive,
  type VideoPrimitiveOptions
} from '../video-effects-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const placing = ref(false)

const widthMeters = ref(1200)
const heightMeters = ref(900)
const opacity = ref(1)
const playing = ref(true)

const DEFAULT_LON = 120.38
const DEFAULT_LAT = 36.08

const VIDEO_ID = 'video-plane'
const CURRENT_POS = { lon: DEFAULT_LON, lat: DEFAULT_LAT }

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let video: HTMLVideoElement | undefined

function buildOptions(): VideoPrimitiveOptions {
  return {
    id: VIDEO_ID,
    lon: CURRENT_POS.lon,
    lat: CURRENT_POS.lat,
    widthMeters: widthMeters.value,
    heightMeters: heightMeters.value,
    video: video as HTMLVideoElement,
    materialKind: 'Image',
    opacity: opacity.value,
    color: new Color(1, 1, 1, 1)
  }
}

function place(lon: number, lat: number): void {
  if (!viewer || viewer.isDestroyed() || !video) return
  CURRENT_POS.lon = lon
  CURRENT_POS.lat = lat
  moveVideoPrimitive(viewer, VIDEO_ID, buildOptions())
  resultMessage.value = `平面视频已放置于 ${lon.toFixed(4)}, ${lat.toFixed(4)}`
}

function updateEffect(): void {
  if (!viewer || viewer.isDestroyed() || !video) return
  updateVideoPrimitive(viewer, VIDEO_ID, {
    opacity: opacity.value
  })
  resultMessage.value = '平面视频参数已更新'
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !placing.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  const carto = Cartographic.fromCartesian(pos)
  place(CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude))
}

watch([widthMeters, heightMeters], () => {
  if (viewer && !viewer.isDestroyed() && video) {
    moveVideoPrimitive(viewer, VIDEO_ID, buildOptions())
    resultMessage.value = '平面视频参数已更新'
  }
})

watch(opacity, () => {
  if (viewer && !viewer.isDestroyed() && video) {
    updateVideoPrimitive(viewer, VIDEO_ID, { opacity: opacity.value })
    resultMessage.value = '平面视频参数已更新'
  }
})

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    video = createVideoElement()
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(DEFAULT_LON, DEFAULT_LAT, 12000)
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
  removeVideoPrimitive(viewer, VIDEO_ID)
  destroyScene(viewer)
  viewer = undefined
  disposeVideoElement(video)
  video = undefined
})
</script>

<template>
  <div class="video-plane-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">平面视频</div>

      <button class="action-button primary" :class="{ active: placing }" @click="placing = !placing">
        {{ placing ? '放置中… 点击地图定位' : '点击地图放置视频区域' }}
      </button>
      <button class="action-button neutral" @click="place(DEFAULT_LON, DEFAULT_LAT)">重置默认位置</button>

      <div class="section-title">视频参数</div>
      <div class="control-row">
        <span class="row-label">宽度(m)</span>
        <input v-model.number="widthMeters" type="range" min="300" max="3000" step="50" />
        <span class="row-value">{{ widthMeters }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">高度(m)</span>
        <input v-model.number="heightMeters" type="range" min="300" max="3000" step="50" />
        <span class="row-value">{{ heightMeters }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">透明度</span>
        <input v-model.number="opacity" type="range" min="0.2" max="1" step="0.05" />
        <span class="row-value">{{ opacity.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">视频播放</span>
        <button class="mini-button" @click="playing = !playing; video && (playing ? video.play() : video.pause())">
          {{ playing ? '暂停' : '播放' }}
        </button>
      </div>

      <p class="hint">视频将作为影像贴地显示；开启放置后单击地图可移动区域，参数修改实时生效。</p>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.video-plane-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 248px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 48px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.action-button { width: 100%; height: 28px; margin-top: 6px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.primary.active { background: #1f6f96; }
.action-button.neutral { background: #2c3a52; color: #c3d5e8; }
.mini-button { height: 22px; padding: 0 10px; border: 0; border-radius: 4px; background: #2c3a52; color: #c3d5e8; cursor: pointer; font-size: 11px; }
.hint { margin: 8px 0 0; font-size: 11px; color: #7f96b3; line-height: 1.5; }
.result-message { margin-top: 6px; font-size: 11px; color: #8be0b2; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
