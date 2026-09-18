<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as Cesium from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib/pick'
import {
  computeEarthworks,
  computeRegionStats,
  createSampleGrid,
  fillGridStats,
  nodeLonLat,
  pointInRing,
  type RegionStats,
  type Ring,
  type SampleGrid
} from './terrain-flatten-lib'
import {
  createFlattenTerrainProvider,
  invalidateTilesIntersectingRing,
  readFlattenTerrainStats,
  resetFlattenTerrainStats,
  type FlattenTerrainController,
  type FlattenTerrainStats
} from './terrain-flatten-provider'

const SAMPLE_DIMENSION = 140

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
const worldTerrainOk = ref(false)
const busy = ref(false)
const drawing = ref(false)
const hasResult = ref(false)
const flattenActive = ref(false)
const vertexCount = ref(0)
const progress = ref(0)

const heightMode = ref<'max' | 'custom'>('max')
const customHeight = ref(400)
const liftOffset = ref(2)

const areaText = ref('—')
const sampleCountText = ref('0')
const heightRangeText = ref('—')
const avgHeightText = ref('—')
const flattenHeightText = ref('—')
const fillVolumeText = ref('—')
const cutVolumeText = ref('—')
const fillDepthText = ref('—')
const cutDepthText = ref('—')

let viewer: Cesium.Viewer | undefined
let handler: Cesium.ScreenSpaceEventHandler | undefined
let baseTerrainProvider: Cesium.TerrainProvider | undefined
let terrainFlatten: FlattenTerrainController | undefined
let lastAppliedRing: Ring | undefined
let analysisRun = 0
let applyRun = 0
let applyDebounceId: number | undefined
let grid: SampleGrid | undefined
let stats: RegionStats | undefined
let currentRing: Ring | undefined
let regionOutline: Cesium.Entity | undefined
let draftEntity: Cesium.Entity | undefined
let vertexEntities: Cesium.Entity[] = []
let pickedVertices: Cesium.Cartesian3[] = []

const targetHeight = computed(() => {
  if (!stats) return 0
  return heightMode.value === 'max' ? stats.maxHeight + liftOffset.value : customHeight.value
})

function setStatus(message: string): void {
  statusMessage.value = message
}

function ringToCartesians(ring: Ring, height = 0): Cesium.Cartesian3[] {
  const positions: Cesium.Cartesian3[] = []
  for (const point of ring) positions.push(Cesium.Cartesian3.fromDegrees(point.lon, point.lat, height))
  return positions
}

function removeDraft(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (draftEntity) viewer.entities.remove(draftEntity)
  draftEntity = undefined
  for (const entity of vertexEntities) viewer.entities.remove(entity)
  vertexEntities = []
}

function showRegionOutline(): void {
  if (!viewer || viewer.isDestroyed() || !currentRing) return
  const positions = ringToCartesians(currentRing, 0)
  if (!regionOutline) {
    regionOutline = viewer.entities.add({
      polyline: {
        positions,
        width: 3,
        material: Cesium.Color.fromCssColorString('#ffcf5c'),
        clampToGround: true
      }
    }) as unknown as Cesium.Entity
  } else if (regionOutline.polyline) {
    regionOutline.polyline.positions = new Cesium.ConstantProperty(positions)
    regionOutline.polyline.show = new Cesium.ConstantProperty(true)
  }
}

function removeRegionOutline(): void {
  if (viewer && !viewer.isDestroyed() && regionOutline) {
    viewer.entities.remove(regionOutline)
  }
  regionOutline = undefined
}

function restoreOriginalTerrain(): void {
  if (!viewer || viewer.isDestroyed() || !baseTerrainProvider || !terrainFlatten) return
  applyRun += 1
  if (terrainFlatten.getOptions()) {
    terrainFlatten.setOptions(null)
    if (lastAppliedRing) {
      invalidateTilesIntersectingRing(viewer.scene, lastAppliedRing)
    }
  }
  flattenActive.value = false
  resetFlattenTerrainStats()
}

function clearAnalysis(): void {
  analysisRun += 1
  applyRun += 1
  if (applyDebounceId !== undefined) {
    window.clearTimeout(applyDebounceId)
    applyDebounceId = undefined
  }
  restoreOriginalTerrain()
  removeRegionOutline()
  grid = undefined
  stats = undefined
  currentRing = undefined
  hasResult.value = false
  areaText.value = '—'
  sampleCountText.value = '0'
  heightRangeText.value = '—'
  avgHeightText.value = '—'
  flattenHeightText.value = '—'
  fillVolumeText.value = '—'
  cutVolumeText.value = '—'
  fillDepthText.value = '—'
  cutDepthText.value = '—'
  progress.value = 0
}

