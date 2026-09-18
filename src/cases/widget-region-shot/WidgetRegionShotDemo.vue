<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Camera,
  Cartesian3,
  Color,
  Ion,
  Viewer
} from 'cesium'
import { DEFAULT_VIEW_RECTANGLE, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

const CESIUM_ION_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmNGI3MTJlZi1kNGFmLTQ1OWQtYmJiMC0yMDViNjM0ZDdjYzMiLCJpZCI6Mzg2MzU3LCJpYXQiOjE3NzAwODA5MDJ9.-ggs9Xfr6ptMLXTs0MS7xdieNVFr7TMV7yyd-yjxyHw'

const MIN_DRAG_PX = 12

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const ready = ref(false)
const capturing = ref(false)
const masking = ref(false)
const scale = ref(1)
const format = ref('png')
const lastShot = ref('')
const lastThumb = ref('')

type Phase = 'idle' | 'ready'
const phase = ref<Phase>('idle')
const guide = ref('点击「开始框选」后在当前页面上拖拽，框出要导出的矩形区域')

interface DragBox {
  left: number
  top: number
  width: number
  height: number
}
const dragBox = ref<DragBox | null>(null)

const canStart = computed(() => !capturing.value && !masking.value)
const phaseText = computed(() => (phase.value === 'ready' ? '可再次框选' : '待框选'))
const selectionStyle = computed(() => {
  const box = dragBox.value
  if (!box) return {}
  return { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }
})

function scaleText(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded)
}

function timestamp(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

let viewer: Viewer | undefined
let active = false
let startX = 0
let startY = 0
let shellLeft = 0
let shellTop = 0
let shellWidth = 0
let shellHeight = 0

function applySceneDefaults(): void {
  Camera.DEFAULT_VIEW_RECTANGLE = DEFAULT_VIEW_RECTANGLE
  Ion.defaultAccessToken = CESIUM_ION_ACCESS_TOKEN
}

function onWindowMove(event: MouseEvent): void {
  if (!active) return
  const x = Math.max(0, Math.min(shellWidth, event.clientX - shellLeft))
  const y = Math.max(0, Math.min(shellHeight, event.clientY - shellTop))
  dragBox.value = normalizeBox(startX, startY, x, y)
}

function onWindowUp(event: MouseEvent): void {
  if (!active) return
  active = false
  removeWindowListeners()
  const x = Math.max(0, Math.min(shellWidth, event.clientX - shellLeft))
  const y = Math.max(0, Math.min(shellHeight, event.clientY - shellTop))
  const box = normalizeBox(startX, startY, x, y)
  dragBox.value = null
  masking.value = false
  if (box.width < MIN_DRAG_PX || box.height < MIN_DRAG_PX) {
    cancelMask('框选范围过小（至少 ' + MIN_DRAG_PX + '×' + MIN_DRAG_PX + ' 像素），已取消，请重新拖拽')
    return
  }
  void runCrop(box)
}

function onWindowKey(event: KeyboardEvent): void {
  if (event.key === 'Escape' && active) {
    active = false
    removeWindowListeners()
    dragBox.value = null
    masking.value = false
    cancelMask('已按 Esc 取消框选')
  }
}

function normalizeBox(ax: number, ay: number, bx: number, by: number): DragBox {
  return {
    left: Math.min(ax, bx),
    top: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay)
  }
}

function removeWindowListeners(): void {
  window.removeEventListener('mousemove', onWindowMove)
  window.removeEventListener('mouseup', onWindowUp)
  window.removeEventListener('keydown', onWindowKey)
}

function onOverlayMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  shellLeft = rect.left
  shellTop = rect.top
  shellWidth = rect.width
  shellHeight = rect.height
  startX = event.clientX - shellLeft
  startY = event.clientY - shellTop
  active = true
  dragBox.value = null
  window.addEventListener('mousemove', onWindowMove)
  window.addEventListener('mouseup', onWindowUp)
  window.addEventListener('keydown', onWindowKey)
}

function startMask(): void {
  const v = viewer
  if (!v || v.isDestroyed() || capturing.value) return
  masking.value = true
  dragBox.value = null
  guide.value = '按住左键拖拽框出要导出的区域，松开自动出图；单击或按 Esc 取消'
  statusMessage.value = ''
}

function cancelMask(message: string): void {
  masking.value = false
  dragBox.value = null
  phase.value = 'idle'
  guide.value = '点击「开始框选」后在当前页面上拖拽，框出要导出的矩形区域'
  if (message) statusMessage.value = message
}

