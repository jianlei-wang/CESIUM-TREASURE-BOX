<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Camera,
  Cartesian2,
  Cartesian3,
  Color,
  Ion,
  Viewer,
  type Entity
} from 'cesium'
import { DEFAULT_VIEW_RECTANGLE, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

const CESIUM_ION_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmNGI3MTJlZi1kNGFmLTQ1OWQtYmJiMC0yMDViNjM0ZDdjYzMiLCJpZCI6Mzg2MzU3LCJpYXQiOjE3NzAwODA5MDJ9.-ggs9Xfr6ptMLXTs0MS7xdieNVFr7TMV7yyd-yjxyHw'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const ready = ref(false)
const capturing = ref(false)
const scale = ref(1)
const format = ref('png')
const featuresOn = ref(true)
const lastShot = ref('')

let viewer: Viewer | undefined
let featureEntities: Entity[] = []

function applySceneDefaults(): void {
  Camera.DEFAULT_VIEW_RECTANGLE = DEFAULT_VIEW_RECTANGLE
  Ion.defaultAccessToken = CESIUM_ION_ACCESS_TOKEN
}

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

async function captureOnce(): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const v = viewer
  if (!v || v.isDestroyed()) return null
  return await new Promise((resolve) => {
    v.resolutionScale = scale.value
    let finished = false
    let timeoutId = 0
    const finish = (dataUrl: string | null, width: number, height: number): void => {
      if (finished) return
      finished = true
      window.clearTimeout(timeoutId)
      if (!v.isDestroyed()) v.scene.postRender.removeEventListener(onRender)
      resolve(dataUrl ? { dataUrl, width, height } : null)
    }
    const onRender = (): void => {
      const width = v.canvas.width
      const height = v.canvas.height
      if (width <= 0 || height <= 0) {
        finish(null, 0, 0)
        return
      }
      try {
        const mime = format.value === 'jpg' ? 'image/jpeg' : 'image/png'
        const dataUrl = v.canvas.toDataURL(mime, 0.92)
        finish(dataUrl, width, height)
      } catch {
        finish(null, 0, 0)
      }
    }
    timeoutId = window.setTimeout(() => finish(null, 0, 0), 8000)
    v.scene.postRender.addEventListener(onRender)
    v.scene.requestRender()
  })
}

async function captureAndDownload(): Promise<void> {
  const v = viewer
  if (!v || v.isDestroyed() || capturing.value) return
  capturing.value = true
  try {
    const shot = await captureOnce()
    if (!shot) {
      statusMessage.value = '截图失败：画面尺寸为 0 或渲染未完成，请重试'
      return
    }
    const ext = format.value === 'jpg' ? 'jpg' : 'png'
    const filename = `场景截图-${timestamp()}.${ext}`
    downloadDataUrl(shot.dataUrl, filename)
    lastShot.value = `${shot.width}×${shot.height}@${scaleText(scale.value)}x`
    statusMessage.value = `已下载 ${filename}（${lastShot.value}）`
  } finally {
    capturing.value = false
  }
}

