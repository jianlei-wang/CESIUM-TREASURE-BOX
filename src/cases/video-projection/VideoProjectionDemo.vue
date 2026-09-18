<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  Cartesian3,
  Cartographic,
  GroundPrimitive,
  Math as CesiumMath,
  Matrix4,
  sampleTerrainMostDetailed,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  loadWorldTerrain,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import {
  VideoFusionManager,
  type CameraStateInput,
  type ProjectionCameraConfig
} from '../video-projection-lib'

const VIDEO_URL = '/videos/demo.mp4'
const BASE_LON = 120.628
const BASE_LAT = 36.185

type CameraUiState = {
  id: string
  label: string
  lon: number
  lat: number
  ground: number
  height: number
  heading: number
  pitch: number
  roll: number
  horizontalFov: number
  far: number
  tintHex: string
}

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')

const mode = ref<'single' | 'multi'>('single')
const fusionEnabled = ref(true)
const frustumVisible = ref(true)
const boundaryVisible = ref(true)
const playing = ref(true)
const videoAlpha = ref(0.92)
const edgeFeather = ref(0.08)
const depthFeather = ref(80)
const activeCameraIndex = ref(0)

const cameras = reactive<CameraUiState[]>([
  {
    id: 'A',
    label: '摄像头 A',
    lon: BASE_LON,
    lat: BASE_LAT,
    ground: 0,
    height: 900,
    heading: 150,
    pitch: -34,
    roll: 0,
    horizontalFov: 74,
    far: 3500,
    tintHex: '#ffffff'
  },
  {
    id: 'B',
    label: '摄像头 B',
    lon: BASE_LON - 0.012,
    lat: BASE_LAT - 0.012,
    ground: 0,
    height: 1000,
    heading: 120,
    pitch: -30,
    roll: 0,
    horizontalFov: 68,
    far: 3500,
    tintHex: '#ffb066'
  }
])

const lonRange = { min: BASE_LON - 0.08, max: BASE_LON + 0.08 }
const latRange = { min: BASE_LAT - 0.08, max: BASE_LAT + 0.08 }

let viewer: Viewer | undefined
let manager: VideoFusionManager | undefined
let disposed = false

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const normalized = value.length === 3
    ? value.split('').map((c) => c + c).join('')
    : value
  const r = parseInt(normalized.substring(0, 2), 16) / 255
  const g = parseInt(normalized.substring(2, 4), 16) / 255
  const b = parseInt(normalized.substring(4, 6), 16) / 255
  return [Number.isFinite(r) ? r : 1, Number.isFinite(g) ? g : 1, Number.isFinite(b) ? b : 1]
}

function buildConfig(camera: CameraUiState): ProjectionCameraConfig {
  return {
    lon: camera.lon,
    lat: camera.lat,
    height: camera.height,
    heading: camera.heading,
    pitch: camera.pitch,
    roll: camera.roll,
    horizontalFov: camera.horizontalFov,
    aspectRatio: 16 / 9,
    near: 1,
    far: camera.far,
    videoAlpha: videoAlpha.value,
    edgeFeather: edgeFeather.value,
    depthFeather: depthFeather.value,
    tint: hexToRgb(camera.tintHex)
  }
}

function applyState(): void {
  if (!manager || !viewer || viewer.isDestroyed() || disposed) return
  const inputs: CameraStateInput[] = cameras.map((camera, index) => ({
    id: camera.id,
    active: index === 0 || mode.value === 'multi',
    config: buildConfig(camera),
    videoUrl: VIDEO_URL
  }))
  manager.sync(inputs, {
    fusionEnabled: fusionEnabled.value,
    frustumVisible: frustumVisible.value,
    boundaryVisible: boundaryVisible.value
  })
}

function focusCamera(index: number): void {
  if (!viewer || viewer.isDestroyed()) return
  const list = mode.value === 'multi' ? cameras : [cameras[index]]
  const lon = list.reduce((sum, camera) => sum + camera.lon, 0) / list.length
  const lat = list.reduce((sum, camera) => sum + camera.lat, 0) / list.length
  viewer.camera.lookAtTransform(Matrix4.IDENTITY)
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(lon - 0.02, lat + 0.055, 5000),
    orientation: {
      heading: CesiumMath.toRadians(165),
      pitch: CesiumMath.toRadians(-35),
      roll: 0
    },
    duration: 0.8
  })
}

