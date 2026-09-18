<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  PointPrimitiveCollection,
  PolylineCollection,
  ScreenSpaceEventType,
  ScreenSpaceEventHandler,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  setTerrainEnabled,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import {
  formatLength,
  pickPosition,
  rightTriangleInfo,
  type RightTriangleInfo,
  MouseTooltip,
  makeLineMaterial
} from '../measure-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const useTerrain = ref(true)
const measuring = ref(false)
const horizontalResult = ref('--')
const verticalResult = ref('--')
const slopeResult = ref('--')
const angleResult = ref('--')

const HORIZONTAL_COLOR = '#7be09e'
const VERTICAL_COLOR = '#4dd0ff'
const SLOPE_COLOR = '#ffb84d'

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let tooltip: MouseTooltip | undefined
let disposed = false

let vertexPoints: PointPrimitiveCollection | undefined
let previewPoint: PointPrimitiveCollection | undefined
let previewLine: PolylineCollection | undefined
let measureLine: PolylineCollection | undefined

const collected: Cartesian3[] = []
let previewPos: Cartesian3 | undefined

function applyTerrain(enabled: boolean): void {
  if (!viewer) return
  if (enabled) {
    statusMessage.value = '正在加载Cesium World Terrain...'
    setTerrainEnabled(viewer, true)
      .then(() => {
        if (!disposed) statusMessage.value = ''
      })
      .catch((error: unknown) => {
        if (!disposed) {
          statusMessage.value = error instanceof Error ? error.message : String(error)
        }
      })
  } else {
    setTerrainEnabled(viewer, false).catch(() => {})
    statusMessage.value = ''
  }
}

function clearEntities(): void {
  if (viewer) viewer.entities.removeAll()
  vertexPoints?.removeAll()
  previewPoint?.removeAll()
  previewLine?.removeAll()
  measureLine?.removeAll()
}

function addVertex(position: Cartesian3): void {
  vertexPoints?.add({
    position,
    color: Color.fromCssColorString('#ffd166'),
    pixelSize: 9,
    outlineColor: Color.WHITE,
    outlineWidth: 1.5,
    disableDepthTestDistance: Number.POSITIVE_INFINITY
  })
}

function edgesOf(start: Cartesian3, end: Cartesian3, info: RightTriangleInfo): { horizontal: Cartesian3[]; vertical: Cartesian3[] } {
  const gb = Cartographic.fromCartesian(end)
  const horizontal = gb.height > Cartographic.fromCartesian(start).height ? [info.apex, end] : [start, info.apex]
  const vertical = gb.height > Cartographic.fromCartesian(start).height ? [start, info.apex] : [info.apex, end]
  return { horizontal, vertical }
}

function drawPreviewShape(start: Cartesian3, end: Cartesian3): void {
  previewPoint?.removeAll()
  previewLine?.removeAll()
  const info = rightTriangleInfo(start, end)
  previewPoint?.add({
    position: end,
    color: Color.fromCssColorString('#8ab4f8'),
    pixelSize: 6,
    outlineColor: Color.WHITE,
    outlineWidth: 1,
    disableDepthTestDistance: Number.POSITIVE_INFINITY
  })
  const { horizontal, vertical } = edgesOf(start, end, info)
  if (Cartesian3.distance(horizontal[0], horizontal[1]) > 0.001) {
    previewLine?.add({
      positions: horizontal,
      width: 2,
      material: makeLineMaterial(Color.fromCssColorString(HORIZONTAL_COLOR).withAlpha(0.9))
    })
  }
  if (Cartesian3.distance(vertical[0], vertical[1]) > 0.001) {
    previewLine?.add({
      positions: vertical,
      width: 2,
      material: makeLineMaterial(Color.fromCssColorString(VERTICAL_COLOR).withAlpha(0.9))
    })
  }
  previewLine?.add({
    positions: [start, end],
    width: 2,
    material: makeLineMaterial(Color.fromCssColorString(SLOPE_COLOR).withAlpha(0.9))
  })
}

