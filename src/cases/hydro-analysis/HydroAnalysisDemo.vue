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
import { paletteGradientCss } from '../polygon-depth-contour/depth-contour-lib'
import {
  buildHydroGrid,
  cellCenter,
  cellIndexOf,
  computeAccumulation,
  computeD8Direction,
  computeStreamLinks,
  computeWatershed,
  fillDepressions,
  lonLatToCell,
  snapPourPoint,
  vectorizeLinksContinuous,
  type AccResult,
  type DirResult,
  type FillResult,
  type HydBounds,
  type HydGrid,
  type LinkResult,
  type VectorReach,
  type WatershedResult
} from './hydro-lib'
import {
  accGradientCss,
  buildCornerHeights,
  buildFlowArrowsPrimitive,
  buildRasterSurfacePrimitive,
  buildReachPrimitive,
  raiseGradientCss,
  surfaceHeightAt,
  DIR_COLORS,
  type ReachStyle
} from './hydro-render'

const RESOLUTION_OPTIONS = [90, 120, 160, 200]
const ARROW_STRIDE_OPTIONS = [2, 3, 4, 5, 6]
const REACH_WIDTH_OPTIONS = [1, 2, 3, 4, 5]
const POUR_COLORS = ['#2ad4a0', '#4f9dff', '#ffb74d', '#e16bf0', '#ff5d7a', '#7ef0e0']

const EXAMPLE_BOUNDS: HydBounds = { west: 108.94, east: 109.04, south: 34.02, north: 34.1 }

const STEPS = [
  { key: 1, label: '① 采样 DEM 高程' },
  { key: 2, label: '② 洼地填平' },
  { key: 3, label: '③ 计算 D8 流向' },
  { key: 4, label: '④ 汇流累积量' },
  { key: 5, label: '⑤ 提取栅格河网' },
  { key: 6, label: '⑥ 生成矢量河网' },
  { key: 7, label: '⑦ 拾取倾泻点' }
] as const

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图与 Cesium World Terrain…')
const isLoaded = ref(false)
const busy = ref(false)
const drawingRect = ref(false)
const pickingPour = ref(false)
const rectLocked = ref(false)
const progress = ref(0)
const stage = ref(0)

const resolutionDim = ref(160)
const baseSource = ref<'dem' | 'fill' | 'acc'>('dem')
const fillVisible = ref(true)
const dirVisible = ref(true)
const streamVisible = ref(true)
const reachVisible = ref(true)
const pourVisible = ref(true)
const boundaryVisible = ref(true)
const legendVisible = ref(true)

const arrowStride = ref(4)
const arrowAlpha = ref(0.9)
const riverThreshold = ref(10)
const reachWidth = ref(2)
const reachAlpha = ref(0.95)
const reachColor = ref('#35e0d0')
const baseOpacity = ref(0.85)
const fillOpacity = ref(0.6)
const accOpacity = ref(0.82)

const gridInfoText = ref('—')
const demRangeText = ref('—')
const fillStatsText = ref('—')
const dirStatsText = ref('—')
const accStatsText = ref('—')
const linkStatsText = ref('—')
const reachStatsText = ref('—')
const wsStatsText = ref('—')

const demGradientCss = computed(() => paletteGradientCss('terrain'))
const accCss = computed(() => accGradientCss())
const raiseCss = computed(() => raiseGradientCss())
const stageMax = computed(() => STEPS[STEPS.length - 1].key)
const regionLabel = computed(() => {
  if (!regionBounds.value) return '未选择'
  return `${regionBounds.value.west.toFixed(4)} ~ ${regionBounds.value.east.toFixed(4)}°E`
})

let viewer: Cesium.Viewer | undefined
let handler: Cesium.ScreenSpaceEventHandler | undefined
let analysisRun = 0
let hydGrid: HydGrid | undefined
let cornerH: Float32Array | undefined
let fillResult: FillResult | undefined
let dirResult: DirResult | undefined
let accResult: AccResult | undefined
let linkResult: LinkResult | undefined
let reaches: VectorReach[] = []
const regionBounds = ref<HydBounds | undefined>()

let regionRectEntity: Cesium.Entity | undefined
let draftEntity: Cesium.Entity | undefined
let pickMarkerEntity: Cesium.Entity | undefined
let rectStart: { lon: number; lat: number } | undefined

const demPrim = ref<Cesium.Primitive | undefined>()
const fillPrim = ref<Cesium.Primitive | undefined>()
const accPrim = ref<Cesium.Primitive | undefined>()
const raisePrim = ref<Cesium.Primitive | undefined>()
const arrowPrim = ref<Cesium.Primitive | undefined>()
const streamPrim = ref<Cesium.Primitive | undefined>()
const reachPrim = ref<Cesium.Primitive | undefined>()

type PourLayer = {
  id: number
  color: string
  surf: Cesium.Primitive
  polygonEntity: Cesium.Entity
  markerEntity: Cesium.Entity
}
const pourLayers: PourLayer[] = []
let pourCount = 0
const pourLayerCount = ref(0)

function setStatus(message: string): void {
  statusMessage.value = message
}

function removePrimitive(primitive: Cesium.Primitive | undefined): void {
  if (!viewer || !primitive || viewer.isDestroyed()) return
  viewer.scene.primitives.remove(primitive)
}

