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
  ASPECT_DIRECTIONS,
  buildAspectArrowPrimitive,
  buildSlopeSurfaceGeometry,
  computeSlopeField,
  createSampleGrid,
  createSurfaceAppearance,
  estimateArrowCount,
  fillGridStats,
  nodeLonLat,
  paletteGradientCss,
  pointInRing,
  PALETTE_OPTIONS,
  type AspectColorMode,
  type PaletteKey,
  type Ring,
  type SampleGrid,
  type SlopeField
} from './slope-aspect-lib'

const RESOLUTION_OPTIONS = [80, 120, 160, 200, 256]
const ARROW_STRIDE_OPTIONS = [2, 3, 4, 5, 6, 8]

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
const slopePalette = ref<PaletteKey>('terrain')
const slopeCap = ref(30)
const slopeOpacity = ref(0.78)
const slopeVisible = ref(true)
const aspectVisible = ref(true)
const boundaryVisible = ref(true)
const legendVisible = ref(true)

const arrowStride = ref(4)
const arrowLength = ref(1.1)
const arrowWidth = ref(2)
const arrowColorMode = ref<AspectColorMode>('aspect')
const arrowCustomColor = ref('#ffd166')
const arrowAlpha = ref(0.95)
const flatThreshold = ref(1.5)

const sampleCountText = ref('0')
const heightRangeText = ref('—')
const slopeAvgText = ref('—')
const slopeMaxText = ref('—')
const aspectText = ref('—')
const flatCellsText = ref('0')
const arrowCountText = ref('0')
const slopeGradientCss = computed(() => paletteGradientCss(slopePalette.value))

let viewer: Cesium.Viewer | undefined
let handler: Cesium.ScreenSpaceEventHandler | undefined
let analysisRun = 0
let slopePrimitive: Cesium.Primitive | undefined
let arrowPrimitive: Cesium.Primitive | undefined
let grid: SampleGrid | undefined
let field: SlopeField | undefined
let currentRing: Ring | undefined
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
  removePrimitive(slopePrimitive)
  slopePrimitive = undefined
  removePrimitive(arrowPrimitive)
  arrowPrimitive = undefined
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
  field = undefined
  currentRing = undefined
  removePrimitives()
  if (viewer && !viewer.isDestroyed() && regionOutline) {
    viewer.entities.remove(regionOutline)
    regionOutline = undefined
  }
  hasResult.value = false
  sampleCountText.value = '0'
  heightRangeText.value = '—'
  slopeAvgText.value = '—'
  slopeMaxText.value = '—'
  aspectText.value = '—'
  flatCellsText.value = '0'
  arrowCountText.value = '0'
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

function renderSlopeSurface(): void {
  if (!viewer || !grid || !field || !currentRing) return
  removePrimitive(slopePrimitive)
  slopePrimitive = undefined
  if (!slopeVisible.value) {
    viewer.scene.requestRender()
    return
  }
  const geometry = buildSlopeSurfaceGeometry(grid, currentRing, field, {
    palette: slopePalette.value,
    opacity: slopeOpacity.value,
    capDeg: slopeCap.value
  })
  slopePrimitive = viewer.scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry }),
      appearance: createSurfaceAppearance(),
      asynchronous: false,
      allowPicking: false
    })
  )
  viewer.scene.requestRender()
}

function renderAspectArrows(): void {
  if (!viewer || !grid || !field || !currentRing) return
  removePrimitive(arrowPrimitive)
  arrowPrimitive = undefined
  if (!aspectVisible.value) {
    arrowCountText.value = '0'
    viewer.scene.requestRender()
    return
  }
  arrowPrimitive = buildAspectArrowPrimitive(grid, currentRing, field, {
    stride: arrowStride.value,
    lengthRatio: arrowLength.value,
    width: arrowWidth.value,
    alpha: arrowAlpha.value,
    flatThresholdDeg: flatThreshold.value,
    colorMode: arrowColorMode.value,
    customColor: arrowCustomColor.value,
    lift: 16
  })
  if (arrowPrimitive) viewer.scene.primitives.add(arrowPrimitive)
  arrowCountText.value = estimateArrowCount(grid, currentRing, arrowStride.value, flatThreshold.value, field).toLocaleString()
  viewer.scene.requestRender()
}

function refreshSlope(): void {
  if (!hasResult.value || busy.value) return
  renderSlopeSurface()
}

function refreshAspectArrows(): void {
  if (!hasResult.value || busy.value) return
  renderAspectArrows()
}