async function readMapFrame(): Promise<HTMLCanvasElement | null> {
  const v = viewer
  if (!v || v.isDestroyed()) return null
  return await new Promise((resolve) => {
    let finished = false
    let timeoutId = 0
    const finish = (canvas: HTMLCanvasElement | null): void => {
      if (finished) return
      finished = true
      window.clearTimeout(timeoutId)
      if (!v.isDestroyed()) v.scene.postRender.removeEventListener(onRender)
      resolve(canvas)
    }
    const onRender = (): void => {
      const width = v.canvas.width
      const height = v.canvas.height
      if (width <= 0 || height <= 0) {
        finish(null)
        return
      }
      const tmp = document.createElement('canvas')
      tmp.width = width
      tmp.height = height
      const ctx = tmp.getContext('2d')
      if (!ctx) {
        finish(null)
        return
      }
      try {
        ctx.drawImage(v.canvas, 0, 0)
        finish(tmp)
      } catch {
        finish(null)
      }
    }
    timeoutId = window.setTimeout(() => finish(null), 8000)
    v.scene.postRender.addEventListener(onRender)
    v.scene.requestRender()
  })
}

function cropFromFrame(frame: HTMLCanvasElement, box: DragBox): HTMLCanvasElement | null {
  const v = viewer
  if (!v || v.isDestroyed()) return null
  const cssWidth = v.canvas.clientWidth || container.value?.clientWidth || 1
  const cssHeight = v.canvas.clientHeight || container.value?.clientHeight || 1
  const fx = frame.width / cssWidth
  const fy = frame.height / cssHeight
  const sx = Math.floor(box.left * fx)
  const sy = Math.floor(box.top * fy)
  const sw = Math.max(1, Math.floor(box.width * fx))
  const sh = Math.max(1, Math.floor(box.height * fy))
  const out = document.createElement('canvas')
  out.width = sw
  out.height = sh
  const ctx = out.getContext('2d')
  if (!ctx) return null
  try {
    ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, sw, sh)
    return out
  } catch {
    return null
  }
}

async function canvasToMimeDataUrl(source: HTMLCanvasElement, mime: string): Promise<string> {
  if (mime === 'image/png') return source.toDataURL('image/png')
  const pngUrl = source.toDataURL('image/png')
  return await new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = image.naturalWidth
        c.height = image.naturalHeight
        const ctx = c.getContext('2d')
        if (!ctx) {
          reject(new Error('2d context unavailable'))
          return
        }
        ctx.drawImage(image, 0, 0)
        resolve(c.toDataURL('image/jpeg', 0.92))
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    image.onerror = () => reject(new Error('encode image failed'))
    image.src = pngUrl
  })
}

function buildThumb(cropped: HTMLCanvasElement): string {
  const maxWidth = 460
  const ratio = cropped.height / cropped.width
  const tw = Math.min(cropped.width, maxWidth)
  const th = Math.max(1, Math.round(tw * ratio))
  const c = document.createElement('canvas')
  c.width = tw
  c.height = th
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  ctx.drawImage(cropped, 0, 0, tw, th)
  return c.toDataURL('image/jpeg', 0.86)
}

async function runCrop(box: DragBox): Promise<void> {
  const v = viewer
  if (!v || v.isDestroyed() || capturing.value) return
  masking.value = false
  dragBox.value = null
  capturing.value = true
  phase.value = 'idle'
  guide.value = '正在生成图鉴图片…'
  statusMessage.value = '正在生成图鉴图片…'
  try {
    const frame = await readMapFrame()
    if (!frame) {
      statusMessage.value = '截图失败：画面尺寸为 0 或渲染未完成，请重试'
      return
    }
    const cropped = cropFromFrame(frame, box)
    if (!cropped) {
      statusMessage.value = '截图失败：无法读取所选区域像素，请重试'
      return
    }
    const mime = format.value === 'jpg' ? 'image/jpeg' : 'image/png'
    const dataUrl = await canvasToMimeDataUrl(cropped, mime)
    const ext = format.value === 'jpg' ? 'jpg' : 'png'
    const filename = `区域图鉴-${timestamp()}.${ext}`
    downloadDataUrl(dataUrl, filename)
    lastThumb.value = buildThumb(cropped)
    lastShot.value = `${cropped.width}×${cropped.height}@${scaleText(scale.value)}x`
    phase.value = 'ready'
    guide.value = '已按框选区域出图；点击「重新框选」可继续选择其他区域'
    statusMessage.value = `已下载 ${filename}（${lastShot.value}）`
  } finally {
    capturing.value = false
  }
}

watch(scale, (value) => {
  if (viewer && !viewer.isDestroyed()) {
    viewer.resolutionScale = value
    viewer.scene.requestRender()
  }
})

