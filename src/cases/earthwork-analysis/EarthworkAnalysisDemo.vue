<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import * as Cesium from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain } from '../../lib/cesium-scene'
import { pickCartographic } from '../measure-lib/pick'
import { EARTHWORK_HELP } from './help'
import { printReport, exportReportDocx, type ReportModel, type ReportSection } from '../sunshine-lib/report'
import {
  buildDesignHeights,
  buildGrid,
  defaultRing,
  diffColor,
  evaluateEarthwork,
  ringCentroid,
  type EarthworkGrid,
  type EarthworkParams,
  type EarthworkStats,
  type LngLat
} from './analysis'

type Ring = LngLat
type DrawMode = 'none' | 'polygon' | 'rectangle'

const REGION_FILL_ID = 'earthwork-region-fill'
const REGION_OUTLINE_ID = 'earthwork-region-outline'
const PREVIEW_ID = 'earthwork-preview'
const LABEL_CUT_ID = 'earthwork-label-cut'
const LABEL_FILL_ID = 'earthwork-label-fill'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const isLoaded = ref(false)
const isAnalyzing = ref(false)
const drawMode = ref<DrawMode>('none')
const helpOpen = ref(false)
const activeHelpKey = ref<string | undefined>(EARTHWORK_HELP[0]?.key)

const zoneRing = shallowRef<Ring[]>([])
const terrainReady = ref(false)
const terrainWarning = ref('')
const errorMessage = ref('')

const form = reactive({
  resolution: 20,
  designMode: 'plane' as EarthworkParams['designMode'],
  designHeight: 0,
  slopePercent: 1,
  aspectDeg: 0,
  offset: 2
})

const display = reactive({
  showHeatmap: true,
  heatmapOpacity: 0.82,
  showDesign: true,
  designOpacity: 0.28,
  showRegion: true,
  showLabels: true
})

const stats = shallowRef<EarthworkStats | undefined>()
const gridInfo = ref('')
const calcTime = ref(0)
const meanGround = ref(0)

let viewer: Cesium.Viewer | undefined
let handler: Cesium.ScreenSpaceEventHandler | undefined
let heatmapPrimitive: Cesium.Primitive | undefined
let designPrimitive: Cesium.Primitive | undefined
let grid: EarthworkGrid | undefined
let originalHeights: Float64Array | undefined
let designHeights: Float64Array | undefined
let cellDiff: Float32Array | undefined
let tempRing: Ring[] = []
let cursorPoint: Ring | undefined
let rectAnchor: Ring | null = null
let runSeq = 0
let analyzeTimer: number | undefined
let lastKey = ''

const RESOLUTION_OPTIONS = [2, 5, 10, 20, 30, 50]

const zoneAreaText = computed(() => {
  const area = stats.value?.regionArea ?? 0
  if (area <= 0) return '—'
  return area >= 1000000 ? `${(area / 1000000).toFixed(3)} km²` : `${Math.round(area)} m²`
})

const netText = computed(() => {
  const value = stats.value?.netVolume ?? 0
  const sign = value > 0 ? '挖' : value < 0 ? '填' : '平衡'
  return `${Math.abs(value).toFixed(0)} m³（${sign}）`
})

function ringToCartesians(ring: Ring[]): Cesium.Cartesian3[] {
  const flat: number[] = []
  for (const p of ring) flat.push(p.lon, p.lat)
  return Cesium.Cartesian3.fromDegreesArray(flat)
}

function clearPrimitive(primitive: Cesium.Primitive | undefined): void {
  if (!viewer || viewer.isDestroyed() || !primitive) return
  viewer.scene.primitives.remove(primitive)
}

function removeVisuals(): void {
  if (!viewer || viewer.isDestroyed()) return
  clearPrimitive(heatmapPrimitive)
  clearPrimitive(designPrimitive)
  heatmapPrimitive = undefined
  designPrimitive = undefined
  viewer.entities.removeById(REGION_FILL_ID)
  viewer.entities.removeById(REGION_OUTLINE_ID)
  viewer.entities.removeById(LABEL_CUT_ID)
  viewer.entities.removeById(LABEL_FILL_ID)
}

