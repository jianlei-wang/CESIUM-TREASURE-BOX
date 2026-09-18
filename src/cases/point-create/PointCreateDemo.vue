<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Ellipsoid,
  HeightReference,
  HorizontalOrigin,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const drawing = ref(false)
const pointCount = ref(0)
const pointSize = ref(10)
const pointColor = ref('#ffb84d')
const outlineColor = ref('#ffffff')
const outlineWidth = ref(1.5)
const pointHeight = ref(0)
const clampToGround = ref(false)
const showLabel = ref(true)
const labelColor = ref('#ffffff')

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let disposed = false

const POINT_COLORS = ['#ffb84d', '#ff5c5c', '#4a9eff', '#52de9f', '#c98bff', '#ff8ad8', '#ffffff']

function positionWithHeight(pos: Cartesian3): Cartesian3 {
  if (!clampToGround.value || pointHeight.value !== 0) {
    const carto = Cartographic.fromCartesian(pos, Ellipsoid.WGS84)
    return Cartesian3.fromRadians(carto.longitude, carto.latitude, pointHeight.value)
  }
  return pos
}

function createPoint(position: Cartesian3): void {
  if (!viewer || viewer.isDestroyed()) return
  const pos = positionWithHeight(position)
  const color = Color.fromCssColorString(pointColor.value)
  const outline = Color.fromCssColorString(outlineColor.value)
  viewer.entities.add({
    position: pos,
    point: {
      pixelSize: pointSize.value,
      color,
      outlineColor: outline,
      outlineWidth: outlineWidth.value,
      heightReference: clampToGround.value ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: `P${pointCount.value + 1}`,
      font: '13px sans-serif',
      fillColor: Color.fromCssColorString(labelColor.value),
      outlineColor: Color.BLACK,
      outlineWidth: 3,
      showBackground: true,
      backgroundColor: Color.fromCssColorString('#0a2030').withAlpha(0.72),
      verticalOrigin: VerticalOrigin.BOTTOM,
      horizontalOrigin: HorizontalOrigin.CENTER,
      pixelOffset: new Cartesian2(0, -22),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: showLabel.value
    }
  })
  pointCount.value += 1
  const carto = Cartographic.fromCartesian(position, Ellipsoid.WGS84)
  const lon = (carto.longitude * 180) / Math.PI
  const lat = (carto.latitude * 180) / Math.PI
  resultMessage.value = `P${pointCount.value}: 经度 ${lon.toFixed(6)}° 纬度 ${lat.toFixed(6)}° 高度 ${carto.height.toFixed(1)} m`
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !drawing.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  createPoint(pos)
}

function clearAll(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.entities.removeAll()
  pointCount.value = 0
  resultMessage.value = ''
}

function applyPointHeight(): void {
  if (!viewer || viewer.isDestroyed() || pointCount.value === 0) return
  for (const entity of viewer.entities.values) {
    const position = (entity as { position?: { getValue: (time: unknown) => Cartesian3 } }).position?.getValue(0)
    if (!position) continue
    const carto = Cartographic.fromCartesian(position, Ellipsoid.WGS84)
    const height = clampToGround.value && pointHeight.value === 0 ? carto.height : pointHeight.value
    const newPos = Cartesian3.fromRadians(carto.longitude, carto.latitude, height)
    ;(entity as unknown as { position: { setValue: (v: Cartesian3) => void } }).position.setValue(newPos)
  }
}

watch([pointSize, pointColor, outlineColor, outlineWidth, labelColor], () => {
  if (!viewer || viewer.isDestroyed() || pointCount.value === 0) return
  const color = Color.fromCssColorString(pointColor.value)
  const outline = Color.fromCssColorString(outlineColor.value)
  for (const entity of viewer.entities.values) {
    const point = (entity as { point?: { pixelSize: unknown; color: unknown; outlineColor: unknown; outlineWidth: unknown } }).point
    if (point) {
      point.pixelSize = pointSize.value
      point.color = color
      point.outlineColor = outline
      point.outlineWidth = outlineWidth.value
    }
  }
})

watch(showLabel, () => {
  if (!viewer || viewer.isDestroyed()) return
  for (const entity of viewer.entities.values) {
    const label = (entity as { label?: { show: unknown } }).label
    if (label) label.show = showLabel.value
  }
})

watch(clampToGround, () => {
  if (!viewer || viewer.isDestroyed() || pointCount.value === 0) return
  const hr = clampToGround.value ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE
  for (const entity of viewer.entities.values) {
    const point = (entity as { point?: { heightReference: unknown } }).point
    if (point) point.heightReference = hr
  }
})

watch(pointHeight, () => applyPointHeight())

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
  <div class="point-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="control-panel">
      <div class="panel-title">动态点标注</div>
      <div class="control-row">
        <button class="action-button primary" @click="drawing = !drawing">
          {{ drawing ? '停止绘制' : '开始绘制' }}
        </button>
        <button class="action-button danger" @click="clearAll">清除全部</button>
      </div>
      <div class="section-title">点参数</div>
      <div class="control-row">
        <span class="row-label">点大小</span>
        <input v-model.number="pointSize" type="range" min="3" max="40" step="1" />
        <span class="row-value">{{ pointSize }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">填充颜色</span>
        <div class="swatch-group">
          <button v-for="c in POINT_COLORS" :key="c" class="swatch" :style="{ background: c }" :class="{ active: c === pointColor }" @click="pointColor = c"></button>
        </div>
      </div>
      <div class="control-row">
        <span class="row-label">轮廓宽度</span>
        <input v-model.number="outlineWidth" type="range" min="0" max="6" step="0.5" />
        <span class="row-value">{{ outlineWidth }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">点高度(m)</span>
        <input v-model.number="pointHeight" type="number" step="10" />
      </div>
      <div class="control-row">
        <label class="switch-label">贴地</label>
        <input v-model="clampToGround" type="checkbox" />
      </div>
      <div class="control-row">
        <label class="switch-label">显示标签</label>
        <input v-model="showLabel" type="checkbox" />
      </div>
      <div class="hint">点击地图任意位置创建点位；已有点位参数实时更新。</div>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.point-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 258px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 8px; margin-bottom: 4px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 30px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row input[type="number"] { width: 64px; height: 24px; padding: 0 6px; border-radius: 5px; border: 1px solid rgba(157, 188, 224, 0.24); outline: 0; background: rgba(8, 21, 40, 0.55); color: #e6eef9; font-size: 11px; }
.switch-label { color: #c3d5e8; font-size: 11px; }
.control-row input[type="checkbox"] { accent-color: #2f80ed; }
.swatch-group { display: flex; flex-wrap: wrap; gap: 5px; }
.swatch { width: 18px; height: 18px; padding: 0; border: 2px solid transparent; border-radius: 50%; cursor: pointer; }
.swatch.active { border-color: #fff; }
.button-row { display: flex; gap: 8px; margin-top: 4px; }
.action-button { flex: 1; height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.danger { background: #7a3b4a; color: #ffe3ea; }
.hint { margin-top: 8px; font-size: 11px; color: #7f96b3; line-height: 1.5; }
.result-message { margin-top: 6px; font-size: 11px; color: #8be0b2; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
