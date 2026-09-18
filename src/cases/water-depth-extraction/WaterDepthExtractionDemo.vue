<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  HeightReference,
  Math as CesiumMath,
  PolygonHierarchy,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  SingleTileImageryProvider,
  type Entity,
  type ImageryLayer,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain, type SceneCallbacks } from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib/pick'
import { sampleTerrainHeights, aspectRows, type DepthGrid, type SourceExtent } from './terrain-sampler'
import { parseRasterFile, type RasterSource } from './raster-loader'
import { writeDepthGeoTiffFloat32 } from './geotiff-export'

const AUTO_EXTENT: SourceExtent = { west: 85.2844, east: 85.6063, south: 28.1153, north: 28.5735 }
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))

type HeldFile = {
  name: string
  isImage: boolean
  grid: DepthGrid
  extent?: SourceExtent
}

type DepthState = {
  cols: number
  rows: number
  extent: SourceExtent
  depthPixels: Float32Array
  depthMax: number
  demPixels?: Float32Array
  demMin: number
  demMax: number
  normPixels?: Float32Array
  pngFullUrl: string
  previewUrl: string
}

const container = ref<HTMLElement | null>(null)
const previewUrl = ref('')
const statusMessage = ref('正在加载 Bing 地图…')
const terrainReady = ref(false)
const drawing = ref(false)
const processing = ref(false)
const hasResult = ref(false)
const hasDem = ref(false)
const overlayVisible = ref(false)
const overlayOpacity = ref(0.85)
const rectVisible = ref(true)
const fileInput = ref<HTMLInputElement | null>(null)

const ui = reactive({
  source: 'terrain' as 'terrain' | 'file',
  resolution: 128,
  mode: 'dem' as 'dem' | 'depth',
  westInput: String(AUTO_EXTENT.west),
  eastInput: String(AUTO_EXTENT.east),
  southInput: String(AUTO_EXTENT.south),
  northInput: String(AUTO_EXTENT.north),
  fileName: '',
  dataText: '未加载',
  extentText: '',
  waterLevel: 0,
  fileGain: 60
})

const waterRange = reactive({ min: 0, max: 9000 })

const heldFileNameIsTif = computed(() => /\.(tif|tiff)$/i.test(ui.fileName))
const heldFileNameIsPng = computed(() => /\.(png|jpg|jpeg)$/i.test(ui.fileName))

let viewer: Viewer | undefined
let state: DepthState | undefined
let heldFile: HeldFile | undefined
let rectEntity: Entity | undefined
let rectOutlineEntity: Entity | undefined
let startEntity: Entity | undefined
let endEntity: Entity | undefined
let overlayLayer: ImageryLayer | undefined
let drawHandler: ScreenSpaceEventHandler | undefined
let firstCorner: Cartographic | undefined
let autoStarted = false

function normalizedRectangle(a: Cartographic, b: Cartographic): Rectangle {
  return new Rectangle(
    Math.min(a.longitude, b.longitude),
    Math.min(a.latitude, b.latitude),
    Math.max(a.longitude, b.longitude),
    Math.max(a.latitude, b.latitude)
  )
}

function rectToExtent(rect: Rectangle): SourceExtent {
  return {
    west: CesiumMath.toDegrees(rect.west),
    east: CesiumMath.toDegrees(rect.east),
    south: CesiumMath.toDegrees(rect.south),
    north: CesiumMath.toDegrees(rect.north)
  }
}

function extentToRect(extent: SourceExtent): Rectangle {
  return Rectangle.fromDegrees(extent.west, extent.south, extent.east, extent.north)
}

function rectOutlinePositions(rect: Rectangle): Cartesian3[] {
  return Cartesian3.fromRadiansArray([
    rect.west, rect.south,
    rect.east, rect.south,
    rect.east, rect.north,
    rect.west, rect.north,
    rect.west, rect.south
  ])
}

function hierarchyOf(rect: Rectangle): PolygonHierarchy {
  return new PolygonHierarchy(Cartesian3.fromRadiansArray([
    rect.west, rect.south,
    rect.east, rect.south,
    rect.east, rect.north,
    rect.west, rect.north
  ]))
}