function resetDrawing(): void {
  drawing.value = false
  pickedVertices = []
  vertexCount.value = 0
  removeDraft()
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
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
    setStatus(`正在采样多边形区域原始地形高度…${Math.round((startRow / totalRows) * 100)}%`)
    progress.value = Math.round((startRow / totalRows) * 55)
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
    progress.value = Math.min(60, Math.round((endRow / totalRows) * 55))
    await yieldFrame()
  }
}

function formatVolume(m3: number): string {
  if (!Number.isFinite(m3) || m3 <= 0) return '—'
  if (m3 >= 10000) return `${(m3 / 10000).toFixed(2)} 万 m³`
  return `${Math.round(m3).toLocaleString()} m³`
}

function updateStatsText(): void {
  if (!stats || !currentRing || !grid) return
  const target = targetHeight.value
  const modeText = heightMode.value === 'max'
    ? `最高点 + ${liftOffset.value.toFixed(0)} m`
    : '指定高度'
  flattenHeightText.value = `${target.toFixed(1)} m`
  areaText.value = `${stats.areaKm2.toFixed(2)} km²`
  sampleCountText.value = stats.sampleCount.toLocaleString()
  heightRangeText.value = `${stats.minHeight.toFixed(1)} ~ ${stats.maxHeight.toFixed(1)} m`
  avgHeightText.value = `${stats.avgHeight.toFixed(1)} m`

  const earth = computeEarthworks(grid, currentRing, target)
  fillVolumeText.value = formatVolume(earth.fillM3)
  cutVolumeText.value = formatVolume(earth.cutM3)
  const fillAvg = earth.fillAreaM2 > 0 ? earth.fillM3 / earth.fillAreaM2 : 0
  const cutAvg = earth.cutAreaM2 > 0 ? earth.cutM3 / earth.cutAreaM2 : 0
  if (earth.fillCells > 0) {
    fillDepthText.value = `平均 ${fillAvg.toFixed(1)} m，最大 ${earth.fillMaxDepthM.toFixed(1)} m`
  } else {
    fillDepthText.value = '—'
  }
  if (earth.cutCells > 0) {
    cutDepthText.value = `平均 ${cutAvg.toFixed(1)} m，最大 ${earth.cutMaxDepthM.toFixed(1)} m`
  } else {
    cutDepthText.value = '—'
  }

  if (flattenActive.value && terrainFlatten) {
    const applied = readFlattenTerrainStats()
    setStatus(`地形压平已生效（${modeText}，平面 ${flattenHeightText.value}）：真实改写 ${applied.touchedTiles} 块地形瓦片、共 ${applied.flattenedVertices} 个地形顶点到同一高度。拖动缩放可查看铲平后的边缘切面。`)
  } else {
    setStatus('已完成原始地形采样统计。确认整平参数后点击「应用地形压平」。')
  }
}

async function applyFlatten(): Promise<void> {
  if (!viewer || viewer.isDestroyed() || !baseTerrainProvider || !terrainFlatten || !currentRing || !stats) return
  if (!worldTerrainOk.value) {
    setStatus('未加载 Cesium World Terrain，真实地形压平不可用。')
    return
  }
  const run = ++applyRun
  busy.value = true
  const ring = currentRing
  const target = targetHeight.value
  try {
    resetFlattenTerrainStats()
    lastAppliedRing = ring
    terrainFlatten.setOptions({ ringDeg: ring, targetHeight: target })
    flattenActive.value = true
    invalidateTilesIntersectingRing(viewer.scene, ring)
    setStatus(`正在应用真实地形压平：把多边形内地形改写至 ${target.toFixed(1)} m（等待区域地形瓦片刷新）…`)
    const deadline = Date.now() + 50000
    let waitsSinceInvalidate = 0
    while (Date.now() < deadline) {
      if (run !== applyRun || viewer.isDestroyed()) return
      const applied = readFlattenTerrainStats()
      if (applied.touchedTiles > 0) {
        updateStatsText()
        return
      }
      if (applied.seenTiles > 0) {
        setStatus(`正在应用真实地形压平：已检查 ${applied.seenTiles} 块地形瓦片，等待区域顶点被改写…`)
      }
      waitsSinceInvalidate += 1
      if (waitsSinceInvalidate >= 4 && Date.now() < deadline) {
        invalidateTilesIntersectingRing(viewer.scene, ring)
        waitsSinceInvalidate = 0
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1500))
    }
    const applied = readFlattenTerrainStats()
    if (run === applyRun) {
      updateStatsText()
      if (applied.touchedTiles === 0) {
        setStatus('等待区域地形瓦片超时：区域可能不在当前视野内，请移动视角到多边形后再点击「应用地形压平」。')
      }
    }
  } finally {
    if (run === applyRun) busy.value = false
  }
}