function updateStatsText(): void {
  if (!grid || !field) return
  slopeAvgText.value = `${field.avgSlopeDeg.toFixed(2)}°`
  slopeMaxText.value = `${field.maxSlopeDeg.toFixed(2)}°`
  if (field.dominantIndex >= 0) {
    const direction = ASPECT_DIRECTIONS[field.dominantIndex]
    aspectText.value = `${direction.label} ${direction.code} ${(field.dominantRatio * 100).toFixed(0)}%`
  } else {
    aspectText.value = '平缓为主'
  }
  flatCellsText.value = field.flatCells.toLocaleString()
}

function recomputeFieldStats(): void {
  if (!hasResult.value || busy.value || !grid || !currentRing) return
  field = computeSlopeField(grid, currentRing, flatThreshold.value)
  updateStatsText()
  renderSlopeSurface()
  renderAspectArrows()
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
    setStatus('正在计算坡度与坡向…')
    progress.value = 78
    await yieldFrame()
    if (runId !== analysisRun || viewer.isDestroyed()) return
    if (!Number.isFinite(grid.minInside)) {
      setStatus('未获取到有效地形高度，请确认已加载 Cesium World Terrain 后重试')
      return
    }
    field = computeSlopeField(grid, ring, flatThreshold.value)
    progress.value = 88
    renderSlopeSurface()
    renderAspectArrows()
    updateStatsText()
    sampleCountText.value = grid.insideCount.toLocaleString()
    heightRangeText.value = `${grid.minInside.toFixed(1)} ~ ${grid.maxInside.toFixed(1)} m`
    showRegionOutline(ring)
    hasResult.value = true
    progress.value = 100
    setStatus('坡度图与坡向箭头已生成。可在地图上右键/双击结束绘制；修改参数实时更新。')
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
  setStatus('正在提取多边形内地形并计算坡度与坡向…')
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
      setStatus('地形加载失败，已降级为全球椭球体，坡度坡向不可用。')
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

watch(slopeVisible, () => { if (!busy.value) renderSlopeSurface() })
watch(boundaryVisible, () => { updateRegionVisible() })
watch(aspectVisible, () => { if (!busy.value) renderAspectArrows() })

watch(slopePalette, () => { if (!busy.value) renderSlopeSurface() })
watch(slopeCap, () => { if (!busy.value) renderSlopeSurface() })
watch(slopeOpacity, () => { if (!busy.value) renderSlopeSurface() })
watch([arrowStride, arrowLength, arrowWidth, arrowAlpha, arrowColorMode, arrowCustomColor], () => { if (!busy.value) renderAspectArrows() })
watch(flatThreshold, () => {
  if (!busy.value && hasResult.value) recomputeFieldStats()
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
  <div class="psa-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">空间分析-多边形坡度/坡向</div>

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
          <span>坡度图</span>
          <input v-model="slopeVisible" type="checkbox" />
        </label>
        <label class="switch-row">
          <span>坡向箭头</span>
          <input v-model="aspectVisible" type="checkbox" />
        </label>
        <label class="switch-row">
          <span>范围线</span>
          <input v-model="boundaryVisible" type="checkbox" />
        </label>
        <label class="switch-row">
          <span>图例</span>
          <input v-model="legendVisible" type="checkbox" />
        </label>

        <div class="section-title">坡度图设置</div>
        <label class="control-row">
          <span class="row-label">采样网格</span>
          <select v-model.number="resolutionDim" :disabled="busy">
            <option v-for="option in RESOLUTION_OPTIONS" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <label class="control-row">
          <span class="row-label">配色方案</span>
          <select v-model="slopePalette">
            <option v-for="option in PALETTE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <div class="control-row">
          <span class="row-label">色带上限</span>
          <input v-model.number="slopeCap" type="range" min="5" max="60" step="1" />
          <span class="row-value">{{ slopeCap }}°</span>
        </div>
        <div class="control-row">
          <span class="row-label">透明度</span>
          <input v-model.number="slopeOpacity" type="range" min="0.15" max="1" step="0.05" />
          <span class="row-value">{{ slopeOpacity.toFixed(2) }}</span>
        </div>

        <div class="section-title">坡向箭头设置</div>
        <label class="control-row">
          <span class="row-label">箭头密度</span>
          <select v-model.number="arrowStride">
            <option v-for="option in ARROW_STRIDE_OPTIONS" :key="option" :value="option">
              每 {{ option }} 格
            </option>
          </select>
        </label>
        <div class="control-row">
          <span class="row-label">箭头长度</span>
          <input v-model.number="arrowLength" type="range" min="0.4" max="2.6" step="0.1" />
          <span class="row-value">×{{ arrowLength.toFixed(1) }}</span>
        </div>
        <div class="control-row">
          <span class="row-label">线宽</span>
          <input v-model.number="arrowWidth" type="range" min="1" max="4" step="1" />
          <span class="row-value">{{ arrowWidth }}px</span>
        </div>
        <div class="control-row">
          <span class="row-label">透明度</span>
          <input v-model.number="arrowAlpha" type="range" min="0.2" max="1" step="0.05" />
          <span class="row-value">{{ arrowAlpha.toFixed(2) }}</span>
        </div>
        <label class="control-row">
          <span class="row-label">颜色方案</span>
          <select v-model="arrowColorMode">
            <option value="aspect">8 方向配色</option>
            <option value="custom">自定义颜色</option>
          </select>
        </label>
        <label class="control-row" :class="{ disabled: arrowColorMode !== 'custom' }">
          <span class="row-label">箭头颜色</span>
          <input v-model="arrowCustomColor" type="color" :disabled="arrowColorMode !== 'custom'" />
        </label>
        <div class="control-row">
          <span class="row-label">忽略平缓坡</span>
          <input v-model.number="flatThreshold" type="range" min="0.5" max="8" step="0.5" />
          <span class="row-value">&lt; {{ flatThreshold.toFixed(1) }}°</span>
        </div>

        <div class="section-title">统计</div>
        <p class="stat-line">采样点：{{ sampleCountText }}　高程：{{ heightRangeText }}</p>
        <p class="stat-line">平均坡度：{{ slopeAvgText }}　最大坡度：{{ slopeMaxText }}</p>
        <p class="stat-line">主坡向：{{ aspectText }}　箭头：{{ arrowCountText }}</p>
        <p class="stat-note">忽略平缓格：{{ flatCellsText }}</p>
      </template>

      <p class="hint">绘制完成后自动按地形采样生成坡度图，并以箭头显示坡向（东/南/西/北与东北等 8 个方向）；密度/长度/配色/阈值等均可实时调整。</p>
    </div>

    <div v-if="busy" class="progress-mask">
      <div class="progress-bar"><i :style="{ width: `${progress}%` }"></i></div>
      <span>{{ progress }}%</span>
    </div>

    <div v-if="legendVisible && hasResult" class="legend">
      <template v-if="slopeVisible">
        <div class="legend-gradient" :style="{ background: slopeGradientCss }"></div>
        <span>0°</span>
        <span>{{ slopeCap }}°</span>
      </template>
      <div v-if="aspectVisible && arrowColorMode === 'aspect'" class="legend-chips">
        <span v-for="direction in ASPECT_DIRECTIONS" :key="direction.code" class="chip" :style="{ background: direction.css }" :title="direction.label" />
      </div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.psa-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
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
.row-value { flex: 0 0 44px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row select, .control-row input[type="number"] { width: 92px; height: 22px; padding: 0 5px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.control-row input[type="color"] { width: 34px; height: 20px; padding: 0; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: transparent; }
.stat-line { margin: 0; font-size: 10px; color: #9fb8d4; line-height: 1.7; }
.stat-note { margin: 0; font-size: 10px; color: #ffd666; line-height: 1.5; }
.hint { margin: 6px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.progress-mask { position: absolute; top: 12px; left: 50%; z-index: 9; display: flex; flex-direction: column; align-items: center; gap: 6px; transform: translateX(-50%); padding: 10px 16px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; background: rgba(8, 21, 40, 0.9); color: #e8f4fa; font-size: 12px; pointer-events: none; min-width: 210px; }
.progress-bar { position: relative; width: 100%; height: 8px; overflow: hidden; border-radius: 4px; background: rgba(137, 210, 233, 0.2); }
.progress-bar i { position: absolute; top: 0; bottom: 0; left: 0; background: #2f80ed; }
.legend { position: absolute; bottom: 14px; left: 12px; z-index: 8; display: flex; align-items: center; gap: 8px; padding: 6px 9px; border: 1px solid rgba(137, 210, 233, 0.25); border-radius: 6px; background: rgba(8, 26, 44, 0.82); color: #bcd7e4; font-size: 10px; }
.legend-gradient { width: 130px; height: 8px; border-radius: 4px; }
.legend-chips { display: flex; gap: 3px; align-items: center; padding-left: 2px; border-left: 1px solid rgba(137, 210, 233, 0.22); }
.chip { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 420px; padding: 8px 14px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
