<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Color,
  HeightReference,
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
import { pickPosition } from '../measure-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const drawing = ref(false)
const polygonCount = ref(0)
const fillColor = ref('#4a9eff')
const fillAlpha = ref(0.5)
const showBorder = ref(true)
const borderColor = ref('#ffffff')
const borderWidth = ref(3)
const polygonHeight = ref(0)
const clampToGround = ref(false)

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let disposed = false

const FILL_COLORS = ['#4a9eff', '#ff5c5c', '#52de9f', '#ffb84d', '#c98bff', '#ff8ad8', '#ffffff']
const currentVertices: Cartesian3[] = []
let lastPreviewPos: Cartesian3 | undefined

type PreviewFace = {
  polygon: {
    hierarchy: { setValue: (h: PolygonHierarchy) => void }
    show: unknown
    material: unknown
    height: unknown
    heightReference: unknown
  }
}
type PreviewBorder = {
  polyline: {
    positions: { setValue: (p: Cartesian3[]) => void }
    show: unknown
    material: unknown
    width: unknown
  }
}

let previewFace: PreviewFace | undefined
let previewBorder: PreviewBorder | undefined

function makeFillColor(): Color {
  const c = Color.fromCssColorString(fillColor.value)
  c.alpha = fillAlpha.value
  return c
}

function createPreviewEntities(): void {
  if (!viewer || viewer.isDestroyed()) return
  previewFace = viewer.entities.add({
    id: '__preview-face__',
    polygon: {
      hierarchy: new PolygonHierarchy([]),
      material: makeFillColor(),
      height: clampToGround.value ? 0 : polygonHeight.value,
      perPositionHeight: false,
      heightReference: clampToGround.value ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
      show: false
    }
  }) as unknown as PreviewFace
  previewBorder = viewer.entities.add({
    id: '__preview-border__',
    polyline: {
      positions: [],
      width: Math.max(borderWidth.value, 2),
      material: Color.fromCssColorString(borderColor.value).withAlpha(0.9),
      clampToGround: clampToGround.value,
      show: false
    }
  }) as unknown as PreviewBorder
}

function updatePreview(): void {
  if (!viewer || viewer.isDestroyed() || !previewFace || !previewBorder) return
  if (!drawing.value || currentVertices.length === 0) {
    previewFace.polygon.show = false
    previewBorder.polyline.show = false
    return
  }
  const lastCollected = currentVertices[currentVertices.length - 1]
  const hasPreview = !!lastPreviewPos && !Cartesian3.equals(lastPreviewPos, lastCollected)
  const facePositions: Cartesian3[] = hasPreview && lastPreviewPos ? [...currentVertices, lastPreviewPos] : [...currentVertices]
  if (facePositions.length >= 3) {
    previewFace.polygon.hierarchy.setValue(new PolygonHierarchy(facePositions))
    previewFace.polygon.material = makeFillColor()
    previewFace.polygon.height = clampToGround.value ? 0 : polygonHeight.value
    previewFace.polygon.heightReference = clampToGround.value ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE
    previewFace.polygon.show = true
  } else {
    previewFace.polygon.show = false
  }
  const borderPositions: Cartesian3[] = hasPreview && lastPreviewPos ? [...currentVertices, lastPreviewPos, currentVertices[0]] : [...currentVertices, currentVertices[0]]
  previewBorder.polyline.positions.setValue(borderPositions)
  previewBorder.polyline.show = true
}

function finishPolygon(): void {
  if (!drawing.value) return
  drawing.value = false
  lastPreviewPos = undefined
  if (previewFace) previewFace.polygon.show = false
  if (previewBorder) previewBorder.polyline.show = false
  if (currentVertices.length < 3) {
    currentVertices.length = 0
    resultMessage.value = '点数不足，至少需要 3 个点'
    return
  }
  const vertices = [...currentVertices]
  currentVertices.length = 0
  const color = makeFillColor()
  const border = Color.fromCssColorString(borderColor.value)
  const hierarchy = new PolygonHierarchy(vertices)
  const options: {
    polygon: Record<string, unknown>
    polyline?: Record<string, unknown>
  } = {
    polygon: {
      hierarchy,
      material: color,
      height: clampToGround.value ? 0 : polygonHeight.value,
      perPositionHeight: false,
      heightReference: clampToGround.value ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE
    }
  }
  options.polyline = {
    positions: [...vertices, vertices[0]],
    width: borderWidth.value,
    material: border,
    clampToGround: clampToGround.value,
    show: showBorder.value
  }
  viewer?.entities.add(options)
  polygonCount.value += 1
  resultMessage.value = `多边形 #${polygonCount.value} 完成（${vertices.length} 个顶点）`
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !drawing.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  currentVertices.push(pos)
  resultMessage.value = `已采集 ${currentVertices.length} 个顶点`
  updatePreview()
}

