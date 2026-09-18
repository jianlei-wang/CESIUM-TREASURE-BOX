<script setup lang="ts">
import { Cartesian2, Cartesian3, Cartographic, Color, ConstantPositionProperty, ConstantProperty, Math as CesiumMath, PolygonHierarchy, Rectangle, ScreenSpaceEventHandler, ScreenSpaceEventType, sampleTerrainMostDetailed, SingleTileImageryProvider, type Entity, type ImageryLayer, type Viewer } from 'cesium'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain, type SceneCallbacks } from '../../lib/cesium-scene'
import { buildWorldFile, writeGeoTiffFloat32 } from '../../lib/geotiff'
import { pickPosition } from '../measure-lib/pick'

type DepthMap = { width: number; height: number; heights: number[]; min: number; max: number; pngUrl: string; tiff: Blob; rectangle: Rectangle; cellLon: number; cellLat: number; westDeg: number; northDeg: number }

const MIN_SPACING = 5
const MAX_DIM = 1024
const METERS_PER_DEGREE = 111320

const container = ref<HTMLElement | null>(null)
const preview = ref<HTMLCanvasElement | null>(null)
const resolution = ref(128)
const samplingMode = ref<'dim' | 'spacing'>('dim')
const spacingMeters = ref(50)
const statusMessage = ref('正在加载带地形与三维模型的地图场景…')
const drawing = ref(false)
const selectionReady = ref(false)
const processing = ref(false)
const progress = ref(0)
const result = ref<DepthMap | undefined>()
const westInput = ref(116.3)
const eastInput = ref(116.48)
const southInput = ref(39.84)
const northInput = ref(40.0)
const overlayVisible = ref(false)
const overlayOpacity = ref(0.8)
let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let rectangleEntity: Entity | undefined
let boundsLabelEntity: Entity | undefined
let modelEntity: Entity | undefined
let startEntity: Entity | undefined
let endEntity: Entity | undefined
let firstCorner: Cartographic | undefined
let selectedRectangle: Rectangle | undefined
let overlayLayer: ImageryLayer | undefined

const resultText = computed(() => {
  if (!result.value) return ''
  const r = result.value
  const midLat = (r.rectangle.south + r.rectangle.north) / 2
  const cellLonM = r.cellLon * METERS_PER_DEGREE * Math.cos(midLat)
  const cellLatM = r.cellLat * METERS_PER_DEGREE
  return `${r.width} x ${r.height} | ${r.heights.length.toLocaleString()} 个采样点 | ${r.min.toFixed(1)}m 至 ${r.max.toFixed(1)}m | 格距约 ${cellLonM.toFixed(1)} x ${cellLatM.toFixed(1)}m`
})

const gridEstimate = computed(() => {
  const rect = tryBoundsRectangle()
  if (!rect) return ''
  const dims = computeGridDims(rect)
  return `${dims.cols} x ${dims.rows}`
})

function clampDim(value: number): number {
  return Math.max(2, Math.min(MAX_DIM, Math.round(Number.isFinite(value) ? value : 2)))
}

function computeGridDims(rectangle: Rectangle): { cols: number; rows: number } {
  if (samplingMode.value === 'spacing') {
    const spacing = Math.max(MIN_SPACING, Number(spacingMeters.value) || MIN_SPACING)
    const west = CesiumMath.toDegrees(rectangle.west)
    const east = CesiumMath.toDegrees(rectangle.east)
    const south = CesiumMath.toDegrees(rectangle.south)
    const north = CesiumMath.toDegrees(rectangle.north)
    const midLat = CesiumMath.toRadians((south + north) / 2)
    const spanLonM = Math.abs(east - west) * METERS_PER_DEGREE * Math.cos(midLat)
    const spanLatM = Math.abs(north - south) * METERS_PER_DEGREE
    return { cols: clampDim(spanLonM / spacing), rows: clampDim(spanLatM / spacing) }
  }
  const size = clampDim(resolution.value)
  return { cols: size, rows: size }
}

function normalizedRectangle(first: Cartographic, second: Cartographic): Rectangle {
  return new Rectangle(
    Math.min(first.longitude, second.longitude),
    Math.min(first.latitude, second.latitude),
    Math.max(first.longitude, second.longitude),
    Math.max(first.latitude, second.latitude)
  )
}