function renderRegion(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.entities.removeById(REGION_FILL_ID)
  viewer.entities.removeById(REGION_OUTLINE_ID)
  const ring = zoneRing.value
  if (!display.showRegion || ring.length < 3) return
  const positions = ringToCartesians(ring)
  viewer.entities.add({
    id: REGION_FILL_ID,
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(positions),
      material: Cesium.Color.fromCssColorString('#31d0ff').withAlpha(0.1),
      classificationType: Cesium.ClassificationType.TERRAIN,
      outline: false
    }
  })
  viewer.entities.add({
    id: REGION_OUTLINE_ID,
    polyline: {
      positions: [...positions, positions[0]],
      width: 2,
      material: Cesium.Color.fromCssColorString('#45e0ff'),
      clampToGround: true
    }
  })
}

function removePreview(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.entities.removeById(PREVIEW_ID)
}

function updatePreview(): void {
  if (!viewer || viewer.isDestroyed()) return
  removePreview()
  if (drawMode.value === 'none' || tempRing.length === 0) return
  const positions: Ring[] = [...tempRing]
  if (cursorPoint) positions.push(cursorPoint)
  const cartesians = ringToCartesians(positions)
  if (positions.length >= 3) {
    viewer.entities.add({
      id: PREVIEW_ID,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(cartesians),
        material: Cesium.Color.fromCssColorString('#ffe066').withAlpha(0.25),
        classificationType: Cesium.ClassificationType.TERRAIN,
        outline: false
      }
    })
  } else if (cartesians.length >= 2) {
    viewer.entities.add({
      id: PREVIEW_ID,
      polyline: { positions: cartesians, width: 2, material: Cesium.Color.fromCssColorString('#ffe066'), clampToGround: true }
    })
  }
}

function buildCellPrimitive(
  colorForCell: (cellIndex: number) => Cesium.Color,
  heightForCorner: (cornerIndex: number) => number,
  offset: number
): Cesium.Primitive | undefined {
  if (!viewer || viewer.isDestroyed() || !grid) return undefined
  const { cols, rows, coverage, corners } = grid
  const rowWidth = cols + 1
  const instances: Cesium.GeometryInstance[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col
      if (coverage[index] <= 0) continue
      const i00 = row * rowWidth + col
      const i10 = i00 + 1
      const i01 = i00 + rowWidth
      const i11 = i01 + 1
      const positions = [i00, i10, i11, i01].map((cornerIndex) => {
        const corner = corners[cornerIndex]
        return Cesium.Cartesian3.fromDegrees(corner.lon, corner.lat, heightForCorner(cornerIndex) + offset)
      })
      instances.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(positions),
            perPositionHeight: true,
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT
          }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(colorForCell(index)) }
        })
      )
    }
  }
  if (instances.length === 0) return undefined
  return viewer.scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true, closed: false }),
      asynchronous: false
    })
  )
}

function renderHeatmap(): void {
  clearPrimitive(heatmapPrimitive)
  heatmapPrimitive = undefined
  if (!display.showHeatmap || !grid || !originalHeights || !cellDiff || !stats.value) return
  const maxCut = Math.max(0.5, stats.value.maxCutDepth)
  const maxFill = Math.max(0.5, stats.value.maxFillDepth)
  const alpha = Math.round(display.heatmapOpacity * 255)
  heatmapPrimitive = buildCellPrimitive(
    (index) => {
      const { r, g, b } = diffColor(cellDiff![index], maxCut, maxFill)
      return Cesium.Color.fromBytes(r, g, b, alpha)
    },
    (index) => originalHeights![index],
    0.25
  )
}

function renderDesignSurface(): void {
  clearPrimitive(designPrimitive)
  designPrimitive = undefined
  if (!display.showDesign || !grid || !designHeights) return
  const color = Cesium.Color.fromCssColorString('#54d6ff').withAlpha(display.designOpacity)
  designPrimitive = buildCellPrimitive(
    () => color,
    (index) => designHeights![index],
    0.4
  )
}

