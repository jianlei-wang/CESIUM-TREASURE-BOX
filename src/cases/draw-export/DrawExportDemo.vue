<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Math as CesiumMath,
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
import { pickPosition } from '../measure-lib'
import { exportGeojson, exportShp, type ExportSummary } from '../draw-export-lib/exporter'
import type { CRSId } from '../draw-export-lib/geo'
import type { GeoJSONFeatureCollection, GeoJSONGeometry } from '../draw-export-lib/geo'

type DrawType = 'point' | 'line' | 'polygon'
type DrawMode = DrawType | 'none'

type DrawRecord = {
  id: number
  type: DrawType
  cartesians: Cartesian3[]
  name: string
  entity: Entity
}

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const mode = ref<DrawMode>('none')
const exportFormat = ref<'geojson' | 'shp'>('geojson')
const crsId = ref<CRSId>('wgs84')
const exporting = ref(false)
const stats = ref({ point: 0, line: 0, polygon: 0 })

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let disposed = false
let idCounter = 0
const records: DrawRecord[] = []
const currentVertices: Cartesian3[] = []
let lastPreviewPos: Cartesian3 | undefined
let previewLine: any
let previewFace: any
let previewBorder: any

const POINT_COLOR = Color.fromCssColorString('#ffd24a')
const LINE_COLOR = Color.fromCssColorString('#4ad2ff')
const FACE_COLOR = Color.fromCssColorString('#52de9f').withAlpha(0.45)

function setMode(m: DrawMode): void {
  if (mode.value === m) {
    if (m === 'line' || m === 'polygon') cancelDrawing()
    mode.value = 'none'
    return
  }
  if ((mode.value === 'line' || mode.value === 'polygon') && m !== 'none') {
    finishGeometry()
  }
  mode.value = m
  currentVertices.length = 0
  lastPreviewPos = undefined
  updatePreview()
}

function cancelDrawing(): void {
  currentVertices.length = 0
  lastPreviewPos = undefined
  updatePreview()
}

function createPreviewEntities(): void {
  if (!viewer || viewer.isDestroyed()) return
  previewLine = viewer.entities.add({
    id: '__preview-line__',
    polyline: { positions: [], width: 3, material: LINE_COLOR.withAlpha(0.7), show: false }
  })
  previewFace = viewer.entities.add({
    id: '__preview-face__',
    polygon: { hierarchy: new PolygonHierarchy([]), material: FACE_COLOR, show: false }
  })
  previewBorder = viewer.entities.add({
    id: '__preview-border__',
    polyline: { positions: [], width: 2, material: LINE_COLOR, show: false }
  })
}

function updatePreview(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (mode.value === 'none' || currentVertices.length === 0) {
    if (previewLine) previewLine.polyline.show = false
    if (previewFace) previewFace.polygon.show = false
    if (previewBorder) previewBorder.polyline.show = false
    return
  }
  const hasPreview = !!lastPreviewPos && !Cartesian3.equals(lastPreviewPos, currentVertices[currentVertices.length - 1])
  const pos = hasPreview && lastPreviewPos ? lastPreviewPos : currentVertices[currentVertices.length - 1]

  if (mode.value === 'line') {
    const positions = hasPreview ? [...currentVertices, pos] : [...currentVertices]
    previewLine.polyline.positions = positions
    previewLine.polyline.show = true
  } else {
    const facePositions = hasPreview ? [...currentVertices, pos] : [...currentVertices]
    if (facePositions.length >= 3) {
      previewFace.polygon.hierarchy = new PolygonHierarchy(facePositions)
      previewFace.polygon.show = true
    } else {
      previewFace.polygon.show = false
    }
    const borderPositions = hasPreview ? [...currentVertices, pos, currentVertices[0]] : [...currentVertices, currentVertices[0]]
    previewBorder.polyline.positions = borderPositions
    previewBorder.polyline.show = true
  }
}