function rectangleHierarchy(rectangle: Rectangle): PolygonHierarchy {
  return new PolygonHierarchy(Cartesian3.fromRadiansArray([
    rectangle.west, rectangle.south,
    rectangle.east, rectangle.south,
    rectangle.east, rectangle.north,
    rectangle.west, rectangle.north
  ]))
}

function setRectangle(rectangle: Rectangle): void {
  selectedRectangle = rectangle
  if (!rectangleEntity || !viewer) return
  rectangleEntity.polygon!.hierarchy = new ConstantProperty(rectangleHierarchy(rectangle))
  rectangleEntity.show = true
  updateBoundsLabel(rectangle)
  viewer.scene.requestRender()
}

function updateBoundsLabel(rectangle: Rectangle): void {
  if (!viewer || viewer.isDestroyed()) return
  const text = `四至 西 ${CesiumMath.toDegrees(rectangle.west).toFixed(4)} | 东 ${CesiumMath.toDegrees(rectangle.east).toFixed(4)} | 南 ${CesiumMath.toDegrees(rectangle.south).toFixed(4)} | 北 ${CesiumMath.toDegrees(rectangle.north).toFixed(4)}`
  const position = Cartesian3.fromRadians(
    (rectangle.west + rectangle.east) / 2,
    (rectangle.south + rectangle.north) / 2,
    400
  )
  if (!boundsLabelEntity) {
    boundsLabelEntity = viewer.entities.add({
      position,
      label: {
        text,
        font: '12px sans-serif',
        fillColor: Color.WHITE,
        outlineColor: Color.fromCssColorString('#102b40'),
        outlineWidth: 3,
        showBackground: true,
        backgroundColor: Color.fromCssColorString('#0a2030').withAlpha(0.82),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
  } else {
    boundsLabelEntity.position = new ConstantPositionProperty(position)
    boundsLabelEntity.label!.text = new ConstantProperty(text)
  }
}

function removeOverlay(): void {
  if (overlayLayer && viewer && !viewer.isDestroyed()) {
    viewer.imageryLayers.remove(overlayLayer, true)
  }
  overlayLayer = undefined
}

function addOverlay(): void {
  if (!viewer || viewer.isDestroyed() || !result.value) return
  removeOverlay()
  try {
    overlayLayer = viewer.imageryLayers.addImageryProvider(
      new SingleTileImageryProvider({
        url: result.value.pngUrl,
        rectangle: result.value.rectangle ?? Rectangle.MAX_VALUE,
        tileWidth: result.value.width,
        tileHeight: result.value.height
      })
    )
    overlayLayer.alpha = overlayOpacity.value
    overlayLayer.show = true
    overlayVisible.value = true
  } catch (error) {
    overlayLayer = undefined
    const detail = error instanceof Error ? error.stack ?? error.message : String(error)
    statusMessage.value = `深度图已生成，但地图叠加显示失败：${detail}`
  }
}

watch(overlayVisible, (visible) => {
  if (visible) {
    if (!overlayLayer) addOverlay()
  } else if (overlayLayer) {
    overlayLayer.show = false
  }
})

watch(overlayOpacity, (alpha) => {
  if (overlayLayer) overlayLayer.alpha = alpha
})

function setMarker(entity: Entity | undefined, position: Cartesian3): Entity | undefined {
  if (!viewer) return entity
  if (entity) {
    entity.position = new ConstantPositionProperty(position)
    entity.show = true
    return entity
  }
  return viewer.entities.add({
    position,
    point: { pixelSize: 10, color: Color.fromCssColorString('#f6ca55'), outlineColor: Color.WHITE, outlineWidth: 2 },
    label: { text: '', font: '11px sans-serif', fillColor: Color.WHITE, outlineColor: Color.fromCssColorString('#102b40'), outlineWidth: 3, style: 2, pixelOffset: new Cartesian2(0, -18) }
  })
}

function setMarkerLabel(entity: Entity | undefined, text: string): void {
  if (entity?.label) entity.label.text = new ConstantProperty(text)
}

function tryBoundsRectangle(): Rectangle | undefined {
  const values = [westInput.value, eastInput.value, southInput.value, northInput.value]
  if (values.some((value) => !Number.isFinite(value))) return undefined
  const [west, east, south, north] = values
  if (west >= east || south >= north) return undefined
  if (west < -180 || east > 180 || south < -90 || north > 90) return undefined
  return Rectangle.fromDegrees(west, south, east, north)
}

async function generateFromBounds(): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  const rect = tryBoundsRectangle()
  if (!rect) {
    statusMessage.value = '四至范围无效：请填写有效经纬度，且西经 < 东经、南纬 < 北纬（经度 ±180，纬度 ±90）'
    return
  }
  stopDrawing()
  result.value = undefined
  progress.value = 0
  selectionReady.value = false
  drawing.value = false
  if (rectangleEntity) rectangleEntity.show = false
  setRectangle(rect)
  const start = Cartesian3.fromRadians(rect.west, rect.south)
  const end = Cartesian3.fromRadians(rect.east, rect.north)
  startEntity = setMarker(startEntity, start)
  setMarkerLabel(startEntity, '起点')
  endEntity = setMarker(endEntity, end)
  setMarkerLabel(endEntity, '终点')
  selectionReady.value = true
  statusMessage.value = '正在按四至范围采样地形高度…'
  await generateDepthMap()
}

watch([westInput, eastInput, southInput, northInput], () => {
  if (!viewer || viewer.isDestroyed() || drawing.value) return
  const rect = tryBoundsRectangle()
  if (rect && rectangleEntity) {
    setRectangle(rect)
  }
})

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function stopDrawing(): void {
  drawing.value = false
  firstCorner = undefined
  handler?.removeInputAction(ScreenSpaceEventType.LEFT_CLICK)
  handler?.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE)
}

function startDrawing(): void {
  if (!viewer) return
  result.value = undefined
  progress.value = 0
  selectionReady.value = false
  firstCorner = undefined
  selectedRectangle = undefined
  drawing.value = true
  if (rectangleEntity) rectangleEntity.show = false
  statusMessage.value = '点击地图确定矩形第一个角点'
  handler ??= new ScreenSpaceEventHandler(viewer.scene.canvas)
  handler.setInputAction((event: { position: Cartesian2 }) => {
    if (!viewer) return
    const position = pickPosition(viewer.scene, event.position)
    if (!position) return
    const corner = Cartographic.fromCartesian(position)
    if (!firstCorner) {
      firstCorner = corner
      startEntity = setMarker(startEntity, position)
      setMarkerLabel(startEntity, '起点')
      if (endEntity) endEntity.show = false
      statusMessage.value = '移动鼠标预览，第二次点击后自动生成深度图'
      return
    }
    setRectangle(normalizedRectangle(firstCorner, corner))
    endEntity = setMarker(endEntity, position)
    setMarkerLabel(endEntity, '终点')
    selectionReady.value = true
    stopDrawing()
    statusMessage.value = '正在采样矩形范围内的地形高度…'
    void generateDepthMap()
  }, ScreenSpaceEventType.LEFT_CLICK)
  handler.setInputAction((event: { endPosition: Cartesian2 }) => {
    if (!viewer || !firstCorner) return
    const position = pickPosition(viewer.scene, event.endPosition)
    if (position) {
      setRectangle(normalizedRectangle(firstCorner, Cartographic.fromCartesian(position)))
      endEntity = setMarker(endEntity, position)
      setMarkerLabel(endEntity, '终点预览')
    }
  }, ScreenSpaceEventType.MOUSE_MOVE)
}

function renderPreview(heights: number[], cols: number, rows: number, min: number, max: number): string {
  const canvas = preview.value
  if (!canvas) throw new Error('深度图预览画布尚未准备完成')
  canvas.width = cols
  canvas.height = rows
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建深度图画布')
  const pixels = context.createImageData(cols, rows)
  const range = max - min
  heights.forEach((height, index) => {
    const value = Math.round((range > 0 ? (height - min) / range : 0) * 255)
    const pixel = index * 4
    pixels.data[pixel] = value
    pixels.data[pixel + 1] = value
    pixels.data[pixel + 2] = value
    pixels.data[pixel + 3] = 255
  })
  context.putImageData(pixels, 0, 0)
  return canvas.toDataURL('image/png')
}

async function generateDepthMap(): Promise<void> {
  if (!viewer || !selectedRectangle) return
  try {
    processing.value = true
    progress.value = 0
    const { cols, rows } = computeGridDims(selectedRectangle)
    const westDeg = CesiumMath.toDegrees(selectedRectangle.west)
    const eastDeg = CesiumMath.toDegrees(selectedRectangle.east)
    const southDeg = CesiumMath.toDegrees(selectedRectangle.south)
    const northDeg = CesiumMath.toDegrees(selectedRectangle.north)
    const cellLon = (eastDeg - westDeg) / cols
    const cellLat = (northDeg - southDeg) / rows
    const spacing = Math.max(MIN_SPACING, Number(spacingMeters.value) || MIN_SPACING)
    const samplingNote = samplingMode.value === 'spacing'
      ? `按间距 ${spacing}m`
      : `按分辨率 ${cols}x${rows}`
    const heights: number[] = []
    const rowsPerBatch = Math.max(1, Math.floor(8192 / cols))
    statusMessage.value = `正在准备 ${cols} x ${rows} 个采样点（${samplingNote}）…`
    await yieldFrame()
    for (let startY = 0; startY < rows; startY += rowsPerBatch) {
      const samples: Cartographic[] = []
      const endY = Math.min(rows, startY + rowsPerBatch)
      for (let y = startY; y < endY; y += 1) {
        const lat = northDeg - (y + 0.5) * cellLat
        for (let x = 0; x < cols; x += 1) {
          samples.push(new Cartographic(CesiumMath.toRadians(westDeg + (x + 0.5) * cellLon), CesiumMath.toRadians(lat)))
        }
      }
      statusMessage.value = `正在采样地形高度：${Math.round(startY / rows * 100)}%`
      const sampled = await sampleTerrainMostDetailed(viewer.terrainProvider, samples)
      heights.push(...sampled.map((sample) => sample.height ?? 0))
      progress.value = Math.round(endY / rows * 85)
      await yieldFrame()
    }
    statusMessage.value = '正在计算高程范围并绘制预览…'
    progress.value = 90
    await yieldFrame()
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (let i = 0; i < heights.length; i += 1) {
      const height = heights[i]
      if (height < min) min = height
      if (height > max) max = height
    }
    const pngUrl = renderPreview(heights, cols, rows, min, max)
    statusMessage.value = '正在编码带地理坐标的 GeoTIFF 下载文件…'
    progress.value = 95
    await yieldFrame()
    const tiffBytes = writeGeoTiffFloat32({
      width: cols,
      height: rows,
      west: westDeg,
      north: northDeg,
      cellLon,
      cellLat,
      values: Float32Array.from(heights),
      description: 'terrain elevation (m) EPSG:4326'
    })
    result.value = {
      width: cols,
      height: rows,
      heights,
      min,
      max,
      pngUrl,
      tiff: new Blob([tiffBytes.buffer as ArrayBuffer], { type: 'image/tiff' }),
      rectangle: Rectangle.clone(selectedRectangle),
      cellLon,
      cellLat,
      westDeg,
      northDeg
    }
    progress.value = 100
    const cellNote = `格距约 ${(cellLon * METERS_PER_DEGREE * Math.cos(CesiumMath.toRadians((southDeg + northDeg) / 2))).toFixed(1)} x ${(cellLat * METERS_PER_DEGREE).toFixed(1)}m`
    statusMessage.value = `深度图已生成（${cols} x ${rows}，${cellNote}），可在左上角预览与下载，地图上叠加显示深度图。`
    addOverlay()
  } catch (error) {
    statusMessage.value = error instanceof Error ? `深度图生成失败：${error.stack ?? error.message}` : '深度图生成失败'
  } finally {
    processing.value = false
  }
}

function triggerDownload(url: string, filename: string): void {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
}

function download(type: 'png' | 'tiff'): void {
  if (!result.value) return
  if (type === 'png') {
    triggerDownload(result.value.pngUrl, 'rectangle-depth-map.png')
    return
  }
  const source = URL.createObjectURL(result.value.tiff)
  triggerDownload(source, 'rectangle-depth-map.tif')
  URL.revokeObjectURL(source)
}

function downloadWorldFile(): void {
  if (!result.value) return
  const content = buildWorldFile({
    west: result.value.westDeg,
    north: result.value.northDeg,
    cellLon: result.value.cellLon,
    cellLat: result.value.cellLat
  })
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
  triggerDownload(url, 'rectangle-depth-map.pgw')
  URL.revokeObjectURL(url)
}

async function mountScene(): Promise<void> {
  if (!container.value) return
  const callbacks: SceneCallbacks = { onStatus: (message) => { statusMessage.value = message }, onBasemapReady: () => { statusMessage.value = '正在加载地形…' } }
  try {
    viewer = createMapScene(container.value, callbacks)
    loadBingImagery(viewer, callbacks)
    viewer.scene.globe.depthTestAgainstTerrain = true
    await loadWorldTerrain(viewer)
    if (!viewer || viewer.isDestroyed()) return
    modelEntity = viewer.entities.add({
      position: Cartesian3.fromDegrees(116.391, 39.919, 100),
      box: { dimensions: new Cartesian3(180, 120, 200), material: Color.fromCssColorString('#f0a94b').withAlpha(0.86), outline: true, outlineColor: Color.WHITE }
    })
    rectangleEntity = viewer.entities.add({ polygon: { hierarchy: new ConstantProperty(new PolygonHierarchy()), material: Color.fromCssColorString('#36c5e8').withAlpha(0.32), outline: true, outlineColor: Color.fromCssColorString('#7ef0ff'), outlineWidth: 2, perPositionHeight: true }, show: false })
    viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(116.391, 39.919, 4800) })
    statusMessage.value = '场景已就绪。点击“框选矩形范围”开始生成深度图。'
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(() => { void mountScene() })
onBeforeUnmount(() => {
  handler?.destroy()
  handler = undefined
  removeOverlay()
  modelEntity = undefined
  boundsLabelEntity = undefined
  rectangleEntity = undefined
  startEntity = undefined
  endEntity = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="depth-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="depth-panel">
      <div class="panel-title">矩形范围深度图</div>
      <div class="sampling-group">
        <span class="bounds-title">采样方式</span>
        <div class="mode-row">
          <button class="mode-button" :class="{ active: samplingMode === 'dim' }" :disabled="drawing || processing" @click="samplingMode = 'dim'">按分辨率</button>
          <button class="mode-button" :class="{ active: samplingMode === 'spacing' }" :disabled="drawing || processing" @click="samplingMode = 'spacing'">按间距</button>
        </div>
        <label v-if="samplingMode === 'dim'">分辨率 <select v-model.number="resolution" :disabled="drawing || processing"><option :value="64">64 x 64</option><option :value="128">128 x 128</option><option :value="256">256 x 256</option><option :value="512">512 x 512</option><option :value="1024">1024 x 1024</option></select></label>
        <label v-else>间距(米)<input v-model.number="spacingMeters" type="number" min="5" max="5000" step="5" :disabled="drawing || processing" /></label>
        <span class="grid-estimate">预计网格：{{ gridEstimate || '—' }}</span>
      </div>
      <div class="bounds-group">
        <span class="bounds-title">四至范围（经纬度）</span>
        <div class="bounds-grid">
          <label>西经<input v-model.number="westInput" type="number" step="0.0001" :disabled="drawing || processing" /></label>
          <label>东经<input v-model.number="eastInput" type="number" step="0.0001" :disabled="drawing || processing" /></label>
          <label>南纬<input v-model.number="southInput" type="number" step="0.0001" :disabled="drawing || processing" /></label>
          <label>北纬<input v-model.number="northInput" type="number" step="0.0001" :disabled="drawing || processing" /></label>
        </div>
      </div>
      <button class="primary-button" :disabled="drawing || processing" @click="generateFromBounds">按四至生成</button>
      <button class="primary-button" :disabled="drawing || processing" @click="startDrawing">框选矩形范围</button>
      <button class="secondary-button" :disabled="!selectionReady || drawing || processing" @click="generateDepthMap">重新生成</button>
      <div v-if="processing" class="progress"><i :style="{ width: `${progress}%` }"></i><span>{{ progress }}%</span></div>
      <p class="hint">可输入西/东/南/北四至经纬度一键生成，或在地图上框选矩形范围；按分辨率使用固定方形网格，按间距(米)按实际地面距离生成网格；导出的 GeoTIFF 已写入 WGS84 地理坐标，可直接叠加到 GIS 软件。</p>
    </div>
    <div v-if="result" class="result-panel">
      <div class="panel-title">深度图预览</div>
      <img :src="result.pngUrl" alt="矩形范围深度图预览" />
      <p>{{ resultText }}</p>
      <div class="download-row"><button @click="download('png')">下载 PNG</button><button @click="download('tiff')">下载 GeoTIFF</button></div>
      <button class="secondary-button" @click="downloadWorldFile">下载 PNG 坐标文件(.pgw)</button>
      <div class="overlay-group">
        <span class="overlay-title">地图叠加显示</span>
        <label class="switch-row">
          <span>显示深度图层</span>
          <input v-model="overlayVisible" type="checkbox" />
        </label>
        <label class="opacity-row">
          <span>透明度</span>
          <input v-model.number="overlayOpacity" type="range" min="0" max="1" step="0.05" />
          <em>{{ overlayOpacity.toFixed(2) }}</em>
        </label>
      </div>
    </div>
    <canvas ref="preview" class="preview-canvas"></canvas>
    <div class="status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.depth-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }.cesium-container { width: 100%; height: 100%; }.depth-panel,.result-panel { position: absolute; top: 12px; z-index: 10; display: flex; flex-direction: column; gap: 9px; width: 236px; padding: 12px; border: 1px solid rgba(137,210,233,.3); border-radius: 9px; background: rgba(8,32,49,.88); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }.depth-panel { right: 12px; }.result-panel { left: 12px; width: 202px; }.panel-title { font-size: 12px; font-weight: 700; }.depth-panel label { display: flex; align-items: center; justify-content: space-between; color: #bdd9e4; }.bounds-group { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid rgba(137,210,233,.18); border-radius: 6px; }.bounds-title { color: #bdd9e4; font-size: 10px; }.bounds-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }.bounds-grid label { display: flex; align-items: center; justify-content: space-between; color: #bdd9e4; font-size: 10px; gap: 4px; }.bounds-grid input { width: 62px; min-width: 0; height: 21px; padding: 0 5px; border: 1px solid rgba(137,210,233,.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }.bounds-grid input:disabled { opacity: .5; }.depth-panel select { border: 1px solid rgba(137,210,233,.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }.primary-button,.secondary-button,.download-row button { min-height: 27px; border: 0; border-radius: 5px; color: #edfaff; cursor: pointer; font-size: 11px; }.primary-button,.download-row button { background: #257f9e; }.secondary-button { background: rgba(137,210,233,.22); }.primary-button:disabled,.secondary-button:disabled { cursor: default; opacity: .5; }.progress { position: relative; height: 15px; overflow: hidden; border-radius: 4px; background: rgba(137,210,233,.18); }.progress i { display: block; height: 100%; background: #36a8cc; transition: width .15s; }.progress span { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font-size: 9px; }.hint,.result-panel p { margin: 0; color: #a4c6d2; font-size: 10px; line-height: 1.4; }.result-panel img { width: 100%; image-rendering: pixelated; border: 1px solid rgba(137,210,233,.25); }.download-row { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }.overlay-group { display: flex; flex-direction: column; gap: 6px; padding: 7px; border: 1px solid rgba(137,210,233,.18); border-radius: 6px; }.overlay-title { color: #bdd9e4; font-size: 10px; }.switch-row, .opacity-row { display: flex; align-items: center; justify-content: space-between; color: #bdd9e4; font-size: 10px; gap: 6px; }.switch-row input { accent-color: #36a8cc; }.opacity-row input[type=range] { flex: 1; min-width: 0; accent-color: #36a8cc; }.opacity-row em { flex: 0 0 30px; font-style: normal; text-align: right; color: #a4c6d2; font-family: ui-monospace, Menlo, monospace; }.preview-canvas { display: none; }.status { position: absolute; right: 12px; bottom: 12px; z-index: 10; max-width: 320px; padding: 7px 9px; border-radius: 5px; background: rgba(8,32,49,.8); color: #d9eff6; font-size: 10px; }
</style>

<style scoped>
.sampling-group { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid rgba(137,210,233,.18); border-radius: 6px; }
.mode-row { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.mode-button { min-height: 22px; border: 1px solid rgba(137,210,233,.3); border-radius: 4px; background: transparent; color: #bdd9e4; cursor: pointer; font-size: 10px; }
.mode-button.active { border-color: #36a8cc; background: rgba(54,168,204,.24); color: #edfaff; }
.mode-button:disabled { cursor: default; opacity: .5; }
.sampling-group input[type=number] { width: 62px; min-width: 0; height: 21px; padding: 0 5px; border: 1px solid rgba(137,210,233,.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.sampling-group input[type=number]:disabled { opacity: .5; }
.grid-estimate { color: #8fb8c6; font-size: 10px; }
</style>
