<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  PolygonHierarchy,
  PointPrimitiveCollection,
  PolylineCollection,
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
import {
  pickPosition,
  lineBuffer,
  bufferOuterRing,
  makeLineMaterial,
  type BufferParams,
  type EndCapStyle,
  type JoinStyle
} from '../measure-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const drawing = ref(false)
const bufferRadius = ref(800)
const endCapStyle = ref<EndCapStyle>('round')
const joinStyle = ref<JoinStyle>('round')
const steps = ref(32)
const fillColor = ref('#3d9bff')
const fillAlpha = ref(0.45)
const showBorder = ref(true)
const borderColor = ref('#1f6fe0')
const borderWidth = ref(2)
const lineCount = ref(0)

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let disposed = false

let vertexPoints: PointPrimitiveCollection | undefined
let previewLine: PolylineCollection | undefined
const currentVertices: Cartesian3[] = []
let lastPreviewPos: Cartesian3 | undefined

type LineBufferItem = {
  positions: Cartesian3[]
  bufferPolygon: { hierarchy: { setValue: (h: PolygonHierarchy) => void }; material: unknown }
  borderPolyline: { positions: { setValue: (p: Cartesian3[]) => void }; show: unknown; width: unknown; material: unknown }
}
const lineBufferItems: LineBufferItem[] = []

function makeParams(): BufferParams {
  return { radius: bufferRadius.value, joinStyle: joinStyle.value, endCapStyle: endCapStyle.value, steps: steps.value }
}

function makeFillColor(): Color {
  const c = Color.fromCssColorString(fillColor.value)
  c.alpha = fillAlpha.value
  return c
}

function toLngLat(position: Cartesian3): [number, number] {
  const carto = Cartographic.fromCartesian(position)
  return [(carto.longitude * 180) / Math.PI, (carto.latitude * 180) / Math.PI]
}

function applyBufferStyle(item: LineBufferItem): void {
  item.bufferPolygon.material = makeFillColor()
  item.borderPolyline.show = showBorder.value
  item.borderPolyline.width = borderWidth.value
  item.borderPolyline.material = Color.fromCssColorString(borderColor.value)
}

function rebuildBuffer(item: LineBufferItem): void {
  const bufferPoly = lineBuffer(item.positions.map(toLngLat), makeParams())
  if (!bufferPoly) return
  const ring = bufferOuterRing(bufferPoly)
  const ringPositions = ring.map(([x, y]) => Cartesian3.fromDegrees(x, y))
  item.bufferPolygon.hierarchy.setValue(new PolygonHierarchy(ringPositions))
  item.borderPolyline.positions.setValue(ringPositions)
}

function createLine(vertices: Cartesian3[]): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.entities.add({
    polyline: {
      positions: vertices,
      width: 3,
      material: Color.fromCssColorString('#ffd166')
    }
  })
  const bufferPoly = lineBuffer(vertices.map(toLngLat), makeParams())
  if (!bufferPoly) {
    resultMessage.value = '缓冲区生成失败，请检查缓冲值'
    return
  }
  const ring = bufferOuterRing(bufferPoly)
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
  lineBufferItems.push({
    positions: vertices,
    bufferPolygon: (bufferEntity as unknown as { polygon: LineBufferItem['bufferPolygon'] }).polygon,
    borderPolyline: (borderEntity as unknown as { polyline: LineBufferItem['borderPolyline'] }).polyline
  })
  lineCount.value += 1
  resultMessage.value = `折线 #${lineCount.value} 完成（${vertices.length} 个顶点），缓冲区 ${bufferRadius.value}m`
}