function refreshStats(): void {
  stats.value = {
    point: records.filter((r) => r.type === 'point').length,
    line: records.filter((r) => r.type === 'line').length,
    polygon: records.filter((r) => r.type === 'polygon').length
  }
}

function addRecord(type: DrawType, cartesians: Cartesian3[]): void {
  if (!viewer) return
  idCounter += 1
  const name = `${type === 'point' ? '点' : type === 'line' ? '线' : '面'}${idCounter}`
  const options: Record<string, unknown> = { id: `draw-${idCounter}` }
  if (type === 'point') {
    options.position = cartesians[0]
    options.point = { pixelSize: 10, color: POINT_COLOR, outlineColor: Color.WHITE, outlineWidth: 1 }
    options.label = { text: name, font: '11px sans-serif', fillColor: Color.WHITE, pixelOffset: new Cartesian2(0, -14), outlineColor: Color.fromCssColorString('#102b40'), outlineWidth: 3, style: 2 }
  } else if (type === 'line') {
    options.polyline = { positions: cartesians, width: 4, material: LINE_COLOR }
  } else {
    options.polygon = { hierarchy: new PolygonHierarchy(cartesians), material: FACE_COLOR }
    options.polyline = { positions: [...cartesians, cartesians[0]], width: 3, material: LINE_COLOR }
  }
  const entity = viewer.entities.add(options as never)
  records.push({ id: idCounter, type, cartesians: [...cartesians], name, entity })
  refreshStats()
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed()) return
  if (mode.value === 'point') {
    const pos = pickPosition(viewer.scene, event.position)
    if (!pos) return
    addRecord('point', [pos])
    resultMessage.value = `已添加点 ${records.filter((r) => r.type === 'point').length} 个`
    return
  }
  if (mode.value === 'line' || mode.value === 'polygon') {
    const pos = pickPosition(viewer.scene, event.position)
    if (!pos) return
    currentVertices.push(pos)
    resultMessage.value = `已采集 ${currentVertices.length} 个顶点`
    updatePreview()
  }
}

function onMouseMove(event: { endPosition: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed()) return
  if (mode.value !== 'line' && mode.value !== 'polygon') return
  const pos = pickPosition(viewer.scene, event.endPosition)
  if (!pos) return
  lastPreviewPos = pos
  updatePreview()
}

function finishGeometry(): void {
  if (!viewer || viewer.isDestroyed()) return
  const m = mode.value
  if (m !== 'line' && m !== 'polygon') return
  if (currentVertices.length < (m === 'line' ? 2 : 3)) {
    resultMessage.value = m === 'line' ? '线段至少需要 2 个点' : '多边形至少需要 3 个点'
    currentVertices.length = 0
    lastPreviewPos = undefined
    updatePreview()
    return
  }
  const verts = [...currentVertices]
  currentVertices.length = 0
  lastPreviewPos = undefined
  updatePreview()
  addRecord(m, verts)
  mode.value = 'none'
  const count = records.filter((r) => r.type === m).length
  resultMessage.value = `${m === 'line' ? '线' : '面'} #${count} 完成(${verts.length} 个顶点)`
}

function onRightClick(): void {
  if (mode.value === 'line' || mode.value === 'polygon') finishGeometry()
}

function onDoubleClick(): void {
  if (mode.value === 'line' || mode.value === 'polygon') finishGeometry()
}

function clearAll(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const r of records) {
    viewer.entities.remove(r.entity)
  }
  records.length = 0
  idCounter = 0
  currentVertices.length = 0
  lastPreviewPos = undefined
  mode.value = 'none'
  refreshStats()
  resultMessage.value = '已清除全部图形'
}