function renderLabels(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.entities.removeById(LABEL_CUT_ID)
  viewer.entities.removeById(LABEL_FILL_ID)
  if (!display.showLabels || !grid || !originalHeights || !designHeights || !cellDiff || !stats.value) return
  const { cols, rows, corners } = grid
  const rowWidth = cols + 1
  let cutIndex = -1
  let fillIndex = -1
  let cutDepth = 0
  let fillDepth = 0
  for (let index = 0; index < cellDiff.length; index += 1) {
    const diff = cellDiff[index]
    if (diff < -cutDepth) {
      cutDepth = -diff
      cutIndex = index
    }
    if (diff > fillDepth) {
      fillDepth = diff
      fillIndex = index
    }
  }
  const cellCenter = (index: number) => {
    const row = Math.floor(index / cols)
    const col = index % cols
    const i00 = row * rowWidth + col
    const i10 = i00 + 1
    const i01 = i00 + rowWidth
    const i11 = i01 + 1
    const lon = (corners[i00].lon + corners[i11].lon) / 2
    const lat = (corners[i00].lat + corners[i11].lat) / 2
    return { lon, lat, i00, i10, i01, i11 }
  }
  if (cutIndex >= 0 && cutDepth > 0.05) {
    const c = cellCenter(cutIndex)
    viewer.entities.add({
      id: LABEL_CUT_ID,
      position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, originalHeights[c.i00] + 3),
      point: { pixelSize: 7, color: Cesium.Color.fromCssColorString('#ff4d4f'), outlineColor: Cesium.Color.WHITE, outlineWidth: 1 },
      label: {
        text: `最大挖深 ${cutDepth.toFixed(1)}m`,
        font: '12px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#5a1010'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -16)
      }
    })
  }
  if (fillIndex >= 0 && fillDepth > 0.05) {
    const c = cellCenter(fillIndex)
    viewer.entities.add({
      id: LABEL_FILL_ID,
      position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, designHeights[c.i00] + 3),
      point: { pixelSize: 7, color: Cesium.Color.fromCssColorString('#2f8bff'), outlineColor: Cesium.Color.WHITE, outlineWidth: 1 },
      label: {
        text: `最大填高 ${fillDepth.toFixed(1)}m`,
        font: '12px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#0b2a52'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -16)
      }
    })
  }
}

function renderResult(): void {
  renderHeatmap()
  renderDesignSurface()
  renderLabels()
}

async function sampleOriginalHeights(target: EarthworkGrid): Promise<Float64Array> {
  const cartos = target.corners.map((c) => Cesium.Cartographic.fromDegrees(c.lon, c.lat))
  if (terrainReady.value && viewer) {
    try {
      const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartos)
      return Float64Array.from(sampled.map((c) => c.height ?? 0))
    } catch {
      // 最详细层级采样失败时降级到当前 LOD
    }
  }
  return Float64Array.from(cartos.map((c) => viewer?.scene.globe.getHeight(c) ?? 0))
}

async function runAnalysis(): Promise<void> {
  if (!viewer || viewer.isDestroyed() || isAnalyzing.value) return
  const ring = zoneRing.value
  if (ring.length < 3) {
    errorMessage.value = '请先绘制至少包含 3 个顶点的分析区域'
    return
  }
  const seq = ++runSeq
  isAnalyzing.value = true
  errorMessage.value = ''
  statusMessage.value = '正在构建分析网格…'
  await new Promise((resolve) => setTimeout(resolve, 30))
  try {
    const started = performance.now()
    const target = buildGrid(ring, form.resolution)
    if (!target) throw new Error('无法构建分析网格，请检查区域形状或适当减小分辨率')
    const cacheKey = `${target.lon0.toFixed(6)},${target.lat0.toFixed(6)},${target.resolution.toFixed(2)},${target.cols}x${target.rows},${ring.length}`
    let original = originalHeights
    const needSample = cacheKey !== lastKey || !original || original.length !== target.corners.length
    if (needSample) {
      statusMessage.value = '正在采样地形高程…'
      original = await sampleOriginalHeights(target)
      if (seq !== runSeq) return
      lastKey = cacheKey
    }
    if (!original) throw new Error('地形高程采样失败')
    const mean = original.length > 0 ? original.reduce((sum, value) => sum + value, 0) / original.length : 0
    meanGround.value = mean
    if (form.designMode === 'plane' && form.designHeight === 0) form.designHeight = Math.round(mean * 10) / 10
    const design = buildDesignHeights(target, form, original)
    const evaluated = evaluateEarthwork(target, original, design)
    grid = target
    originalHeights = original
    designHeights = design
    cellDiff = evaluated.cellDiff
    stats.value = evaluated.stats
    calcTime.value = performance.now() - started
    gridInfo.value = `${target.cols} × ${target.rows}（${target.resolution.toFixed(1)} m）`
    renderRegion()
    renderResult()
    statusMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
    statusMessage.value = ''
  } finally {
    isAnalyzing.value = false
  }
}

