<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  LabelStyle,
  PolygonHierarchy,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Entity,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { pickPosition, pointBuffer, bufferOuterRing, type BufferParams } from '../measure-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const newValue = ref(100)
const isPicking = ref(false)

const params = reactive({
  mode: 'area',
  areaFactor: 20000000,
  radiusPerUnit: 80,
  minRadiusKm: 5,
  maxRadiusKm: 500,
  steps: 48,
  fillColor: '#ffa022',
  fillAlpha: 0.45,
  showBorder: true,
  borderColor: '#ffd54d',
  borderWidth: 2,
  showLabel: true,
  labelSize: 13
})

const PRESET_CITIES: { name: string; coord: [number, number]; value: number }[] = [
  { name: '北京', coord: [116.41, 39.9], value: 2189 },
  { name: '上海', coord: [121.47, 31.23], value: 2487 },
  { name: '广州', coord: [113.26, 23.13], value: 1868 },
  { name: '成都', coord: [104.07, 30.57], value: 2094 },
  { name: '武汉', coord: [114.31, 30.59], value: 1374 },
  { name: '西安', coord: [108.94, 34.34], value: 1296 },
  { name: '南京', coord: [118.8, 32.06], value: 942 },
  { name: '重庆', coord: [106.55, 29.56], value: 3205 }
]

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined

type SymbolItem = { lng: number; lat: number; value: number; label?: string }

const items: SymbolItem[] = []
const itemEntities: Entity[] = []

function computeRadius(value: number): number {
  let radius: number
  if (params.mode === 'area') {
    radius = Math.sqrt((value * params.areaFactor) / Math.PI)
  } else {
    radius = value * params.radiusPerUnit
  }
  const min = params.minRadiusKm * 1000
  const max = params.maxRadiusKm * 1000
  return Math.max(min, Math.min(max, radius))
}

function makeFillColor(): Color {
  const c = Color.fromCssColorString(params.fillColor)
  c.alpha = params.fillAlpha
  return c
}

function rebuild(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const entity of itemEntities) {
    viewer.entities.remove(entity)
  }
  itemEntities.length = 0
  for (const item of items) {
    const radius = computeRadius(item.value)
    const bufferParams: BufferParams = {
      radius,
      joinStyle: 'round',
      endCapStyle: 'round',
      steps: params.steps
    }
    const bufferPoly = pointBuffer(item.lng, item.lat, bufferParams)
    if (!bufferPoly) continue
    const ring = bufferOuterRing(bufferPoly)
    const positions = ring.map(([x, y]) => Cartesian3.fromDegrees(x, y))
    const polygonEntity = viewer.entities.add({
      polygon: {
        hierarchy: new PolygonHierarchy(positions),
        material: makeFillColor()
      }
    })
    itemEntities.push(polygonEntity)
    if (params.showBorder) {
      const borderEntity = viewer.entities.add({
        polyline: {
          positions: [...positions, positions[0]],
          width: params.borderWidth,
          material: Color.fromCssColorString(params.borderColor)
        }
      })
      itemEntities.push(borderEntity)
    }
    if (params.showLabel) {
      const labelEntity = viewer.entities.add({
        position: Cartesian3.fromDegrees(item.lng, item.lat),
        label: {
          text: item.label ? `${item.label} ${item.value}` : String(item.value),
          font: `bold ${params.labelSize}px sans-serif`,
          fillColor: Color.WHITE,
          outlineColor: Color.fromCssColorString('#0e2340'),
          outlineWidth: 4,
          style: LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Color.fromCssColorString('#0e2340').withAlpha(0.6),
          backgroundPadding: new Cartesian2(5, 3),
          pixelOffset: new Cartesian2(0, 0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      })
      itemEntities.push(labelEntity)
    }
  }
  resultMessage.value = `已渲染 ${items.length} 个比例符号面（${params.mode === 'area' ? '面积' : '半径'}正比）`
}

function addItem(lng: number, lat: number, value: number, label?: string): void {
  if (value <= 0) {
    resultMessage.value = '数值必须大于 0'
    return
  }
  items.push({ lng, lat, value, label })
  rebuild()
}

function loadPreset(): void {
  items.length = 0
  for (const city of PRESET_CITIES) {
    items.push({ lng: city.coord[0], lat: city.coord[1], value: city.value, label: city.name })
  }
  rebuild()
}

function clearAll(): void {
  items.length = 0
  if (viewer && !viewer.isDestroyed()) {
    for (const entity of itemEntities) viewer.entities.remove(entity)
  }
  itemEntities.length = 0
  resultMessage.value = ''
}

function togglePicking(): void {
  if (!viewer || viewer.isDestroyed()) return
  isPicking.value = !isPicking.value
  if (isPicking.value) {
    resultMessage.value = '拾取模式开启：点击地图在对应位置添加数值符号面'
  } else {
    resultMessage.value = ''
  }
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!isPicking.value || !viewer || viewer.isDestroyed()) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  const carto = Cartographic.fromCartesian(pos)
  const lng = (carto.longitude * 180) / Math.PI
  const lat = (carto.latitude * 180) / Math.PI
  addItem(lng, lat, newValue.value)
}