function setRectangle(rect: Rectangle): void {
  if (!viewer || viewer.isDestroyed()) return
  rectEntity!.polygon!.hierarchy = new ConstantProperty(hierarchyOf(rect))
  rectOutlineEntity!.polyline!.positions = new ConstantProperty(rectOutlinePositions(rect))
  const visible = rectVisible.value
  rectEntity!.show = visible
  rectOutlineEntity!.show = visible
  viewer.scene.requestRender()
}

function showExtentRectangle(extent: SourceExtent): void {
  setRectangle(extentToRect(extent))
}

function setMarker(entity: Entity | undefined, position: Cartesian3): Entity | undefined {
  if (!viewer) return entity
  if (entity) {
    entity.position = new ConstantPositionProperty(position)
    entity.show = true
    return entity
  }
  return viewer.entities.add({
    position,
    point: { pixelSize: 9, color: Color.fromCssColorString('#f6ca55'), outlineColor: Color.WHITE, outlineWidth: 2 }
  })
}

function hideMarker(entity: Entity | undefined): void {
  if (entity) entity.show = false
}

function removeOverlay(): void {
  if (overlayLayer && viewer && !viewer.isDestroyed()) {
    viewer.imageryLayers.remove(overlayLayer, true)
  }
  overlayLayer = undefined
}

function addOverlay(): void {
  if (!viewer || viewer.isDestroyed() || !state) return
  removeOverlay()
  try {
    const st = state
    const rect = extentToRect(st.extent)
    overlayLayer = viewer.imageryLayers.addImageryProvider(
      new SingleTileImageryProvider({
        url: st.pngFullUrl,
        rectangle: rect,
        tileWidth: st.cols,
        tileHeight: st.rows
      })
    )
    overlayLayer.alpha = overlayOpacity.value
    overlayLayer.show = true
    overlayVisible.value = true
  } catch (error) {
    overlayLayer = undefined
    const detail = error instanceof Error ? error.stack ?? error.message : String(error)
    statusMessage.value = `水深图已生成，但地图叠加显示失败：${detail}`
  }
}

watch(overlayVisible, (visible) => {
  if (visible) {
    if (!overlayLayer && state) addOverlay()
  } else if (overlayLayer) {
    overlayLayer.show = false
  }
  if (window.__wdeState) window.__wdeState.overlayVisible = visible
})

watch(overlayOpacity, (alpha) => {
  if (overlayLayer) overlayLayer.alpha = alpha
})

watch(rectVisible, (visible) => {
  if (!viewer || viewer.isDestroyed() || !state) return
  rectEntity!.show = visible
  rectOutlineEntity!.show = visible
  if (window.__wdeState) window.__wdeState.rectVisible = visible
})

const COLOR_RAMP: Array<[number, number, number]> = [
  [16, 51, 235],
  [8, 181, 235],
  [45, 216, 137],
  [245, 214, 61],
  [235, 35, 76]
]

