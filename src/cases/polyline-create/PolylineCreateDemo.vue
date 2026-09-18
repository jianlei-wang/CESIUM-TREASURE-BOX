<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Color,
  HeightReference,
  PointPrimitiveCollection,
  PolylineCollection,
  PolylineDashMaterialProperty,
  PolylineGlowMaterialProperty,
  PolylineOutlineMaterialProperty,
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
import { pickPosition, makeLineMaterial } from '../measure-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const drawing = ref(false)
const lineCount = ref(0)
const lineWidth = ref(4)
const lineColor = ref('#4a9eff')
const dashMode = ref<'solid' | 'dash' | 'glow' | 'outline'>('solid')
const clampToGround = ref(false)
const showPoints = ref(true)

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let disposed = false

let previewLine: PolylineCollection | undefined
let previewPoint: PointPrimitiveCollection | undefined
const vertexEntities: { entity: unknown; point: { show: unknown } }[] = []

const LINE_COLORS = ['#4a9eff', '#ff5c5c', '#52de9f', '#ffb84d', '#c98bff', '#ff8ad8', '#ffffff']
const currentVertices: Cartesian3[] = []
let lastPreviewPos: Cartesian3 | undefined

function makeMaterial(color: Color): Color | PolylineDashMaterialProperty | PolylineGlowMaterialProperty | PolylineOutlineMaterialProperty {
  switch (dashMode.value) {
    case 'dash':
      return new PolylineDashMaterialProperty({ color, dashLength: 12 })
    case 'glow':
      return new PolylineGlowMaterialProperty({ color, glowPower: 0.25, taperPower: 0.5 })
    case 'outline':
      return new PolylineOutlineMaterialProperty({ color, outlineColor: Color.WHITE, outlineWidth: 1.5 })
    case 'solid':
    default:
      return color
  }
}

function updatePreview(): void {
  if (!viewer || viewer.isDestroyed()) return
  previewPoint?.removeAll()
  previewLine?.removeAll()
  if (!drawing.value || currentVertices.length === 0) return
  const color = Color.fromCssColorString(lineColor.value)
  for (const v of currentVertices) {
    previewPoint?.add({
      position: v,
      color,
      pixelSize: 8,
      outlineColor: Color.WHITE,
      outlineWidth: 1.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    })
  }
  const positions = lastPreviewPos ? [...currentVertices, lastPreviewPos] : currentVertices
  if (positions.length >= 2) {
    const previewColor = Color.fromCssColorString(lineColor.value)
    previewColor.alpha = 0.85
    previewLine?.add({
      positions,
      width: Math.max(lineWidth.value, 2),
      material: makeLineMaterial(previewColor)
    })
  }
}

function addVertex(position: Cartesian3): void {
  if (!viewer || viewer.isDestroyed() || !drawing.value) return
  currentVertices.push(position)
  resultMessage.value = `已采集 ${currentVertices.length} 个顶点`
  updatePreview()
}