function addPresetFeatures(v: Viewer): void {
  const colorA = Color.fromCssColorString('#ff5a5a')
  const colorB = Color.fromCssColorString('#ffb64d')
  const colorC = Color.fromCssColorString('#4fc3f7')

  const pA = Cartesian3.fromDegrees(116.3, 39.84)
  const pB = Cartesian3.fromDegrees(116.5, 39.96)

  const pointA = v.entities.add({
    position: pA,
    point: { pixelSize: 13, color: colorA, outlineColor: Color.WHITE, outlineWidth: 2 },
    label: {
      text: '示例标注 A',
      font: '28px sans-serif',
      fillColor: Color.WHITE,
      pixelOffset: new Cartesian2(0, -36),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
  const pointB = v.entities.add({
    position: pB,
    point: { pixelSize: 13, color: colorB, outlineColor: Color.WHITE, outlineWidth: 2 },
    label: {
      text: '示例标注 B',
      font: '28px sans-serif',
      fillColor: Color.WHITE,
      pixelOffset: new Cartesian2(0, -36),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
  const lineAB = v.entities.add({
    polyline: {
      positions: Cartesian3.fromDegreesArrayHeights([116.3, 39.84, 500, 116.5, 39.96, 500]),
      width: 7,
      material: colorA
    }
  })
  const lineBC = v.entities.add({
    polyline: {
      positions: Cartesian3.fromDegreesArrayHeights([116.5, 39.96, 500, 116.36, 40.0, 500]),
      width: 7,
      material: colorB
    }
  })
  const lineCA = v.entities.add({
    polyline: {
      positions: Cartesian3.fromDegreesArrayHeights([116.36, 40.0, 500, 116.3, 39.84, 500]),
      width: 7,
      material: colorC
    }
  })
  featureEntities = [pointA, pointB, lineAB, lineBC, lineCA]
}

function setFeaturesVisible(visible: boolean): void {
  for (const entity of featureEntities) entity.show = visible
  if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender()
}

function toggleFeatures(): void {
  featuresOn.value = !featuresOn.value
  setFeaturesVisible(featuresOn.value)
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
        statusMessage.value = '场景就绪：可调整清晰度与格式后截图并下载'
      }
    }
    viewer = v
    loadBingImagery(v, callbacks)
    v.camera.setView({ destination: Cartesian3.fromDegrees(116.397, 39.908, 90000) })
    addPresetFeatures(v)
    v.resolutionScale = scale.value
    v.scene.requestRender()
    ready.value = true
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  featureEntities = []
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="widget-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">场景截图控件</div>

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

      <div class="row">
        <span class="row-label">示例要素</span>
        <button class="mini-btn" :aria-label="featuresOn ? '清空示例要素' : '恢复示例要素'" @click="toggleFeatures">
          {{ featuresOn ? '清空示例要素' : '恢复示例要素' }}
        </button>
      </div>

      <button class="capture-btn" :disabled="!ready || capturing" @click="captureAndDownload">
        {{ capturing ? '正在截图…' : '截图并下载' }}
      </button>

      <p v-if="lastShot" class="shot-info">最近一次截图：{{ lastShot }}</p>

      <p class="hint">
        清晰度是渲染分辨率倍率：2.0x 表示以当前容器 2 倍像素离屏渲染后再缩放显示，截图文件因此包含更细腻的影像与要素细节；建议按目标用途选择倍率与 PNG/JPG 格式。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.widget-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 268px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.slider-row { display: block; margin-top: 12px; }
.slider-row .field-label { display: flex; align-items: center; justify-content: space-between; color: #c3d5e8; font-size: 11px; }
.slider-row .field-label em { font-style: normal; color: #65d3eb; font-weight: 700; }
.slider-row input[type="range"] { width: 100%; margin: 3px 0 0; accent-color: #2f80ed; background: transparent; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; }
.row-label { color: #c3d5e8; font-size: 11px; }
.format-select { height: 24px; padding: 0 4px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 5px; background: #0d1e38; color: #dce8f5; font-size: 11px; }
.mini-btn { height: 24px; padding: 0 8px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 5px; background: rgba(157, 188, 224, 0.14); color: #dce8f5; cursor: pointer; font-size: 11px; }
.mini-btn:hover { background: rgba(104, 173, 254, 0.3); }
.capture-btn { width: 100%; height: 30px; margin-top: 12px; border: 0; border-radius: 6px; background: linear-gradient(90deg, #2f80ed, #2ea8d8); color: #f3f9ff; cursor: pointer; font-size: 12px; font-weight: 700; }
.capture-btn:disabled { cursor: default; opacity: 0.5; }
.shot-info { margin: 10px 0 0; font-size: 11px; color: #9fe3b4; }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