function removeLayerPrims(): void {
  removePrimitive(demPrim.value)
  demPrim.value = undefined
  removePrimitive(fillPrim.value)
  fillPrim.value = undefined
  removePrimitive(accPrim.value)
  accPrim.value = undefined
  removePrimitive(raisePrim.value)
  raisePrim.value = undefined
  removePrimitive(arrowPrim.value)
  arrowPrim.value = undefined
  removePrimitive(streamPrim.value)
  streamPrim.value = undefined
  removePrimitive(reachPrim.value)
  reachPrim.value = undefined
}

function removePourLayers(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const layer of pourLayers) {
    viewer.scene.primitives.remove(layer.surf)
    viewer.entities.remove(layer.polygonEntity)
    viewer.entities.remove(layer.markerEntity)
  }
  pourLayers.length = 0
  pourCount = 0
  pourLayerCount.value = 0
  pickingPour.value = false
  wsStatsText.value = '—'
  if (pickMarkerEntity) {
    viewer.entities.remove(pickMarkerEntity)
    pickMarkerEntity = undefined
  }
}

function regionRing(bounds: HydBounds): { lon: number; lat: number }[] {
  return [
    { lon: bounds.west, lat: bounds.north },
    { lon: bounds.east, lat: bounds.north },
    { lon: bounds.east, lat: bounds.south },
    { lon: bounds.west, lat: bounds.south }
  ]
}

function ringToCartesians(points: { lon: number; lat: number }[]): Cesium.Cartesian3[] {
  return points.map((point) => Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 0))
}

function showRegionRect(bounds: HydBounds): void {
  if (!viewer || viewer.isDestroyed()) return
  const ring = regionRing(bounds)
  const color = Cesium.Color.fromCssColorString('#ffcf5c')
  if (!regionRectEntity) {
    regionRectEntity = viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(ringToCartesians(ring)),
        material: color.withAlpha(0.08),
        outline: true,
        outlineColor: color.withAlpha(0.9),
        outlineWidth: 2,
        perPositionHeight: true
      }
    }) as unknown as Cesium.Entity
  } else {
    const polygon = regionRectEntity.polygon
    if (polygon) {
      polygon.hierarchy = new Cesium.ConstantProperty(new Cesium.PolygonHierarchy(ringToCartesians(ring)))
      polygon.show = new Cesium.ConstantProperty(true)
    }
  }
  if (regionRectEntity?.polygon) regionRectEntity.polygon.show = new Cesium.ConstantProperty(boundaryVisible.value)
}

function clearLayers(): void {
  analysisRun += 1
  hydGrid = undefined
  cornerH = undefined
  fillResult = undefined
  dirResult = undefined
  accResult = undefined
  linkResult = undefined
  reaches = []
  stage.value = 0
  regionBounds.value = undefined
  rectStart = undefined
  drawingRect.value = false
  pickingPour.value = false
  removeLayerPrims()
  removePourLayers()
  if (regionRectEntity && viewer && !viewer.isDestroyed()) {
    viewer.entities.remove(regionRectEntity)
    regionRectEntity = undefined
  }
  gridInfoText.value = '—'
  demRangeText.value = '—'
  fillStatsText.value = '—'
  dirStatsText.value = '—'
  accStatsText.value = '—'
  linkStatsText.value = '—'
  reachStatsText.value = '—'
  progress.value = 0
}

function resetPickingFlags(): void {
  pickingPour.value = false
  drawingRect.value = false
  rectStart = undefined
  if (draftEntity && viewer && !viewer.isDestroyed()) {
    viewer.entities.remove(draftEntity)
    draftEntity = undefined
  }
  if (pickMarkerEntity && viewer && !viewer.isDestroyed()) {
    viewer.entities.remove(pickMarkerEntity)
    pickMarkerEntity = undefined
  }
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function sampleDem(runId: number, grid: HydGrid): Promise<boolean> {
  if (!viewer || viewer.isDestroyed()) return false
  const totalRows = grid.rows
  const batchRows = Math.max(1, Math.min(totalRows, Math.floor(6000 / grid.cols)))
  for (let startRow = 0; startRow < totalRows; startRow += batchRows) {
    if (runId !== analysisRun || viewer.isDestroyed()) return false
    const endRow = Math.min(totalRows, startRow + batchRows)
    const samples: Cesium.Cartographic[] = []
    for (let row = startRow; row < endRow; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const point = cellCenter(grid, row, col)
        samples.push(Cesium.Cartographic.fromDegrees(point.lon, point.lat))
      }
    }
    setStatus(`正在采样区域地形高程…${Math.round((startRow / totalRows) * 100)}%`)
    progress.value = Math.round((startRow / totalRows) * 80)
    await yieldFrame()
    try {
      const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, samples)
      if (runId !== analysisRun || viewer.isDestroyed()) return false
      let index = 0
      for (let row = startRow; row < endRow; row += 1) {
        for (let col = 0; col < grid.cols; col += 1) {
          const height = sampled[index]?.height
          grid.dem[row * grid.cols + col] = Number.isFinite(height) ? (height as number) : 0
          index += 1
        }
      }
    } catch {
      if (runId !== analysisRun || viewer.isDestroyed()) return false
      for (let row = startRow; row < endRow; row += 1) {
        for (let col = 0; col < grid.cols; col += 1) {
          grid.dem[row * grid.cols + col] = 0
        }
      }
    }
    progress.value = Math.min(80, Math.round((endRow / totalRows) * 80))
    await yieldFrame()
  }
  return true
}

function syncComputeThrough(target: number): void {
  if (!hydGrid) return
  const grid = hydGrid
  if (target >= 2 && !fillResult) {
    fillResult = fillDepressions(grid)
  }
  if (target >= 3 && fillResult && !dirResult) {
    dirResult = computeD8Direction(grid, fillResult.filled)
  }
  if (target >= 4 && dirResult && !accResult) {
    accResult = computeAccumulation(grid, dirResult.dir)
  }
  if (target >= 5 && accResult && dirResult && !linkResult) {
    refreshLinks()
  }
}

