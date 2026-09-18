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
  createPolylineEntity,
  DEFAULT_LINE_POSITIONS,
  registerPolylineMaterials,
  removePolylineEntity,
  updatePolylineEntity,
  type PolylineEntityOptions,
  type PolylineMaterialKind
} from '../polyline-effects-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const placing = ref(false)

const materialKind = ref<PolylineMaterialKind>('PolylineTrail')
const colorHex = ref('#3399ff')
const opacity = ref(0.7)
const speed = ref(1.5)
const percent = ref(0.03)
const gradient = ref(0.15)
const repeatX = ref(8)
const repeatFactor = ref(4)
const dashLength = ref(16)
const dashPattern = ref(255)
const outlineWidth = ref(8)
const directionColorHex = ref('#ffffff')
const lineWidth = ref(8)

const LINE_ID = 'line-material'

const KIND_OPTIONS: Array<{ value: PolylineMaterialKind; label: string }> = [
  { value: 'PolylineTrail', label: '材质线（分段尾迹）' },
  { value: 'PolylineFlow', label: '流动线' },
  { value: 'PolylineFence', label: '栅栏线' },
  { value: 'PolylineMultiArrow', label: '多箭头线' },
  { value: 'PolylineDashArrow', label: '虚线箭头线' },
  { value: 'PolylineDirection', label: '方向线' },
  { value: 'PolylineLighting', label: '发光线' },
  { value: 'PolylineFlicker', label: '闪烁线' },
  { value: 'PolylineImageTrail', label: '图片轨迹线' },
  { value: 'PolylineLightingTrail', label: '发光轨迹线' }
]

const KIND_DEFAULTS: Record<string, { speed?: number; percent?: number; gradient?: number; repeatX?: number; repeatFactor?: number; dashLength?: number; dashPattern?: number; outlineWidth?: number; image?: string }> = {
  PolylineTrail: { speed: 1.5 },
  PolylineFlow: { speed: 2, percent: 0.03, gradient: 0.15 },
  PolylineFence: { dashLength: 16, dashPattern: 255, outlineWidth: 8 },
  PolylineMultiArrow: { repeatFactor: 4 },
  PolylineDashArrow: { dashLength: 16, dashPattern: 255 },
  PolylineDirection: { outlineWidth: 2 },
  PolylineLighting: { image: '/images/lighting.png' },
  PolylineFlicker: { speed: 3 },
  PolylineImageTrail: { speed: 3, repeatX: 8, image: '/images/polyline-arrow.png' },
  PolylineLightingTrail: { speed: 5, image: '/images/lighting.png' }
}

const BASE_CENTER = { lon: 115.73, lat: 36.2 }
const CENTER = { lon: 115.73, lat: 36.2 }

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined

function showSpeed(): boolean {
  return ['PolylineTrail', 'PolylineFlow', 'PolylineFlicker', 'PolylineImageTrail', 'PolylineLightingTrail'].includes(materialKind.value)
}
function showPercent(): boolean { return materialKind.value === 'PolylineFlow' }
function showGradient(): boolean { return materialKind.value === 'PolylineFlow' }
function showRepeatX(): boolean { return materialKind.value === 'PolylineImageTrail' }
function showRepeatFactor(): boolean { return materialKind.value === 'PolylineMultiArrow' }
function showDash(): boolean { return ['PolylineFence', 'PolylineDashArrow'].includes(materialKind.value) }
function showOutlineWidth(): boolean { return ['PolylineFence', 'PolylineDirection'].includes(materialKind.value) }
function showDirectionColor(): boolean { return materialKind.value === 'PolylineDirection' }

function buildPositions(): Array<[number, number, number]> {
  const dLon = CENTER.lon - BASE_CENTER.lon
  const dLat = CENTER.lat - BASE_CENTER.lat
  return DEFAULT_LINE_POSITIONS.map(([lon, lat, height]) => [lon + dLon, lat + dLat, height])
}

