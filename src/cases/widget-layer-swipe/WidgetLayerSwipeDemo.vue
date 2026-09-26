<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Camera,
  Cartesian3,
  Color,
  Ion,
  Viewer,
  type ImageryProvider
} from 'cesium'
import { DEFAULT_VIEW_RECTANGLE, destroyScene } from '../../lib/cesium-scene'
import { createBingImageryProvider } from '../../lib/bing'
import { createTiandituImageryProvider } from '../../lib/tianditu'
import { AMapImageryProvider } from '../../lib/map-providers'

const CESIUM_ION_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmNGI3MTJlZi1kNGFmLTQ1OWQtYmJiMC0yMDViNjM0ZDdjYzMiLCJpZCI6Mzg2MzU3LCJpYXQiOjE3NzAwODA5MDJ9.-ggs9Xfr6ptMLXTs0MS7xdieNVFr7TMV7yyd-yjxyHw'

type Orientation = 'vertical' | 'horizontal'
type LayerId = 'bing' | 'tianditu' | 'amap-img' | 'amap-street'

interface LayerDef {
  id: LayerId
  label: string
  short: string
  create: () => ImageryProvider
}

const LAYERS: LayerDef[] = [
  { id: 'bing', label: 'Bing 影像', short: 'Bing 影像', create: () => createBingImageryProvider() },
  { id: 'tianditu', label: '天地图影像', short: '天地图', create: () => createTiandituImageryProvider() },
  { id: 'amap-img', label: '高德影像', short: '高德影像', create: () => new AMapImageryProvider({ style: 'img' }) },
  { id: 'amap-street', label: '高德街道', short: '高德街道', create: () => new AMapImageryProvider({ style: 'elec' }) }
]

const stage = ref<HTMLElement | null>(null)
const baseContainer = ref<HTMLElement | null>(null)
const compareContainer = ref<HTMLElement | null>(null)

const statusMessage = ref('正在加载底图…')
const baseLayerId = ref<LayerId>('bing')
const compareLayerId = ref<LayerId>('amap-img')
const orientation = ref<Orientation>('vertical')
const position = ref(50)
const enabled = ref(true)
const ready = ref(false)

let baseViewer: Viewer | undefined
let compareViewer: Viewer | undefined
let dragging = false

const baseLabel = computed(() => LAYERS.find((layer) => layer.id === baseLayerId.value)?.short ?? '')
const compareLabel = computed(() => LAYERS.find((layer) => layer.id === compareLayerId.value)?.short ?? '')

const compareClipStyle = computed(() => {
  if (!enabled.value) {
    return orientation.value === 'vertical'
      ? { clipPath: 'inset(0 0 0 100%)' }
      : { clipPath: 'inset(100% 0 0 0)' }
  }
  return orientation.value === 'vertical'
    ? { clipPath: `inset(0 0 0 ${position.value}%)` }
    : { clipPath: `inset(${position.value}% 0 0 0)` }
})

const dividerStyle = computed(() => {
  if (orientation.value === 'vertical') {
    return { left: `${position.value}%`, top: '0', bottom: '0', width: '4px', transform: 'translateX(-2px)' }
  }
  return { top: `${position.value}%`, left: '0', right: '0', height: '4px', transform: 'translateY(-2px)' }
})

function createViewer(container: HTMLElement): Viewer {
  const viewer = new Viewer(container, {
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
    scene3DOnly: true
  })
  viewer.scene.globe.baseColor = Color.fromCssColorString('#152b4c')
  return viewer
}

function applyLayer(viewer: Viewer, id: LayerId): void {
  const def = LAYERS.find((layer) => layer.id === id)
  if (!def) return
  try {
    viewer.imageryLayers.removeAll()
    viewer.imageryLayers.addImageryProvider(def.create())
    viewer.scene.requestRender()
  } catch {
    statusMessage.value = `底图加载失败：${def.label}`
  }
}

function refreshLayers(): void {
  if (baseViewer && !baseViewer.isDestroyed()) applyLayer(baseViewer, baseLayerId.value)
  if (compareViewer && !compareViewer.isDestroyed()) applyLayer(compareViewer, compareLayerId.value)
}