watch(
  [cameras, mode, fusionEnabled, frustumVisible, boundaryVisible, videoAlpha, edgeFeather, depthFeather],
  applyState,
  { deep: true }
)

watch(playing, (value) => {
  if (!manager) return
  if (value) manager.playAll()
  else manager.pauseAll()
})

watch(mode, (value) => {
  if (value === 'single') activeCameraIndex.value = 0
})

async function setupTerrain(): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  const terrainProvider = await loadWorldTerrain(viewer)
  if (disposed || !viewer || viewer.isDestroyed()) return
  const points = cameras.map((camera) => Cartographic.fromDegrees(camera.lon, camera.lat))
  try {
    const sampled = await sampleTerrainMostDetailed(terrainProvider, points)
    if (disposed) return
    sampled.forEach((point, index) => {
      cameras[index].ground = point.height ?? 0
      cameras[index].height = (point.height ?? 0) + (index === 0 ? 420 : 520)
    })
  } catch {
    cameras.forEach((camera, index) => {
      camera.ground = 0
      camera.height = index === 0 ? 900 : 1000
    })
  }
  applyState()
  focusCamera(0)
  statusMessage.value = ''
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
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.logarithmicDepthBuffer = false
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = true
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(BASE_LON - 0.03, BASE_LAT - 0.05, 6000)
    })
    try {
      await GroundPrimitive.initializeTerrainHeights()
    } catch {
      /* 地形高度预加载失败时退回惰性初始化，不影响视频投影 */
    }
    if (disposed || !viewer || viewer.isDestroyed()) return
    manager = new VideoFusionManager(viewer.scene)
    applyState()
    void setupTerrain()
    resultMessage.value = '视锥体与裁切面随参数实时刷新，可切换单路投影 / 多路融合'
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  manager?.destroy()
  manager = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="video-projection-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">实时视频投影融合</div>

      <div class="mode-switch">
        <button class="mode-button" :class="{ active: mode === 'single' }" @click="mode = 'single'">单路投影</button>
        <button class="mode-button" :class="{ active: mode === 'multi' }" @click="mode = 'multi'">多路融合</button>
      </div>

      <div class="toggle-row">
        <span class="row-label">视频融合</span>
        <button class="toggle" :class="{ on: fusionEnabled }" @click="fusionEnabled = !fusionEnabled"><i></i></button>
      </div>
      <div class="toggle-row">
        <span class="row-label">视锥体线框</span>
        <button class="toggle" :class="{ on: frustumVisible }" @click="frustumVisible = !frustumVisible"><i></i></button>
      </div>
      <div class="toggle-row">
        <span class="row-label">裁切边界</span>
        <button class="toggle" :class="{ on: boundaryVisible }" @click="boundaryVisible = !boundaryVisible"><i></i></button>
      </div>

      <div class="section-title">融合效果</div>
      <div class="control-row">
        <span class="row-label">透明度</span>
        <input v-model.number="videoAlpha" type="range" min="0.1" max="1" step="0.02" />
        <span class="row-value">{{ videoAlpha.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">边缘羽化</span>
        <input v-model.number="edgeFeather" type="range" min="0" max="0.3" step="0.01" />
        <span class="row-value">{{ edgeFeather.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">深度羽化</span>
        <input v-model.number="depthFeather" type="range" min="5" max="400" step="5" />
        <span class="row-value">{{ depthFeather }}</span>
      </div>

      <div class="section-title">摄像头参数</div>
      <div class="camera-tabs">
        <button
          v-for="(camera, index) in cameras"
          :key="camera.id"
          class="camera-tab"
          :class="{ active: activeCameraIndex === index, disabled: index === 1 && mode === 'single' }"
          :disabled="index === 1 && mode === 'single'"
          @click="activeCameraIndex = index"
        >
          {{ camera.label }}
        </button>
      </div>

      <template v-for="(camera, index) in cameras" :key="camera.id">
        <template v-if="activeCameraIndex === index">
          <div class="control-row">
            <span class="row-label">经度</span>
            <input v-model.number="camera.lon" type="range" :min="lonRange.min" :max="lonRange.max" step="0.0005" />
            <span class="row-value">{{ camera.lon.toFixed(4) }}</span>
          </div>
          <div class="control-row">
            <span class="row-label">纬度</span>
            <input v-model.number="camera.lat" type="range" :min="latRange.min" :max="latRange.max" step="0.0005" />
            <span class="row-value">{{ camera.lat.toFixed(4) }}</span>
          </div>
          <div class="control-row">
            <span class="row-label">高度(m)</span>
            <input v-model.number="camera.height" type="range" min="50" max="4000" step="10" />
            <span class="row-value">{{ camera.height }}</span>
          </div>
          <div class="control-row">
            <span class="row-label">航向(°)</span>
            <input v-model.number="camera.heading" type="range" min="0" max="360" step="1" />
            <span class="row-value">{{ camera.heading }}</span>
          </div>
          <div class="control-row">
            <span class="row-label">俯仰(°)</span>
            <input v-model.number="camera.pitch" type="range" min="-80" max="-5" step="1" />
            <span class="row-value">{{ camera.pitch }}</span>
          </div>
          <div class="control-row">
            <span class="row-label">水平FOV(°)</span>
            <input v-model.number="camera.horizontalFov" type="range" min="30" max="110" step="1" />
            <span class="row-value">{{ camera.horizontalFov }}</span>
          </div>
          <div class="control-row">
            <span class="row-label">远裁剪(m)</span>
            <input v-model.number="camera.far" type="range" min="500" max="6000" step="50" />
            <span class="row-value">{{ camera.far }}</span>
          </div>
          <div class="control-row">
            <span class="row-label">色调</span>
            <input v-model="camera.tintHex" type="color" class="color-input" />
            <span class="row-value">#{{ camera.tintHex.replace('#', '').toUpperCase() }}</span>
          </div>
        </template>
      </template>

      <button class="action-button primary" @click="focusCamera(activeCameraIndex)">重置视角</button>
      <button class="action-button neutral" @click="playing = !playing">{{ playing ? '暂停视频' : '播放视频' }}</button>

      <p class="hint">后处理依据深度重建世界坐标，将视频按视频相机视锥投影到地形；开启多路融合后两路视频在重叠区域叠加。</p>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.video-projection-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 252px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.85); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.mode-switch { display: flex; gap: 6px; margin-bottom: 8px; }
.mode-button { flex: 1; height: 26px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 5px; background: transparent; color: #c3d5e8; cursor: pointer; font-size: 11px; }
.mode-button.active { background: #2f80ed; border-color: #2f80ed; color: #eef4ff; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 52px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.toggle { width: 36px; height: 18px; padding: 0; border-radius: 999px; border: 0; background: rgba(157, 188, 224, 0.35); cursor: pointer; position: relative; transition: background 0.2s; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #dce8f5; transition: transform 0.2s; }
.toggle.on { background: #2f80ed; }
.toggle.on i { transform: translateX(18px); }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.color-input { flex: 1; min-width: 0; height: 22px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 5px; background: transparent; cursor: pointer; }
.camera-tabs { display: flex; gap: 6px; margin-bottom: 4px; }
.camera-tab { flex: 1; height: 24px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 5px; background: transparent; color: #c3d5e8; cursor: pointer; font-size: 11px; }
.camera-tab.active { background: #24405f; border-color: #4f8fd0; color: #eef4ff; }
.camera-tab.disabled { opacity: 0.45; }
.action-button { width: 100%; height: 28px; margin-top: 6px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.neutral { background: #2c3a52; color: #c3d5e8; }
.hint { margin: 8px 0 0; font-size: 10px; line-height: 1.5; color: #7f96b3; }
.result-message { margin-top: 6px; font-size: 10px; color: #8be0b2; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
