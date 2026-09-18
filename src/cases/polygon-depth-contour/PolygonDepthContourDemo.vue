<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as Cesium from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  loadWorldTerrain,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib/pick'
import {
  buildContourPrimitive,
  buildSurfaceGeometry,
  chooseLabelPoints,
  computeContours,
  createSampleGrid,
  createSurfaceAppearance,
  fillGridStats,
  formatLevel,
  nodeLonLat,
  paletteGradientCss,
  PALETTE_OPTIONS,
  pointInRing,
  type ContourColorMode,
  type ContourResult,
  type PaletteKey,
  type Ring,
  type SampleGrid
} from './depth-contour-lib'

const RESOLUTION_OPTIONS = [80, 120, 160, 200, 256]
const LABEL_INTERVAL_OPTIONS = [1, 2, 3, 5, 10]

const EXAMPLE_REGION: Ring = [
  { lon: 116.702, lat: 40.405 },
  { lon: 116.795, lat: 40.412 },
  { lon: 116.835, lat: 40.452 },
  { lon: 116.81, lat: 40.515 },
  { lon: 116.725, lat: 40.548 },
  { lon: 116.645, lat: 40.502 },
  { lon: 116.638, lat: 40.443 }
]

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图与 Cesium World Terrain…')
const isLoaded = ref(false)
const busy = ref(false)
const drawing = ref(false)
const hasResult = ref(false)
const vertexCount = ref(0)
const progress = ref(0)
const resolutionDim = ref(160)
const intervalInput = ref(10)
const depthPalette = ref<PaletteKey>('terrain')
const depthOpacity = ref(0.72)
const depthVisible = ref(true)
const boundaryVisible = ref(true)
const contourVisible = ref(true)
const contourWidth = ref(2)
const contourMode = ref<ContourColorMode>('brown')
const contourAlpha = ref(1)
const labelVisible = ref(true)
const labelFont = ref(15)
const labelColor = ref('#1f2933')
const labelBgVisible = ref(true)
const labelBgColor = ref('#ffffff')
const labelEvery = ref(1)
const legendVisible = ref(true)

const sampleCountText = ref('0')
const heightRangeText = ref('—')
const levelCountText = ref('0')
const pieceCountText = ref('0')
const intervalText = ref('—')
const statsMessage = ref('')

const depthGradientCss = computed(() => paletteGradientCss(depthPalette.value))
const busyText = computed(() => (busy.value ? `${progress.value}%` : ''))

let viewer: Cesium.Viewer | undefined
let handler: Cesium.ScreenSpaceEventHandler | undefined
let analysisRun = 0
let surfacePrimitive: Cesium.Primitive | undefined
let contourPrimitive: Cesium.Primitive | undefined
let labelEntities: Cesium.Entity[] = []
let grid: SampleGrid | undefined
let currentRing: Ring | undefined
let contourResult: ContourResult | undefined
let draftEntity: Cesium.Entity | undefined
let vertexEntities: Cesium.Entity[] = []
let regionOutline: Cesium.Entity | undefined
let pickedVertices: Cesium.Cartesian3[] = []

function setStatus(message: string): void {
  statusMessage.value = message
}

function removePrimitive(primitive: Cesium.Primitive | undefined): void {
  if (!viewer || !primitive || viewer.isDestroyed()) return
  viewer.scene.primitives.remove(primitive)
}

function removePrimitives(): void {
  removePrimitive(surfacePrimitive)
  surfacePrimitive = undefined
  removePrimitive(contourPrimitive)
  contourPrimitive = undefined
  for (const entity of labelEntities) {
    if (viewer && !viewer.isDestroyed()) viewer.entities.remove(entity)
  }
  labelEntities = []
}

function removeDraft(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (draftEntity) viewer.entities.remove(draftEntity)
  draftEntity = undefined
  for (const entity of vertexEntities) viewer.entities.remove(entity)
  vertexEntities = []
}

function ringToCartesians(ring: Ring): Cesium.Cartesian3[] {
  const positions: Cesium.Cartesian3[] = []
  for (const point of ring) positions.push(Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 0))
  return positions
}