function finishLine(): void {
  if (!drawing.value) return
  drawing.value = false
  lastPreviewPos = undefined
  previewPoint?.removeAll()
  previewLine?.removeAll()
  if (currentVertices.length < 2) {
    currentVertices.length = 0
    resultMessage.value = '点数不足，至少需要 2 个点'
    return
  }
  const vertices = [...currentVertices]
  currentVertices.length = 0
  const color = Color.fromCssColorString(lineColor.value)
  viewer?.entities.add({
    polyline: {
      positions: vertices,
      width: lineWidth.value,
      material: makeMaterial(color),
      clampToGround: clampToGround.value
    }
  })
  lineCount.value += 1
  for (const v of vertices) {
    const entity = viewer?.entities.add({
      position: v,
      point: {
        show: showPoints.value,
        pixelSize: 7,
        color: Color.WHITE,
        outlineColor: color,
        outlineWidth: 2,
        heightReference: clampToGround.value ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
    if (entity) {
      vertexEntities.push({ entity, point: (entity as unknown as { point: { show: unknown } }).point })
    }
  }
  resultMessage.value = `折线 #${lineCount.value} 完成（${vertices.length} 个顶点）`
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !drawing.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  addVertex(pos)
}

function onMouseMove(event: { endPosition: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !drawing.value) return
  const pos = pickPosition(viewer.scene, event.endPosition)
  if (!pos) return
  lastPreviewPos = pos
  updatePreview()
}

function onRightClick(): void {
  if (drawing.value) finishLine()
}

function onDoubleClick(): void {
  if (drawing.value) finishLine()
}

function clearAll(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.entities.removeAll()
  previewPoint?.removeAll()
  previewLine?.removeAll()
  currentVertices.length = 0
  lastPreviewPos = undefined
  vertexEntities.length = 0
  lineCount.value = 0
  resultMessage.value = ''
  drawing.value = false
}

function updateExistingLines(): void {
  if (!viewer || viewer.isDestroyed() || lineCount.value === 0) return
  const color = Color.fromCssColorString(lineColor.value)
  for (const entity of viewer.entities.values) {
    const polyline = (entity as { polyline?: { width: unknown; material: unknown; clampToGround: unknown } }).polyline
    if (!polyline) continue
    polyline.width = lineWidth.value
    polyline.material = makeMaterial(color)
    polyline.clampToGround = clampToGround.value
  }
  if (drawing.value) updatePreview()
}

function applyShowPoints(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const item of vertexEntities) {
    item.point.show = showPoints.value
  }
}

watch([lineWidth, lineColor, dashMode, clampToGround], () => updateExistingLines())
watch(showPoints, () => applyShowPoints())

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    previewPoint = viewer.scene.primitives.add(new PointPrimitiveCollection())
    previewLine = viewer.scene.primitives.add(new PolylineCollection())

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction((event: { endPosition: Cartesian2 }) => onMouseMove(event), ScreenSpaceEventType.MOUSE_MOVE)
    handler.setInputAction(() => onRightClick(), ScreenSpaceEventType.RIGHT_CLICK)
    handler.setInputAction(() => onDoubleClick(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
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
  <div class="polyline-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="control-panel">
      <div class="panel-title">动态折线</div>
      <div class="button-row">
        <button class="action-button primary" @click="drawing = !drawing">
          {{ drawing ? '结束绘制' : '开始绘制' }}
        </button>
        <button class="action-button danger" @click="clearAll">清除全部</button>
      </div>
      <div class="section-title">线参数</div>
      <div class="control-row">
        <span class="row-label">线宽</span>
        <input v-model.number="lineWidth" type="range" min="1" max="12" step="1" />
        <span class="row-value">{{ lineWidth }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">线颜色</span>
        <div class="swatch-group">
          <button v-for="c in LINE_COLORS" :key="c" class="swatch" :style="{ background: c }" :class="{ active: c === lineColor }" @click="lineColor = c"></button>
        </div>
      </div>
      <div class="control-row">
        <span class="row-label">线型</span>
        <select v-model="dashMode" class="mode-select">
          <option value="solid">实线</option>
          <option value="dash">虚线</option>
          <option value="glow">发光</option>
          <option value="outline">描边</option>
        </select>
      </div>
      <div class="control-row">
        <label class="switch-label">贴地</label>
        <input v-model="clampToGround" type="checkbox" />
      </div>
      <div class="control-row">
        <label class="switch-label">显示顶点</label>
        <input v-model="showPoints" type="checkbox" />
      </div>
      <div class="hint">单击加点，右键或双击结束绘制；已绘折线参数实时更新。</div>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.polyline-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 258px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 8px; margin-bottom: 4px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 30px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.switch-label { color: #c3d5e8; font-size: 11px; }
.control-row input[type="checkbox"] { accent-color: #2f80ed; }
.swatch-group { display: flex; flex-wrap: wrap; gap: 5px; }
.swatch { width: 18px; height: 18px; padding: 0; border: 2px solid transparent; border-radius: 50%; cursor: pointer; }
.swatch.active { border-color: #fff; }
.mode-select { height: 24px; padding: 0 4px; border-radius: 5px; border: 1px solid rgba(157, 188, 224, 0.24); outline: 0; background: rgba(8, 21, 40, 0.55); color: #e6eef9; font-size: 11px; }
.button-row { display: flex; gap: 8px; margin-top: 4px; }
.action-button { flex: 1; height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.danger { background: #7a3b4a; color: #ffe3ea; }
.hint { margin-top: 8px; font-size: 11px; color: #7f96b3; line-height: 1.5; }
.result-message { margin-top: 6px; font-size: 11px; color: #8be0b2; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