function refreshLinks(): void {
  if (!hydGrid || !accResult || !dirResult) return
  linkResult = computeStreamLinks(hydGrid, accResult.acc, riverThreshold.value, dirResult.dir)
  reaches = vectorizeLinksContinuous(hydGrid, linkResult.links, {
    dir: dirResult.dir,
    acc: accResult.acc,
    linkOf: linkResult.linkOf,
    streamOf: linkResult.streamOf
  })
}

function buildDemLayer(): void {
  if (!viewer || !hydGrid || !cornerH || viewer.isDestroyed()) return
  const grid = hydGrid
  removePrimitive(demPrim.value)
  demPrim.value = buildRasterSurfacePrimitive(grid, cornerH, grid.dem, {
    mode: 'elevation',
    opacity: baseOpacity.value,
    min: grid.demMin,
    max: grid.demMax
  })
  if (demPrim.value) viewer.scene.primitives.add(demPrim.value)
  updateBaseVisibility()
}

function buildRaiseLayer(): void {
  if (!viewer || !hydGrid || !cornerH || !fillResult || viewer.isDestroyed()) return
  const raiseValues = new Float32Array(hydGrid.dem.length)
  for (let i = 0; i < raiseValues.length; i += 1) {
    raiseValues[i] = fillResult.filled[i] - hydGrid.dem[i]
  }
  removePrimitive(raisePrim.value)
  raisePrim.value = buildRasterSurfacePrimitive(hydGrid, cornerH, raiseValues, {
    mode: 'raise',
    opacity: fillOpacity.value,
    min: 0,
    max: Math.max(1, fillResult.maxRaise),
    zeroAlpha: true
  })
  if (raisePrim.value) {
    viewer.scene.primitives.add(raisePrim.value)
    raisePrim.value.show = fillVisible.value
  }
}

function buildFillLayer(): void {
  if (!viewer || !hydGrid || !cornerH || !fillResult || viewer.isDestroyed()) return
  removePrimitive(fillPrim.value)
  fillPrim.value = buildRasterSurfacePrimitive(hydGrid, cornerH, fillResult.filled, {
    mode: 'elevation',
    opacity: baseOpacity.value,
    min: hydGrid.demMin,
    max: hydGrid.demMax
  })
  if (fillPrim.value) viewer.scene.primitives.add(fillPrim.value)
  updateBaseVisibility()
}

function buildAccLayer(): void {
  if (!viewer || !hydGrid || !cornerH || !accResult || viewer.isDestroyed()) return
  const accF = new Float32Array(accResult.acc.length)
  for (let i = 0; i < accF.length; i += 1) accF[i] = accResult.acc[i]
  removePrimitive(accPrim.value)
  accPrim.value = buildRasterSurfacePrimitive(hydGrid, cornerH, accF, {
    mode: 'acc',
    opacity: accOpacity.value,
    max: accResult.maxAcc
  })
  if (accPrim.value) viewer.scene.primitives.add(accPrim.value)
  updateBaseVisibility()
}

function buildArrowLayer(): void {
  if (!viewer || !hydGrid || !cornerH || !dirResult || viewer.isDestroyed()) return
  removePrimitive(arrowPrim.value)
  arrowPrim.value = buildFlowArrowsPrimitive(hydGrid, cornerH, dirResult.dir, {
    stride: arrowStride.value,
    alpha: arrowAlpha.value
  })
  if (arrowPrim.value) {
    viewer.scene.primitives.add(arrowPrim.value)
    arrowPrim.value.show = dirVisible.value
  }
}

function buildStreamLayer(): void {
  if (!viewer || !hydGrid || !cornerH || !linkResult || viewer.isDestroyed()) return
  const streamF = new Float32Array(linkResult.streamOf.length)
  for (let i = 0; i < streamF.length; i += 1) streamF[i] = linkResult.streamOf[i] ? 1 : 0
  removePrimitive(streamPrim.value)
  streamPrim.value = buildRasterSurfacePrimitive(hydGrid, cornerH, streamF, {
    mode: 'mask',
    opacity: 0.9,
    fill: [90, 235, 170],
    zeroAlpha: true
  })
  if (streamPrim.value) {
    viewer.scene.primitives.add(streamPrim.value)
    streamPrim.value.show = streamVisible.value
  }
}

function buildReachLayer(): void {
  if (!viewer || !hydGrid || !cornerH || !linkResult || viewer.isDestroyed()) return
  removePrimitive(reachPrim.value)
  const style: ReachStyle = {
    width: reachWidth.value,
    alpha: reachAlpha.value,
    color: reachColor.value,
    lift: 6
  }
  reachPrim.value = buildReachPrimitive(hydGrid, cornerH, linkResult.links, style)
  if (reachPrim.value) {
    viewer.scene.primitives.add(reachPrim.value)
    reachPrim.value.show = reachVisible.value
  }
}

function updateBaseVisibility(): void {
  const demShow = baseSource.value === 'dem' && !!demPrim.value
  const fillShow = baseSource.value === 'fill' && !!fillPrim.value
  const accShow = baseSource.value === 'acc' && !!accPrim.value
  if (demPrim.value) demPrim.value.show = demShow
  if (fillPrim.value) fillPrim.value.show = fillShow
  if (accPrim.value) accPrim.value.show = accShow
  if (viewer) viewer.scene.requestRender()
}