function showRegionOutline(ring: Ring): void {
  if (!viewer || viewer.isDestroyed()) return
  if (!regionOutline) {
    regionOutline = viewer.entities.add({
      polyline: {
        positions: ringToCartesians(ring),
        width: 3,
        material: Cesium.Color.fromCssColorString('#ffcf5c'),
        clampToGround: true
      }
    }) as unknown as Cesium.Entity
  } else {
    const polyline = regionOutline.polyline
    if (polyline) {
      polyline.positions = new Cesium.ConstantProperty(ringToCartesians(ring))
      polyline.show = new Cesium.ConstantProperty(true)
    }
  }
  if (regionOutline?.polyline) regionOutline.polyline.show = new Cesium.ConstantProperty(boundaryVisible.value)
}

function updateRegionVisible(): void {
  if (regionOutline?.polyline) regionOutline.polyline.show = new Cesium.ConstantProperty(boundaryVisible.value)
  if (viewer) viewer.scene.requestRender()
}

function clearAnalysis(): void {
  analysisRun += 1
  grid = undefined
  currentRing = undefined
  contourResult = undefined
  removePrimitives()
  if (viewer && !viewer.isDestroyed() && regionOutline) {
    viewer.entities.remove(regionOutline)
    regionOutline = undefined
  }
  hasResult.value = false
  sampleCountText.value = '0'
  heightRangeText.value = '—'
  levelCountText.value = '0'
  pieceCountText.value = '0'
  intervalText.value = '—'
  statsMessage.value = ''
  progress.value = 0
}

function resetDrawing(): void {
  drawing.value = false
  pickedVertices = []
  vertexCount.value = 0
  removeDraft()
}

async function sampleGridHeights(runId: number): Promise<void> {
  if (!viewer || !grid || viewer.isDestroyed()) return
  const totalRows = grid.ny
  const batchRows = Math.max(1, Math.min(totalRows, Math.floor(6000 / grid.nx)))
  for (let startRow = 0; startRow < totalRows; startRow += batchRows) {
    if (runId !== analysisRun || viewer.isDestroyed()) return
    const endRow = Math.min(totalRows, startRow + batchRows)
    const samples: Cesium.Cartographic[] = []
    for (let row = startRow; row < endRow; row += 1) {
      for (let col = 0; col < grid.nx; col += 1) {
        const point = nodeLonLat(grid, row, col)
        samples.push(Cesium.Cartographic.fromDegrees(point.lon, point.lat))
      }
    }
    setStatus(`正在采样多边形区域地形高度…${Math.round((startRow / totalRows) * 100)}%`)
    progress.value = Math.round((startRow / totalRows) * 70)
    await yieldFrame()
    try {
      const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, samples)
      if (runId !== analysisRun || viewer.isDestroyed()) return
      let index = 0
      for (let row = startRow; row < endRow; row += 1) {
        for (let col = 0; col < grid.nx; col += 1) {
          const height = sampled[index]?.height
          grid.heights[row * grid.nx + col] = Number.isFinite(height) ? (height as number) : 0
          index += 1
        }
      }
    } catch {
      if (runId !== analysisRun || viewer.isDestroyed()) return
      for (let row = startRow; row < endRow; row += 1) {
        for (let col = 0; col < grid.nx; col += 1) {
          grid.heights[row * grid.nx + col] = 0
        }
      }
    }
    progress.value = Math.min(70, Math.round((endRow / totalRows) * 70))
    await yieldFrame()
  }
}

function renderSurface(): void {
  if (!viewer || !grid || !currentRing) return
  removePrimitive(surfacePrimitive)
  surfacePrimitive = undefined
  if (!depthVisible.value) {
    viewer.scene.requestRender()
    return
  }
  const geometry = buildSurfaceGeometry(grid, currentRing, {
    palette: depthPalette.value,
    opacity: depthOpacity.value,
    minHeight: grid.minInside,
    maxHeight: grid.maxInside
  })
  surfacePrimitive = viewer.scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry }),
      appearance: createSurfaceAppearance(),
      asynchronous: false,
      allowPicking: false
    })
  )
  viewer.scene.requestRender()
}