function onMouseMove(event: { endPosition: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !drawing.value) return
  const pos = pickPosition(viewer.scene, event.endPosition)
  if (!pos) return
  lastPreviewPos = pos
  updatePreview()
}

function onRightClick(): void {
  if (drawing.value) finishPolygon()
}

function onDoubleClick(): void {
  if (drawing.value) finishPolygon()
}

function clearAll(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.entities.removeAll()
  previewFace = undefined
  previewBorder = undefined
  currentVertices.length = 0
  lastPreviewPos = undefined
  polygonCount.value = 0
  resultMessage.value = ''
  drawing.value = false
  createPreviewEntities()
}

function updateExistingPolygons(): void {
  if (!viewer || viewer.isDestroyed()) return
  const color = makeFillColor()
  const border = Color.fromCssColorString(borderColor.value)
  for (const entity of viewer.entities.values) {
    const id = (entity as { id?: string }).id ?? ''
    if (id === '__preview-face__' || id === '__preview-border__') continue
    const polygon = (entity as { polygon?: { material: unknown; height: unknown; heightReference: unknown } }).polygon
    if (polygon) {
      polygon.material = color
      polygon.height = clampToGround.value ? 0 : polygonHeight.value
      polygon.heightReference = clampToGround.value ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE
    }
    const polyline = (entity as { polyline?: { width: unknown; material: unknown; clampToGround: unknown; show: unknown } }).polyline
    if (polyline) {
      polyline.width = borderWidth.value
      polyline.material = border
      polyline.clampToGround = clampToGround.value
      polyline.show = showBorder.value
    }
  }
  if (drawing.value) updatePreview()
}

watch([fillColor, fillAlpha, showBorder, borderColor, borderWidth, polygonHeight, clampToGround], () => updateExistingPolygons())

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    createPreviewEntities()

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
  <div class="polygon-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="control-panel">
      <div class="panel-title">动态多边形面</div>
      <div class="button-row">
        <button class="action-button primary" @click="drawing = !drawing">
          {{ drawing ? '结束绘制' : '开始绘制' }}
        </button>
        <button class="action-button danger" @click="clearAll">清除全部</button>
      </div>
      <div class="section-title">面参数</div>
      <div class="control-row">
        <span class="row-label">填充颜色</span>
        <div class="swatch-group">
          <button v-for="c in FILL_COLORS" :key="c" class="swatch" :style="{ background: c }" :class="{ active: c === fillColor }" @click="fillColor = c"></button>
        </div>
      </div>
      <div class="control-row">
        <span class="row-label">透明度</span>
        <input v-model.number="fillAlpha" type="range" min="0" max="1" step="0.05" />
        <span class="row-value">{{ fillAlpha.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">面高度(m)</span>
        <input v-model.number="polygonHeight" type="number" step="10" />
      </div>
      <div class="section-title">边框参数</div>
      <div class="control-row">
        <label class="switch-label">显示边框</label>
        <input v-model="showBorder" type="checkbox" />
      </div>
      <div class="control-row">
        <span class="row-label">边框宽度</span>
        <input v-model.number="borderWidth" type="range" min="1" max="10" step="1" />
        <span class="row-value">{{ borderWidth }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">边框颜色</span>
        <input v-model="borderColor" type="color" class="color-input" />
      </div>
      <div class="control-row">
        <label class="switch-label">贴地</label>
        <input v-model="clampToGround" type="checkbox" />
      </div>
      <div class="hint">单击加点，右键或双击闭合完成绘制；已绘面参数实时更新。</div>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.polygon-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 258px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 8px; margin-bottom: 4px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 34px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row input[type="number"] { width: 64px; height: 24px; padding: 0 6px; border-radius: 5px; border: 1px solid rgba(157, 188, 224, 0.24); outline: 0; background: rgba(8, 21, 40, 0.55); color: #e6eef9; font-size: 11px; }
.control-row input[type="color"] { width: 40px; height: 24px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 5px; background: transparent; cursor: pointer; }
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