function toFeatureCollection(): GeoJSONFeatureCollection {
  const features = records.map((r) => {
    const coords = r.cartesians.map((c) => {
      const carto = Cartographic.fromCartesian(c)
      return [CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude)] as [number, number]
    })
    const geometry: GeoJSONGeometry = r.type === 'point'
      ? { type: 'Point', coordinates: coords[0] as [number, number] }
      : r.type === 'line'
        ? { type: 'LineString', coordinates: coords }
        : { type: 'Polygon', coordinates: [coords] }
    return { type: 'Feature' as const, properties: { name: r.name }, geometry }
  })
  return { type: 'FeatureCollection', features }
}

async function doExport(): Promise<void> {
  if (records.length === 0) {
    resultMessage.value = '请先绘制点、线或面再导出'
    return
  }
  exporting.value = true
  try {
    const fc = toFeatureCollection()
    const summary: ExportSummary = exportFormat.value === 'geojson'
      ? await exportGeojson(fc, crsId.value)
      : await exportShp(fc, crsId.value)
    resultMessage.value = `已导出 ${summary.filename}(${summary.featureCount} 个要素,${summary.typeCount} 种类型)`
  } catch (error) {
    resultMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    exporting.value = false
  }
}

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
    statusMessage.value = ''
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
  <div class="draw-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">点线面绘制与导出</div>

      <div class="section-title">绘制</div>
      <div class="mode-row">
        <button class="mode-button" :class="{ active: mode === 'point' }" @click="setMode('point')">点</button>
        <button class="mode-button" :class="{ active: mode === 'line' }" @click="setMode('line')">线</button>
        <button class="mode-button" :class="{ active: mode === 'polygon' }" @click="setMode('polygon')">面</button>
        <button class="mode-button" :class="{ active: mode === 'none' }" @click="setMode('none')">停止</button>
      </div>
      <p class="hint">
        {{ mode === 'point' ? '单击地图连续添加点' : mode === 'line' ? '单击加点，双击或右键结束线段' : mode === 'polygon' ? '单击加点，双击或右键闭合面' : '选择绘制类型后在地图上绘制' }}
      </p>

      <div class="section-title">图形统计</div>
      <div class="stats-row">
        <span>点 {{ stats.point }}</span>
        <span>线 {{ stats.line }}</span>
        <span>面 {{ stats.polygon }}</span>
      </div>
      <button class="action-button danger" @click="clearAll">清除全部</button>

      <div class="section-title">导出</div>
      <div class="control-row">
        <span class="row-label">格式</span>
        <select v-model="exportFormat" class="select">
          <option value="geojson">GeoJSON</option>
          <option value="shp">SHP</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">坐标系</span>
        <select v-model="crsId" class="select">
          <option value="wgs84">WGS84(经纬度 4326)</option>
          <option value="mercator">Web墨卡托(3857)</option>
          <option value="beijing54">北京54(3°带,117°)</option>
          <option value="xian80">西安80(3°带,117°)</option>
        </select>
      </div>
      <button class="action-button primary" :disabled="exporting" @click="doExport">
        {{ exporting ? '导出中…' : '导出' }}
      </button>

      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.draw-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 248px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.mode-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.mode-button { height: 26px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 5px; background: rgba(157, 188, 224, 0.1); color: #c3d5e8; cursor: pointer; font-size: 11px; }
.mode-button.active { border-color: #4ad2ff; background: #1f6f96; color: #fff; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.select { flex: 1; min-width: 0; height: 24px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 5px; background: rgba(8, 21, 40, 0.55); color: #e6eef9; font-size: 11px; padding: 0 4px; }
.stats-row { display: flex; gap: 12px; padding: 3px 0; color: #9fb8d4; font-size: 11px; }
.action-button { width: 100%; height: 28px; margin-top: 8px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.danger { background: #7a3b4a; color: #ffe3ea; }
.action-button:disabled { opacity: 0.5; cursor: default; }
.hint { margin: 6px 0 0; font-size: 11px; color: #7f96b3; line-height: 1.5; }
.result-message { margin-top: 8px; font-size: 11px; color: #8be0b2; line-height: 1.5; word-break: break-all; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