function renderContours(): void {
  if (!viewer || !grid || !currentRing || !contourResult) return
  removePrimitive(contourPrimitive)
  contourPrimitive = undefined
  if (!contourVisible.value) {
    viewer.scene.requestRender()
    return
  }
  contourPrimitive = buildContourPrimitive(
    contourResult,
    grid,
    contourMode.value,
    depthPalette.value,
    contourWidth.value,
    contourAlpha.value,
    grid.minInside,
    grid.maxInside
  )
  viewer.scene.primitives.add(contourPrimitive)
  viewer.scene.requestRender()
}

function renderLabels(): void {
  if (!viewer || viewer.isDestroyed() || !grid || !currentRing || !contourResult) return
  for (const entity of labelEntities) {
    if (!viewer.isDestroyed()) viewer.entities.remove(entity)
  }
  labelEntities = []
  if (!labelVisible.value) {
    viewer.scene.requestRender()
    return
  }
  const points = chooseLabelPoints(contourResult, grid, labelEvery.value)
  for (const point of points) {
    const position = Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.level)
    const text = `${formatLevel(point.level)}m`
    const entity = viewer.entities.add({
      position,
      label: {
        text,
        font: `bold ${labelFont.value}px sans-serif`,
        fillColor: Cesium.Color.fromCssColorString(labelColor.value),
        outlineColor: Cesium.Color.fromCssColorString(labelBgVisible.value ? labelBgColor.value : '#000000'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: labelBgVisible.value,
        backgroundColor: Cesium.Color.fromCssColorString(labelBgColor.value).withAlpha(0.82),
        backgroundPadding: new Cesium.Cartesian2(5, 3),
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(8, -4),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
    labelEntities.push(entity)
  }
  viewer.scene.requestRender()
}

function refreshLabels(): void {
  if (!hasResult.value || busy.value) return
  renderLabels()
}

function refreshSurface(): void {
  if (!hasResult.value || busy.value) return
  renderSurface()
}

function refreshContours(): void {
  if (!hasResult.value || busy.value) return
  renderContours()
  refreshLabels()
}

function recomputeContours(): void {
  if (!hasResult.value || busy.value || !grid || !currentRing) return
  contourResult = computeContours(grid, currentRing, intervalInput.value, grid.minInside, grid.maxInside)
  intervalText.value = `${contourResult.usedInterval.toFixed(2).replace(/\.?0+$/, '')} m`
  levelCountText.value = String(contourResult.levels.length)
  pieceCountText.value = String(contourResult.pieceCount)
  renderContours()
  renderLabels()
}

async function analyze(ring: Ring): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  clearAnalysis()
  const runId = ++analysisRun
  busy.value = true
  progress.value = 2
  grid = createSampleGrid(ring, resolutionDim.value)
  currentRing = ring.map((point) => ({ ...point }))
  try {
    setStatus('正在准备地形采样网格…')
    await yieldFrame()
    await sampleGridHeights(runId)
    if (runId !== analysisRun || viewer.isDestroyed()) return
    fillGridStats(grid, ring)
    if (grid.insideCount < 10) {
      setStatus('采样范围内有效点数过少，请绘制更大范围或提升分辨率后重试')
      hasResult.value = false
      return
    }
    setStatus('正在生成深度图与等高线…')
    progress.value = 76
    await yieldFrame()
    if (runId !== analysisRun || viewer.isDestroyed()) return
    if (!Number.isFinite(grid.minInside)) {
      setStatus('未获取到有效地形高度，请确认已加载 Cesium World Terrain 后重试')
      return
    }
    const heightRange = grid.maxInside - grid.minInside
    contourResult = computeContours(grid, ring, intervalInput.value, grid.minInside, grid.maxInside)
    progress.value = 88
    renderSurface()
    renderContours()
    renderLabels()
    sampleCountText.value = grid.insideCount.toLocaleString()
    heightRangeText.value = `${grid.minInside.toFixed(1)} ~ ${grid.maxInside.toFixed(1)} m`
    intervalText.value = `${contourResult.usedInterval.toFixed(2).replace(/\.?0+$/, '')} m`
    levelCountText.value = String(contourResult.levels.length)
    pieceCountText.value = String(contourResult.pieceCount)
    statsMessage.value =
      heightRange < 1
        ? '区域内地形高差不足 1m，等高线较稀疏'
        : `高差约 ${heightRange.toFixed(1)} m，按 ${intervalText.value} 等高距生成 ${contourResult.levels.length} 层`
    showRegionOutline(ring)
    hasResult.value = true
    progress.value = 100
    setStatus('深度图与等高线已生成。可在地图上右键/双击结束绘制；修改参数实时更新。')
    flyToRing(ring)
  } catch (error) {
    if (runId === analysisRun) {
      const detail = error instanceof Error ? error.message : String(error)
      setStatus(`分析失败：${detail}`)
    }
  } finally {
    if (runId === analysisRun) busy.value = false
  }
}

function flyToRing(ring: Ring): void {
  if (!viewer) return
  let west = Number.POSITIVE_INFINITY
  let east = Number.NEGATIVE_INFINITY
  let south = Number.POSITIVE_INFINITY
  let north = Number.NEGATIVE_INFINITY
  for (const point of ring) {
    if (point.lon < west) west = point.lon
    if (point.lon > east) east = point.lon
    if (point.lat < south) south = point.lat
    if (point.lat > north) north = point.lat
  }
  const widthMeters = Cesium.Cartesian3.distance(
    Cesium.Cartesian3.fromDegrees(west, (south + north) / 2),
    Cesium.Cartesian3.fromDegrees(east, (south + north) / 2)
  )
  const heightMeters = Cesium.Cartesian3.distance(
    Cesium.Cartesian3.fromDegrees((west + east) / 2, south),
    Cesium.Cartesian3.fromDegrees((west + east) / 2, north)
  )
  const maxSpan = Math.max(widthMeters, heightMeters, 800)
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees((west + east) / 2, (south + north) / 2, Math.max(1400, maxSpan * 2.6)),
    duration: 1.0
  })
}