function resetZone(): void {
  zoneRing.value = defaultRing()
  cursorPoint = undefined
  tempRing = []
  renderRegion()
  viewer?.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(ringCentroid(zoneRing.value).lon, ringCentroid(zoneRing.value).lat - 0.006, 2600),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
    duration: 1.2
  })
  void runAnalysis()
}

function clearZone(): void {
  cancelDraw()
  zoneRing.value = []
  grid = undefined
  originalHeights = undefined
  designHeights = undefined
  cellDiff = undefined
  stats.value = undefined
  gridInfo.value = ''
  lastKey = ''
  if (analyzeTimer !== undefined) {
    window.clearTimeout(analyzeTimer)
    analyzeTimer = undefined
  }
  renderRegion()
  removeVisuals()
  statusMessage.value = ''
}

function scheduleAnalysis(delay = 280): void {
  if (analyzeTimer !== undefined) window.clearTimeout(analyzeTimer)
  analyzeTimer = window.setTimeout(() => {
    analyzeTimer = undefined
    void runAnalysis()
  }, delay)
}

function cancelDraw(): void {
  drawMode.value = 'none'
  tempRing = []
  cursorPoint = undefined
  rectAnchor = null
  removePreview()
}

function startPolygonDraw(): void {
  if (!viewer || !handler || isAnalyzing.value) return
  cancelDraw()
  drawMode.value = 'polygon'
  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const carto = pickCartographic(viewer!.scene, movement.position)
    if (!carto) return
    tempRing.push({ lon: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) })
    updatePreview()
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
    const carto = pickCartographic(viewer!.scene, movement.endPosition)
    if (!carto) return
    cursorPoint = { lon: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) }
    updatePreview()
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
  handler.setInputAction(() => finishDraw(), Cesium.ScreenSpaceEventType.RIGHT_CLICK)
  handler.setInputAction(() => finishDraw(), Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
}

function startRectangleDraw(): void {
  if (!viewer || !handler || isAnalyzing.value) return
  cancelDraw()
  drawMode.value = 'rectangle'
  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const carto = pickCartographic(viewer!.scene, movement.position)
    if (!carto) return
    const point = { lon: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) }
    if (!rectAnchor) {
      rectAnchor = point
      return
    }
    tempRing = rectangleRing(rectAnchor, point)
    finishDraw()
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
    if (!rectAnchor) return
    const carto = pickCartographic(viewer!.scene, movement.endPosition)
    if (!carto) return
    cursorPoint = { lon: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) }
    tempRing = rectangleRing(rectAnchor, cursorPoint)
    cursorPoint = undefined
    updatePreview()
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
}

function rectangleRing(a: Ring, b: Ring): Ring[] {
  return [
    { lon: a.lon, lat: a.lat },
    { lon: b.lon, lat: a.lat },
    { lon: b.lon, lat: b.lat },
    { lon: a.lon, lat: b.lat }
  ]
}

function finishDraw(): void {
  if (drawMode.value === 'none') return
  if (tempRing.length < 3) {
    cancelDraw()
    errorMessage.value = '分析区域至少需要 3 个顶点'
    return
  }
  zoneRing.value = tempRing.slice()
  cancelDraw()
  void runAnalysis()
}

function toggleHelp(key: string): void {
  activeHelpKey.value = activeHelpKey.value === key ? undefined : key
}