async function analyze(ring: Ring): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  clearAnalysis()
  const runId = ++analysisRun
  busy.value = true
  progress.value = 2
  grid = createSampleGrid(ring, SAMPLE_DIMENSION)
  currentRing = ring.map((point) => ({ ...point }))
  try {
    setStatus('正在准备原始地形采样网格…')
    await yieldFrame()
    await sampleGridHeights(runId)
    if (runId !== analysisRun || viewer.isDestroyed()) return
    fillGridStats(grid, ring)
    if (grid.insideCount < 10) {
      setStatus('采样范围内有效点数过少，请绘制更大范围后重试')
      hasResult.value = false
      return
    }
    setStatus('正在计算压平平面与土方统计…')
    progress.value = 72
    await yieldFrame()
    if (runId !== analysisRun || viewer.isDestroyed()) return
    if (!Number.isFinite(grid.minInside)) {
      setStatus('未获取到有效地形高度，请确认已加载 Cesium World Terrain 后重试')
      return
    }
    stats = computeRegionStats(grid, ring)
    progress.value = 84
    showRegionOutline()
    hasResult.value = true
    progress.value = 100
    updateStatsText()
    flyToRing(ring)
    if (worldTerrainOk.value) {
      await applyFlatten()
    } else {
      setStatus('未加载真实地形，已完成统计但无法执行压平。')
    }
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
    destination: Cesium.Cartesian3.fromDegrees((west + east) / 2, (south + north) / 2, Math.max(1600, maxSpan * 2.1)),
    duration: 1.0
  })
}

function useExampleRegion(): void {
  if (!isLoaded.value || busy.value || !viewer) return
  resetDrawing()
  removeDraft()
  setStatus('正在加载示例区域并执行真实地形压平…')
  void analyze(EXAMPLE_REGION)
}