function useExampleRegion(): void {
  if (!isLoaded.value || busy.value || !viewer) return
  resetDrawing()
  removeDraft()
  void analyze(EXAMPLE_REGION)
}

function clearResult(): void {
  if (busy.value) return
  clearAnalysis()
  resetDrawing()
  setStatus('已清除分析结果，可点击「绘制多边形」重新绘制')
}

function startDrawing(): void {
  if (!isLoaded.value || busy.value || !viewer) return
  if (drawing.value) {
    finishDrawing()
    return
  }
  clearAnalysis()
  resetDrawing()
  drawing.value = true
  setStatus('在地图上单击依次采集多边形顶点，右键或双击闭合完成绘制')
}

function updateDraftPreview(cursorPosition?: Cesium.Cartesian3): void {
  if (!viewer || viewer.isDestroyed()) return
  removeDraft()
  if (pickedVertices.length === 0) return
  const positions = [...pickedVertices]
  if (cursorPosition) positions.push(cursorPosition)
  if (positions.length >= 3) {
    draftEntity = viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: Cesium.Color.fromCssColorString('#ffcf5c').withAlpha(0.18),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#ffcf5c').withAlpha(0.9),
        outlineWidth: 2,
        perPositionHeight: true
      }
    }) as unknown as Cesium.Entity
  } else {
    draftEntity = viewer.entities.add({
      polyline: {
        positions,
        width: 2,
        material: Cesium.Color.fromCssColorString('#ffcf5c')
      }
    }) as unknown as Cesium.Entity
  }
}