watch(
  () => [params.mode, params.areaFactor, params.radiusPerUnit, params.minRadiusKm, params.maxRadiusKm, params.steps, params.fillColor, params.fillAlpha, params.showBorder, params.borderColor, params.borderWidth, params.showLabel, params.labelSize],
  () => {
    if (items.length > 0) rebuild()
  }
)

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    if (!viewer || viewer.isDestroyed()) return
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(105, 35, 16500000)
    })
    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)
    loadPreset()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  handler?.destroy()
  handler = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="pa-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="control-panel">
      <div class="panel-title">比例符号面</div>

      <div class="section-title">数值与创建</div>
      <div class="control-row">
        <span class="row-label">数值</span>
        <input v-model.number="newValue" type="number" min="1" step="10" class="num-input" />
      </div>
      <div class="button-row">
        <button class="action-button primary" @click="loadPreset">载入示例城市</button>
        <button class="action-button ghost" :class="{ active: isPicking }" @click="togglePicking">地图点击添加</button>
      </div>

      <div class="section-title">比例参数</div>
      <div class="control-row">
        <span class="row-label">正比模式</span>
        <select v-model="params.mode" class="num-input">
          <option value="area">面积正比</option>
          <option value="radius">半径正比</option>
        </select>
      </div>
      <div v-if="params.mode === 'area'" class="control-row">
        <span class="row-label">面积系数(㎡/单位)</span>
        <input v-model.number="params.areaFactor" type="number" min="1000000" step="1000000" class="num-input" />
      </div>
      <div v-else class="control-row">
        <span class="row-label">半径系数(m/单位)</span>
        <input v-model.number="params.radiusPerUnit" type="number" min="10" step="10" class="num-input" />
      </div>
      <div class="control-row">
        <span class="row-label">最小半径(km)</span>
        <input v-model.number="params.minRadiusKm" type="number" min="0.5" step="0.5" class="num-input" />
      </div>
      <div class="control-row">
        <span class="row-label">最大半径(km)</span>
        <input v-model.number="params.maxRadiusKm" type="number" min="10" step="10" class="num-input" />
      </div>
      <div class="control-row">
        <span class="row-label">圆滑度</span>
        <input v-model.number="params.steps" type="range" min="8" max="128" step="4" />
        <span class="row-value">{{ params.steps }}</span>
      </div>

      <div class="section-title">显示样式</div>
      <div class="control-row">
        <span class="row-label">填充颜色</span>
        <input v-model="params.fillColor" type="color" class="color-input" />
      </div>
      <div class="control-row">
        <span class="row-label">透明度</span>
        <input v-model.number="params.fillAlpha" type="range" min="0" max="1" step="0.05" />
        <span class="row-value">{{ params.fillAlpha.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <label class="switch-label">显示边框</label>
        <input v-model="params.showBorder" type="checkbox" />
      </div>
      <div class="control-row">
        <span class="row-label">边框颜色</span>
        <input v-model="params.borderColor" type="color" class="color-input" />
      </div>
      <div class="control-row">
        <span class="row-label">边框宽度</span>
        <input v-model.number="params.borderWidth" type="range" min="1" max="8" step="1" />
        <span class="row-value">{{ params.borderWidth }}</span>
      </div>
      <div class="control-row">
        <label class="switch-label">数值标签</label>
        <input v-model="params.showLabel" type="checkbox" />
      </div>

      <div class="button-row">
        <button class="action-button danger" @click="clearAll">清除全部</button>
      </div>
      <div class="hint">已渲染 {{ items.length }} 个比例符号面</div>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.pa-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 260px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 8px; margin-bottom: 4px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 34px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.num-input { width: 118px; height: 24px; padding: 0 6px; border-radius: 5px; border: 1px solid rgba(157, 188, 224, 0.24); outline: 0; background: rgba(8, 21, 40, 0.55); color: #e6eef9; font-size: 11px; }
.control-row input[type="color"] { width: 40px; height: 24px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 5px; background: transparent; cursor: pointer; }
.switch-label { color: #c3d5e8; font-size: 11px; }
.control-row input[type="checkbox"] { accent-color: #2f80ed; }
.button-row { display: flex; gap: 8px; margin-top: 4px; }
.action-button { flex: 1; height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.ghost { background: rgba(47, 128, 237, 0.18); color: #cfe3ff; border: 1px solid rgba(47, 128, 237, 0.4); }
.action-button.ghost.active { background: #e8791e; color: #fff; border-color: #e8791e; }
.action-button.danger { background: #7a3b4a; color: #ffe3ea; }
.hint { margin-top: 8px; font-size: 11px; color: #7f96b3; line-height: 1.5; }
.result-message { margin-top: 6px; font-size: 11px; color: #8be0b2; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