function applyStageRendering(): void {
  if (!viewer || viewer.isDestroyed()) return
  updateBaseVisibility()
  if (raisePrim.value) raisePrim.value.show = fillVisible.value
  if (arrowPrim.value) arrowPrim.value.show = dirVisible.value
  if (streamPrim.value) streamPrim.value.show = streamVisible.value
  if (reachPrim.value) reachPrim.value.show = reachVisible.value
  for (const layer of pourLayers) {
    layer.surf.show = pourVisible.value
    layer.polygonEntity.show = pourVisible.value
    layer.markerEntity.show = pourVisible.value
  }
  if (regionRectEntity?.polygon) regionRectEntity.polygon.show = new Cesium.ConstantProperty(boundaryVisible.value)
  if (viewer) viewer.scene.requestRender()
}

function updateTexts(): void {
  if (!hydGrid) return
  const grid = hydGrid
  gridInfoText.value = `${grid.cols}×${grid.rows}，约 ${Math.max(1, Math.round((grid.cellLon + grid.cellLat) / 2 * 111320)).toLocaleString()} m/格`
  demRangeText.value = `${grid.demMin.toFixed(1)} ~ ${grid.demMax.toFixed(1)} m`
  fillStatsText.value = fillResult ? `抬升 ${fillResult.raisedCells} 格，最大 ${fillResult.maxRaise.toFixed(1)} m` : '—'
  dirStatsText.value = dirResult ? `流向箭头 ${dirResult.sinks} 个边界出口` : '—'
  accStatsText.value = accResult ? `最大汇流 ${Math.round(accResult.maxAcc).toLocaleString()} 格` : '—'
  linkStatsText.value = linkResult ? `河网像元 ${linkResult.links.reduce((sum, link) => sum + link.cells.length, 0)}，链段 ${linkResult.links.length}` : '—'
  reachStatsText.value = linkResult ? `${reaches.length} 条矢量河段` : '—'
}

async function ensureStepDem(): Promise<boolean> {
  if (hydGrid && stage.value >= 1) return true
  if (!viewer || viewer.isDestroyed() || !regionBounds.value) return false
  const runId = ++analysisRun
  busy.value = true
  progress.value = 1
  const grid = buildHydroGrid(regionBounds.value, resolutionDim.value)
  hydGrid = grid
  const ok = await sampleDem(runId, grid)
  if (runId !== analysisRun || viewer.isDestroyed()) {
    busy.value = false
    return false
  }
  let minH = Number.POSITIVE_INFINITY
  let maxH = Number.NEGATIVE_INFINITY
  for (let i = 0; i < grid.dem.length; i += 1) {
    const h = grid.dem[i]
    if (h < minH) minH = h
    if (h > maxH) maxH = h
  }
  grid.demMin = minH
  grid.demMax = maxH
  cornerH = buildCornerHeights(grid)
  if (!ok || !Number.isFinite(maxH) || maxH <= 0) {
    setStatus('未获取到区域地形高度，请确认已加载 Cesium World Terrain 后重试')
    busy.value = false
    return false
  }
  stage.value = 1
  buildDemLayer()
  updateTexts()
  showRegionRect(regionBounds.value)
  setStatus('DEM 采样完成，可点击后续步骤逐步执行水文分析')
  progress.value = 100
  busy.value = false
  return true
}

async function executeStep(target: number): Promise<void> {
  if (!viewer || viewer.isDestroyed() || busy.value) return
  if (stage.value >= target) {
    setStatus(`步骤 ${target} 已完成，无需重复执行`)
    return
  }
  const ok = await ensureStepDem()
  if (!ok || !hydGrid) return
  if (stage.value >= target) return
  busy.value = true
  setStatus(`正在执行步骤 ${target}：${STEPS[target - 1].label.slice(3)}…`)
  progress.value = 82
  await yieldFrame()
  syncComputeThrough(target)
  if (target >= 2) {
    buildFillLayer()
    buildRaiseLayer()
  }
  if (target >= 3) buildArrowLayer()
  if (target >= 4) buildAccLayer()
  if (target >= 5) {
    refreshLinks()
    buildStreamLayer()
    buildReachLayer()
  }
  if (target >= 6) {
    buildReachLayer()
  }
  stage.value = target
  updateBaseVisibility()
  updateTexts()
  applyStageRendering()
  progress.value = 100
  busy.value = false
  if (target === 7) {
    setStatus('步骤 7 完成。点击「拾取倾泻点」后在地图上单击即可生成汇水流域')
  } else {
    setStatus(`${STEPS[target - 1].label} 完成`)
  }
}

function recomputeRiverLayers(): void {
  if (!hydGrid || !accResult || !dirResult || stage.value < 5) return
  busy.value = true
  setStatus('正在按新阈值重新提取栅格河网并矢量化…')
  refreshLinks()
  buildStreamLayer()
  buildReachLayer()
  updateTexts()
  busy.value = false
  setStatus(`河网阈值 ${riverThreshold.value}，共 ${reaches.length} 条矢量河段`)
}

async function startAnalysis(bounds: HydBounds): Promise<void> {
  if (busy.value || !viewer || viewer.isDestroyed()) return
  clearLayers()
  resetPickingFlags()
  regionBounds.value = { west: bounds.west, east: bounds.east, south: bounds.south, north: bounds.north }
  await ensureStepDem()
}

function useExampleRegion(): void {
  if (!isLoaded.value || busy.value || !viewer) return
  void startAnalysis(EXAMPLE_BOUNDS)
}