function colorDepthCanvas(cols: number, rows: number, depthPixels: Float32Array, depthMax: number, maxSide?: number): string {
  const w = cols
  const h = rows
  const scale = maxSide == null ? 1 : Math.min(1, maxSide / Math.max(w, h))
  const tw = Math.max(2, Math.round(w * scale))
  const th = Math.max(2, Math.round(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器无法创建水深图画布')
  const img = ctx.createImageData(tw, th)
  const lerp = (t: number, a: number, b: number): number => Math.round(a + (b - a) * t)
  const range = Math.max(depthMax, 0.01)
  for (let y = 0; y < th; y += 1) {
    const srcRow = Math.min(h - 1, Math.floor(((y + 0.5) * h) / th))
    for (let x = 0; x < tw; x += 1) {
      const srcX = Math.min(w - 1, Math.floor(((x + 0.5) * w) / tw))
      const v = depthPixels[srcRow * cols + srcX] / range
      const idx = (y * tw + x) * 4
      if (v <= 0.003) {
        img.data[idx + 3] = 0
        continue
      }
      const t = clamp(v * 4, 0, 3.999)
      const seg = Math.floor(t)
      const f = t - seg
      const lo = COLOR_RAMP[seg]
      const hi = COLOR_RAMP[seg + 1]
      img.data[idx] = lerp(f, lo[0], hi[0])
      img.data[idx + 1] = lerp(f, lo[1], hi[1])
      img.data[idx + 2] = lerp(f, lo[2], hi[2])
      img.data[idx + 3] = 235
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

function depthMaxOf(meters: Float32Array): number {
  let depthMax = 0
  for (let i = 0; i < meters.length; i += 1) if (meters[i] > depthMax) depthMax = meters[i]
  return Math.max(depthMax, 0.01)
}

function buildDemState(grid: DepthGrid, extent: SourceExtent): DepthState {
  const dem = grid.pixels
  const depth = new Float32Array(dem.length)
  for (let i = 0; i < dem.length; i += 1) depth[i] = Math.max(0, ui.waterLevel - dem[i])
  const base: Omit<DepthState, 'pngFullUrl' | 'previewUrl'> = {
    cols: grid.cols,
    rows: grid.rows,
    extent,
    demPixels: dem,
    demMin: grid.min,
    demMax: grid.max,
    normPixels: undefined,
    depthPixels: depth,
    depthMax: depthMaxOf(depth)
  }
  return { ...base, pngFullUrl: '', previewUrl: '' }
}

function buildDirectState(input: {
  cols: number
  rows: number
  extent: SourceExtent
  meters?: Float32Array
  norm?: Float32Array
}): DepthState {
  const gain = ui.fileGain
  const meters = input.meters ?? (input.norm as Float32Array).map((v) => Math.max(0, v * gain))
  const clamped = new Float32Array(meters.length)
  let depthMax = 0
  for (let i = 0; i < meters.length; i += 1) {
    clamped[i] = Math.max(0, meters[i])
    if (clamped[i] > depthMax) depthMax = clamped[i]
  }
  const base: Omit<DepthState, 'pngFullUrl' | 'previewUrl'> = {
    cols: input.cols,
    rows: input.rows,
    extent: input.extent,
    demPixels: undefined,
    demMin: 0,
    demMax: 0,
    normPixels: input.norm,
    depthPixels: clamped,
    depthMax: Math.max(depthMax, 0.01)
  }
  return { ...base, pngFullUrl: '', previewUrl: '' }
}

function presentState(next: DepthState): void {
  state = next
  hasResult.value = true
  hasDem.value = Boolean(next.demPixels)
  next.pngFullUrl = colorDepthCanvas(next.cols, next.rows, next.depthPixels, next.depthMax)
  next.previewUrl = colorDepthCanvas(next.cols, next.rows, next.depthPixels, next.depthMax, 260)
  previewUrl.value = next.previewUrl
  if (next.demPixels) {
    waterRange.min = Math.floor(next.demMin)
    waterRange.max = Math.ceil(next.demMax)
  } else {
    waterRange.min = 0
    waterRange.max = Math.ceil(next.depthMax)
  }
  const e = next.extent
  ui.extentText = `四至 西 ${e.west.toFixed(4)}° | 东 ${e.east.toFixed(4)}° | 南 ${e.south.toFixed(4)}° | 北 ${e.north.toFixed(4)}°`
  ui.dataText = hasDem.value
    ? `${next.cols} x ${next.rows}（${(next.cols * next.rows).toLocaleString()} 格）｜高程 ${next.demMin.toFixed(0)}~${next.demMax.toFixed(0)} m｜水面 ${ui.waterLevel.toFixed(1)} m｜最大水深 ${next.depthMax.toFixed(1)} m`
    : `${next.cols} x ${next.rows}（${(next.cols * next.rows).toLocaleString()} 格）｜最大水深 ${next.depthMax.toFixed(1)} m`
  showExtentRectangle(next.extent)
  addOverlay()
  if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender()
  window.__wdeState = {
    cols: next.cols,
    rows: next.rows,
    extent: { ...next.extent },
    depthMax: next.depthMax,
    hasDem: hasDem.value,
    overlayVisible: overlayVisible.value,
    rectVisible: rectVisible.value
  }
}

declare global {
  interface Window {
    __wdeState?: {
      cols: number
      rows: number
      extent: SourceExtent
      depthMax: number
      hasDem: boolean
      overlayVisible: boolean
      rectVisible: boolean
    }
  }
}

function clearStatusSoon(): void {
  const scheduled = statusMessage.value
  window.setTimeout(() => {
    if (statusMessage.value === scheduled) statusMessage.value = ''
  }, 4200)
}

function flyToExtent(extent: SourceExtent): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: extentToRect(extent),
    orientation: { heading: 0, pitch: CesiumMath.toRadians(-55), roll: 0 },
    duration: 1.0
  })
}

function refreshDepthFromLevel(): void {
  const s = state
  if (!s?.demPixels) return
  const dem = s.demPixels as Float32Array
  presentState(buildDemState({ cols: s.cols, rows: s.rows, pixels: dem, min: s.demMin, max: s.demMax }, s.extent))
}

function refreshGainFromFile(): void {
  const s = state
  if (!s?.normPixels) return
  const norm = s.normPixels as Float32Array
  const ncols = s.cols
  const nrows = s.rows
  const extent = s.extent
  presentState(buildDirectState({ cols: ncols, rows: nrows, extent, norm }))
}

async function runFromDem(grid: DepthGrid, extent: SourceExtent): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  ui.waterLevel = Math.round((grid.min + (grid.max - grid.min) * 0.4) * 10) / 10
  presentState(buildDemState(grid, extent))
  statusMessage.value = `水深图已生成：${grid.cols} x ${grid.rows}，水深已叠加到地图`
  clearStatusSoon()
  flyToExtent(extent)
}

async function sampleAndRun(extent: SourceExtent): Promise<void> {
  const cols = ui.resolution
  const rows = clamp(aspectRows(cols, extent), 4, 1024)
  statusMessage.value = `正在采样 ${cols} x ${rows} 个真实地形点…`
  const provider = (viewer as Viewer).terrainProvider
  const grid = await sampleTerrainHeights(provider, extent, cols, rows)
  await runFromDem(grid, extent)
}

function parseInputExtent(): SourceExtent | null {
  const w = Number(ui.westInput)
  const e = Number(ui.eastInput)
  const s = Number(ui.southInput)
  const n = Number(ui.northInput)
  if (![w, e, s, n].every(Number.isFinite) || w >= e || s >= n) {
    statusMessage.value = '四至输入无效：请填写合理的西/东经与南/北纬'
    return null
  }
  return { west: w, east: e, south: s, north: n }
}

async function generateFromBounds(): Promise<void> {
  const extent = parseInputExtent()
  if (!extent || !viewer || !terrainReady.value || processing.value || drawing.value) return
  processing.value = true
  try {
    statusMessage.value = '开始采样地形并生成水深图…'
    const rect = extentToRect(extent)
    startEntity = setMarker(startEntity, Cartesian3.fromRadians(rect.west, rect.south))
    endEntity = setMarker(endEntity, Cartesian3.fromRadians(rect.east, rect.north))
    showExtentRectangle(extent)
    await sampleAndRun(extent)
  } catch (error) {
    statusMessage.value = error instanceof Error ? `采样失败：${error.message}` : '采样失败'
  } finally {
    processing.value = false
  }
}

async function startAutoDemo(): Promise<void> {
  if (!viewer || viewer.isDestroyed() || !terrainReady.value || processing.value || drawing.value) return
  processing.value = true
  autoStarted = true
  try {
    const extent = { ...AUTO_EXTENT }
    ui.westInput = String(extent.west)
    ui.eastInput = String(extent.east)
    ui.southInput = String(extent.south)
    ui.northInput = String(extent.north)
    statusMessage.value = '自动示例：正在采样默认区域真实地形…'
    await sampleAndRun(extent)
  } catch (error) {
    statusMessage.value = error instanceof Error ? `自动示例失败：${error.message}` : '自动示例失败'
  } finally {
    processing.value = false
  }
}

function stopDrawing(): void {
  drawing.value = false
  firstCorner = undefined
  if (drawHandler && !drawHandler.isDestroyed()) drawHandler.destroy()
  drawHandler = undefined
}

function startDrawing(): void {
  if (!viewer || viewer.isDestroyed() || drawing.value) return
  drawing.value = true
  firstCorner = undefined
  if (rectEntity) rectEntity.show = false
  if (rectOutlineEntity) rectOutlineEntity.show = false
  hideMarker(startEntity)
  hideMarker(endEntity)
  statusMessage.value = '点击地图确定矩形第一角点'
  if (drawHandler && !drawHandler.isDestroyed()) drawHandler.destroy()
  drawHandler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  drawHandler.setInputAction((event: { position: Cartesian2 }) => {
    if (!viewer || !drawing.value) return
    const position = pickPosition(viewer.scene, event.position)
    if (!position) return
    const corner = Cartographic.fromCartesian(position)
    if (!firstCorner) {
      firstCorner = corner
      startEntity = setMarker(startEntity, position)
      statusMessage.value = '移动鼠标实时预览矩形范围，点击第二角点完成框选'
      return
    }
    const rect = normalizedRectangle(firstCorner, corner)
    endEntity = setMarker(endEntity, position)
    firstCorner = undefined
    drawing.value = false
    drawHandler?.destroy()
    drawHandler = undefined
    const extent = rectToExtent(rect)
    showExtentRectangle(extent)
    void generateFromExtent(extent)
  }, ScreenSpaceEventType.LEFT_CLICK)
  drawHandler.setInputAction((event: { endPosition: Cartesian2 }) => {
    if (!viewer || !firstCorner) return
    const position = pickPosition(viewer.scene, event.endPosition)
    if (!position) return
    const rect = normalizedRectangle(firstCorner, Cartographic.fromCartesian(position))
    endEntity = setMarker(endEntity, position)
    setRectangle(rect)
  }, ScreenSpaceEventType.MOUSE_MOVE)
}

async function generateFromExtent(extent: SourceExtent): Promise<void> {
  if (processing.value || !terrainReady.value) return
  processing.value = true
  try {
    ui.westInput = String(extent.west)
    ui.eastInput = String(extent.east)
    ui.southInput = String(extent.south)
    ui.northInput = String(extent.north)
    statusMessage.value = '框选完成，正在采样并生成水深图…'
    await sampleAndRun(extent)
  } catch (error) {
    statusMessage.value = error instanceof Error ? `采样失败：${error.message}` : '采样失败'
  } finally {
    processing.value = false
  }
}

function applyHeldFile(): void {
  if (!viewer || viewer.isDestroyed() || !heldFile) return
  if (heldFile.isImage) {
    ui.fileName = heldFile.name
    presentState(buildDirectState({
      cols: heldFile.grid.cols,
      rows: heldFile.grid.rows,
      extent: { ...AUTO_EXTENT },
      norm: heldFile.grid.pixels
    }))
    showExtentRectangle({ ...AUTO_EXTENT })
    statusMessage.value = `已加载归一化水深图 ${heldFile.name}，水深已按默认区域叠加`
    clearStatusSoon()
    flyToExtent({ ...AUTO_EXTENT })
    return
  }
  const extent = heldFile.extent as SourceExtent
  ui.fileName = heldFile.name
  if (ui.mode === 'dem') {
    ui.waterLevel = Math.round((heldFile.grid.min + (heldFile.grid.max - heldFile.grid.min) * 0.4) * 10) / 10
    presentState(buildDemState(heldFile.grid, extent))
    statusMessage.value = `已加载高程 DEM ${heldFile.name}，水深已按水面高程叠加`
  } else {
    presentState(buildDirectState({
      cols: heldFile.grid.cols,
      rows: heldFile.grid.rows,
      extent,
      meters: heldFile.grid.pixels
    }))
    statusMessage.value = `已加载水深栅格 ${heldFile.name}，水深已叠加到地图`
  }
  clearStatusSoon()
  flyToExtent(extent)
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  processing.value = true
  try {
    statusMessage.value = `正在解析栅格文件 ${file.name}…`
    const source: RasterSource = await parseRasterFile(file)
    heldFile = {
      name: file.name,
      isImage: source.isImage,
      grid: source.grid,
      extent: source.extent
    }
    ui.source = 'file'
    applyHeldFile()
  } catch (error) {
    statusMessage.value = error instanceof Error ? `栅格解析失败：${error.message}` : '栅格解析失败'
  } finally {
    processing.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

function download(type: 'png' | 'tif'): void {
  const s = state
  if (!s) return
  if (type === 'png') {
    const link = document.createElement('a')
    link.href = s.pngFullUrl
    link.download = 'water-depth-map.png'
    link.click()
    return
  }
  const e = s.extent
  const bytes = writeDepthGeoTiffFloat32({
    width: s.cols,
    height: s.rows,
    west: e.west,
    south: e.south,
    east: e.east,
    north: e.north,
    values: s.depthPixels,
    description: 'water depth (m) EPSG:4326'
  })
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/tiff' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'water-depth-map.tif'
  link.click()
  URL.revokeObjectURL(url)
}

watch(
  () => [ui.mode] as const,
  () => {
    if (ui.source === 'file' && heldFile && !heldFile.isImage && hasResult.value) applyHeldFile()
  }
)

const sceneCallbacks: SceneCallbacks = {
  onStatus: (message) => {
    statusMessage.value = message
  },
  onBasemapReady: () => {
    statusMessage.value = '正在加载 Cesium World Terrain…'
  }
}

onMounted(() => {
  if (!container.value) return
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    if (!viewer || viewer.isDestroyed()) return
    viewer.scene.globe.depthTestAgainstTerrain = true
    rectEntity = viewer.entities.add({
      polygon: {
        hierarchy: new ConstantProperty(new PolygonHierarchy()),
        material: Color.fromCssColorString('#36c5e8').withAlpha(0.16),
        height: 0,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        perPositionHeight: false
      },
      show: false
    })
    rectOutlineEntity = viewer.entities.add({
      polyline: {
        positions: new ConstantProperty([]),
        clampToGround: true,
        width: 2,
        material: Color.fromCssColorString('#7ef0ff')
      },
      show: false
    })
    void loadWorldTerrain(viewer)
      .then(() => {
        terrainReady.value = true
      })
      .catch(() => {
        if (viewer && !viewer.isDestroyed()) statusMessage.value = '地形加载失败，请重试或切换数据源'
      })
      .finally(() => {
        if (!viewer || viewer.isDestroyed()) return
        statusMessage.value = '场景已就绪：输入四至 / 框选范围 / 上传栅格生成水深图。'
        viewer.camera.flyTo({
          destination: Rectangle.fromDegrees(AUTO_EXTENT.west - 0.25, AUTO_EXTENT.south - 0.2, AUTO_EXTENT.east + 0.25, AUTO_EXTENT.north + 0.2),
          duration: 1.0
        })
        window.setTimeout(() => {
          if (!viewer || viewer.isDestroyed() || autoStarted) return
          void startAutoDemo()
        }, 500)
      })
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (drawHandler && !drawHandler.isDestroyed()) drawHandler.destroy()
  drawHandler = undefined
  removeOverlay()
  state = undefined
  heldFile = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="wde-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">水深图提取</div>
      <p class="subtitle">真实地形采样 / 上传栅格 → 水深网格 → 叠加 / 导出</p>

      <div class="sec-title">① 深度数据源</div>
      <label class="res-row">类型
        <select v-model="ui.source" :disabled="processing">
          <option value="terrain">真实地形采样（水面高程）</option>
          <option value="file">上传栅格文件</option>
        </select>
      </label>

      <div v-if="ui.source === 'terrain'" class="bounds-group">
        <span class="bounds-title">四至范围（经纬度）</span>
        <div class="bounds-grid">
          <label>西经<input v-model="ui.westInput" type="number" step="0.0001" :disabled="processing || drawing" /></label>
          <label>东经<input v-model="ui.eastInput" type="number" step="0.0001" :disabled="processing || drawing" /></label>
          <label>南纬<input v-model="ui.southInput" type="number" step="0.0001" :disabled="processing || drawing" /></label>
          <label>北纬<input v-model="ui.northInput" type="number" step="0.0001" :disabled="processing || drawing" /></label>
        </div>
        <label class="res-row">网格分辨率
          <select v-model.number="ui.resolution" :disabled="processing || drawing">
            <option :value="64">64（快）</option>
            <option :value="128">128（推荐）</option>
            <option :value="256">256（精细）</option>
            <option :value="512">512（高采样）</option>
          </select>
        </label>
        <button class="primary-button" :disabled="!terrainReady || processing || drawing" @click="startAutoDemo">自动示例（默认区域）</button>
        <button class="primary-button" :disabled="!terrainReady || processing || drawing" @click="generateFromBounds">按四至生成</button>
        <button class="secondary-button" :disabled="!terrainReady || processing || drawing" @click="startDrawing">框选矩形范围</button>
        <p class="hint-inline">框选时点击地图确定第一角点，移动鼠标即实时预览贴地矩形，点击第二角点自动生成。</p>
      </div>

      <div v-else class="bounds-group">
        <span class="bounds-title">GeoTIFF：高程 DEM / 水深栅格；PNG/JPG：归一化水深图</span>
        <button class="primary-button" :disabled="processing" @click="fileInput?.click()">选择栅格文件</button>
        <input ref="fileInput" type="file" accept=".tif,.tiff,.png,.jpg,.jpeg" style="display:none" @change="onFileChange" />
        <label class="res-row" v-if="ui.fileName && heldFileNameIsTif">栅格模式
          <select v-model="ui.mode">
            <option value="dem">高程 DEM（水面高程控制）</option>
            <option value="depth">水深（直接取值）</option>
          </select>
        </label>
        <div v-if="ui.fileName && heldFileNameIsPng" class="slider-row">
          <label>水深比例 <em>{{ ui.fileGain }}</em></label>
          <input type="range" min="5" max="500" step="5" v-model.number="ui.fileGain" @change="refreshGainFromFile" />
        </div>
        <p class="hint-inline">PNG/JPG 无地理坐标，将铺在默认区域内；GeoTIFF 使用文件自带范围。</p>
      </div>

      <div v-if="processing" class="progress"><i style="width:100%"></i><span>采样 / 解析中…</span></div>

      <div v-if="hasResult && hasDem" class="slider-row">
        <label>水面高程(米) <em>{{ ui.waterLevel.toFixed(1) }}</em></label>
        <input type="range" :min="waterRange.min" :max="waterRange.max" step="1" v-model.number="ui.waterLevel" @change="refreshDepthFromLevel" />
      </div>

      <p class="hint">
        <b>流程：</b>① 选择数据源：真实地形采样（自动示例 / 四至 / 贴地框选）或上传 DEM / 水深栅格 / 归一化水深图；② 调整水面高程（DEM 源）或水深比例（图片源）；③ 水深图叠加地图并预览，可导出 GeoTIFF（含地理坐标）或 PNG 图。<br />
        <b>贴地框选：</b>框选矩形随地形起伏贴合地表显示，实时预览范围。<br />
        <b>导出：</b>TIF 为 Float32 水深栅格（EPSG:4326），可在 GIS 软件中加载。
      </p>
    </div>

    <div v-if="hasResult" class="result-panel">
      <div class="panel-title">水深图结果</div>
      <div class="color-bar"><i></i><span>浅</span><span>深</span></div>
      <img :src="previewUrl" alt="水深图预览" />
      <p class="data mono">{{ ui.dataText }}</p>
      <p class="extent">{{ ui.extentText }}</p>
      <div class="download-row"><button @click="download('png')">下载 PNG</button><button @click="download('tif')">下载 TIF</button></div>
      <div class="overlay-group">
        <span class="overlay-title">地图叠加显示</span>
        <label class="switch-row">
          <span>显示水深图层</span>
          <input v-model="overlayVisible" type="checkbox" />
        </label>
        <label class="switch-row">
          <span>显示范围矩形</span>
          <input v-model="rectVisible" type="checkbox" />
        </label>
        <label class="opacity-row">
          <span>透明度</span>
          <input v-model.number="overlayOpacity" type="range" min="0" max="1" step="0.05" />
          <em>{{ overlayOpacity.toFixed(2) }}</em>
        </label>
      </div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.wde-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.control-panel, .result-panel { position: absolute; top: 12px; z-index: 10; display: flex; flex-direction: column; gap: 9px; padding: 12px; border: 1px solid rgba(137,210,233,.3); border-radius: 9px; background: rgba(8,32,49,.88); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.control-panel { right: 12px; width: 278px; max-height: calc(100% - 24px); overflow-y: auto; box-sizing: border-box; }
.result-panel { left: 12px; width: 210px; }
.panel-title { font-size: 12px; font-weight: 700; }
.subtitle { margin: 0 0 2px; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.sec-title { margin-top: 8px; font-size: 11px; font-weight: 700; color: #65d3eb; letter-spacing: 0.03em; }
.res-row { display: flex; align-items: center; justify-content: space-between; color: #bdd9e4; gap: 6px; }
.control-panel select { border: 1px solid rgba(137,210,233,.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.bounds-group { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid rgba(137,210,233,.18); border-radius: 6px; }
.bounds-title { color: #bdd9e4; font-size: 10px; }
.bounds-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.bounds-grid label { display: flex; align-items: center; justify-content: space-between; color: #bdd9e4; font-size: 10px; gap: 4px; }
.bounds-grid input { width: 62px; min-width: 0; height: 21px; padding: 0 5px; border: 1px solid rgba(137,210,233,.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.bounds-grid input:disabled { opacity: .5; }
.primary-button, .secondary-button, .download-row button { min-height: 27px; border: 0; border-radius: 5px; color: #edfaff; cursor: pointer; font-size: 11px; }
.primary-button, .download-row button { background: #257f9e; }
.secondary-button { background: rgba(137,210,233,.22); }
.primary-button:disabled, .secondary-button:disabled, .download-row button:disabled { cursor: default; opacity: .5; }
.progress { position: relative; height: 15px; overflow: hidden; border-radius: 4px; background: rgba(137,210,233,.18); }
.progress i { display: block; height: 100%; background: linear-gradient(90deg, #2f80ed, #65d3eb); }
.progress span { position: absolute; inset: 0; display: grid; place-items: center; font-size: 10px; color: #eaf7fc; }
.slider-row { margin-top: 7px; }
.slider-row label { display: flex; justify-content: space-between; align-items: center; color: #bdd9e4; font-size: 11px; }
.slider-row label em { font-style: normal; color: #65d3eb; font-weight: 700; }
.slider-row input[type="range"] { width: 100%; margin: 3px 0 0; accent-color: #2f80ed; background: transparent; }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.hint b { color: #9fb3cc; }
.hint-inline { margin: 2px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.5; }
.color-bar { display: flex; align-items: center; gap: 6px; font-size: 10px; color: #bdd9e4; }
.color-bar i { flex: 1; height: 8px; border-radius: 4px; background: linear-gradient(90deg, #1033eb, #08b5eb, #2dd889, #f5d63d, #eb234c); }
.result-panel img { width: 100%; border-radius: 4px; image-rendering: pixelated; }
.result-panel p { margin: 0; font-size: 10px; color: #bdd9e4; line-height: 1.5; }
.result-panel .data { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #65d3eb; word-break: break-all; }
.result-panel .extent { font-size: 9px; color: #7f96b3; word-break: break-all; }
.download-row { display: flex; gap: 6px; }
.download-row button { flex: 1; }
.overlay-group { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; border-top: 1px solid rgba(137,210,233,.18); }
.overlay-title { color: #bdd9e4; font-size: 10px; }
.switch-row, .opacity-row { display: flex; align-items: center; justify-content: space-between; color: #bdd9e4; font-size: 10px; }
.opacity-row input[type="range"] { width: 80px; accent-color: #2f80ed; }
.opacity-row em { font-style: normal; color: #65d3eb; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
