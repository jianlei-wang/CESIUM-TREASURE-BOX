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
  createColoredLineSegments,
  createPolylineEntity,
  DEFAULT_LINE_POSITIONS,
  registerPolylineMaterials,
  removeColoredLineSegments,
  removePolylineEntity,
  updateColoredLineSegments,
  updatePolylineEntity,
  type PolylineEntityOptions
} from '../polyline-effects-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const placing = ref(false)

const colorMode = ref<'single' | 'multi'>('single')
const colorHex = ref('#ff9933')
const opacity = ref(0.8)
const speed = ref(2)
const percent = ref(0.03)
const gradient = ref(0.15)
const lineWidth = ref(10)

const MULTI_COLORS = ['#ff3344', '#ff9933', '#33cc66', '#3399ff']

const LINE_ID = 'line-flow'

const BASE_CENTER = { lon: 115.73, lat: 36.2 }
const CENTER = { lon: 115.73, lat: 36.2 }

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined

function buildPositions(): Array<[number, number, number]> {
  const dLon = CENTER.lon - BASE_CENTER.lon
  const dLat = CENTER.lat - BASE_CENTER.lat
  return DEFAULT_LINE_POSITIONS.map(([lon, lat, height]) => [lon + dLon, lat + dLat, height])
}

function buildOptions(): PolylineEntityOptions {
  return {
    id: LINE_ID,
    positions: buildPositions(),
    kind: 'PolylineFlow',
    width: lineWidth.value,
    material: {
      color: Color.fromCssColorString(colorHex.value).withAlpha(opacity.value),
      speed: speed.value,
      percent: percent.value,
      gradient: gradient.value
    }
  }
}

function place(lon: number, lat: number): void {
  if (!viewer || viewer.isDestroyed()) return
  CENTER.lon = lon
  CENTER.lat = lat
  createFlow()
  resultMessage.value = `流动线已平移至 ${lon.toFixed(4)}, ${lat.toFixed(4)}`
}

function createFlow(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (colorMode.value === 'single') {
    createPolylineEntity(viewer, buildOptions())
  } else {
    createColoredLineSegments(viewer, LINE_ID, buildPositions(), {
      kind: 'PolylineFlow',
      width: lineWidth.value,
      colors: MULTI_COLORS.map((hex) => Color.fromCssColorString(hex).withAlpha(opacity.value)),
      material: {
        speed: speed.value,
        percent: percent.value,
        gradient: gradient.value
      }
    })
  }
}

function updateEffect(): void {
  if (!viewer || viewer.isDestroyed()) return
  const singleEntity = viewer.entities.getById(`dc-polyline-${LINE_ID}`)
  const segEntity = viewer.entities.getById(`dc-polyline-${LINE_ID}-seg-0`)
  if (!singleEntity && !segEntity) {
    createFlow()
    return
  }
  if (colorMode.value === 'single') {
    removeColoredLineSegments(viewer, LINE_ID)
    if (!singleEntity) {
      createFlow()
      return
    }
    updatePolylineEntity(viewer, LINE_ID, {
      width: lineWidth.value,
      material: {
        color: Color.fromCssColorString(colorHex.value).withAlpha(opacity.value),
        speed: speed.value,
        percent: percent.value,
        gradient: gradient.value
      }
    })
  } else {
    removePolylineEntity(viewer, LINE_ID)
    updateColoredLineSegments(viewer, LINE_ID, {
      positions: buildPositions(),
      width: lineWidth.value,
      colors: MULTI_COLORS.map((hex) => Color.fromCssColorString(hex).withAlpha(opacity.value)),
      material: {
        speed: speed.value,
        percent: percent.value,
        gradient: gradient.value
      }
    })
  }
  resultMessage.value = colorMode.value === 'single' ? '流动线参数已更新' : '多色流动线参数已更新'
}

function onColorModeChange(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (colorMode.value === 'single') {
    removeColoredLineSegments(viewer, LINE_ID)
    createPolylineEntity(viewer, buildOptions())
  } else {
    removePolylineEntity(viewer, LINE_ID)
    createColoredLineSegments(viewer, LINE_ID, buildPositions(), {
      kind: 'PolylineFlow',
      width: lineWidth.value,
      colors: MULTI_COLORS.map((hex) => Color.fromCssColorString(hex).withAlpha(opacity.value)),
      material: {
        speed: speed.value,
        percent: percent.value,
        gradient: gradient.value
      }
    })
  }
  resultMessage.value = colorMode.value === 'single' ? '已切换为单色流动线' : '已切换为多色流动线'
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !placing.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  const carto = Cartographic.fromCartesian(pos)
  place(CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude))
}

watch([colorHex, opacity, speed, percent, gradient, lineWidth], () => {
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

    createFlow()
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  handler?.destroy()
  handler = undefined
  removePolylineEntity(viewer, LINE_ID)
  removeColoredLineSegments(viewer, LINE_ID)
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="line-flow-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">流动线效果</div>

      <button class="action-button primary" :class="{ active: placing }" @click="placing = !placing">
        {{ placing ? '放置中… 点击地图平移' : '点击地图平移折线' }}
      </button>
      <button class="action-button neutral" @click="place(BASE_CENTER.lon, BASE_CENTER.lat)">重置默认位置</button>

      <div class="section-title">颜色模式</div>
      <div class="control-row">
        <span class="row-label">模式</span>
        <select v-model="colorMode" class="kind-select" aria-label="颜色模式" @change="onColorModeChange">
          <option value="single">单色</option>
          <option value="multi">多色（每段一色）</option>
        </select>
      </div>

      <div class="section-title">线条参数</div>
      <template v-if="colorMode === 'single'">
        <div class="control-row">
          <span class="row-label">颜色</span>
          <input v-model="colorHex" type="color" class="color-input" />
        </div>
      </template>
      <div class="control-row">
        <span class="row-label">透明度</span>
        <input v-model.number="opacity" type="range" min="0.1" max="1" step="0.05" />
        <span class="row-value">{{ opacity.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">流动速度</span>
        <input v-model.number="speed" type="range" min="0.5" max="10" step="0.5" />
        <span class="row-value">{{ speed.toFixed(1) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">段长</span>
        <input v-model.number="percent" type="range" min="0.01" max="0.2" step="0.01" />
        <span class="row-value">{{ percent.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">渐变强度</span>
        <input v-model.number="gradient" type="range" min="0" max="0.5" step="0.01" />
        <span class="row-value">{{ gradient.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">线宽(px)</span>
        <input v-model.number="lineWidth" type="range" min="1" max="40" step="1" />
        <span class="row-value">{{ lineWidth }}</span>
      </div>

      <p class="hint">发光段沿路径向前流动；多色模式将折线按段着色（红橙绿蓝），各段流动同步；参数修改实时生效。</p>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.line-flow-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
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
