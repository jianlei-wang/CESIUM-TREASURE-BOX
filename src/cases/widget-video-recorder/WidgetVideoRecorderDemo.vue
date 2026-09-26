<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Camera, Cartesian3, Color, Ion, Viewer } from 'cesium'
import { DEFAULT_VIEW_RECTANGLE, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import {
  CAPTION_POSITION_LABELS,
  CAPTION_POSITIONS,
  MAX_FPS,
  MIN_FPS,
  MIN_REGION_SIZE,
  hasCaptionText,
  isMapRecordingSupported,
  recordCanvas,
  type CaptionPosition,
  type MapRecording,
  type RecordRegion
} from './videoRecorder'

const CESIUM_ION_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmNGI3MTJlZi1kNGFmLTQ1OWQtYmJiMC0yMDViNjM0ZDdjYzMiLCJpZCI6Mzg2MzU3LCJpYXQiOjE3NzAwODA5MDJ9.-ggs9Xfr6ptMLXTs0MS7xdieNVFr7TMV7yyd-yjxyHw'

type Mode = 'whole' | 'region'
type Status = 'idle' | 'preparing' | 'recording' | 'ready'

const container = ref<HTMLElement | null>(null)
const regionLayer = ref<HTMLElement | null>(null)

const statusMessage = ref('正在加载 Bing 地图…')
const ready = ref(false)
const supported = ref(isMapRecordingSupported())

const mode = ref<Mode>('whole')
const selecting = ref(false)
const region = ref<RecordRegion | null>(null)

const fps = ref(30)
const captionTitle = ref('')
const captionText = ref('')
const captionPosition = ref<CaptionPosition>('bottom-left')

const status = ref<Status>('idle')
const elapsed = ref(0)
const error = ref<string | null>(null)
const pending = ref<MapRecording | null>(null)
const previewUrl = ref('')
const fileName = ref('map-recording')

let viewer: Viewer | undefined
let abortController: AbortController | null = null
let dragStart: { x: number; y: number } | null = null

const busy = computed(() => status.value === 'preparing' || status.value === 'recording')
const editingFrozen = computed(() => busy.value || status.value === 'ready')

const shownRegion = computed(() => (mode.value === 'region' ? region.value : null))
const regionStyle = computed(() => {
  const r = shownRegion.value
  if (!r) return {}
  return { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` }
})
const regionVisible = computed(() => Boolean(shownRegion.value) && (selecting.value || mode.value === 'region'))

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeBox(ax: number, ay: number, bx: number, by: number): RecordRegion {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay)
  }
}

function relativePoint(event: PointerEvent): { x: number; y: number; width: number; height: number } {
  const el = regionLayer.value
  if (!el) return { x: 0, y: 0, width: 0, height: 0 }
  const rect = el.getBoundingClientRect()
  return {
    x: clamp(event.clientX - rect.left, 0, rect.width),
    y: clamp(event.clientY - rect.top, 0, rect.height),
    width: rect.width,
    height: rect.height
  }
}

function onRegionPointerDown(event: PointerEvent): void {
  if (!selecting.value || editingFrozen.value) return
  const point = relativePoint(event)
  dragStart = { x: point.x, y: point.y }
  region.value = { x: point.x, y: point.y, width: 0, height: 0 }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onRegionPointerMove(event: PointerEvent): void {
  if (!selecting.value || !dragStart) return
  const point = relativePoint(event)
  region.value = normalizeBox(dragStart.x, dragStart.y, point.x, point.y)
}

function onRegionPointerUp(event: PointerEvent): void {
  if (!selecting.value || !dragStart) return
  dragStart = null
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
  const current = region.value
  if (!current || current.width < MIN_REGION_SIZE || current.height < MIN_REGION_SIZE) {
    region.value = null
    return
  }
  selecting.value = false
}

function chooseMode(next: Mode): void {
  if (editingFrozen.value) return
  clearMessages()
  mode.value = next
  if (next === 'whole') selecting.value = false
}

function startSelect(): void {
  if (editingFrozen.value) return
  clearMessages()
  mode.value = 'region'
  region.value = null
  selecting.value = true
}

function clearMessages(): void {
  error.value = null
}

function formattedElapsed(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function revokePreview(): void {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''
  }
}

function replacePending(rec: MapRecording): void {
  revokePreview()
  pending.value = rec
  previewUrl.value = URL.createObjectURL(rec.blob)
}

function isActiveStatus(value: Status): boolean {
  return value === 'preparing' || value === 'recording'
}

async function startRecording(): Promise<void> {
  const v = viewer
  if (!v || v.isDestroyed() || busy.value) return
  if (mode.value === 'region' && !region.value) {
    error.value = '请先框选录制区域'
    return
  }
  clearMessages()
  elapsed.value = 0
  status.value = 'preparing'
  const controller = new AbortController()
  abortController = controller
  const caption = hasCaptionText({
    title: captionTitle.value,
    caption: captionText.value,
    position: captionPosition.value
  })
    ? { title: captionTitle.value, caption: captionText.value, position: captionPosition.value }
    : null
  try {
    const rec = await recordCanvas({
      canvas: v.canvas,
      region: mode.value === 'region' ? region.value : null,
      caption,
      fps: fps.value,
      signal: controller.signal,
      onStarted: () => {
        status.value = 'recording'
      },
      onElapsed: (seconds) => {
        elapsed.value = seconds
      },
      onFrame: () => {
        if (!v.isDestroyed()) v.scene.requestRender()
      }
    })
    if (rec.blob.size === 0) {
      status.value = 'idle'
    } else {
      replacePending(rec)
      status.value = 'ready'
    }
  } catch (err) {
    if (!controller.signal.aborted) {
      error.value = err instanceof Error ? err.message : String(err)
    }
    status.value = 'idle'
  } finally {
    abortController = null
    if (isActiveStatus(status.value)) status.value = 'idle'
  }
}

function stopRecording(): void {
  abortController?.abort()
}

function download(): void {
  const rec = pending.value
  if (!rec) return
  const base = fileName.value.trim().replace(/\.(mp4|webm)$/i, '') || 'map-recording'
  const link = document.createElement('a')
  link.href = previewUrl.value
  link.download = `${base}.${rec.extension}`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function discard(): void {
  revokePreview()
  pending.value = null
  fileName.value = 'map-recording'
  status.value = 'idle'
  clearMessages()
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
    v.camera.setView({ destination: Cartesian3.fromDegrees(116.397, 39.908, 120000) })
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

    <div
      ref="regionLayer"
      class="region-layer"
      :class="{ selecting }"
      @pointerdown="onRegionPointerDown"
      @pointermove="onRegionPointerMove"
      @pointerup="onRegionPointerUp"
      @pointercancel="onRegionPointerUp"
    >
      <div v-if="regionVisible" class="region-box" :style="regionStyle">
        <span class="region-corner tl"></span>
        <span class="region-corner tr"></span>
        <span class="region-corner bl"></span>
        <span class="region-corner br"></span>
      </div>
      <div v-if="selecting" class="region-tip">按住左键拖拽框选录制区域，松开完成；Esc 取消</div>
    </div>

    <div class="control-panel">
      <div class="panel-title">视频录制控件</div>

      <p v-if="!supported" class="warn">当前浏览器不支持画布录制（缺少 MediaRecorder / captureStream）</p>

      <div class="row">
        <span class="row-label">录制区域</span>
        <div class="seg small">
          <button class="seg-btn" :class="{ active: mode === 'whole' }" :disabled="editingFrozen" @click="chooseMode('whole')">整图</button>
          <button class="seg-btn" :class="{ active: mode === 'region' }" :disabled="editingFrozen" @click="chooseMode('region')">框选</button>
        </div>
      </div>

      <button class="mini-btn wide" :disabled="editingFrozen" @click="startSelect">
        {{ region ? '重新框选区域' : '框选区域' }}
      </button>

      <label class="field">
        <span class="field-label">标题（可空）</span>
        <input class="text-input" type="text" v-model="captionTitle" :disabled="editingFrozen" placeholder="例如：北京城区影像" />
      </label>

      <label class="field">
        <span class="field-label">来源 / 副标题（可空）</span>
        <input class="text-input" type="text" v-model="captionText" :disabled="editingFrozen" placeholder="例如：Bing 影像底图" />
      </label>

      <div class="row">
        <span class="row-label">水印位置</span>
        <select class="select" v-model="captionPosition" :disabled="editingFrozen">
          <option v-for="pos in CAPTION_POSITIONS" :key="pos" :value="pos">{{ CAPTION_POSITION_LABELS[pos] }}</option>
        </select>
      </div>

      <label class="slider-row">
        <span class="field-label">帧率 <em>{{ fps }} fps</em></span>
        <input type="range" :min="MIN_FPS" :max="MAX_FPS" step="1" v-model.number="fps" :disabled="editingFrozen" />
      </label>

      <button v-if="status !== 'recording' && status !== 'preparing'" class="capture-btn" :disabled="!ready || !supported || editingFrozen" @click="startRecording">
        开始录制
      </button>
      <button v-else class="capture-btn stop" @click="stopRecording">
        停止录制（{{ formattedElapsed(elapsed) }}）
      </button>

      <p v-if="status === 'preparing'" class="shot-info">正在准备录制…</p>
      <p v-else-if="status === 'recording'" class="shot-info rec">● 录制中 {{ formattedElapsed(elapsed) }}</p>

      <div v-if="pending" class="result">
        <video class="preview" :src="previewUrl" controls playsinline></video>
        <input class="text-input" type="text" v-model="fileName" />
        <div class="result-actions">
          <button class="mini-btn" @click="download">下载视频</button>
          <button class="mini-btn" @click="discard">丢弃</button>
        </div>
      </div>

      <p v-if="error" class="error-text">{{ error }}</p>

      <p class="hint">
        录制直接采集三维画布：整图模式记录整个视口，框选模式只记录固定矩形区域（地图在其下移动）。标题与来源会以水印形式烧录进视频画面。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.widget-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.region-layer { position: absolute; inset: 0; z-index: 5; pointer-events: none; }
.region-layer.selecting { pointer-events: auto; cursor: crosshair; background: rgba(10, 26, 52, 0.18); }
.region-box { position: absolute; border: 2px dashed #65d3eb; background: rgba(47, 128, 237, 0.12); box-shadow: 0 0 0 9999px rgba(8, 21, 40, 0.28); pointer-events: none; }
.region-corner { position: absolute; width: 10px; height: 10px; border: 2px solid #65d3eb; }
.region-corner.tl { left: -2px; top: -2px; border-right: 0; border-bottom: 0; }
.region-corner.tr { right: -2px; top: -2px; border-left: 0; border-bottom: 0; }
.region-corner.bl { left: -2px; bottom: -2px; border-right: 0; border-top: 0; }
.region-corner.br { right: -2px; bottom: -2px; border-left: 0; border-top: 0; }
.region-tip { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); padding: 6px 12px; border-radius: 7px; background: rgba(8, 21, 40, 0.88); color: #e8f4fa; font-size: 12px; pointer-events: none; }
.control-panel { position: absolute; right: 12px; top: 12px; z-index: 10; width: 272px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.9); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.warn { margin: 10px 0 0; padding: 6px 8px; border: 1px solid rgba(255, 182, 77, 0.4); border-radius: 6px; background: rgba(255, 182, 77, 0.12); color: #ffd79a; font-size: 11px; line-height: 1.5; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; gap: 8px; }
.row-label { color: #c3d5e8; font-size: 11px; white-space: nowrap; }
.seg { display: flex; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 6px; overflow: hidden; }
.seg.small .seg-btn { height: 24px; padding: 0 10px; }
.seg-btn { border: 0; background: transparent; color: #c3d5e8; font-size: 11px; cursor: pointer; }
.seg-btn.active { background: #2f80ed; color: #f3f9ff; font-weight: 700; }
.seg-btn:disabled { cursor: not-allowed; opacity: 0.5; }
.field { display: block; margin-top: 10px; }
.field-label { display: block; color: #c3d5e8; font-size: 11px; margin-bottom: 4px; }
.text-input { width: 100%; height: 26px; padding: 0 8px; border: 1px solid rgba(157, 188, 224, 0.35); border-radius: 5px; background: rgba(20, 40, 70, 0.9); color: #dce8f5; font-size: 11px; box-sizing: border-box; }
.select { height: 26px; background: rgba(20, 40, 70, 0.9); border: 1px solid rgba(157, 188, 224, 0.35); color: #dce8f5; font-size: 11px; border-radius: 5px; padding: 0 4px; }
.slider-row { display: block; margin-top: 12px; }
.slider-row .field-label { display: flex; align-items: center; justify-content: space-between; color: #c3d5e8; font-size: 11px; }
.slider-row .field-label em { font-style: normal; color: #65d3eb; font-weight: 700; }
.slider-row input[type="range"] { width: 100%; margin: 3px 0 0; accent-color: #2f80ed; background: transparent; }
.mini-btn { height: 24px; padding: 0 8px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 5px; background: rgba(157, 188, 224, 0.14); color: #dce8f5; cursor: pointer; font-size: 11px; }
.mini-btn:hover { background: rgba(104, 173, 254, 0.3); }
.mini-btn.wide { width: 100%; margin-top: 10px; }
.capture-btn { width: 100%; height: 30px; margin-top: 12px; border: 0; border-radius: 6px; background: linear-gradient(90deg, #2f80ed, #2ea8d8); color: #f3f9ff; cursor: pointer; font-size: 12px; font-weight: 700; }
.capture-btn:disabled { cursor: default; opacity: 0.5; }
.capture-btn.stop { background: linear-gradient(90deg, #d64545, #b33030); }
.shot-info { margin: 10px 0 0; font-size: 11px; color: #9fe3b4; }
.shot-info.rec { color: #ff8f8f; }
.result { margin-top: 12px; }
.preview { width: 100%; border-radius: 6px; background: #000; }
.result-actions { display: flex; gap: 8px; margin-top: 8px; }
.result-actions .mini-btn { flex: 1; }
.error-text { margin: 10px 0 0; font-size: 11px; color: #ff9a9a; line-height: 1.5; }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