function syncCamera(): void {
  const src = baseViewer?.camera
  const dst = compareViewer?.camera
  if (!src || !dst || !baseViewer || !compareViewer) return
  if (baseViewer.isDestroyed() || compareViewer.isDestroyed()) return
  try {
    dst.position = Cartesian3.clone(src.position, dst.position)
    dst.direction = Cartesian3.clone(src.direction, dst.direction)
    dst.up = Cartesian3.clone(src.up, dst.up)
    dst.right = Cartesian3.clone(src.right, dst.right)
    const sf = src.frustum as { fov?: number; near?: number; far?: number }
    const df = dst.frustum as { fov?: number; near?: number; far?: number }
    if (typeof sf.fov === 'number' && typeof df.fov === 'number') {
      df.fov = sf.fov
      df.near = sf.near
      df.far = sf.far
    }
  } catch {
    // 相机尚未初始化，跳过本次同步
  }
}

function updateFromClient(clientX: number, clientY: number): void {
  const el = stage.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  const ratio =
    orientation.value === 'vertical'
      ? (clientX - rect.left) / rect.width
      : (clientY - rect.top) / rect.height
  position.value = Math.max(0, Math.min(100, ratio * 100))
}

function onPointerDown(event: PointerEvent): void {
  if (!enabled.value) return
  dragging = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  updateFromClient(event.clientX, event.clientY)
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging) return
  updateFromClient(event.clientX, event.clientY)
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging) return
  dragging = false
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
}

function setOrientation(value: Orientation): void {
  orientation.value = value
  position.value = 50
}

function onEnabledChange(): void {
  position.value = enabled.value ? 50 : orientation.value === 'vertical' ? 100 : 100
}