function buildOptions(): PolylineEntityOptions {
  const kind = materialKind.value
  const color = Color.fromCssColorString(colorHex.value).withAlpha(opacity.value)
  return {
    id: LINE_ID,
    positions: buildPositions(),
    kind,
    width: lineWidth.value,
    material: {
      color,
      speed: speed.value,
      percent: percent.value,
      gradient: gradient.value,
      repeatX: repeatX.value,
      repeatFactor: repeatFactor.value,
      dashLength: dashLength.value,
      dashPattern: dashPattern.value,
      outlineWidth: outlineWidth.value,
      directionColor: Color.fromCssColorString(directionColorHex.value).withAlpha(opacity.value),
      image: KIND_DEFAULTS[kind]?.image
    }
  }
}

function place(lon: number, lat: number): void {
  if (!viewer || viewer.isDestroyed()) return
  CENTER.lon = lon
  CENTER.lat = lat
  createPolylineEntity(viewer, buildOptions())
  resultMessage.value = `材质线已平移至 ${lon.toFixed(4)}, ${lat.toFixed(4)}`
}

function updateEffect(): void {
  if (!viewer || viewer.isDestroyed()) return
  const entity = viewer.entities.getById(`dc-polyline-${LINE_ID}`)
  if (!entity) {
    place(BASE_CENTER.lon, BASE_CENTER.lat)
    return
  }
  updatePolylineEntity(viewer, LINE_ID, {
    width: lineWidth.value,
    material: {
      color: Color.fromCssColorString(colorHex.value).withAlpha(opacity.value),
      speed: speed.value,
      percent: percent.value,
      gradient: gradient.value,
      repeatX: repeatX.value,
      repeatFactor: repeatFactor.value,
      dashLength: dashLength.value,
      dashPattern: dashPattern.value,
      outlineWidth: outlineWidth.value,
      directionColor: Color.fromCssColorString(directionColorHex.value).withAlpha(opacity.value)
    }
  })
  resultMessage.value = '材质线参数已更新'
}

function onKindChange(): void {
  const defaults = KIND_DEFAULTS[materialKind.value]
  if (defaults) {
    if (defaults.speed !== undefined) speed.value = defaults.speed
    if (defaults.percent !== undefined) percent.value = defaults.percent
    if (defaults.gradient !== undefined) gradient.value = defaults.gradient
    if (defaults.repeatX !== undefined) repeatX.value = defaults.repeatX
    if (defaults.dashLength !== undefined) dashLength.value = defaults.dashLength
    if (defaults.dashPattern !== undefined) dashPattern.value = defaults.dashPattern
    if (defaults.outlineWidth !== undefined) outlineWidth.value = defaults.outlineWidth
  }
  if (viewer && !viewer.isDestroyed()) {
    createPolylineEntity(viewer, buildOptions())
    resultMessage.value = `已切换材质：${KIND_OPTIONS.find((o) => o.value === materialKind.value)?.label}`
  }
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !placing.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  const carto = Cartographic.fromCartesian(pos)
  place(CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude))
}