function flyToBounds(bounds: HydBounds): void {
  if (!viewer) return
  const centerLon = (bounds.west + bounds.east) / 2
  const centerLat = (bounds.south + bounds.north) / 2
  const widthMeters = Cesium.Cartesian3.distance(
    Cesium.Cartesian3.fromDegrees(bounds.west, centerLat),
    Cesium.Cartesian3.fromDegrees(bounds.east, centerLat)
  )
  const heightMeters = Cesium.Cartesian3.distance(
    Cesium.Cartesian3.fromDegrees(centerLon, bounds.south),
    Cesium.Cartesian3.fromDegrees(centerLon, bounds.north)
  )
  const maxSpan = Math.max(widthMeters, heightMeters, 1000)
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, Math.max(1800, maxSpan * 2.4)),
    duration: 1.0
  })
}

function drawRegionPreview(cursorPosition?: Cesium.Cartesian3): void {
  if (!viewer || viewer.isDestroyed() || !rectStart) return
  if (draftEntity) {
    viewer.entities.remove(draftEntity)
    draftEntity = undefined
  }
  if (!cursorPosition) return
  const cursor = Cesium.Cartographic.fromCartesian(cursorPosition, viewer.scene.globe.ellipsoid)
  const lon = Cesium.Math.toDegrees(cursor.longitude)
  const lat = Cesium.Math.toDegrees(cursor.latitude)
  const bounds = {
    west: Math.min(rectStart.lon, lon),
    east: Math.max(rectStart.lon, lon),
    south: Math.min(rectStart.lat, lat),
    north: Math.max(rectStart.lat, lat)
  }
  const color = Cesium.Color.fromCssColorString('#ffcf5c')
  draftEntity = viewer.entities.add({
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(ringToCartesians(regionRing(bounds))),
      material: color.withAlpha(0.14),
      outline: true,
      outlineColor: color,
      outlineWidth: 2,
      perPositionHeight: true
    }
  }) as unknown as Cesium.Entity
}

function startRectDraw(): void {
  if (!isLoaded.value || busy.value || !viewer) return
  resetPickingFlags()
  clearLayers()
  rectLocked.value = false
  drawingRect.value = true
  setStatus('在地图上单击确定矩形区域一角，移动鼠标后再次单击完成框选')
}

function pickPour(): void {
  if (!isLoaded.value || busy.value || !viewer || !hydGrid) return
  if (stage.value < 4) {
    setStatus('请先完成「④ 汇流累积量」后再拾取倾泻点')
    return
  }
  resetPickingFlags()
  pickingPour.value = true
  setStatus('在地图上单击倾泻点位置，将自动吸附到附近汇流最大像元并生成汇水流域')
}

function clearResult(): void {
  if (busy.value) return
  clearLayers()
  resetPickingFlags()
  setStatus('已清除分析结果，可点击「示例区域」或「框选区域」重新开始')
}

function clearPours(): void {
  removePourLayers()
  setStatus('已清除全部倾泻点与流域，可再次拾取')
}

function computePour(boundsLon: number, boundsLat: number): void {
  if (!viewer || !hydGrid || !cornerH || !accResult || !dirResult || viewer.isDestroyed()) return
  const grid = hydGrid
  const rawCell = lonLatToCell(grid, boundsLon, boundsLat)
  const cellCenterPos = cellCenter(grid, Math.floor(rawCell / grid.cols), rawCell % grid.cols)
  if (
    boundsLon < grid.bounds.west || boundsLon > grid.bounds.east ||
    boundsLat < grid.bounds.south || boundsLat > grid.bounds.north
  ) {
    setStatus('倾泻点超出分析范围，请点击范围内位置')
    return
  }
  void cellCenterPos
  const snapped = snapPourPoint(grid, accResult.acc, rawCell, Math.max(2, Math.round(grid.cols * 0.03)))
  const snappedCenter = cellCenter(grid, Math.floor(snapped / grid.cols), snapped % grid.cols)
  const watershed: WatershedResult = computeWatershed(grid, dirResult.dir, snapped)
  const colorHex = POUR_COLORS[pourCount % POUR_COLORS.length]
  const color = Cesium.Color.fromCssColorString(colorHex)
  const colorByte: [number, number, number] = [
    Math.round(color.red * 255),
    Math.round(color.green * 255),
    Math.round(color.blue * 255)
  ]
  const maskF = new Float32Array(watershed.mask.length)
  for (let i = 0; i < maskF.length; i += 1) maskF[i] = watershed.mask[i] ? 1 : 0
  const surf = buildRasterSurfacePrimitive(grid, cornerH, maskF, {
    mode: 'mask',
    opacity: 0.55,
    fill: colorByte,
    zeroAlpha: true
  })
  viewer.scene.primitives.add(surf)
  surf.show = pourVisible.value
  const ch = cornerH
  const ringPositions: Cesium.Cartesian3[] = watershed.ring.map((point) => {
    const h = surfaceHeightAt(grid, ch, point.lon, point.lat) + 10
    return Cesium.Cartesian3.fromDegrees(point.lon, point.lat, h)
  })
  if (ringPositions.length < 3) {
    viewer.scene.primitives.remove(surf)
    setStatus('流域范围过小，请选择汇流路径明显的倾泻点')
    return
  }
  const polygon = viewer.entities.add({
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(ringPositions),
      material: color.withAlpha(0.3),
      outline: true,
      outlineColor: color.withAlpha(0.95),
      outlineWidth: 2,
      perPositionHeight: true
    }
  }) as Cesium.Entity
  const markerCenter = cellCenter(grid, Math.floor(snapped / grid.cols), snapped % grid.cols)
  const markerH = surfaceHeightAt(grid, cornerH, markerCenter.lon, markerCenter.lat) + 30
  const marker = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(markerCenter.lon, markerCenter.lat, markerH),
    point: {
      pixelSize: 11,
      color,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: `P${pourCount + 1}`,
      font: '12px sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      pixelOffset: new Cesium.Cartesian2(0, -18),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE
    }
  }) as Cesium.Entity
  pourCount += 1
  const id = pourCount
  pourLayerCount.value = pourCount
  pourLayers.push({ id, color: colorHex, surf, polygonEntity: polygon, markerEntity: marker })
  wsStatsText.value = `${pourLayers.length} 个流域，第 ${id} 个含 ${watershed.count.toLocaleString()} 像元，轮廓 ${watershed.ring.length} 点`
  applyStageRendering()
  setStatus(`倾泻点 P${id} 已吸附并生成汇水流域（${watershed.count.toLocaleString()} 像元）`)
  viewer.scene.requestRender()
}