function useMeanGround(): void {
  if (meanGround.value > 0) form.designHeight = Math.round(meanGround.value * 10) / 10
}

function collectReport(): ReportModel {
  const centroid = zoneRing.value.length >= 3 ? ringCentroid(zoneRing.value) : undefined
  const s = stats.value
  const sections: ReportSection[] = []
  sections.push({
    title: '一、案例与区域',
    kv: [
      { label: '案例名称', value: '空间分析-土方量分析' },
      { label: '区域中心', value: centroid ? `${centroid.lon.toFixed(6)}, ${centroid.lat.toFixed(6)}` : '—' },
      { label: '区域顶点数', value: `${zoneRing.value.length}` },
      { label: '区域面积', value: s ? `${s.regionArea.toFixed(2)} m²` : '—' }
    ]
  })
  sections.push({
    title: '二、分析参数',
    kv: [
      { label: '网格分辨率', value: `${form.resolution} m` },
      { label: '设计面类型', value: designModeLabel(form.designMode) },
      { label: '设计标高', value: `${form.designHeight.toFixed(2)} m` },
      { label: '坡度', value: form.designMode === 'slope' ? `${form.slopePercent}%` : '—' },
      { label: '坡向', value: form.designMode === 'slope' ? `${form.aspectDeg}°` : '—' },
      { label: '地形偏移量', value: form.designMode === 'offset' ? `${form.offset} m` : '—' },
      { label: '平均地面高程', value: `${meanGround.value.toFixed(2)} m` },
      { label: '网格规模', value: gridInfo.value || '—' }
    ]
  })
  if (s) {
    sections.push({
      title: '三、土方计算结果',
      kv: [
        { label: '挖方量', value: `${s.cutVolume.toFixed(2)} m³` },
        { label: '填方量', value: `${s.fillVolume.toFixed(2)} m³` },
        { label: '净方量（挖-填）', value: `${s.netVolume.toFixed(2)} m³` },
        { label: '挖方面积', value: `${s.cutArea.toFixed(2)} m²` },
        { label: '填方面积', value: `${s.fillArea.toFixed(2)} m²` },
        { label: '最大挖深', value: `${s.maxCutDepth.toFixed(2)} m` },
        { label: '最大填高', value: `${s.maxFillDepth.toFixed(2)} m` },
        { label: '平均挖深', value: `${s.avgCutDepth.toFixed(2)} m` },
        { label: '平均填高', value: `${s.avgFillDepth.toFixed(2)} m` },
        { label: '采样点 / 单元', value: `${s.samplePoints} / ${s.cells}` },
        { label: '计算耗时', value: `${calcTime.value.toFixed(0)} ms` }
      ]
    })
  } else {
    sections.push({ title: '三、土方计算结果', lines: ['尚未执行土方分析，请绘制区域并点击「开始分析」。'] })
  }
  return {
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    intro:
      '本报告由「空间分析-土方量分析」案例生成。分析采用网格法，在区域局部平面米坐标系内对原始地面与设计面高差逐单元积分：diff = 设计高程 − 原始高程，diff < 0 计为挖方、diff > 0 计为填方，净方量 = 挖方 − 填方。原始地面高程来自 Cesium 世界地形采样。',
    sections
  }
}

function designModeLabel(mode: EarthworkParams['designMode']): string {
  if (mode === 'slope') return '斜面'
  if (mode === 'offset') return '地形偏移面'
  return '水平面'
}

function exportPdf(): void {
  printReport(collectReport(), { docTitle: '土方量分析报告', filenamePrefix: 'earthwork-analysis-report', onStatus: (message) => (statusMessage.value = message) })
}

async function exportWord(): Promise<void> {
  await exportReportDocx(collectReport(), { docTitle: '土方量分析报告', filenamePrefix: 'earthwork-analysis-report', onStatus: (message) => (statusMessage.value = message) })
}