function updatePreview(): void {
  vertexPoints?.removeAll()
  previewLine?.removeAll()
  if (!drawing.value || currentVertices.length === 0) return
  for (const v of currentVertices) {
    vertexPoints?.add({
      position: v,
      color: Color.fromCssColorString('#ffd166'),
      pixelSize: 8,
      outlineColor: Color.WHITE,
      outlineWidth: 1.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    })
  }
  const positions = lastPreviewPos ? [...currentVertices, lastPreviewPos] : currentVertices
  if (positions.length >= 2) {
    const previewColor = Color.fromCssColorString('#8ab4f8')
    previewColor.alpha = 0.85
    previewLine?.add({
      positions,
      width: 2,
      material: makeLineMaterial(previewColor)
    })
  }
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

function finishLine(): void {
  if (!drawing.value) return
  drawing.value = false
  lastPreviewPos = undefined
  vertexPoints?.removeAll()
  previewLine?.removeAll()
  if (currentVertices.length < 2) {
    currentVertices.length = 0
    resultMessage.value = '点数不足，至少需要 2 个点'
    return
  }
  const vertices = [...currentVertices]
  currentVertices.length = 0
  createLine(vertices)
}

function onRightClick(): void {
  if (drawing.value) finishLine()
}

function updateExisting(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const item of lineBufferItems) {
    rebuildBuffer(item)
    applyBufferStyle(item)
  }
}

function clearAll(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.entities.removeAll()
  vertexPoints?.removeAll()
  previewLine?.removeAll()
  currentVertices.length = 0
  lastPreviewPos = undefined
  lineBufferItems.length = 0
  lineCount.value = 0
  drawing.value = false
  resultMessage.value = ''
}

watch([bufferRadius, endCapStyle, joinStyle, steps, fillColor, fillAlpha, showBorder, borderColor, borderWidth], () => updateExisting())

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    vertexPoints = viewer.scene.primitives.add(new PointPrimitiveCollection())
    previewLine = viewer.scene.primitives.add(new PolylineCollection())

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction((event: { endPosition: Cartesian2 }) => onMouseMove(event), ScreenSpaceEventType.MOUSE_MOVE)
    handler.setInputAction(() => onRightClick(), ScreenSpaceEventType.RIGHT_CLICK)
    handler.setInputAction(() => finishLine(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
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
  <div class="lb-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="control-panel">
      <div class="panel-title">线缓冲区分析</div>
      <div class="button-row">
        <button class="action-button primary" @click="drawing = !drawing">
          {{ drawing ? '结束绘制' : '开始绘制' }}
        </button>
        <button class="action-button danger" @click="clearAll">清除全部</button>
      </div>
      <div class="section-title">缓冲区参数</div>
      <div class="control-row">
        <span class="row-label">缓冲值(m)</span>
        <input v-model.number="bufferRadius" type="number" min="1" step="50" class="num-input" />
      </div>
      <div class="control-row">
        <span class="row-label">端点样式</span>
        <select v-model="endCapStyle" class="select-input">
          <option value="round">圆角（弧端）</option>
          <option value="flat">平角（垂直端）</option>
          <option value="square">方角（外延端）</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">拐角样式</span>
        <select v-model="joinStyle" class="select-input">
          <option value="round">圆角（弧形拐角）</option>
          <option value="miter">方角（尖角拐角）</option>
          <option value="bevel">斜角（切角拐角）</option>
        </select>
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
      <div class="hint">单击加点，右键或双击结束；已绘折线的缓冲区随参数实时更新。</div>
      <div class="hint">已生成 {{ lineCount }} 条线缓冲区</div>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.lb-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 260px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 8px; margin-bottom: 4px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 34px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.num-input { width: 96px; height: 24px; padding: 0 6px; border-radius: 5px; border: 1px solid rgba(157, 188, 224, 0.24); outline: 0; background: rgba(8, 21, 40, 0.55); color: #e6eef9; font-size: 11px; }
.select-input { width: 128px; height: 24px; padding: 0 4px; border-radius: 5px; border: 1px solid rgba(157, 188, 224, 0.24); outline: 0; background: rgba(8, 21, 40, 0.55); color: #e6eef9; font-size: 11px; }
.control-row input[type="color"] { width: 40px; height: 24px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 5px; background: transparent; cursor: pointer; }
.switch-label { color: #c3d5e8; font-size: 11px; }
.control-row input[type="checkbox"] { accent-color: #2f80ed; }
.button-row { display: flex; gap: 8px; margin-top: 4px; }
.action-button { flex: 1; height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.danger { background: #7a3b4a; color: #ffe3ea; }
.hint { margin-top: 6px; font-size: 11px; color: #7f96b3; line-height: 1.5; }
.result-message { margin-top: 6px; font-size: 11px; color: #8be0b2; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