function onLeftClick(event: { position: Cesium.Cartesian2 }): void {
  if (!viewer || !isLoaded.value) return
  const position = pickPosition(viewer.scene, event.position)
  if (!position) return
  if (drawingRect.value && !busy.value) {
    const carto = Cesium.Cartographic.fromCartesian(position, viewer.scene.globe.ellipsoid)
    if (!rectStart) {
      rectStart = { lon: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) }
      setStatus('已确定第一角，移动鼠标预览后再次单击完成框选')
      return
    }
    const lon = Cesium.Math.toDegrees(carto.longitude)
    const lat = Cesium.Math.toDegrees(carto.latitude)
    const bounds = {
      west: Math.min(rectStart.lon, lon),
      east: Math.max(rectStart.lon, lon),
      south: Math.min(rectStart.lat, lat),
      north: Math.max(rectStart.lat, lat)
    }
    drawingRect.value = false
    rectStart = undefined
    if (draftEntity) {
      viewer.entities.remove(draftEntity)
      draftEntity = undefined
    }
    if (bounds.east - bounds.west < 0.004 || bounds.north - bounds.south < 0.004) {
      setStatus('框选范围过小，请框选更大范围（约 0.005° 以上）')
      return
    }
    rectLocked.value = true
    setStatus('正在对框选区域进行 DEM 采样与水文分析…')
    void startAnalysis(bounds)
    return
  }
  if (pickingPour.value && !busy.value) {
    const carto = Cesium.Cartographic.fromCartesian(position, viewer.scene.globe.ellipsoid)
    computePour(Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude))
    return
  }
}

function onMouseMove(event: { endPosition: Cesium.Cartesian2 }): void {
  if (!viewer || !drawingRect.value || busy.value) return
  const position = pickPosition(viewer.scene, event.endPosition)
  if (position) drawRegionPreview(position)
}

function onRightClick(): void {
  if (drawingRect.value) {
    drawingRect.value = false
    rectStart = undefined
    if (draftEntity && viewer) {
      viewer.entities.remove(draftEntity)
      draftEntity = undefined
    }
    setStatus('已取消框选')
  } else if (pickingPour.value) {
    pickingPour.value = false
    setStatus('已取消拾取倾泻点')
  }
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
      setStatus('地形加载失败，已降级为全球椭球体，水文分析不可用。')
    }
    if (!viewer || viewer.isDestroyed()) return
    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((event: { position: Cesium.Cartesian2 }) => onLeftClick(event), Cesium.ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction((event: { endPosition: Cesium.Cartesian2 }) => onMouseMove(event), Cesium.ScreenSpaceEventType.MOUSE_MOVE)
    handler.setInputAction(() => onRightClick(), Cesium.ScreenSpaceEventType.RIGHT_CLICK)
    isLoaded.value = true
    await useExampleRegion()
    flyToBounds(EXAMPLE_BOUNDS)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error))
  }
}

watch(baseSource, () => { if (!busy.value) updateBaseVisibility() })
watch(fillVisible, () => { if (!busy.value) applyStageRendering() })
watch(dirVisible, () => { if (!busy.value) applyStageRendering() })
watch(streamVisible, () => { if (!busy.value) applyStageRendering() })
watch(reachVisible, () => { if (!busy.value) applyStageRendering() })
watch(pourVisible, () => { if (!busy.value) applyStageRendering() })
watch(boundaryVisible, () => { if (!busy.value) applyStageRendering() })

watch([baseOpacity, accOpacity], () => {
  if (!busy.value && hydGrid && cornerH) {
    if (fillPrim.value || demPrim.value) {
      buildDemLayer()
      buildFillLayer()
    }
    buildAccLayer()
    applyStageRendering()
  }
})
watch(fillOpacity, () => {
  if (!busy.value && hydGrid && fillResult) {
    buildRaiseLayer()
    applyStageRendering()
  }
})
watch(arrowStride, () => {
  if (!busy.value && stage.value >= 3) {
    buildArrowLayer()
    applyStageRendering()
  }
})
watch(arrowAlpha, () => {
  if (!busy.value && stage.value >= 3) {
    buildArrowLayer()
    applyStageRendering()
  }
})
watch(riverThreshold, () => {
  if (!busy.value && stage.value >= 5) recomputeRiverLayers()
})
watch([reachWidth, reachAlpha, reachColor], () => {
  if (!busy.value && stage.value >= 6) {
    buildReachLayer()
    applyStageRendering()
  }
})