watch([() => display.showHeatmap, () => display.heatmapOpacity], () => {
  if (grid && originalHeights && cellDiff) renderHeatmap()
})
watch([() => display.showDesign, () => display.designOpacity], () => {
  if (grid && designHeights) renderDesignSurface()
})
watch([() => display.showRegion], () => renderRegion())
watch([() => display.showLabels], () => renderLabels())
watch(
  [() => form.resolution, () => form.designMode, () => form.designHeight, () => form.slopePercent, () => form.aspectDeg, () => form.offset],
  () => {
    if (grid) scheduleAnalysis()
  }
)

onMounted(async () => {
  if (!container.value) return
  viewer = createMapScene(container.value, { onStatus: (message) => (statusMessage.value = message) })
  handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  loadBingImagery(viewer, { onStatus: (message) => (statusMessage.value = message) })
  statusMessage.value = '正在加载 Cesium World Terrain…'
  try {
    await loadWorldTerrain(viewer)
    terrainReady.value = true
  } catch {
    terrainReady.value = false
    terrainWarning.value = '地形加载失败，已降级为椭球面（土方结果为示意值）'
    statusMessage.value = terrainWarning.value
  }
  if (!viewer || viewer.isDestroyed()) return
  viewer.scene.globe.depthTestAgainstTerrain = true
  resetZone()
  isLoaded.value = true
})

