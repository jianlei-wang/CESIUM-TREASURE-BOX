<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  PolygonHierarchy,
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
import { pickPosition, pointBuffer, bufferOuterRing, type BufferParams } from '../measure-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const radius = ref(1000)
const steps = ref(48)
const fillColor = ref('#ff7a3d')
const fillAlpha = ref(0.45)
const showBorder = ref(true)
const borderColor = ref('#ff5c2e')
const borderWidth = ref(2)
const lngInput = ref('116.391')
const latInput = ref('39.908')
const pointCount = ref(0)

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let disposed = false

type BufferItem = {
  bufferPolygon: { hierarchy: { setValue: (h: PolygonHierarchy) => void }; material: unknown }
  borderPolyline: { positions: { setValue: (p: Cartesian3[]) => void }; show: unknown; width: unknown; material: unknown }
}

const bufferItems: BufferItem[] = []

function makeParams(): BufferParams {
  return { radius: radius.value, joinStyle: 'round', endCapStyle: 'round', steps: steps.value }
}

function makeFillColor(): Color {
  const c = Color.fromCssColorString(fillColor.value)
  c.alpha = fillAlpha.value
  return c
}

function applyBufferStyle(item: BufferItem): void {
  item.bufferPolygon.material = makeFillColor()
  item.borderPolyline.show = showBorder.value
  item.borderPolyline.width = borderWidth.value
  item.borderPolyline.material = Color.fromCssColorString(borderColor.value)
}

function createPoint(lng: number, lat: number): void {
  if (!viewer || viewer.isDestroyed()) return
  const bufferPoly = pointBuffer(lng, lat, makeParams())
  if (!bufferPoly) {
    resultMessage.value = '缓冲区生成失败，请检查半径'
    return
  }
  const ring = bufferOuterRing(bufferPoly)
  viewer.entities.add({
    position: Cartesian3.fromDegrees(lng, lat),
    point: {
      pixelSize: 10,
      color: Color.fromCssColorString('#ffd166'),
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
  const ringPositions = ring.map(([x, y]) => Cartesian3.fromDegrees(x, y))
  const bufferEntity = viewer.entities.add({
    polygon: {
      hierarchy: new PolygonHierarchy(ringPositions),
      material: makeFillColor()
    }
  })
  const borderEntity = viewer.entities.add({
    polyline: {
      positions: ringPositions,
      width: borderWidth.value,
      material: Color.fromCssColorString(borderColor.value),
      show: showBorder.value
    }
  })
  bufferItems.push({
    bufferPolygon: (bufferEntity as unknown as { polygon: BufferItem['bufferPolygon'] }).polygon,
    borderPolyline: (borderEntity as unknown as { polyline: BufferItem['borderPolyline'] }).polyline
  })
  pointCount.value += 1
  resultMessage.value = `点 #${pointCount.value}（${lng.toFixed(4)}, ${lat.toFixed(4)}），缓冲区半径 ${radius.value}m`
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed()) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  const carto = Cartographic.fromCartesian(pos)
  createPoint((carto.longitude * 180) / Math.PI, (carto.latitude * 180) / Math.PI)
}

function applyPointInput(): void {
  const lng = parseFloat(lngInput.value)
  const lat = parseFloat(latInput.value)
  if (Number.isNaN(lng) || Number.isNaN(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    resultMessage.value = '经纬度无效，经度范围 [-180,180]，纬度范围 [-90,90]'
    return
  }
  createPoint(lng, lat)
}

function updateAll(): void {
  for (const item of bufferItems) applyBufferStyle(item)
}

function clearAll(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.entities.removeAll()
  bufferItems.length = 0
  pointCount.value = 0
  resultMessage.value = ''
}

watch([fillColor, fillAlpha, showBorder, borderColor, borderWidth], () => updateAll())

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  handler?.destroy()
  handler = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="pb-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="control-panel">
      <div class="panel-title">点缓冲区分析</div>
      <div class="section-title">创建点</div>
      <div class="control-row">
        <span class="row-label">经度</span>
        <input v-model="lngInput" type="number" step="0.0001" class="num-input" />
      </div>
      <div class="control-row">
        <span class="row-label">纬度</span>
        <input v-model="latInput" type="number" step="0.0001" class="num-input" />
      </div>
      <div class="button-row">
        <button class="action-button primary" @click="applyPointInput">按坐标创建点</button>
        <button class="action-button ghost" @click="resultMessage = '单击地图任意位置创建点'">地图点击创建</button>
      </div>
      <div class="section-title">缓冲区参数</div>
      <div class="control-row">
        <span class="row-label">半径(m)</span>
        <input v-model.number="radius" type="number" min="1" step="10" class="num-input" />
      </div>
      <div class="control-row">
        <span class="row-label">圆滑度</span>
        <input v-model.number="steps" type="range" min="8" max="128" step="4" />
        <span class="row-value">{{ steps }}</span>
      </div>
      <div class="section-title">显示样式</div>
      <div class="control-row">
        <span class="row-label">填充颜色</span>
        <input v-model="fillColor" type="color" class="color-input" />
      </div>
      <div class="control-row">
        <span class="row-label">透明度</span>
        <input v-model.number="fillAlpha" type="range" min="0" max="1" step="0.05" />
        <span class="row-value">{{ fillAlpha.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <label class="switch-label">显示边框</label>
        <input v-model="showBorder" type="checkbox" />
      </div>
      <div class="control-row">
        <span class="row-label">边框颜色</span>
        <input v-model="borderColor" type="color" class="color-input" />
      </div>
      <div class="control-row">
        <span class="row-label">边框宽度</span>
        <input v-model.number="borderWidth" type="range" min="1" max="8" step="1" />
        <span class="row-value">{{ borderWidth }}</span>
      </div>
      <div class="button-row">
        <button class="action-button danger" @click="clearAll">清除全部</button>
      </div>
      <div class="hint">已创建 {{ pointCount }} 个点缓冲区</div>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.pb-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 260px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 8px; margin-bottom: 4px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 34px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.num-input { width: 96px; height: 24px; padding: 0 6px; border-radius: 5px; border: 1px solid rgba(157, 188, 224, 0.24); outline: 0; background: rgba(8, 21, 40, 0.55); color: #e6eef9; font-size: 11px; }
.control-row input[type="color"] { width: 40px; height: 24px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 5px; background: transparent; cursor: pointer; }
.switch-label { color: #c3d5e8; font-size: 11px; }
.control-row input[type="checkbox"] { accent-color: #2f80ed; }
.button-row { display: flex; gap: 8px; margin-top: 4px; }
.action-button { flex: 1; height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.ghost { background: rgba(47, 128, 237, 0.18); color: #cfe3ff; border: 1px solid rgba(47, 128, 237, 0.4); }
.action-button.danger { background: #7a3b4a; color: #ffe3ea; }
.hint { margin-top: 8px; font-size: 11px; color: #7f96b3; line-height: 1.5; }
.result-message { margin-top: 6px; font-size: 11px; color: #8be0b2; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