watch([colorHex, opacity, speed, percent, gradient, repeatX, repeatFactor, dashLength, dashPattern, outlineWidth, directionColorHex, lineWidth], () => {
  if (viewer && !viewer.isDestroyed()) updateEffect()
})

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    registerPolylineMaterials()
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(BASE_CENTER.lon, BASE_CENTER.lat, 2600000)
    })

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)

    place(BASE_CENTER.lon, BASE_CENTER.lat)
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  handler?.destroy()
  handler = undefined
  removePolylineEntity(viewer, LINE_ID)
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="line-material-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">材质线效果</div>

      <button class="action-button primary" :class="{ active: placing }" @click="placing = !placing">
        {{ placing ? '放置中… 点击地图平移' : '点击地图平移折线' }}
      </button>
      <button class="action-button neutral" @click="place(BASE_CENTER.lon, BASE_CENTER.lat)">重置默认位置</button>

      <div class="section-title">材质样例</div>
      <div class="control-row">
        <span class="row-label">材质类型</span>
        <select v-model="materialKind" class="kind-select" aria-label="材质类型" @change="onKindChange">
          <option v-for="opt in KIND_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>

      <div class="section-title">线条参数</div>
      <div class="control-row">
        <span class="row-label">颜色</span>
        <input v-model="colorHex" type="color" class="color-input" />
      </div>
      <div class="control-row">
        <span class="row-label">透明度</span>
        <input v-model.number="opacity" type="range" min="0.1" max="1" step="0.05" />
        <span class="row-value">{{ opacity.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">线宽(px)</span>
        <input v-model.number="lineWidth" type="range" min="1" max="40" step="1" />
        <span class="row-value">{{ lineWidth }}</span>
      </div>

      <template v-if="showSpeed()">
        <div class="control-row">
          <span class="row-label">流动速度</span>
          <input v-model.number="speed" type="range" min="0.5" max="10" step="0.5" />
          <span class="row-value">{{ speed.toFixed(1) }}</span>
        </div>
      </template>
      <template v-if="showPercent()">
        <div class="control-row">
          <span class="row-label">段长</span>
          <input v-model.number="percent" type="range" min="0.01" max="0.2" step="0.01" />
          <span class="row-value">{{ percent.toFixed(2) }}</span>
        </div>
      </template>
      <template v-if="showGradient()">
        <div class="control-row">
          <span class="row-label">渐变强度</span>
          <input v-model.number="gradient" type="range" min="0" max="0.5" step="0.01" />
          <span class="row-value">{{ gradient.toFixed(2) }}</span>
        </div>
      </template>
      <template v-if="showRepeatX()">
        <div class="control-row">
          <span class="row-label">重复次数</span>
          <input v-model.number="repeatX" type="range" min="1" max="20" step="1" />
          <span class="row-value">{{ repeatX }}</span>
        </div>
      </template>
      <template v-if="showRepeatFactor()">
        <div class="control-row">
          <span class="row-label">箭头重复</span>
          <input v-model.number="repeatFactor" type="range" min="1" max="10" step="1" />
          <span class="row-value">{{ repeatFactor }}</span>
        </div>
      </template>
      <template v-if="showDash()">
        <div class="control-row">
          <span class="row-label">虚线长度</span>
          <input v-model.number="dashLength" type="range" min="4" max="40" step="1" />
          <span class="row-value">{{ dashLength }}</span>
        </div>
        <div class="control-row">
          <span class="row-label">虚线图案</span>
          <input v-model.number="dashPattern" type="range" min="1" max="255" step="1" />
          <span class="row-value">{{ dashPattern }}</span>
        </div>
      </template>
      <template v-if="showOutlineWidth()">
        <div class="control-row">
          <span class="row-label">外轮廓宽</span>
          <input v-model.number="outlineWidth" type="range" min="0" max="30" step="1" />
          <span class="row-value">{{ outlineWidth }}</span>
        </div>
      </template>
      <template v-if="showDirectionColor()">
        <div class="control-row">
          <span class="row-label">方向颜色</span>
          <input v-model="directionColorHex" type="color" class="color-input" />
        </div>
      </template>

      <p class="hint">支持 10 种线材质样例，切换后参数实时联动；开启放置后单击地图可整体平移折线。</p>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.line-material-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 248px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 48px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row input[type="color"] { width: 40px; height: 24px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 5px; background: transparent; cursor: pointer; }
.kind-select { flex: 1; min-width: 0; height: 26px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 5px; background: #15233c; color: #dce8f5; font-size: 11px; }
.action-button { width: 100%; height: 28px; margin-top: 6px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.primary.active { background: #1f6f96; }
.action-button.neutral { background: #2c3a52; color: #c3d5e8; }
.hint { margin: 8px 0 0; font-size: 11px; color: #7f96b3; line-height: 1.5; }
.result-message { margin-top: 6px; font-size: 11px; color: #8be0b2; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