onMounted(() => {
  const el = container.value
  if (!el) return
  applySceneDefaults()
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
    const callbacks: SceneCallbacks = {
      onStatus: (message) => {
        statusMessage.value = message
      },
      onBasemapReady: () => {
        statusMessage.value = '场景就绪：点击「开始框选」在页面上拖拽出图'
      }
    }
    viewer = v
    loadBingImagery(v, callbacks)
    v.camera.setView({ destination: Cartesian3.fromDegrees(116.397, 39.908, 90000) })
    v.resolutionScale = scale.value
    v.scene.requestRender()
    ready.value = true
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (active) removeWindowListeners()
  active = false
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="widget-shell">
    <div ref="container" class="cesium-container"></div>

    <div v-if="!masking && !capturing" class="control-panel">
      <div class="panel-title">区域截图控件</div>

      <div class="row">
        <span class="row-label">流程状态</span>
        <span class="state-chip" :class="phase">{{ phaseText }}</span>
      </div>
      <p class="guide-text">{{ guide }}</p>

      <img v-if="lastThumb" class="thumb" :src="lastThumb" alt="最近一次区域图鉴" />

      <label class="slider-row">
        <span class="field-label">清晰度 <em>×{{ scaleText(scale) }}</em></span>
        <input type="range" min="0.5" max="3" step="0.25" v-model.number="scale" />
      </label>

      <div class="row">
        <span class="row-label">图片格式</span>
        <select class="format-select" v-model="format">
          <option value="png">PNG（无损）</option>
          <option value="jpg">JPG（压缩）</option>
        </select>
      </div>

      <button class="capture-btn" :disabled="!canStart" @click="startMask">
        {{ capturing ? '正在生成图鉴…' : phase === 'ready' ? '重新框选' : '开始框选' }}
      </button>

      <p v-if="lastShot" class="shot-info">最近一次图鉴：{{ lastShot }}</p>

      <p class="hint">
        点击「开始框选」后，在当前页面上覆盖半透明遮罩：按住鼠标左键拖拽，框出要导出的矩形区域，松开立即按该区域生成图鉴图片（PNG / JPG）并自动下载；单击或按 Esc 取消。导出区域与「清晰度」倍率共同决定图片分辨率。
      </p>
    </div>

    <div v-if="masking" class="crop-mask" @mousedown="onOverlayMouseDown">
      <div v-if="dragBox" class="drag-tip">
        松开鼠标出图 · Esc 取消
      </div>
      <div v-if="dragBox" class="selection" :style="selectionStyle">
        <span class="selection-label">{{ Math.round(dragBox.width) }} × {{ Math.round(dragBox.height) }} px</span>
      </div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.widget-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 268px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; }
.row-label { color: #c3d5e8; font-size: 11px; }
.state-chip { padding: 2px 8px; border-radius: 999px; background: rgba(157, 188, 224, 0.16); color: #b9d7ef; font-size: 11px; }
.state-chip.ready { background: rgba(94, 210, 120, 0.2); color: #9fe3b4; }
.guide-text { margin: 6px 0 0; font-size: 10px; color: #9fb4cc; line-height: 1.5; }
.thumb { display: block; width: 100%; margin-top: 10px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 6px; box-sizing: border-box; }
.slider-row { display: block; margin-top: 12px; }
.slider-row .field-label { display: flex; align-items: center; justify-content: space-between; color: #c3d5e8; font-size: 11px; }
.slider-row .field-label em { font-style: normal; color: #65d3eb; font-weight: 700; }
.slider-row input[type="range"] { width: 100%; margin: 3px 0 0; accent-color: #2f80ed; background: transparent; }
.format-select { height: 24px; padding: 0 4px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 5px; background: #0d1e38; color: #dce8f5; font-size: 11px; }
.capture-btn { width: 100%; height: 32px; margin-top: 12px; border: 0; border-radius: 6px; background: linear-gradient(90deg, #2f80ed, #2ea8d8); color: #f3f9ff; cursor: pointer; font-size: 12px; font-weight: 700; }
.capture-btn:disabled { cursor: default; opacity: 0.5; }
.shot-info { margin: 10px 0 0; font-size: 11px; color: #9fe3b4; }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
.crop-mask { position: absolute; inset: 0; z-index: 40; background: rgba(8, 18, 32, 0.42); cursor: crosshair; user-select: none; }
.selection { position: absolute; border: 1.5px solid #65d3eb; background: rgba(101, 211, 235, 0.14); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25); }
.selection-label { position: absolute; left: 2px; top: -18px; padding: 1px 6px; border-radius: 4px; background: rgba(8, 21, 40, 0.9); color: #a9ecff; font-size: 10px; white-space: nowrap; }
.drag-tip { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); padding: 6px 12px; border-radius: 6px; background: rgba(8, 21, 40, 0.86); color: #d7ecff; font-size: 11px; pointer-events: none; }
</style>