function addVertex(position: Cesium.Cartesian3): void {
  if (!viewer || !drawing.value) return
  pickedVertices.push(position)
  vertexCount.value = pickedVertices.length
  const entity = viewer.entities.add({
    position,
    point: {
      pixelSize: 7,
      color: Cesium.Color.fromCssColorString('#ffd166'),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2
    }
  })
  vertexEntities.push(entity)
  updateDraftPreview()
  setStatus(`已采集 ${pickedVertices.length} 个顶点，右键或双击闭合`)
}

function finishDrawing(): void {
  if (!drawing.value) return
  drawing.value = false
  if (pickedVertices.length < 3) {
    resetDrawing()
    setStatus('多边形至少需要 3 个顶点，已取消绘制')
    return
  }
  removeDraft()
  const ring: Ring = pickedVertices.map((position) => {
    const carto = Cesium.Cartographic.fromCartesian(position, viewer?.scene.globe.ellipsoid)
    return { lon: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) }
  })
  if (pointInRing(ring[0].lon, ring[0].lat, ring)) {
    ring.pop()
  }
  const cleaned = ring.filter((point, index) => {
    if (index === 0) return true
    const previous = ring[index - 1]
    return Math.abs(point.lon - previous.lon) > 1e-9 || Math.abs(point.lat - previous.lat) > 1e-9
  })
  for (const entity of vertexEntities) {
    if (viewer && !viewer.isDestroyed()) viewer.entities.remove(entity)
  }
  vertexEntities = []
  vertexCount.value = 0
  if (cleaned.length < 3) {
    setStatus('多边形顶点过少，请重新绘制')
    return
  }
  setStatus('正在提取多边形内深度图并生成等高线…')
  void analyze(cleaned)
}

function onLeftClick(event: { position: Cesium.Cartesian2 }): void {
  if (!viewer || !drawing.value) return
  const position = pickPosition(viewer.scene, event.position)
  if (!position) return
  addVertex(position)
}

function onMouseMove(event: { endPosition: Cesium.Cartesian2 }): void {
  if (!viewer || !drawing.value) return
  const position = pickPosition(viewer.scene, event.endPosition)
  if (position) updateDraftPreview(position)
}

async function mountScene(): Promise<void> {
  if (!container.value) return
  const callbacks: SceneCallbacks = {
    onStatus: setStatus,
    onBasemapReady: () => { setStatus('正在加载 Cesium World Terrain…') }
  }
  try {
    viewer = createMapScene(container.value, callbacks)
    loadBingImagery(viewer, callbacks)
    try {
      await loadWorldTerrain(viewer)
    } catch {
      setStatus('地形加载失败，已降级为全球椭球体，等高线不可用。')
    }
    if (!viewer || viewer.isDestroyed()) return
    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((event: { position: Cesium.Cartesian2 }) => onLeftClick(event), Cesium.ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction((event: { endPosition: Cesium.Cartesian2 }) => onMouseMove(event), Cesium.ScreenSpaceEventType.MOUSE_MOVE)
    handler.setInputAction(() => finishDrawing(), Cesium.ScreenSpaceEventType.RIGHT_CLICK)
    handler.setInputAction(() => finishDrawing(), Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
    isLoaded.value = true
    await analyze(EXAMPLE_REGION)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error))
  }
}

watch(depthVisible, () => { if (!busy.value) renderSurface() })
watch(boundaryVisible, () => { updateRegionVisible() })
watch(contourVisible, () => { if (!busy.value) { renderContours(); renderLabels() } })
watch(labelVisible, () => { if (!busy.value) refreshLabels() })

watch(depthPalette, () => { if (!busy.value) { renderSurface(); renderContours() } })
watch(depthOpacity, () => { if (!busy.value) renderSurface() })
watch(contourMode, () => { if (!busy.value) { renderContours(); renderLabels() } })
watch(contourWidth, () => { if (!busy.value) renderContours() })
watch(contourAlpha, () => { if (!busy.value) renderContours() })
watch([labelFont, labelColor, labelBgVisible, labelBgColor], () => { if (!busy.value) refreshLabels() })
watch(labelEvery, () => { if (!busy.value) refreshLabels() })

watch(intervalInput, () => {
  if (!busy.value && hasResult.value) recomputeContours()
})