function clearResult(): void {
  if (busy.value) return
  clearAnalysis()
  resetDrawing()
  setStatus('已恢复原始地形并清除结果，可点击「绘制多边形」重新绘制。')
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
  setStatus('正在采样多边形内原始地形并执行真实压平…')
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
      baseTerrainProvider = await Cesium.createWorldTerrainAsync({
        requestVertexNormals: false,
        requestWaterMask: false
      })
      terrainFlatten = createFlattenTerrainProvider(baseTerrainProvider)
      viewer.terrainProvider = terrainFlatten.terrainProvider
      worldTerrainOk.value = true
    } catch {
      baseTerrainProvider = new Cesium.EllipsoidTerrainProvider()
      terrainFlatten = undefined
      viewer.terrainProvider = baseTerrainProvider
      worldTerrainOk.value = false
      setStatus('地形加载失败，已降级为全球椭球体，压平不可用。')
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

function scheduleReapply(): void {
  if (applyDebounceId !== undefined) {
    window.clearTimeout(applyDebounceId)
    applyDebounceId = undefined
  }
  applyDebounceId = window.setTimeout(() => {
    applyDebounceId = undefined
    if (!hasResult.value || busy.value || !viewer || viewer.isDestroyed()) return
    void applyFlatten()
  }, 600)
}

watch([heightMode, customHeight, liftOffset], () => {
  if (hasResult.value && !busy.value) scheduleReapply()
})

onBeforeUnmount(() => {
  analysisRun += 1
  applyRun += 1
  if (applyDebounceId !== undefined) {
    window.clearTimeout(applyDebounceId)
    applyDebounceId = undefined
  }
  handler?.destroy()
  handler = undefined
  if (viewer && !viewer.isDestroyed()) {
    removeDraft()
    removeRegionOutline()
  }
  destroyScene(viewer)
  viewer = undefined
  baseTerrainProvider = undefined
  terrainFlatten = undefined
  lastAppliedRing = undefined
})

onMounted(() => { void mountScene() })
</script>

<template>
  <div class="ptf-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">空间分析-多边形地形压平</div>

      <div class="section-title">绘制区域</div>
      <div class="button-row">
        <button class="action-button primary" :disabled="!isLoaded || busy" @click="useExampleRegion">示例区域</button>
        <button class="action-button accent" :disabled="!isLoaded || busy" @click="startDrawing">
          {{ drawing ? '闭合多边形' : '绘制多边形' }}
        </button>
      </div>
      <button v-if="hasResult" class="action-button danger" :disabled="busy" @click="clearResult">恢复原状并清除</button>
      <p v-if="drawing" class="result">
        {{ vertexCount === 0 ? '在地图上单击依次采集顶点，右键或双击闭合' : `已采集 ${vertexCount} 个顶点，右键或双击闭合` }}
      </p>

      <template v-if="hasResult">
        <div class="section-title">整平参数</div>
        <label class="control-row">
          <span class="row-label">整平基准</span>
          <select v-model="heightMode">
            <option value="max">整平至区域最高点</option>
            <option value="custom">指定整平高度</option>
          </select>
        </label>
        <label class="control-row" :class="{ disabled: heightMode !== 'max' }">
          <span class="row-label">抬升</span>
          <input v-model.number="liftOffset" type="range" min="-20" max="150" step="1" :disabled="heightMode !== 'max'" />
          <span class="row-value">{{ liftOffset >= 0 ? '+' : '' }}{{ liftOffset }}m</span>
        </label>
        <label class="control-row" :class="{ disabled: heightMode !== 'custom' }">
          <span class="row-label">平面高度</span>
          <input v-model.number="customHeight" type="number" min="-200" max="5000" step="1" :disabled="heightMode !== 'custom'" />
          <span class="row-value">m</span>
        </label>
        <div v-if="flattenActive" class="button-row" style="margin-top: 4px">
          <button class="action-button accent" :disabled="busy" @click="applyFlatten">重新应用压平</button>
        </div>

        <div class="section-title">统计</div>
        <p class="stat-line">区域面积：{{ areaText }}　采样点：{{ sampleCountText }}</p>
        <p class="stat-line">原始高程：{{ heightRangeText }}　平均 {{ avgHeightText }}</p>
        <p class="stat-line">整平面：{{ flattenHeightText }}</p>
        <p class="stat-line">填方量：{{ fillVolumeText }}　挖方量：{{ cutVolumeText }}</p>
        <p class="stat-line">填方深度：{{ fillDepthText }}</p>
        <p v-if="cutVolumeText !== '—'" class="stat-line">挖方深度：{{ cutDepthText }}</p>
      </template>

      <p class="hint">绘制多边形后将把多边形内 Cesium 真实地形数据顶点改写为同一整平高度（生成真正铲平的地形与边缘切面），默认整平至区域最高点，可调整抬升或指定高度后「重新应用压平」；支持填挖方量统计。</p>
    </div>

    <div v-if="busy" class="progress-mask">
      <div class="progress-bar"><i :style="{ width: `${progress}%` }"></i></div>
      <span>{{ progress > 0 && progress < 70 ? `${progress}%` : '处理中…' }}</span>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.ptf-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
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
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 0; color: #c3d8e6; }
.control-row.disabled { opacity: 0.55; }
.row-label { flex: 0 0 auto; }
.row-value { flex: 0 0 52px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row select, .control-row input[type="number"] { width: 108px; height: 22px; padding: 0 5px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.stat-line { margin: 0; font-size: 10px; color: #9fb8d4; line-height: 1.7; }
.hint { margin: 6px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.progress-mask { position: absolute; top: 12px; left: 50%; z-index: 9; display: flex; flex-direction: column; align-items: center; gap: 6px; transform: translateX(-50%); padding: 10px 16px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; background: rgba(8, 21, 40, 0.9); color: #e8f4fa; font-size: 12px; pointer-events: none; min-width: 210px; }
.progress-bar { position: relative; width: 100%; height: 8px; overflow: hidden; border-radius: 4px; background: rgba(137, 210, 233, 0.2); }
.progress-bar i { position: absolute; top: 0; bottom: 0; left: 0; background: #2f80ed; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 460px; padding: 8px 14px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