function labelAt(position: Cartesian3, text: string, color: string, pixelOffsetY: number): void {
  viewer?.entities.add({
    position,
    label: {
      text,
      font: '12px sans-serif',
      fillColor: Color.fromCssColorString(color),
      outlineColor: Color.BLACK,
      outlineWidth: 4,
      backgroundColor: Color.fromCssColorString('#102b40').withAlpha(0.72),
      showBackground: true,
      pixelOffset: new Cartesian2(0, pixelOffsetY),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      horizontalOrigin: 0,
      verticalOrigin: 0
    }
  })
}

function drawFinalShape(start: Cartesian3, end: Cartesian3, info: RightTriangleInfo): void {
  if (!viewer) return
  measureLine?.removeAll()
  const { horizontal, vertical } = edgesOf(start, end, info)
  if (Cartesian3.distance(horizontal[0], horizontal[1]) > 0.001) {
    measureLine?.add({
      positions: horizontal,
      width: 3,
      material: makeLineMaterial(Color.fromCssColorString(HORIZONTAL_COLOR))
    })
  }
  if (Cartesian3.distance(vertical[0], vertical[1]) > 0.001) {
    measureLine?.add({
      positions: vertical,
      width: 3,
      material: makeLineMaterial(Color.fromCssColorString(VERTICAL_COLOR))
    })
  }
  measureLine?.add({
    positions: [start, end],
    width: 3,
    material: makeLineMaterial(Color.fromCssColorString(SLOPE_COLOR))
  })
  const hMid = Cartesian3.midpoint(horizontal[0], horizontal[1], new Cartesian3())
  const vMid = Cartesian3.midpoint(vertical[0], vertical[1], new Cartesian3())
  const intersection = horizontal[0] === info.apex ? horizontal[1] : horizontal[0]
  labelAt(hMid, `水平距离 ${formatLength(info.horizontal)}`, HORIZONTAL_COLOR, -22)
  labelAt(vMid, `垂直距离 ${formatLength(info.vertical)}`, VERTICAL_COLOR, -22)
  labelAt(intersection, `夹角 ${info.angle.toFixed(2)}°`, SLOPE_COLOR, 24)
}

function startMeasurement(): void {
  resetMeasurement()
  measuring.value = true
  resultMessage.value = '单击选起点，再次单击完成'
}

function finishMeasurement(): void {
  if (!measuring.value) return
  measuring.value = false
  previewPos = undefined
  previewPoint?.removeAll()
  previewLine?.removeAll()
  tooltip?.hide()
  if (collected.length >= 2) {
    const [start, end] = collected
    const info = rightTriangleInfo(start, end)
    horizontalResult.value = formatLength(info.horizontal)
    verticalResult.value = formatLength(info.vertical)
    slopeResult.value = formatLength(info.slope)
    angleResult.value = `${info.angle.toFixed(2)}°`
    drawFinalShape(start, end, info)
    resultMessage.value = '测量完成，左上侧面板显示最终结果'
  } else {
    resultMessage.value = '点数不足，请至少采集 2 个点'
  }
}

function resetMeasurement(): void {
  collected.length = 0
  previewPos = undefined
  measuring.value = false
  horizontalResult.value = '--'
  verticalResult.value = '--'
  slopeResult.value = '--'
  angleResult.value = '--'
  clearEntities()
  tooltip?.hide()
  resultMessage.value = ''
}

function onToggleMeasure(): void {
  if (measuring.value) {
    finishMeasurement()
  } else {
    startMeasurement()
  }
}