watch(resolutionDim, () => {
  if (!busy.value && currentRing && hasResult.value) {
    const ring = currentRing
    void analyze(ring)
  }
})

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

onBeforeUnmount(() => {
  analysisRun += 1
  handler?.destroy()
  handler = undefined
  if (viewer && !viewer.isDestroyed()) {
    removePrimitives()
    removeDraft()
    if (regionOutline) viewer.entities.remove(regionOutline)
  }
  destroyScene(viewer)
  viewer = undefined
})

onMounted(() => { void mountScene() })
</script>

<template>
  <div class="pdc-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">多边形深度图与等高线</div>

      <div class="section-title">绘制区域</div>
      <div class="button-row">
        <button class="action-button primary" :disabled="!isLoaded || busy" @click="useExampleRegion">示例区域</button>
        <button class="action-button accent" :disabled="!isLoaded || busy" @click="startDrawing">
          {{ drawing ? '闭合多边形' : '绘制多边形' }}
        </button>
      </div>
      <button v-if="hasResult" class="action-button danger" :disabled="busy" @click="clearResult">清除结果</button>
      <p v-if="drawing" class="result">
        {{ vertexCount === 0 ? '在地图上单击依次采集顶点，右键或双击闭合' : `已采集 ${vertexCount} 个顶点，右键或双击闭合` }}
      </p>

      <template v-if="hasResult">
        <div class="section-title">显示控制</div>
        <label class="switch-row">
          <span>深度图</span>
          <input v-model="depthVisible" type="checkbox" />
        </label>
        <label class="switch-row">
          <span>等高线</span>
          <input v-model="contourVisible" type="checkbox" />
        </label>
        <label class="switch-row">
          <span>等高线标注</span>
          <input v-model="labelVisible" type="checkbox" />
        </label>
        <label class="switch-row">
          <span>范围线</span>
          <input v-model="boundaryVisible" type="checkbox" />
        </label>

        <div class="section-title">深度图设置</div>
        <label class="control-row">
          <span class="row-label">采样网格</span>
          <select v-model.number="resolutionDim" :disabled="busy">
            <option v-for="option in RESOLUTION_OPTIONS" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <label class="control-row">
          <span class="row-label">配色方案</span>
          <select v-model="depthPalette">
            <option v-for="option in PALETTE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <div class="control-row">
          <span class="row-label">透明度</span>
          <input v-model.number="depthOpacity" type="range" min="0.15" max="1" step="0.05" />
          <span class="row-value">{{ depthOpacity.toFixed(2) }}</span>
        </div>

        <div class="section-title">等高线参数</div>
        <label class="control-row">
          <span class="row-label">等高距</span>
          <input v-model.number="intervalInput" type="number" min="0.5" max="500" step="0.5" />
          <span class="row-value">m</span>
        </label>
        <div class="control-row">
          <span class="row-label">线宽</span>
          <input v-model.number="contourWidth" type="range" min="1" max="6" step="1" />
          <span class="row-value">{{ contourWidth }}px</span>
        </div>
        <label class="control-row">
          <span class="row-label">颜色方案</span>
          <select v-model="contourMode">
            <option value="ramp">随深度色带</option>
            <option value="brown">深棕色</option>
            <option value="slate">墨蓝色</option>
            <option value="white">白色</option>
          </select>
        </label>

        <div class="section-title">等高线标注设置</div>
        <div class="control-row">
          <span class="row-label">标注间隔</span>
          <select v-model.number="labelEvery">
            <option v-for="option in LABEL_INTERVAL_OPTIONS" :key="option" :value="option">
              {{ option === 1 ? '每条' : `每 ${option} 条` }}
            </option>
          </select>
        </div>
        <div class="control-row">
          <span class="row-label">字号</span>
          <input v-model.number="labelFont" type="range" min="10" max="26" step="1" />
          <span class="row-value">{{ labelFont }}px</span>
        </div>
        <label class="control-row">
          <span class="row-label">文字颜色</span>
          <input v-model="labelColor" type="color" />
        </label>
        <label class="switch-row">
          <span>标注背景</span>
          <input v-model="labelBgVisible" type="checkbox" />
        </label>
        <label class="control-row" :class="{ disabled: !labelBgVisible }">
          <span class="row-label">背景颜色</span>
          <input v-model="labelBgColor" type="color" />
        </label>

        <div class="section-title">统计</div>
        <p class="stat-line">采样点：{{ sampleCountText }}　高程：{{ heightRangeText }}</p>
        <p class="stat-line">等高线：{{ levelCountText }} 层 / {{ pieceCountText }} 段　等高距 {{ intervalText }}</p>
        <p v-if="statsMessage" class="stat-note">{{ statsMessage }}</p>
      </template>

      <p class="hint">绘制完成后自动按地形采样提取多边形内深度图并生成等高线；等高距/配色/线宽/标注等参数均可实时调整。</p>
    </div>

    <div v-if="busy" class="progress-mask">
      <div class="progress-bar"><i :style="{ width: `${progress}%` }"></i></div>
      <span>{{ busyText }}</span>
    </div>

    <div v-if="legendVisible && hasResult" class="legend">
      <div class="legend-gradient" :style="{ background: depthGradientCss }"></div>
      <span>{{ heightRangeText.split(' ~ ')[0] ?? '' }}</span>
      <span>{{ heightRangeText.split(' ~ ')[1] ?? '' }}</span>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.pdc-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 6px; width: 254px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 26, 44, 0.88); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.panel-title { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
.section-title { margin-top: 8px; margin-bottom: 2px; padding-bottom: 2px; border-bottom: 1px solid rgba(137, 210, 233, 0.16); font-size: 11px; font-weight: 700; color: #7fd0e6; }
.button-row { display: flex; gap: 6px; }
.action-button { flex: 1; min-height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; color: #edfaff; }
.action-button.primary { background: #257f9e; }
.action-button.accent { background: #8a6d1a; color: #fff3d6; }
.action-button.danger { background: #4a5a72; color: #ffd6d6; }
.action-button:disabled { cursor: default; opacity: 0.5; }
.result { margin: 2px 0 0; padding: 5px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; background: rgba(250, 173, 20, 0.18); color: #ffd666; text-align: center; }
.switch-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; color: #c3d8e6; }
.switch-row input, .control-row input[type="color"] { cursor: pointer; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 0; color: #c3d8e6; }
.control-row.disabled { opacity: 0.55; }
.row-label { flex: 0 0 auto; }
.row-value { flex: 0 0 34px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row select, .control-row input[type="number"] { width: 92px; height: 22px; padding: 0 5px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.control-row input[type="color"] { width: 34px; height: 20px; padding: 0; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: transparent; }
.stat-line { margin: 0; font-size: 10px; color: #9fb8d4; line-height: 1.7; }
.stat-note { margin: 0; font-size: 10px; color: #ffd666; line-height: 1.5; }
.hint { margin: 6px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.progress-mask { position: absolute; top: 12px; left: 50%; z-index: 9; display: flex; flex-direction: column; align-items: center; gap: 6px; transform: translateX(-50%); padding: 10px 16px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; background: rgba(8, 21, 40, 0.9); color: #e8f4fa; font-size: 12px; pointer-events: none; min-width: 210px; }
.progress-bar { position: relative; width: 100%; height: 8px; overflow: hidden; border-radius: 4px; background: rgba(137, 210, 233, 0.2); }
.progress-bar i { position: absolute; top: 0; bottom: 0; left: 0; background: #2f80ed; }
.legend { position: absolute; bottom: 14px; left: 12px; z-index: 8; display: flex; align-items: center; gap: 6px; padding: 6px 9px; border: 1px solid rgba(137, 210, 233, 0.25); border-radius: 6px; background: rgba(8, 26, 44, 0.82); color: #bcd7e4; font-size: 10px; }
.legend-gradient { width: 150px; height: 8px; border-radius: 4px; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 420px; padding: 8px 14px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
