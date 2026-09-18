<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  HeightReference,
  PolygonHierarchy,
  Rectangle,
  Resource,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  SingleTileImageryProvider,
  sampleTerrainMostDetailed,
  Math as CesiumMath,
  type Entity,
  type ImageryLayer,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain, type SceneCallbacks } from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib/pick'
import { FluidDemo, type SimParams } from '../flood-sim-lib/fluid-demo'
import { getDamPos, type Extent } from '../flood-sim-lib/shaders'

type DepthMapResult = {
  width: number
  heights: number[]
  min: number
  max: number
  pngUrl: string
  tiff: Blob
  rectangle: Rectangle
  canvas: HTMLCanvasElement
}

const container = ref<HTMLElement | null>(null)
const preview = ref<HTMLCanvasElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const running = ref(false)
const terrainReady = ref(false)
const drawing = ref(false)
const processing = ref(false)
const progress = ref(0)
const selectionReady = ref(false)
const result = ref<DepthMapResult | undefined>()
const resolution = ref(256)
const westInput = ref('')
const eastInput = ref('')
const southInput = ref('')
const northInput = ref('')
const overlayVisible = ref(false)
const overlayOpacity = ref(0.8)
const rectangleVisible = ref(true)
const waterSourceText = ref('点击地图选择出水点')
const damPosText = ref('未设置')

const ui = reactive({
  waterAddRate: 0.001,
  waterSourceRadius: 0.03,
  attenuation: 0.995,
  strenght: 0.2,
  minTotalFlow: 0.0001,
  initialWaterLevel: 0,
  depth: 180,
  evaporationRate: 0.0,
  waterAlpha: 1.0,
  shallowColor: '#2f6fdd',
  deepColor: '#0b3c91',
  gradientDepth: 0.3,
  minElevation: 0,
  maxElevation: 1000,
  damHeight: 0.0,
  setDam: false
})

const simParams: SimParams = {
  waterAddRate: ui.waterAddRate,
  waterSourceRadius: ui.waterSourceRadius,
  attenuation: ui.attenuation,
  strenght: ui.strenght,
  minTotalFlow: ui.minTotalFlow,
  initialWaterLevel: ui.initialWaterLevel,
  depth: ui.depth,
  evaporationRate: ui.evaporationRate,
  waterAlpha: ui.waterAlpha,
  shallow: Color.fromCssColorString(ui.shallowColor),
  deep: Color.fromCssColorString(ui.deepColor),
  gradientDepth: ui.gradientDepth,
  minElevation: ui.minElevation,
  maxElevation: ui.maxElevation,
  damHeight: ui.damHeight,
  setDam: ui.setDam,
  waterSource: new Cartesian2(0.5, 0.5),
  damStart: new Cartesian2(0.8, 0),
  damEnd: new Cartesian2(1.0, 0.2)
}

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let drawHandler: ScreenSpaceEventHandler | undefined
let sim: FluidDemo | undefined
let waterMarker: Entity | undefined
let rectangleEntity: Entity | undefined
let rectangleOutlineEntity: Entity | undefined
let boundsLabelEntity: Entity | undefined
let startEntity: Entity | undefined
let endEntity: Entity | undefined
let firstCorner: Cartographic | undefined
let selectedRectangle: Rectangle | undefined
let overlayLayer: ImageryLayer | undefined
let extent: Extent | undefined
let wallPositions: number[] = []
let recordPos: number[] = []

const resultText = computed(() => {
  if (!result.value) return ''
  return `${result.value.width} x ${result.value.width} | ${result.value.heights.length.toLocaleString()} 个采样点 | ${result.value.min.toFixed(1)}m 至 ${result.value.max.toFixed(1)}m`
})

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
  rectangleEntity.show = rectangleVisible.value
  if (rectangleOutlineEntity) {
    rectangleOutlineEntity.polyline!.positions = new ConstantProperty(rectangleOutlinePositions(rectangle))
    rectangleOutlineEntity.show = rectangleVisible.value
  }
  updateBoundsLabel(rectangle)
  viewer.scene.requestRender()
}