onMounted(() => {
  if (!baseContainer.value || !compareContainer.value) return
  Camera.DEFAULT_VIEW_RECTANGLE = DEFAULT_VIEW_RECTANGLE
  Ion.defaultAccessToken = CESIUM_ION_ACCESS_TOKEN
  try {
    baseViewer = createViewer(baseContainer.value)
    compareViewer = createViewer(compareContainer.value)
    compareViewer.scene.screenSpaceCameraController.enableInputs = false
    applyLayer(baseViewer, baseLayerId.value)
    applyLayer(compareViewer, compareLayerId.value)
    const view = {
      destination: Cartesian3.fromDegrees(116.391, 39.907, 220000)
    }
    baseViewer.camera.setView(view)
    compareViewer.camera.setView(view)
    compareViewer.scene.preRender.addEventListener(syncCamera)
    ready.value = true
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (compareViewer && !compareViewer.isDestroyed()) {
    compareViewer.scene.preRender.removeEventListener(syncCamera)
  }
  destroyScene(compareViewer)
  compareViewer = undefined
  destroyScene(baseViewer)
  baseViewer = undefined
})
</script>

<template>
  <div class="swipe-shell">
    <div ref="stage" class="swipe-stage">
      <div ref="baseContainer" class="viewer-layer base"></div>
      <div class="viewer-layer compare" :style="compareClipStyle">
        <div ref="compareContainer" class="viewer-fill"></div>
      </div>

      <div
        v-show="enabled"
        class="swipe-divider"
        :class="orientation"
        :style="dividerStyle"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <div class="swipe-handle" :class="orientation">
          <svg v-if="orientation === 'vertical'" viewBox="0 0 16 16" width="16" height="16">
            <path d="M3 3 L7 8 L3 13" fill="none" stroke="#3a4a5f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M13 3 L9 8 L13 13" fill="none" stroke="#3a4a5f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <svg v-else viewBox="0 0 16 16" width="16" height="16">
            <path d="M3 3 L8 7 L13 3" fill="none" stroke="#3a4a5f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M3 13 L8 9 L13 13" fill="none" stroke="#3a4a5f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>

      <div v-show="enabled" class="side-label" :class="orientation === 'vertical' ? 'side-left' : 'side-top'">{{ baseLabel }}</div>
      <div v-show="enabled" class="side-label" :class="orientation === 'vertical' ? 'side-right' : 'side-bottom'">{{ compareLabel }}</div>
    </div>

    <div class="control-panel">
      <div class="panel-title">图层滑动对比控件</div>

      <div class="row">
        <span class="row-label">启用对比</span>
        <button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '关闭对比' : '启用对比'" @click="enabled = !enabled; onEnabledChange()"><i></i></button>
      </div>

      <div class="seg">
        <button class="seg-btn" :class="{ active: orientation === 'vertical' }" @click="setOrientation('vertical')">垂直</button>
        <button class="seg-btn" :class="{ active: orientation === 'horizontal' }" @click="setOrientation('horizontal')">水平</button>
      </div>

      <label class="slider-row">
        <span class="field-label">分割比例 <em>{{ Math.round(position) }}%</em></span>
        <input type="range" min="0" max="100" step="0.5" v-model.number="position" />
      </label>

      <div class="row stack">
        <span class="row-label">{{ orientation === 'vertical' ? '左侧图层' : '上侧图层' }}</span>
        <select class="select" v-model="baseLayerId" @change="refreshLayers">
          <option v-for="layer in LAYERS" :key="layer.id" :value="layer.id">{{ layer.label }}</option>
        </select>
      </div>

      <div class="row stack">
        <span class="row-label">{{ orientation === 'vertical' ? '右侧图层' : '下侧图层' }}</span>
        <select class="select" v-model="compareLayerId" @change="refreshLayers">
          <option v-for="layer in LAYERS" :key="layer.id" :value="layer.id">{{ layer.label }}</option>
        </select>
      </div>

      <p class="hint">
        按住中央分割条拖动即可对比两侧底图：垂直方向左右对比，水平方向上下对比。可在上/下图层下拉框中切换要对比的底图。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.swipe-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.swipe-stage { position: absolute; inset: 0; }
.viewer-layer { position: absolute; inset: 0; }
.viewer-layer.compare { pointer-events: none; }
.viewer-fill { width: 100%; height: 100%; }
.viewer-layer :deep(.cesium-viewer-bottom) { display: none; }
.swipe-divider { position: absolute; z-index: 20; background: #d3d3d3; touch-action: none; }
.swipe-divider.vertical { cursor: ew-resize; }
.swipe-divider.horizontal { cursor: ns-resize; }
.swipe-handle { position: absolute; width: 42px; height: 42px; background: #fff; border: 1px solid lightgrey; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); }
.swipe-handle.vertical { left: -19px; top: calc(50% - 21px); }
.swipe-handle.horizontal { top: -19px; left: calc(50% - 21px); }
.side-label { position: absolute; z-index: 15; padding: 3px 9px; border-radius: 5px; background: rgba(8, 21, 40, 0.72); color: #dce8f5; font-size: 11px; pointer-events: none; }
.side-left { left: 10px; top: 10px; }
.side-right { right: 10px; top: 10px; }
.side-top { left: 50%; top: 10px; transform: translateX(-50%); }
.side-bottom { left: 50%; bottom: 10px; transform: translateX(-50%); }
.control-panel { position: absolute; right: 12px; top: 12px; z-index: 30; width: 236px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.9); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.row.stack { flex-direction: column; align-items: stretch; gap: 5px; }
.row-label { color: #c3d5e8; font-size: 11px; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }
.toggle.on { background: #2f80ed; }
.toggle.on i { transform: translateX(18px); }
.seg { display: flex; margin-top: 10px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 6px; overflow: hidden; }
.seg-btn { flex: 1; height: 26px; border: 0; background: transparent; color: #c3d5e8; font-size: 11px; cursor: pointer; }
.seg-btn.active { background: #2f80ed; color: #f3f9ff; font-weight: 700; }
.slider-row { display: block; margin-top: 12px; }
.slider-row .field-label { display: flex; align-items: center; justify-content: space-between; color: #c3d5e8; font-size: 11px; }
.slider-row .field-label em { font-style: normal; color: #65d3eb; font-weight: 700; }
.slider-row input[type="range"] { width: 100%; margin: 3px 0 0; accent-color: #2f80ed; background: transparent; }
.select { width: 100%; height: 24px; background: rgba(20, 40, 70, 0.9); border: 1px solid rgba(157, 188, 224, 0.35); color: #dce8f5; font-size: 11px; border-radius: 4px; padding: 0 4px; }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 40; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