watch(resolutionDim, () => {
  if (!busy.value && regionBounds.value && (hydGrid || stage.value === 0)) {
    const bounds = regionBounds.value
    void startAnalysis(bounds)
  }
})

onBeforeUnmount(() => {
  analysisRun += 1
  handler?.destroy()
  handler = undefined
  if (viewer && !viewer.isDestroyed()) {
    removeLayerPrims()
    removePourLayers()
    if (regionRectEntity) viewer.entities.remove(regionRectEntity)
    if (draftEntity) viewer.entities.remove(draftEntity)
    if (pickMarkerEntity) viewer.entities.remove(pickMarkerEntity)
  }
  destroyScene(viewer)
  viewer = undefined
})

onMounted(() => { void mountScene() })
</script>

<template>
  <div class="ha-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">空间分析-水文分析(基础版)</div>

      <div class="section-title">选择区域</div>
      <div class="button-row">
        <button class="action-button primary" :disabled="!isLoaded || busy" @click="useExampleRegion">示例区域</button>
        <button class="action-button accent" :disabled="!isLoaded || busy" @click="startRectDraw">
          {{ drawingRect ? '框选中…' : '框选区域' }}
        </button>
      </div>
      <div class="control-row">
        <span class="row-label">范围</span>
        <span class="row-value region-value">{{ regionLabel }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">列数/行数</span>
        <select v-model.number="resolutionDim" :disabled="busy">
          <option v-for="option in RESOLUTION_OPTIONS" :key="option" :value="option">{{ option }}</option>
        </select>
      </div>
      <button v-if="stage > 0" class="action-button danger" :disabled="busy" @click="clearResult">清除结果</button>
      <p v-if="drawingRect" class="result">单击第一角 → 移动 → 再次单击完成框选；右键取消</p>

      <div class="section-title">逐步分析</div>
      <div class="step-list">
        <button
          v-for="stepItem in STEPS"
          :key="stepItem.key"
          class="step-button"
          :class="{ done: stage >= stepItem.key, current: stage === stepItem.key - 1 }"
          :disabled="!isLoaded || busy || (stepItem.key > 1 && stage === 0)"
          @click="executeStep(stepItem.key)"
        >
          <span class="step-check">{{ stage >= stepItem.key ? '✓' : '' }}</span>
          <span>{{ stepItem.label }}</span>
        </button>
      </div>

      <template v-if="stage >= 2">
        <div class="section-title">基础图层</div>
        <label class="switch-row">
          <span>洼地填平量</span>
          <input v-model="fillVisible" type="checkbox" />
        </label>
        <div class="control-row">
          <span class="row-label">基底图层</span>
          <select v-model="baseSource">
            <option value="dem">原始 DEM</option>
            <option value="fill">填洼后 DEM</option>
            <option value="acc">汇流累积</option>
          </select>
        </div>
        <div v-if="baseSource === 'acc'" class="control-row">
          <span class="row-label">透明度</span>
          <input v-model.number="accOpacity" type="range" min="0.2" max="1" step="0.05" />
          <span class="row-value">{{ accOpacity.toFixed(2) }}</span>
        </div>
        <div v-else class="control-row">
          <span class="row-label">透明度</span>
          <input v-model.number="baseOpacity" type="range" min="0.2" max="1" step="0.05" />
          <span class="row-value">{{ baseOpacity.toFixed(2) }}</span>
        </div>
      </template>

      <template v-if="stage >= 3">
        <div class="section-title">流向箭头</div>
        <label class="switch-row">
          <span>显示 D8 流向</span>
          <input v-model="dirVisible" type="checkbox" />
        </label>
        <div class="control-row">
          <span class="row-label">箭头密度</span>
          <select v-model.number="arrowStride">
            <option v-for="option in ARROW_STRIDE_OPTIONS" :key="option" :value="option">
              每 {{ option }} 格
            </option>
          </select>
        </div>
        <div class="control-row">
          <span class="row-label">透明度</span>
          <input v-model.number="arrowAlpha" type="range" min="0.3" max="1" step="0.05" />
          <span class="row-value">{{ arrowAlpha.toFixed(2) }}</span>
        </div>
      </template>

      <template v-if="stage >= 5">
        <div class="section-title">河网提取</div>
        <label class="switch-row">
          <span>栅格河网</span>
          <input v-model="streamVisible" type="checkbox" />
        </label>
        <div class="control-row">
          <span class="row-label">汇流阈值</span>
          <input v-model.number="riverThreshold" type="range" min="2" max="200" step="1" />
          <span class="row-value">{{ riverThreshold }}</span>
        </div>
      </template>

      <template v-if="stage >= 6">
        <div class="section-title">矢量河网</div>
        <label class="switch-row">
          <span>矢量河段</span>
          <input v-model="reachVisible" type="checkbox" />
        </label>
        <div class="control-row">
          <span class="row-label">线宽</span>
          <select v-model.number="reachWidth">
            <option v-for="option in REACH_WIDTH_OPTIONS" :key="option" :value="option">{{ option }} px</option>
          </select>
        </div>
        <div class="control-row">
          <span class="row-label">透明度</span>
          <input v-model.number="reachAlpha" type="range" min="0.3" max="1" step="0.05" />
          <span class="row-value">{{ reachAlpha.toFixed(2) }}</span>
        </div>
      </template>

      <template v-if="stage >= 4">
        <div class="section-title">倾泻点与流域</div>
        <div class="button-row">
          <button class="action-button accent" :disabled="busy || pickingPour" @click="pickPour">
            {{ pickingPour ? '拾取中…' : '拾取倾泻点' }}
          </button>
          <button class="action-button danger" :disabled="busy || pourLayerCount === 0" @click="clearPours">清空</button>
        </div>
        <label class="switch-row">
          <span>流域显示</span>
          <input v-model="pourVisible" type="checkbox" />
        </label>
      </template>

      <template v-if="stage > 0">
        <div class="section-title">统计</div>
        <p class="stat-line">网格：{{ gridInfoText }}</p>
        <p class="stat-line">DEM：{{ demRangeText }}</p>
        <p class="stat-line">填洼：{{ fillStatsText }}</p>
        <p class="stat-line">流向：{{ dirStatsText }}</p>
        <p class="stat-line">汇流：{{ accStatsText }}</p>
        <p class="stat-line">河网：{{ linkStatsText }}</p>
        <p class="stat-line">矢量化：{{ reachStatsText }}</p>
        <p class="stat-note">流域：{{ wsStatsText }}</p>
      </template>

      <p class="hint">从真实地形 DEM 出发，依次执行填洼、D8 流向、汇流累积、河网提取与矢量化，并拾取倾泻点生成汇水流域。</p>
    </div>

    <div v-if="busy" class="progress-mask">
      <div class="progress-bar"><i :style="{ width: `${progress}%` }"></i></div>
      <span>{{ progress }}%</span>
    </div>

    <div v-if="legendVisible && stage > 0" class="legend">
      <template v-if="stage >= 2 && fillVisible">
        <div class="legend-gradient" :style="{ background: raiseCss }"></div>
        <span>抬升量→</span>
      </template>
      <template v-if="stage >= 2">
        <div class="legend-gradient" :style="{ background: baseSource === 'acc' ? accCss : demGradientCss }"></div>
        <span>{{ baseSource === 'acc' ? '汇流对数色' : '低→高' }}</span>
      </template>
      <div v-if="stage >= 3 && dirVisible" class="legend-chips">
        <span v-for="(color, index) in DIR_COLORS" :key="index" class="chip" :style="{ background: color }" :title="['北', '东北', '东', '东南', '南', '西南', '西', '西北'][index]" />
      </div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.ha-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 5px; width: 266px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 26, 44, 0.9); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.panel-title { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
.section-title { margin-top: 7px; margin-bottom: 2px; padding-bottom: 2px; border-bottom: 1px solid rgba(137, 210, 233, 0.16); font-size: 11px; font-weight: 700; color: #7fd0e6; }
.button-row { display: flex; gap: 6px; }
.action-button { flex: 1; min-height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; color: #edfaff; }
.action-button.primary { background: #257f9e; }
.action-button.accent { background: #8a6d1a; color: #fff3d6; }
.action-button.danger { background: #4a5a72; color: #ffd6d6; }
.action-button:disabled { cursor: default; opacity: 0.5; }
.step-list { display: flex; flex-direction: column; gap: 4px; }
.step-button { display: flex; align-items: center; gap: 7px; min-height: 27px; padding: 0 8px; border: 1px solid rgba(137, 210, 233, 0.22); border-radius: 5px; background: rgba(21, 48, 78, 0.6); color: #b9d6e4; cursor: pointer; font-size: 11px; text-align: left; }
.step-button.done { border-color: rgba(45, 212, 160, 0.5); color: #9df0d8; background: rgba(15, 66, 57, 0.5); }
.step-button.current { border-color: rgba(255, 199, 92, 0.7); }
.step-button:disabled { cursor: default; opacity: 0.5; }
.step-check { flex: 0 0 13px; text-align: center; color: #2ad4a0; font-weight: 700; }
.result { margin: 2px 0 0; padding: 5px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; background: rgba(250, 173, 20, 0.18); color: #ffd666; text-align: center; }
.switch-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; color: #c3d8e6; }
.switch-row input, .control-row input[type="color"] { cursor: pointer; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 0; color: #c3d8e6; }
.row-label { flex: 0 0 auto; }
.row-value { flex: 0 0 44px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.region-value { flex: 1 1 auto; width: auto; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row select, .control-row input[type="number"] { width: 92px; height: 22px; padding: 0 5px; border: 1px solid rgba(137, 210, 233, 0.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.stat-line { margin: 0; font-size: 10px; color: #9fb8d4; line-height: 1.7; }
.stat-note { margin: 0; font-size: 10px; color: #ffd666; line-height: 1.5; }
.hint { margin: 6px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.progress-mask { position: absolute; top: 12px; left: 50%; z-index: 9; display: flex; flex-direction: column; align-items: center; gap: 6px; transform: translateX(-50%); padding: 10px 16px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; background: rgba(8, 21, 40, 0.9); color: #e8f4fa; font-size: 12px; pointer-events: none; min-width: 210px; }
.progress-bar { position: relative; width: 100%; height: 8px; overflow: hidden; border-radius: 4px; background: rgba(137, 210, 233, 0.2); }
.progress-bar i { position: absolute; top: 0; bottom: 0; left: 0; background: #2f80ed; }
.legend { position: absolute; bottom: 14px; left: 12px; z-index: 8; display: flex; align-items: center; gap: 8px; padding: 6px 9px; border: 1px solid rgba(137, 210, 233, 0.25); border-radius: 6px; background: rgba(8, 26, 44, 0.82); color: #bcd7e4; font-size: 10px; }
.legend-gradient { width: 110px; height: 8px; border-radius: 4px; }
.legend-chips { display: flex; gap: 3px; align-items: center; padding-left: 2px; border-left: 1px solid rgba(137, 210, 233, 0.22); }
.chip { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 420px; padding: 8px 14px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