function rectangleOutlinePositions(rectangle: Rectangle): Cartesian3[] {
  return Cartesian3.fromRadiansArray([
    rectangle.west, rectangle.south,
    rectangle.east, rectangle.south,
    rectangle.east, rectangle.north,
    rectangle.west, rectangle.north,
    rectangle.west, rectangle.south
  ])
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
        tileHeight: result.value.width
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

watch(rectangleVisible, (visible) => {
  if (!viewer || viewer.isDestroyed()) return
  if (rectangleEntity) rectangleEntity.show = visible && !!selectedRectangle
  if (rectangleOutlineEntity) rectangleOutlineEntity.show = visible && !!selectedRectangle
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
  const values = [westInput.value, eastInput.value, southInput.value, northInput.value].map(parseFloat)
  if (values.some((value) => !Number.isFinite(value))) return undefined
  const [west, east, south, north] = values
  if (west >= east || south >= north) return undefined
  if (west < -180 || east > 180 || south < -90 || north > 90) return undefined
  return Rectangle.fromDegrees(west, south, east, north)
}

async function generateFromBounds(): Promise<void> {
  if (!viewer || viewer.isDestroyed() || !terrainReady.value) return
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

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function stopDrawing(): void {
  drawing.value = false
  firstCorner = undefined
  if (drawHandler && !drawHandler.isDestroyed()) drawHandler.destroy()
  drawHandler = undefined
}

function startDrawing(): void {
  if (!viewer || !terrainReady.value) return
  result.value = undefined
  progress.value = 0
  selectionReady.value = false
  firstCorner = undefined
  selectedRectangle = undefined
  drawing.value = true
  if (rectangleEntity) rectangleEntity.show = false
  if (rectangleOutlineEntity) rectangleOutlineEntity.show = false
  statusMessage.value = '点击地图确定矩形第一个角点'
  if (drawHandler && !drawHandler.isDestroyed()) drawHandler.destroy()
  drawHandler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  drawHandler.setInputAction((event: { position: Cartesian2 }) => {
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
  drawHandler.setInputAction((event: { endPosition: Cartesian2 }) => {
    if (!viewer || !firstCorner) return
    const position = pickPosition(viewer.scene, event.endPosition)
    if (position) {
      setRectangle(normalizedRectangle(firstCorner, Cartographic.fromCartesian(position)))
      endEntity = setMarker(endEntity, position)
      setMarkerLabel(endEntity, '终点预览')
    }
  }, ScreenSpaceEventType.MOUSE_MOVE)
}

function renderPreview(heights: number[], size: number, min: number, max: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建深度图画布')
  const pixels = context.createImageData(size, size)
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
  return canvas
}

function encodeTiff(grayscale: Uint8Array, width: number, height: number): Blob {
  const entries = 10
  const imageOffset = 8 + 2 + entries * 12 + 4
  const data = new ArrayBuffer(imageOffset + grayscale.length)
  const view = new DataView(data)
  view.setUint16(0, 0x4949, false)
  view.setUint16(2, 42, true)
  view.setUint32(4, 8, true)
  view.setUint16(8, entries, true)
  const tag = (index: number, id: number, value: number) => {
    const offset = 10 + index * 12
    view.setUint16(offset, id, true)
    view.setUint16(offset + 2, 4, true)
    view.setUint32(offset + 4, 1, true)
    view.setUint32(offset + 8, value, true)
  }
  tag(0, 256, width)
  tag(1, 257, height)
  tag(2, 258, 8)
  tag(3, 259, 1)
  tag(4, 262, 1)
  tag(5, 273, imageOffset)
  tag(6, 277, 1)
  tag(7, 278, height)
  tag(8, 279, grayscale.length)
  tag(9, 284, 1)
  view.setUint32(10 + entries * 12, 0, true)
  new Uint8Array(data, imageOffset).set(grayscale)
  return new Blob([data], { type: 'image/tiff' })
}

async function generateDepthMap(): Promise<void> {
  if (!viewer || !selectedRectangle || !terrainReady.value) return
  try {
    processing.value = true
    progress.value = 0
    const size = resolution.value
    const heights: number[] = []
    const rowsPerBatch = Math.max(1, Math.floor(8192 / size))
    statusMessage.value = `正在准备 ${size} x ${size} 个采样点…`
    await yieldFrame()
    for (let startY = 0; startY < size; startY += rowsPerBatch) {
      const samples: Cartographic[] = []
      const endY = Math.min(size, startY + rowsPerBatch)
      for (let y = startY; y < endY; y += 1) {
        for (let x = 0; x < size; x += 1) {
          samples.push(new Cartographic(
            selectedRectangle.west + (selectedRectangle.east - selectedRectangle.west) * (x / (size - 1)),
            selectedRectangle.north - (selectedRectangle.north - selectedRectangle.south) * (y / (size - 1))
          ))
        }
      }
      statusMessage.value = `正在采样地形高度：${Math.round(startY / size * 100)}%`
      const sampled = await sampleTerrainMostDetailed(viewer.terrainProvider, samples)
      heights.push(...sampled.map((sample) => sample.height ?? 0))
      progress.value = Math.round(endY / size * 85)
      await yieldFrame()
    }
    statusMessage.value = '正在归一化高程并生成深度图…'
    progress.value = 90
    await yieldFrame()
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (let i = 0; i < heights.length; i += 1) {
      const height = heights[i]
      if (height < min) min = height
      if (height > max) max = height
    }
    const depthCanvas = renderPreview(heights, size, min, max)
    const pngUrl = depthCanvas.toDataURL('image/png')
    const range = max - min
    const grayscale = Uint8Array.from(heights, (height) => Math.round((range > 0 ? (height - min) / range : 0) * 255))
    statusMessage.value = '正在编码 TIFF 下载文件…'
    progress.value = 95
    await yieldFrame()
    const [west, south, east, north] = [
      CesiumMath.toDegrees(selectedRectangle.west),
      CesiumMath.toDegrees(selectedRectangle.south),
      CesiumMath.toDegrees(selectedRectangle.east),
      CesiumMath.toDegrees(selectedRectangle.north)
    ]
    extent = [west, south, east, north]
    ui.minElevation = Math.max(0, Math.round(min - 100))
    ui.maxElevation = Math.round(max + 100)
    result.value = {
      width: size,
      heights,
      min,
      max,
      pngUrl,
      tiff: encodeTiff(grayscale, size, size),
      rectangle: Rectangle.clone(selectedRectangle),
      canvas: depthCanvas
    }
    progress.value = 100
    statusMessage.value = '深度图已生成，点击「开始模拟」选择出水点并执行洪水模拟。'
    addOverlay()
    if (viewer && !viewer.isDestroyed()) {
      viewer.camera.flyTo({ destination: Rectangle.fromDegrees(west, south, east, north), duration: 1.0 })
    }
  } catch (error) {
    statusMessage.value = error instanceof Error ? `深度图生成失败：${error.stack ?? error.message}` : '深度图生成失败'
  } finally {
    processing.value = false
  }
}

function download(type: 'png' | 'tiff'): void {
  if (!result.value) return
  const source = type === 'png' ? result.value.pngUrl : URL.createObjectURL(result.value.tiff)
  const link = document.createElement('a')
  link.href = source
  link.download = `flood-depth-map.${type === 'png' ? 'png' : 'tiff'}`
  link.click()
  if (type === 'tiff') URL.revokeObjectURL(source)
}

function drawWall(): Entity {
  if (!viewer || !extent) throw new Error('viewer or extent missing')
  const wall = viewer.entities.add({
    name: 'Dam wall',
    wall: {
      positions: new CallbackProperty(() => {
        return Cartesian3.fromDegreesArray(wallPositions)
      }, false),
      maximumHeights: [simParams.minElevation, simParams.minElevation],
      minimumHeights: new CallbackProperty(() => {
        const height = (simParams.maxElevation - simParams.minElevation) * simParams.damHeight
        return [simParams.minElevation + height, simParams.minElevation + height]
      }, false),
      material: Color.WHITE.withAlpha(0.85),
      outline: false,
      outlineColor: Color.BLACK
    }
  })
  return wall
}

function updateWaterMarker(position: Cartesian3): void {
  if (!viewer) return
  if (waterMarker) viewer.entities.remove(waterMarker)
  waterMarker = viewer.entities.add({
    position,
    point: {
      pixelSize: 10,
      color: Color.fromCssColorString('#ff5252'),
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
}

function onCanvasClick(movement: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed()) return
  if (drawing.value) return
  const pickedPosition = viewer.scene.pickPosition(movement.position)
  if (!pickedPosition || !extent) return
  if (ui.setDam) {
    if (recordPos.length >= 4) return
    const cartographic = Cartographic.fromCartesian(pickedPosition)
    const lon = CesiumMath.toDegrees(cartographic.longitude)
    const lat = CesiumMath.toDegrees(cartographic.latitude)
    recordPos.push(lon, lat)
    if (recordPos.length === 4) {
      wallPositions = [...recordPos]
      recordPos = []
      if (sim && sim.blueWall) {
        viewer.entities.remove(sim.blueWall)
        sim.blueWall = undefined
      }
      simParams.damStart = getDamPos(wallPositions[0], wallPositions[1], extent)
      simParams.damEnd = getDamPos(wallPositions[2], wallPositions[3], extent)
      if (sim) sim.blueWall = drawWall()
      damPosText.value = `${wallPositions[0].toFixed(5)}, ${wallPositions[1].toFixed(5)} → ${wallPositions[2].toFixed(5)}, ${wallPositions[3].toFixed(5)}`
    }
    return
  }
  const cartographic = Cartographic.fromCartesian(pickedPosition)
  const lon = CesiumMath.toDegrees(cartographic.longitude)
  const lat = CesiumMath.toDegrees(cartographic.latitude)
  const [minLon, minLat, maxLon, maxLat] = extent
  const x = (lon - minLon) / (maxLon - minLon)
  const y = 1 - (lat - minLat) / (maxLat - minLat)
  const pos = new Cartesian2(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)))
  simParams.waterSource = pos
  if (sim) sim.setWaterPos(pos)
  waterSourceText.value = `(${pos.x.toFixed(4)}, ${pos.y.toFixed(4)})`
  updateWaterMarker(pickedPosition)
}

function flushParams(): void {
  simParams.waterAddRate = ui.waterAddRate
  simParams.waterSourceRadius = ui.waterSourceRadius
  simParams.attenuation = ui.attenuation
  simParams.strenght = ui.strenght
  simParams.minTotalFlow = ui.minTotalFlow
  simParams.initialWaterLevel = ui.initialWaterLevel
  simParams.depth = ui.depth
  simParams.evaporationRate = ui.evaporationRate
  simParams.waterAlpha = ui.waterAlpha
  simParams.shallow = Color.fromCssColorString(ui.shallowColor)
  simParams.deep = Color.fromCssColorString(ui.deepColor)
  simParams.gradientDepth = ui.gradientDepth
  simParams.minElevation = ui.minElevation
  simParams.maxElevation = ui.maxElevation
  simParams.damHeight = ui.damHeight
  simParams.setDam = ui.setDam
}

async function startSimulation(): Promise<void> {
  if (!viewer || viewer.isDestroyed() || sim || !result.value || !extent) return
  if (!terrainReady.value) {
    statusMessage.value = '地形尚未加载完成，请稍候'
    return
  }
  statusMessage.value = '正在初始化流体模拟…'
  try {
    flushParams()
    sim = new FluidDemo(viewer, simParams, result.value.canvas, extent)
    sim.waterPos = simParams.waterSource
    if (ui.setDam && wallPositions.length === 4) {
      sim.blueWall = drawWall()
    }
    running.value = true
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
}

function stopSimulation(): void {
  if (sim) {
    sim.destroy()
    sim = undefined
  }
  if (waterMarker && viewer) {
    viewer.entities.remove(waterMarker)
    waterMarker = undefined
  }
  running.value = false
  statusMessage.value = ''
}

function toggleSimulation(): void {
  if (running.value) {
    stopSimulation()
  } else {
    void startSimulation()
  }
}

function onElevationChange(): void {
  if (running.value) {
    stopSimulation()
    void startSimulation()
  }
}

function resetWaterSource(): void {
  simParams.waterSource = new Cartesian2(0.5, 0.5)
  if (sim) sim.setWaterPos(simParams.waterSource)
  waterSourceText.value = '点击地图选择出水点'
  if (waterMarker && viewer) {
    viewer.entities.remove(waterMarker)
    waterMarker = undefined
  }
}

watch(
  () => [ui.minElevation, ui.maxElevation, ui.initialWaterLevel],
  () => onElevationChange()
)
watch(ui, () => flushParams(), { deep: true })

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => {
      statusMessage.value = message
    },
    onBasemapReady: () => {
      statusMessage.value = '正在加载Cesium World Terrain...'
    }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    if (!viewer || viewer.isDestroyed()) return
    viewer.scene.globe.depthTestAgainstTerrain = true
    rectangleEntity = viewer.entities.add({
      polygon: {
        hierarchy: new ConstantProperty(new PolygonHierarchy()),
        material: Color.fromCssColorString('#36c5e8').withAlpha(0.32),
        height: 0,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        perPositionHeight: false
      },
      show: false
    })
    rectangleOutlineEntity = viewer.entities.add({
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
        if (viewer && !viewer.isDestroyed()) statusMessage.value = '地形加载失败，请重试'
      })
      .finally(() => {
        if (!viewer || viewer.isDestroyed()) return
        statusMessage.value = '场景已就绪：输入四至或框选范围生成深度图。'
        viewer.camera.flyTo({
          destination: Rectangle.fromDegrees(116.30, 39.86, 116.42, 39.94),
          duration: 1.0
        })
        window.setTimeout(() => {
          if (!viewer || viewer.isDestroyed()) return
          statusMessage.value = ''
        }, 3000)
      })
    handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((movement: { position: Cartesian2 }) => {
      onCanvasClick(movement)
    }, ScreenSpaceEventType.LEFT_CLICK)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  stopSimulation()
  if (drawHandler && !drawHandler.isDestroyed()) drawHandler.destroy()
  drawHandler = undefined
  if (handler && !handler.isDestroyed()) handler.destroy()
  handler = undefined
  removeOverlay()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="fds-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">深度图洪水模拟</div>

      <div class="sec-title">① 生成深度图</div>
      <label class="res-row">分辨率 <select v-model.number="resolution" :disabled="drawing || processing || running"><option :value="128">128 x 128</option><option :value="256">256 x 256</option><option :value="512">512 x 512</option><option :value="1024">1024 x 1024</option></select></label>
      <div class="bounds-group">
        <span class="bounds-title">四至范围（经纬度）</span>
        <div class="bounds-grid">
          <label>西经<input v-model="westInput" type="number" step="0.0001" :disabled="drawing || processing || running" /></label>
          <label>东经<input v-model="eastInput" type="number" step="0.0001" :disabled="drawing || processing || running" /></label>
          <label>南纬<input v-model="southInput" type="number" step="0.0001" :disabled="drawing || processing || running" /></label>
          <label>北纬<input v-model="northInput" type="number" step="0.0001" :disabled="drawing || processing || running" /></label>
        </div>
      </div>
      <button class="primary-button" :disabled="!terrainReady || drawing || processing || running" @click="generateFromBounds">按四至生成</button>
      <button class="primary-button" :disabled="!terrainReady || drawing || processing || running" @click="startDrawing">框选矩形范围</button>
      <button class="secondary-button" :disabled="!selectionReady || drawing || processing || running" @click="generateDepthMap">重新生成</button>
      <div v-if="processing" class="progress"><i :style="{ width: `${progress}%` }"></i><span>{{ progress }}%</span></div>

      <div class="sec-title">② 出水点与模拟</div>
      <div class="row">
        <span class="row-label">出水点</span>
        <span class="val mono">{{ waterSourceText }}</span>
      </div>
      <div class="row">
        <span class="row-label">水闸状态</span>
        <span class="val mono">{{ ui.setDam ? `已设置 ${damPosText}` : '未启用' }}</span>
      </div>
      <button class="start-btn" :class="{ running }" :disabled="!result || !extent" @click="toggleSimulation">
        {{ running ? '停止模拟' : '开始模拟' }}
      </button>
      <button class="mini-btn" :disabled="!result" @click="resetWaterSource">重置出水点</button>

      <div class="sec-title">演进区域</div>
      <div class="slider-row">
        <label>最低高程(m) <em>{{ ui.minElevation }}</em></label>
        <input type="range" min="0" max="9000" step="10" v-model.number="ui.minElevation" />
      </div>
      <div class="slider-row">
        <label>最高高程(m) <em>{{ ui.maxElevation }}</em></label>
        <input type="range" min="0" max="9000" step="10" v-model.number="ui.maxElevation" />
      </div>
      <div class="row">
        <span class="row-label">绘制水闸（点击地图两点）</span>
        <button class="toggle" :class="{ on: ui.setDam }" :aria-label="ui.setDam ? '关闭水闸' : '开启水闸'" @click="ui.setDam = !ui.setDam"><i></i></button>
      </div>
      <div class="slider-row">
        <label>水闸高度 <em>{{ ui.damHeight.toFixed(2) }}</em></label>
        <input type="range" min="0" max="1" step="0.01" v-model.number="ui.damHeight" />
      </div>

      <div class="sec-title">③ 洪水流体参数</div>
      <div class="slider-row">
        <label>水流增加速率 <em>{{ ui.waterAddRate.toFixed(4) }}</em></label>
        <input type="range" min="0.0001" max="0.01" step="0.0001" v-model.number="ui.waterAddRate" />
      </div>
      <div class="slider-row">
        <label>水源半径 <em>{{ ui.waterSourceRadius.toFixed(3) }}</em></label>
        <input type="range" min="0.005" max="0.5" step="0.005" v-model.number="ui.waterSourceRadius" />
      </div>
      <div class="slider-row">
        <label>衰减（水波） <em>{{ ui.attenuation.toFixed(3) }}</em></label>
        <input type="range" min="0" max="1" step="0.001" v-model.number="ui.attenuation" />
      </div>
      <div class="slider-row">
        <label>强度扰动 <em>{{ ui.strenght.toFixed(3) }}</em></label>
        <input type="range" min="0" max="1" step="0.001" v-model.number="ui.strenght" />
      </div>
      <div class="slider-row">
        <label>最小水流 <em>{{ ui.minTotalFlow.toFixed(5) }}</em></label>
        <input type="range" min="0.00005" max="0.0003" step="0.00001" v-model.number="ui.minTotalFlow" />
      </div>
      <div class="slider-row">
        <label>初始水位 <em>{{ ui.initialWaterLevel.toFixed(3) }}</em></label>
        <input type="range" min="0" max="1" step="0.01" v-model.number="ui.initialWaterLevel" />
      </div>
      <div class="slider-row">
        <label>光线步进次数 <em>{{ ui.depth }}</em></label>
        <input type="range" min="50" max="500" step="10" v-model.number="ui.depth" />
      </div>
      <div class="slider-row">
        <label>蒸发率 <em>{{ ui.evaporationRate.toFixed(4) }}</em></label>
        <input type="range" min="0" max="0.001" step="0.00001" v-model.number="ui.evaporationRate" />
      </div>
      <div class="slider-row">
        <label>水流透明度 <em>{{ ui.waterAlpha.toFixed(3) }}</em></label>
        <input type="range" min="0.001" max="1" step="0.001" v-model.number="ui.waterAlpha" />
      </div>
      <div class="row">
        <span class="row-label">浅水区颜色</span>
        <input type="color" v-model="ui.shallowColor" />
      </div>
      <div class="row">
        <span class="row-label">深水区颜色</span>
        <input type="color" v-model="ui.deepColor" />
      </div>
      <div class="slider-row">
        <label>颜色渐变深度 <em>{{ ui.gradientDepth.toFixed(2) }}</em></label>
        <input type="range" min="0.05" max="1" step="0.01" v-model.number="ui.gradientDepth" />
      </div>
      <p class="hint">
        <b>流程：</b>① 输入四至或框选范围 → 采样真实地形生成深度图；② 点击地图任选出水点；③ 点击「开始模拟」执行洪水淹没模拟。<br />
        <b>深度图：</b>采样结果同时提供预览/下载（PNG/TIFF）与地图叠加，并作为模拟高度图直接使用。<br />
        <b>参数：</b>大部分流体参数运行中实时调整；初始水位 / 高程区间变更后需重新开始模拟。<br />
        <b>注意：</b>水闸在出水点同一逻辑下通过勾选后点击地图两点建立。
      </p>
    </div>

    <div v-if="result" class="result-panel">
      <div class="panel-title">深度图预览</div>
      <img :src="result.pngUrl" alt="深度图预览" />
      <p>{{ resultText }}</p>
      <div class="download-row"><button @click="download('png')">下载 PNG</button><button @click="download('tiff')">下载 TIFF</button></div>
      <div class="overlay-group">
        <span class="overlay-title">地图叠加显示</span>
        <label class="switch-row">
          <span>显示深度图层</span>
          <input v-model="overlayVisible" type="checkbox" />
        </label>
        <label class="switch-row">
          <span>显示选择矩形</span>
          <input v-model="rectangleVisible" type="checkbox" />
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
.fds-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.control-panel, .result-panel { position: absolute; top: 12px; z-index: 10; display: flex; flex-direction: column; gap: 9px; padding: 12px; border: 1px solid rgba(137,210,233,.3); border-radius: 9px; background: rgba(8,32,49,.88); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.control-panel { right: 12px; width: 270px; max-height: calc(100% - 24px); overflow-y: auto; box-sizing: border-box; }
.result-panel { left: 12px; width: 202px; }
.panel-title { font-size: 12px; font-weight: 700; }
.sec-title { margin-top: 8px; font-size: 11px; font-weight: 700; color: #65d3eb; letter-spacing: 0.03em; }
.res-row { display: flex; align-items: center; justify-content: space-between; color: #bdd9e4; }
.control-panel select { border: 1px solid rgba(137,210,233,.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.bounds-group { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid rgba(137,210,233,.18); border-radius: 6px; }
.bounds-title { color: #bdd9e4; font-size: 10px; }
.bounds-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.bounds-grid label { display: flex; align-items: center; justify-content: space-between; color: #bdd9e4; font-size: 10px; gap: 4px; }
.bounds-grid input { width: 62px; min-width: 0; height: 21px; padding: 0 5px; border: 1px solid rgba(137,210,233,.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; }
.bounds-grid input:disabled { opacity: .5; }
.primary-button, .secondary-button, .start-btn, .mini-btn, .download-row button { min-height: 27px; border: 0; border-radius: 5px; color: #edfaff; cursor: pointer; font-size: 11px; }
.primary-button, .start-btn, .download-row button { background: #257f9e; }
.secondary-button, .mini-btn { background: rgba(137,210,233,.22); }
.primary-button:disabled, .secondary-button:disabled, .start-btn:disabled, .mini-btn:disabled { cursor: default; opacity: .5; }
.start-btn.running { background: rgba(255, 82, 82, 0.25); border: 1px solid rgba(255, 82, 82, 0.55); color: #ff8a8a; }
.progress { position: relative; height: 15px; overflow: hidden; border-radius: 4px; background: rgba(137,210,233,.18); }
.progress i { display: block; height: 100%; background: linear-gradient(90deg, #2f80ed, #65d3eb); transition: width .2s; }
.progress span { position: absolute; inset: 0; display: grid; place-items: center; font-size: 10px; color: #eaf7fc; }
.row { display: flex; align-items: center; justify-content: space-between; }
.row-label { color: #bdd9e4; font-size: 11px; }
.val { font-size: 11px; color: #65d3eb; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }
.toggle.on { background: #2f80ed; }
.toggle.on i { transform: translateX(18px); }
.slider-row { margin-top: 7px; }
.slider-row label { display: flex; justify-content: space-between; align-items: center; color: #bdd9e4; font-size: 11px; }
.slider-row label em { font-style: normal; color: #65d3eb; font-weight: 700; }
.slider-row input[type="range"] { width: 100%; margin: 3px 0 0; accent-color: #2f80ed; background: transparent; }
.row input[type="color"] { width: 34px; height: 22px; padding: 0; border: 1px solid rgba(137,210,233,.35); border-radius: 4px; background: transparent; cursor: pointer; }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.hint b { color: #9fb3cc; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
.result-panel img { width: 100%; border-radius: 4px; }
.result-panel p { margin: 0; font-size: 10px; color: #bdd9e4; line-height: 1.5; }
.download-row { display: flex; gap: 6px; }
.download-row button { flex: 1; }
.overlay-group { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; border-top: 1px solid rgba(137,210,233,.18); }
.overlay-title { color: #bdd9e4; font-size: 10px; }
.switch-row, .opacity-row { display: flex; align-items: center; justify-content: space-between; color: #bdd9e4; font-size: 10px; }
.opacity-row input[type="range"] { width: 80px; accent-color: #2f80ed; }
.opacity-row em { font-style: normal; color: #65d3eb; }
</style>