function onMouseMove(event: { endPosition: Cartesian2 }): void {
  if (!viewer || !tooltip) return
  if (!measuring.value) {
    tooltip.hide()
    previewPos = undefined
    return
  }
  const pos = pickPosition(viewer.scene, event.endPosition)
  if (!pos) {
    tooltip.hide()
    previewPos = undefined
    return
  }
  let content = '单击选起点，再次单击完成<br>'
  if (collected.length >= 1) {
    const start = collected[collected.length - 1]
    drawPreviewShape(start, pos)
    const info = rightTriangleInfo(start, pos)
    content += `水平距离: ${formatLength(info.horizontal)}<br>`
    content += `垂直距离: ${formatLength(info.vertical)}<br>`
    content += `斜边长度: ${formatLength(info.slope)}<br>`
    content += `夹角: ${info.angle.toFixed(2)}°`
  }
  tooltip.setContent(content)
  tooltip.setPosition(event.endPosition.x, event.endPosition.y)
  tooltip.show()
  previewPos = pos
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || !measuring.value) return
  if (collected.length >= 2) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  collected.push(pos)
  addVertex(pos)
  if (collected.length >= 2) {
    finishMeasurement()
    return
  }
    tooltip?.hide()
}

watch(useTerrain, (value) => applyTerrain(value))

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.scene.globe.depthTestAgainstTerrain = true
    vertexPoints = viewer.scene.primitives.add(new PointPrimitiveCollection())
    previewPoint = viewer.scene.primitives.add(new PointPrimitiveCollection())
    previewLine = viewer.scene.primitives.add(new PolylineCollection())
    measureLine = viewer.scene.primitives.add(new PolylineCollection())
    tooltip = new MouseTooltip(container.value)

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { endPosition: Cartesian2 }) => onMouseMove(event), ScreenSpaceEventType.MOUSE_MOVE)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction(() => { if (measuring.value) finishMeasurement() }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
    handler.setInputAction(() => { if (measuring.value) finishMeasurement() }, ScreenSpaceEventType.RIGHT_CLICK)

    if (useTerrain.value) {
      applyTerrain(true)
    }
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  handler?.destroy()
  handler = undefined
  tooltip?.destroy()
  tooltip = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="triangle-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="control-panel">
      <div class="panel-title">三角量测</div>
      <div class="control-row">
        <label class="switch-label">启用地形</label>
        <input v-model="useTerrain" type="checkbox" />
      </div>
      <div class="button-row">
        <button class="action-button primary" @click="onToggleMeasure">
          {{ measuring ? '结束测量' : '开始测量' }}
        </button>
        <button class="action-button danger" @click="resetMeasurement">清除</button>
      </div>
      <div class="hint">单击选起点，移动鼠标实时构建直角三角形，再次单击完成</div>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>
    <div class="result-panel">
      <div class="result-title">量测结果</div>
      <div class="result-item"><span class="result-name">水平距离</span><span class="result-value">{{ horizontalResult }}</span></div>
      <div class="result-item"><span class="result-name">垂直距离</span><span class="result-value">{{ verticalResult }}</span></div>
      <div class="result-item"><span class="result-name">斜边长度</span><span class="result-value">{{ slopeResult }}</span></div>
      <div class="result-item"><span class="result-name">夹角</span><span class="result-value">{{ angleResult }}</span></div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.triangle-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 250px; padding: 12px; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 32, 49, 0.84); backdrop-filter: blur(6px); color: #ddf2f8; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.control-row { display: flex; align-items: center; justify-content: space-between; padding: 3px 0; }
.switch-label { font-size: 11px; color: #bdd9e4; }
.button-row { display: flex; gap: 8px; margin-top: 8px; }
.action-button { flex: 1; height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #257f9e; color: #edfaff; }
.action-button.danger { background: #7a3b4a; color: #ffe3ea; }
.result-panel { position: absolute; top: 12px; left: 12px; z-index: 10; width: 220px; padding: 12px; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 32, 49, 0.84); backdrop-filter: blur(6px); color: #ddf2f8; }
.result-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.result-item { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; }
.result-name { color: #7fb6c9; }
.result-value { color: #d9eff6; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.hint { margin-top: 8px; font-size: 11px; color: #7fb6c9; }
.result-message { margin-top: 6px; font-size: 11px; color: #8be0b2; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>

<style>
.triangle-shell .measure-tooltip { position: absolute; padding: 5px 8px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 5px; background: rgba(8, 32, 49, 0.92); color: #d9eff6; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.5; white-space: nowrap; pointer-events: none; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); }
</style>