onBeforeUnmount(() => {
  runSeq += 1
  cancelDraw()
  handler?.destroy()
  handler = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="ew-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">空间分析-土方量分析</div>

      <div class="section-title">分析区域</div>
      <div class="button-row">
        <button class="action-button" :class="{ active: drawMode === 'polygon' }" :disabled="!isLoaded" @click="startPolygonDraw">多边形</button>
        <button class="action-button" :class="{ active: drawMode === 'rectangle' }" :disabled="!isLoaded" @click="startRectangleDraw">矩形</button>
      </div>
      <div class="button-row">
        <button class="action-button ghost" :disabled="!isLoaded" @click="resetZone">默认区域</button>
        <button class="action-button ghost" :disabled="!isLoaded" @click="clearZone">清除区域</button>
      </div>
      <div class="row-note">
        {{ drawMode === 'none' ? '点击地图拾取顶点，右键 / 双击闭合，绘制结果贴地显示' : drawMode === 'polygon' ? '左键逐点绘制，右键 / 双击闭合' : '左键两次确定矩形对角点' }}
      </div>
      <div class="row-note">区域面积 {{ zoneAreaText }} · 顶点 {{ zoneRing.length }}</div>

      <div class="section-title">网格与设计面</div>
      <div class="control-row">
        <span class="row-label">网格分辨率</span>
        <select v-model.number="form.resolution">
          <option v-for="value in RESOLUTION_OPTIONS" :key="value" :value="value">{{ value }} m</option>
        </select>
      </div>
      <div class="control-row">
        <span class="row-label">设计面</span>
        <select v-model="form.designMode">
          <option value="plane">水平面</option>
          <option value="slope">斜面</option>
          <option value="offset">地形偏移面</option>
        </select>
      </div>
      <div class="control-row" v-if="form.designMode !== 'offset'">
        <span class="row-label">设计标高</span>
        <input v-model.number="form.designHeight" type="number" step="0.5" />
        <span class="row-value">m</span>
      </div>
      <div class="button-row" v-if="form.designMode === 'plane'">
        <button class="action-button ghost" @click="useMeanGround">取平均地面高程</button>
      </div>
      <template v-if="form.designMode === 'slope'">
        <div class="control-row">
          <span class="row-label">坡度</span>
          <input v-model.number="form.slopePercent" type="range" min="-10" max="10" step="0.1" />
          <span class="row-value">{{ form.slopePercent.toFixed(1) }}%</span>
        </div>
        <div class="control-row">
          <span class="row-label">坡向</span>
          <input v-model.number="form.aspectDeg" type="range" min="0" max="359" step="1" />
          <span class="row-value">{{ form.aspectDeg }}°</span>
        </div>
      </template>
      <div class="control-row" v-if="form.designMode === 'offset'">
        <span class="row-label">偏移量</span>
        <input v-model.number="form.offset" type="range" min="-10" max="10" step="0.5" />
        <span class="row-value">{{ form.offset.toFixed(1) }} m</span>
      </div>
      <div class="row-note">平均地面 {{ meanGround.toFixed(2) }} m · 网格 {{ gridInfo || '—' }}</div>

      <div class="section-title">结果展示</div>
      <label class="switch-row"><span>填挖热力图</span><input v-model="display.showHeatmap" type="checkbox" /></label>
      <div class="control-row">
        <span class="row-label">热力图透明度</span>
        <input v-model.number="display.heatmapOpacity" type="range" min="0.2" max="1" step="0.02" :disabled="!display.showHeatmap" />
        <span class="row-value">{{ display.heatmapOpacity.toFixed(2) }}</span>
      </div>
      <label class="switch-row"><span>设计面</span><input v-model="display.showDesign" type="checkbox" /></label>
      <div class="control-row">
        <span class="row-label">设计面透明度</span>
        <input v-model.number="display.designOpacity" type="range" min="0.05" max="0.8" step="0.01" :disabled="!display.showDesign" />
        <span class="row-value">{{ display.designOpacity.toFixed(2) }}</span>
      </div>
      <label class="switch-row"><span>区域贴地面 / 边界</span><input v-model="display.showRegion" type="checkbox" /></label>
      <label class="switch-row"><span>极值点标注</span><input v-model="display.showLabels" type="checkbox" /></label>

      <div class="section-title">土方统计</div>
      <div class="stat-grid">
        <div class="stat-cell"><span>挖方量</span><b class="cut">{{ (stats?.cutVolume ?? 0).toFixed(0) }}</b></div>
        <div class="stat-cell"><span>填方量</span><b class="fill">{{ (stats?.fillVolume ?? 0).toFixed(0) }}</b></div>
        <div class="stat-cell"><span>净方量</span><b>{{ netText }}</b></div>
        <div class="stat-cell"><span>挖方面积</span><b>{{ (stats?.cutArea ?? 0).toFixed(0) }} m²</b></div>
        <div class="stat-cell"><span>填方面积</span><b>{{ (stats?.fillArea ?? 0).toFixed(0) }} m²</b></div>
        <div class="stat-cell"><span>最大挖深</span><b class="cut">{{ (stats?.maxCutDepth ?? 0).toFixed(1) }} m</b></div>
        <div class="stat-cell"><span>最大填高</span><b class="fill">{{ (stats?.maxFillDepth ?? 0).toFixed(1) }} m</b></div>
        <div class="stat-cell"><span>平均挖深</span><b>{{ (stats?.avgCutDepth ?? 0).toFixed(2) }} m</b></div>
        <div class="stat-cell"><span>平均填高</span><b>{{ (stats?.avgFillDepth ?? 0).toFixed(2) }} m</b></div>
      </div>
      <div class="row-note">采样点 {{ stats?.samplePoints ?? 0 }} · 计算耗时 {{ calcTime.toFixed(0) }} ms</div>
      <p v-if="terrainWarning" class="warning-text">{{ terrainWarning }}</p>
      <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
      <div class="button-row">
        <button class="action-button" :disabled="!isLoaded || isAnalyzing" @click="runAnalysis">{{ isAnalyzing ? '分析中…' : '开始分析' }}</button>
      </div>

      <div class="section-title">分析报告</div>
      <div class="button-row">
        <button class="action-button ghost" :disabled="!stats" @click="exportPdf">打印 / PDF</button>
        <button class="action-button ghost" :disabled="!stats" @click="exportWord">下载 Word</button>
      </div>

      <button class="help-toggle" @click="helpOpen = !helpOpen">功能实现说明</button>
      <div v-if="helpOpen" class="help-panel">
        <div class="help-head">
          <span>功能实现说明</span>
          <button class="help-close" @click="helpOpen = false">×</button>
        </div>
        <div v-for="item in EARTHWORK_HELP" :key="item.key" class="help-item">
          <button class="help-item-head" :class="{ active: activeHelpKey === item.key }" @click="toggleHelp(item.key)">
            <span>{{ item.title }}</span><i>{{ activeHelpKey === item.key ? '−' : '+' }}</i>
          </button>
          <p v-if="activeHelpKey === item.key" class="help-summary">{{ item.summary }}</p>
          <ul v-if="activeHelpKey === item.key" class="help-detail">
            <li v-for="(line, index) in item.detail" :key="index">{{ line }}</li>
          </ul>
        </div>
      </div>

      <p class="hint">
        在场景中绘制分析区域并设置设计面与网格分辨率，系统对原始地面与设计面高差逐单元积分，输出挖方量、填方量与净方量及填挖热力图。
      </p>
    </div>

    <div v-if="statusMessage && (!isLoaded || isAnalyzing)" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.ew-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #0f2438; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 5px; width: 292px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 26, 44, 0.9); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.panel-title { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
.section-title { margin-top: 7px; margin-bottom: 2px; padding-bottom: 2px; border-bottom: 1px solid rgba(137, 210, 233, 0.16); font-size: 11px; font-weight: 700; color: #7fd0e6; }
.button-row { display: flex; gap: 6px; }
.action-button { flex: 1; min-height: 26px; border: 1px solid rgba(137, 210, 233, 0.35); border-radius: 5px; background: #143450; color: #d9eff6; cursor: pointer; font-size: 11px; }
.action-button.active { background: #257f9e; border-color: #45b4d6; }
.action-button.ghost { background: rgba(20, 52, 80, 0.6); }
.action-button:disabled { cursor: default; opacity: 0.5; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 0; color: #c3d8e6; }
.row-label { flex: 0 0 auto; }
.row-value { flex: 0 0 56px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.row-note { font-size: 10px; color: #7fd0e6; line-height: 1.5; }
.warning-text { margin: 5px 0 0; padding: 5px 7px; border: 1px solid rgba(255, 199, 92, 0.45); border-radius: 5px; background: rgba(74, 58, 12, 0.4); color: #ffd666; font-size: 10px; line-height: 1.5; }
.error-text { margin: 5px 0 0; padding: 5px 7px; border: 1px solid rgba(255, 120, 117, 0.5); border-radius: 5px; background: rgba(74, 20, 18, 0.45); color: #ff7875; font-size: 10px; line-height: 1.5; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row input[type="number"] { flex: 1; min-width: 0; height: 22px; padding: 0 5px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.control-row select { width: 128px; height: 22px; padding: 0 5px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.switch-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; color: #c3d8e6; }
.switch-row input { cursor: pointer; }
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 2px; }
.stat-cell { display: flex; flex-direction: column; gap: 2px; padding: 5px 4px; border: 1px solid rgba(137, 210, 233, 0.2); border-radius: 5px; background: rgba(16, 43, 64, 0.55); text-align: center; }
.stat-cell span { font-size: 9px; color: #8fb0c8; }
.stat-cell b { font-size: 11px; color: #d9eff6; }
.stat-cell b.cut { color: #ff7875; }
.stat-cell b.fill { color: #5aa9ff; }
.hint { margin: 6px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.help-toggle { margin-top: 7px; min-height: 26px; border: 1px solid rgba(255, 199, 92, 0.5); border-radius: 5px; background: rgba(74, 58, 12, 0.4); color: #ffd666; cursor: pointer; font-size: 11px; }
.help-panel { margin-top: 6px; padding: 8px; border: 1px solid rgba(255, 199, 92, 0.45); border-radius: 6px; background: rgba(30, 24, 8, 0.55); }
.help-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; color: #ffd666; font-weight: 700; }
.help-close { border: 0; background: transparent; color: #cbb98a; cursor: pointer; font-size: 14px; line-height: 1; }
.help-item { border-top: 1px solid rgba(255, 199, 92, 0.16); }
.help-item-head { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 5px 0; border: 0; background: transparent; color: #e9d9ae; cursor: pointer; font-size: 11px; text-align: left; }
.help-item-head.active { color: #ffe9a8; }
.help-item-head i { font-style: normal; font-size: 13px; }
.help-summary { margin: 0 0 3px; font-size: 10px; color: #d9cdab; line-height: 1.5; }
.help-detail { margin: 0; padding-left: 15px; }
.help-detail li { font-size: 10px; color: #cbbd97; line-height: 1.55; margin-bottom: 2px; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 11; width: max-content; max-width: 460px; padding: 8px 14px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
