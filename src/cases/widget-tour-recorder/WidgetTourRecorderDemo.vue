<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Camera, Cartesian3, Color, Ion, Viewer } from 'cesium'
import { DEFAULT_VIEW_RECTANGLE, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import {
  DEFAULT_FPS,
  DEFAULT_HOLD_SECONDS,
  DEFAULT_SEGMENT_SECONDS,
  MAX_FPS,
  MAX_HOLD_SECONDS,
  MAX_SEGMENT_SECONDS,
  MIN_FPS,
  MIN_HOLD_SECONDS,
  MIN_SEGMENT_SECONDS,
  clampNumber,
  estimateTourDurationMs,
  isTourRecordingSupported,
  parseTourConfig,
  recordTour,
  serializeTourConfig,
  type TourKeyframe,
  type TourCameraPose
} from './tourRecorder'

const CESIUM_ION_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmNGI3MTJlZi1kNGFmLTQ1OWQtYmJiMC0yMDViNjM0ZDdjYzMiLCJpZCI6Mzg2MzU3LCJpYXQiOjE3NzAwODA5MDJ9.-ggs9Xfr6ptMLXTs0MS7xdieNVFr7TMV7yyd-yjxyHw'

type Status = 'idle' | 'recording' | 'ready'

const container = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const statusMessage = ref('正在加载 Bing 地图…')
const ready = ref(false)
const supported = isTourRecordingSupported()

const keyframes = ref<TourKeyframe[]>([])
const fps = ref(DEFAULT_FPS)
const status = ref<Status>('idle')
const progress = ref(0)
const error = ref<string | null>(null)
const configMessage = ref<string | null>(null)
const pendingBlob = ref<Blob | null>(null)
const previewUrl = ref('')
const fileName = ref('map-tour')

let viewer: Viewer | undefined
let abortController: AbortController | null = null
let keyframeSeq = 0

const busy = computed(() => status.value === 'recording')
const editingFrozen = computed(() => busy.value || status.value === 'ready')
const canRecord = computed(() => ready.value && supported && keyframes.value.length >= 2 && !editingFrozen.value)

const durationText = computed(() => {
  const ms = estimateTourDurationMs(keyframes.value)
  const totalSeconds = Math.round(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}分${String(s).padStart(2, '0')}秒`
})

function createId(): string {
  keyframeSeq += 1
  return `kf-${Date.now()}-${keyframeSeq}`
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI
}

function formatLng(kf: TourKeyframe): string {
  return kf.longitude.toFixed(5)
}

function formatLat(kf: TourKeyframe): string {
  return kf.latitude.toFixed(5)
}

function formatHeight(kf: TourKeyframe): string {
  return Math.round(kf.height).toLocaleString()
}

function formatHeading(kf: TourKeyframe): number {
  const deg = Math.round(toDegrees(kf.heading))
  return ((deg % 360) + 360) % 360
}

function formatPitch(kf: TourKeyframe): number {
  return Math.round(toDegrees(kf.pitch))
}

function clearMessages(): void {
  error.value = null
  configMessage.value = null
}

function captureView(): TourCameraPose | null {
  const v = viewer
  if (!v || v.isDestroyed()) return null
  const carto = v.camera.positionCartographic
  return {
    longitude: toDegrees(carto.longitude),
    latitude: toDegrees(carto.latitude),
    height: carto.height,
    heading: v.camera.heading,
    pitch: v.camera.pitch,
    roll: v.camera.roll
  }
}

function addCurrentView(): void {
  const view = captureView()
  if (!view) return
  clearMessages()
  keyframes.value = [
    ...keyframes.value,
    {
      id: createId(),
      ...view,
      holdSeconds: DEFAULT_HOLD_SECONDS,
      transitionSeconds: DEFAULT_SEGMENT_SECONDS
    }
  ]
}

function recaptureKeyframe(id: string): void {
  const view = captureView()
  if (!view) return
  clearMessages()
  keyframes.value = keyframes.value.map((kf) => (kf.id === id ? { ...kf, ...view } : kf))
}

function removeKeyframe(id: string): void {
  clearMessages()
  keyframes.value = keyframes.value.filter((kf) => kf.id !== id)
}

function moveKeyframe(index: number, delta: number): void {
  const target = index + delta
  if (target < 0 || target >= keyframes.value.length) return
  clearMessages()
  const next = [...keyframes.value]
  ;[next[index], next[target]] = [next[target], next[index]]
  keyframes.value = next
}

function previewKeyframe(kf: TourKeyframe): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(kf.longitude, kf.latitude, kf.height),
    orientation: { heading: kf.heading, pitch: kf.pitch, roll: kf.roll },
    duration: 1.5
  })
}

function setHold(id: string, event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  const seconds = clampNumber(raw, MIN_HOLD_SECONDS, MAX_HOLD_SECONDS)
  clearMessages()
  keyframes.value = keyframes.value.map((kf) => (kf.id === id ? { ...kf, holdSeconds: seconds } : kf))
}

function setTransition(id: string, event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  const seconds = clampNumber(raw, MIN_SEGMENT_SECONDS, MAX_SEGMENT_SECONDS)
  clearMessages()
  keyframes.value = keyframes.value.map((kf) => (kf.id === id ? { ...kf, transitionSeconds: seconds } : kf))
}

function revokePreview(): void {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''
  }
}

function isRecordingStatus(value: Status): boolean {
  return value === 'recording'
}

async function startRecording(): Promise<void> {
  const v = viewer
  if (!v || v.isDestroyed() || !canRecord.value) return
  clearMessages()
  progress.value = 0
  status.value = 'recording'
  const controller = new AbortController()
  abortController = controller
  try {
    const blob = await recordTour({
      viewer: v,
      keyframes: keyframes.value,
      fps: fps.value,
      signal: controller.signal,
      onProgress: (fraction) => {
        progress.value = Math.round(fraction * 100)
      }
    })
    if (blob.size === 0) {
      status.value = 'idle'
    } else {
      revokePreview()
      pendingBlob.value = blob
      previewUrl.value = URL.createObjectURL(blob)
      status.value = 'ready'
    }
  } catch (err) {
    if (!controller.signal.aborted) {
      error.value = err instanceof Error ? err.message : String(err)
    }
    status.value = 'idle'
  } finally {
    abortController = null
    if (isRecordingStatus(status.value)) status.value = 'idle'
    progress.value = 0
  }
}

function stopRecording(): void {
  abortController?.abort()
}

function download(): void {
  if (!pendingBlob.value) return
  const base = fileName.value.trim() || 'map-tour'
  const link = document.createElement('a')
  link.href = previewUrl.value
  link.download = `${base}.webm`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function discard(): void {
  revokePreview()
  pendingBlob.value = null
  fileName.value = 'map-tour'
  status.value = 'idle'
  clearMessages()
}

function saveConfig(): void {
  if (keyframes.value.length === 0) return
  const content = serializeTourConfig(keyframes.value, fps.value)
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'map-tour-setup.json'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  configMessage.value = '已导出导览配置 JSON'
}

function openConfig(): void {
  if (editingFrozen.value) return
  fileInput.value?.click()
}

async function onConfigFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  clearMessages()
  try {
    const text = await file.text()
    const parsed = parseTourConfig(text)
    keyframes.value = parsed.keyframes.map((kf) => ({ ...kf, id: createId() }))
    fps.value = parsed.fps
    configMessage.value = `已加载 ${parsed.keyframes.length} 个关键帧`
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(() => {
  const el = container.value
  if (!el) return
  Camera.DEFAULT_VIEW_RECTANGLE = DEFAULT_VIEW_RECTANGLE
  Ion.defaultAccessToken = CESIUM_ION_ACCESS_TOKEN
  try {
    const v = new Viewer(el, {
      animation: false,
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      skyAtmosphere: false,
      skyBox: false,
      shadows: false,
      scene3DOnly: true,
      contextOptions: { webgl: { preserveDrawingBuffer: true, alpha: false } }
    })
    v.scene.globe.baseColor = Color.fromCssColorString('#152b4c')
    viewer = v
    const callbacks: SceneCallbacks = {
      onStatus: (message) => {
        statusMessage.value = message
      },
      onBasemapReady: () => {
        statusMessage.value = ''
        ready.value = true
      }
    }
    loadBingImagery(v, callbacks)
    v.camera.setView({ destination: Cartesian3.fromDegrees(116.397, 39.908, 300000) })
    v.scene.requestRender()
    ready.value = true
  } catch (err) {
    statusMessage.value = err instanceof Error ? err.message : String(err)
  }
})

onBeforeUnmount(() => {
  abortController?.abort()
  abortController = null
  revokePreview()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="widget-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">地图导览录制控件</div>

      <p v-if="!supported" class="warn">当前浏览器不支持画布录制（缺少 MediaRecorder / captureStream）</p>

      <div class="toolbar">
        <button class="mini-btn primary" :disabled="!ready || editingFrozen" @click="addCurrentView">添加当前视角</button>
        <button class="mini-btn" :disabled="editingFrozen || keyframes.length === 0" @click="saveConfig">导出配置</button>
        <button class="mini-btn" :disabled="editingFrozen" @click="openConfig">加载配置</button>
        <input ref="fileInput" class="hidden-file" type="file" accept=".json,application/json" @change="onConfigFile" />
      </div>

      <label class="slider-row">
        <span class="field-label">帧率 <em>{{ fps }} fps</em></span>
        <input type="range" :min="MIN_FPS" :max="MAX_FPS" step="1" v-model.number="fps" :disabled="editingFrozen" />
      </label>

      <div class="kf-summary">
        <span>关键帧 {{ keyframes.length }} 个</span>
        <span>预计时长 {{ durationText }}</span>
      </div>

      <div class="kf-list">
        <div v-if="keyframes.length === 0" class="kf-empty">尚未添加关键帧：调整好视角后点击「添加当前视角」，至少添加 2 个即可录制。</div>
        <div v-for="(kf, index) in keyframes" :key="kf.id" class="kf-row">
          <div class="kf-index">{{ index + 1 }}</div>
          <div class="kf-body">
            <div class="kf-coord">{{ formatLng(kf) }}, {{ formatLat(kf) }} · 高 {{ formatHeight(kf) }} m</div>
            <div class="kf-cam">航向 {{ formatHeading(kf) }}° / 俯仰 {{ formatPitch(kf) }}°</div>
            <div class="kf-times">
              <label class="time-field">停留<input type="number" :value="kf.holdSeconds" :min="MIN_HOLD_SECONDS" :max="MAX_HOLD_SECONDS" step="0.5" :disabled="editingFrozen" @change="setHold(kf.id, $event)" />s</label>
              <label class="time-field">过渡<input type="number" :value="kf.transitionSeconds" :min="MIN_SEGMENT_SECONDS" :max="MAX_SEGMENT_SECONDS" step="0.5" :disabled="editingFrozen || index === keyframes.length - 1" @change="setTransition(kf.id, $event)" />s</label>
            </div>
            <div class="kf-actions">
              <button class="tiny-btn" :disabled="editingFrozen" @click="previewKeyframe(kf)">预览</button>
              <button class="tiny-btn" :disabled="editingFrozen" @click="recaptureKeyframe(kf.id)">重拍</button>
              <button class="tiny-btn" :disabled="editingFrozen || index === 0" @click="moveKeyframe(index, -1)">前移</button>
              <button class="tiny-btn" :disabled="editingFrozen || index === keyframes.length - 1" @click="moveKeyframe(index, 1)">后移</button>
              <button class="tiny-btn danger" :disabled="editingFrozen" @click="removeKeyframe(kf.id)">删除</button>
            </div>
          </div>
        </div>
      </div>

      <button v-if="status !== 'recording'" class="capture-btn" :disabled="!canRecord" @click="startRecording">
        开始录制导览
      </button>
      <button v-else class="capture-btn stop" @click="stopRecording">停止录制（{{ progress }}%）</button>

      <div v-if="status === 'recording'" class="progress-track"><div class="progress-fill" :style="{ width: `${progress}%` }"></div></div>

      <div v-if="pendingBlob" class="result">
        <video class="preview" :src="previewUrl" controls playsinline></video>
        <input class="text-input" type="text" v-model="fileName" />
        <div class="result-actions">
          <button class="mini-btn" @click="download">下载视频</button>
          <button class="mini-btn" @click="discard">丢弃</button>
        </div>
      </div>

      <p v-if="configMessage" class="config-msg">{{ configMessage }}</p>
      <p v-if="error" class="error-text">{{ error }}</p>

      <p class="hint">
        采集多个相机关键帧（位置、航向、俯仰、翻滚），设置每个视角的停留时长与飞往下一视角的过渡时长，录制时相机依次飞行动画并实时采集画布为视频。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.widget-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; left: 12px; top: 12px; z-index: 10; width: 320px; max-height: calc(100% - 24px); display: flex; flex-direction: column; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.92); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.warn { margin: 10px 0 0; padding: 6px 8px; border: 1px solid rgba(255, 182, 77, 0.4); border-radius: 6px; background: rgba(255, 182, 77, 0.12); color: #ffd79a; font-size: 11px; line-height: 1.5; }
.toolbar { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.hidden-file { display: none; }
.mini-btn { height: 26px; padding: 0 9px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 5px; background: rgba(157, 188, 224, 0.14); color: #dce8f5; cursor: pointer; font-size: 11px; }
.mini-btn:hover { background: rgba(104, 173, 254, 0.3); }
.mini-btn.primary { background: linear-gradient(90deg, #2f80ed, #2ea8d8); border: 0; font-weight: 700; }
.mini-btn:disabled { cursor: not-allowed; opacity: 0.45; }
.slider-row { display: block; margin-top: 10px; }
.slider-row .field-label { display: flex; align-items: center; justify-content: space-between; color: #c3d5e8; font-size: 11px; }
.slider-row .field-label em { font-style: normal; color: #65d3eb; font-weight: 700; }
.slider-row input[type="range"] { width: 100%; margin: 3px 0 0; accent-color: #2f80ed; background: transparent; }
.kf-summary { display: flex; justify-content: space-between; margin-top: 10px; font-size: 11px; color: #9fb6d1; }
.kf-list { margin-top: 8px; overflow-y: auto; max-height: 320px; padding-right: 2px; }
.kf-empty { padding: 12px 8px; font-size: 11px; color: #7f96b3; line-height: 1.6; text-align: center; }
.kf-row { display: flex; gap: 8px; padding: 8px; margin-bottom: 6px; border: 1px solid rgba(157, 188, 224, 0.2); border-radius: 7px; background: rgba(20, 40, 70, 0.55); }
.kf-index { flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; background: #2f80ed; color: #f3f9ff; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.kf-body { flex: 1; min-width: 0; }
.kf-coord { font-size: 11px; color: #dce8f5; }
.kf-cam { margin-top: 2px; font-size: 10px; color: #8fa8c4; }
.kf-times { display: flex; gap: 8px; margin-top: 6px; }
.time-field { display: flex; align-items: center; gap: 3px; font-size: 10px; color: #c3d5e8; }
.time-field input { width: 48px; height: 22px; padding: 0 4px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 4px; background: #0d1e38; color: #dce8f5; font-size: 11px; }
.kf-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.tiny-btn { height: 20px; padding: 0 6px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 4px; background: rgba(157, 188, 224, 0.12); color: #cfe0f2; cursor: pointer; font-size: 10px; }
.tiny-btn:hover { background: rgba(104, 173, 254, 0.28); }
.tiny-btn:disabled { cursor: not-allowed; opacity: 0.4; }
.tiny-btn.danger { color: #ff9a9a; }
.capture-btn { width: 100%; height: 30px; margin-top: 10px; border: 0; border-radius: 6px; background: linear-gradient(90deg, #2f80ed, #2ea8d8); color: #f3f9ff; cursor: pointer; font-size: 12px; font-weight: 700; }
.capture-btn:disabled { cursor: default; opacity: 0.5; }
.capture-btn.stop { background: linear-gradient(90deg, #d64545, #b33030); }
.progress-track { height: 5px; margin-top: 8px; border-radius: 999px; background: rgba(157, 188, 224, 0.25); overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #2f80ed, #65d3eb); transition: width 0.15s linear; }
.result { margin-top: 10px; }
.preview { width: 100%; border-radius: 6px; background: #000; }
.text-input { width: 100%; height: 26px; margin-top: 8px; padding: 0 8px; border: 1px solid rgba(157, 188, 224, 0.35); border-radius: 5px; background: rgba(20, 40, 70, 0.9); color: #dce8f5; font-size: 11px; box-sizing: border-box; }
.result-actions { display: flex; gap: 8px; margin-top: 8px; }
.result-actions .mini-btn { flex: 1; }
.config-msg { margin: 10px 0 0; font-size: 11px; color: #9fe3b4; }
.error-text { margin: 8px 0 0; font-size: 11px; color: #ff9a9a; line-height: 1.5; }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
