<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  HeightReference,
  PolygonHierarchy,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Math as CesiumMath,
  type Entity,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  loadWorldTerrain,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib/pick'
import { FluidSphDemo } from '../fluid-sph-lib/fluid-sph-demo'
import { aspectRows, sampleTerrainHeights } from '../water-depth-extraction/terrain-sampler'
import type { Extent } from '../fluid-sph-lib/sph-shaders'

const defaultExtent: Extent = [
  -119.5509508318,
  37.7379837881,
  -119.4661638949,
  37.8045600379
]

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const running = ref(true)
const addSource = ref(false)
const drawEnabled = ref(false)
const processingRegion = ref(false)

const ui = reactive({
  waterAddRate: 0.03,
  waterSourceRadius: 0.05,
  gravity: 1,
  initialWaterLevel: 0.12,
  depth: 180,
  waterAlpha: 0.85,
  shallowColor: '#48cae4',
  deepColor: '#023e8a',
  showFlow: false
})

const sourceText = ref('点击地图任意位置可移动水源')

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let drawHandler: ScreenSpaceEventHandler | undefined
let sim: FluidSphDemo | undefined
let sourceMarker: Entity | undefined
let cornerMarker: Entity | undefined
let previewPolygon: Entity | undefined
let previewOutline: Entity | undefined
let firstCorner: Cartographic | undefined
let disposed = false
let created = false

let simExtent: Extent = [...defaultExtent]
let simMinElevation = 0
let simMaxElevation = 1

function parseColor(hex: string): Color {
  return Color.fromCssColorString(hex)
}

function applyLiveParams(): void {
  if (!sim) return
  sim.setWaterParams({
    waterAddRate: ui.waterAddRate,
    waterSourceRadius: ui.waterSourceRadius,
    gravity: ui.gravity,
    depth: Math.round(ui.depth),
    waterAlpha: ui.waterAlpha,
    shallow: parseColor(ui.shallowColor),
    deep: parseColor(ui.deepColor)
  })
}

function applyFlowVisible(): void {
  if (sim) sim.setFlowVisible(ui.showFlow)
}

watch(
  () =>
    [
      ui.waterAddRate,
      ui.waterSourceRadius,
      ui.gravity,
      ui.depth,
      ui.waterAlpha,
      ui.shallowColor,
      ui.deepColor
    ] as const,
  applyLiveParams
)

watch(() => ui.showFlow, applyFlowVisible)

function toNormalized(position: Cartesian3): Cartesian2 | undefined {
  const carto = Cartographic.fromCartesian(position)
  const lon = CesiumMath.toDegrees(carto.longitude)
  const lat = CesiumMath.toDegrees(carto.latitude)
  const [west, south, east, north] = simExtent
  const x = (lon - west) / (east - west)
  const y = 1 - (lat - south) / (north - south)
  if (x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02) return undefined
  return new Cartesian2(x, y)
}

function setupClickHandler(): void {
  if (!viewer || handler) return
  handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  handler.setInputAction((event: { position: Cartesian2 }) => {
    if (!viewer || !addSource.value || drawEnabled.value || processingRegion.value) return
    const picked = pickPosition(viewer.scene, event.position)
    if (!picked) return
    const normalized = toNormalized(picked)
    if (!normalized) {
      sourceText.value = '点击位置超出模拟范围，请在黄色范围框内点选'
      return
    }
    placeSource(normalized.x, normalized.y)
    updateMarker(picked)
  }, ScreenSpaceEventType.LEFT_CLICK)
}

function placeSource(x: number, y: number): void {
  if (!sim || !viewer || viewer.isDestroyed()) return
  sim.setWaterSource(new Cartesian2(x, y))
  sourceText.value = `水源位置 (${x.toFixed(3)}, ${y.toFixed(3)})`
}

function updateMarker(position: Cartesian3): void {
  if (!viewer || viewer.isDestroyed()) return
  if (sourceMarker) {
    sourceMarker.position = new ConstantPositionProperty(position)
    return
  }
  sourceMarker = viewer.entities.add({
    position,
    point: {
      pixelSize: 10,
      color: Color.fromCssColorString('#f6ca55'),
      outlineColor: Color.WHITE,
      outlineWidth: 2
    },
    label: {
      text: '水源',
      font: '11px sans-serif',
      fillColor: Color.WHITE,
      outlineColor: Color.fromCssColorString('#102b40'),
      outlineWidth: 3,
      style: 2,
      pixelOffset: new Cartesian2(0, -18),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
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
  return new PolygonHierarchy(
    Cartesian3.fromRadiansArray([
      rectangle.west,
      rectangle.south,
      rectangle.east,
      rectangle.south,
      rectangle.east,
      rectangle.north,
      rectangle.west,
      rectangle.north
    ])
  )
}

function rectangleOutlinePositions(rectangle: Rectangle): Cartesian3[] {
  return Cartesian3.fromRadiansArray([
    rectangle.west,
    rectangle.south,
    rectangle.east,
    rectangle.south,
    rectangle.east,
    rectangle.north,
    rectangle.west,
    rectangle.north,
    rectangle.west,
    rectangle.south
  ])
}

function setPreview(rectangle: Rectangle | undefined): void {
  if (!viewer || viewer.isDestroyed()) return
  if (!previewPolygon) return
  if (rectangle) {
    previewPolygon.polygon!.hierarchy = new ConstantProperty(rectangleHierarchy(rectangle))
    previewPolygon.show = true
    if (previewOutline) {
      previewOutline.polyline!.positions = new ConstantProperty(rectangleOutlinePositions(rectangle))
      previewOutline.show = true
    }
  } else {
    previewPolygon.show = false
    if (previewOutline) previewOutline.show = false
  }
}

function updateCornerMarker(position: Cartesian3, label: string): void {
  if (!viewer || viewer.isDestroyed()) return
  if (cornerMarker) {
    cornerMarker.position = new ConstantPositionProperty(position)
    cornerMarker.label!.text = new ConstantProperty(label)
    cornerMarker.show = true
    return
  }
  cornerMarker = viewer.entities.add({
    position,
    point: {
      pixelSize: 8,
      color: Color.fromCssColorString('#8ff2ff'),
      outlineColor: Color.WHITE,
      outlineWidth: 2
    },
    label: {
      text: label,
      font: '11px sans-serif',
      fillColor: Color.WHITE,
      outlineColor: Color.fromCssColorString('#102b40'),
      outlineWidth: 3,
      style: 2,
      pixelOffset: new Cartesian2(0, -18),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })
}

function createPreviewEntities(): void {
  if (!viewer) return
  if (!previewPolygon) {
    previewPolygon = viewer.entities.add({
      polygon: {
        hierarchy: new ConstantProperty(new PolygonHierarchy()),
        material: Color.fromCssColorString('#36c5e8').withAlpha(0.28),
        height: 0,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        perPositionHeight: false
      },
      show: false
    })
  }
  if (!previewOutline) {
    previewOutline = viewer.entities.add({
      polyline: {
        positions: new ConstantProperty([]),
        clampToGround: true,
        width: 2,
        material: Color.fromCssColorString('#9ff4ff')
      },
      show: false
    })
  }
}

function hidePreview(): void {
  firstCorner = undefined
  setPreview(undefined)
  if (cornerMarker && viewer && !viewer.isDestroyed()) {
    viewer.entities.remove(cornerMarker)
    cornerMarker = undefined
  }
}

function destroyDrawHandler(): void {
  if (drawHandler && !drawHandler.isDestroyed()) drawHandler.destroy()
  drawHandler = undefined
}

function cancelDraw(): void {
  destroyDrawHandler()
  drawEnabled.value = false
  hidePreview()
  sourceText.value = '已取消框选，当前模拟区域保持不变'
}

function toggleDraw(): void {
  if (!viewer || !created || processingRegion.value) return
  if (drawEnabled.value) {
    cancelDraw()
    return
  }
  drawEnabled.value = true
  addSource.value = false
  firstCorner = undefined
  setPreview(undefined)
  if (cornerMarker) cornerMarker.show = false
  if (drawHandler && !drawHandler.isDestroyed()) drawHandler.destroy()
  drawHandler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  drawHandler.setInputAction((event: { position: Cartesian2 }) => {
    if (!viewer || !drawEnabled.value) return
    const picked = pickPosition(viewer.scene, event.position)
    if (!picked) return
    const corner = Cartographic.fromCartesian(picked)
    if (!firstCorner) {
      firstCorner = corner
      updateCornerMarker(picked, '起点')
      sourceText.value = '移动鼠标预览范围，再次点击确定模拟区域'
      return
    }
    finishDraw(normalizedRectangle(firstCorner, corner))
  }, ScreenSpaceEventType.LEFT_CLICK)
  drawHandler.setInputAction((event: { endPosition: Cartesian2 }) => {
    if (!viewer || !drawEnabled.value || !firstCorner) return
    const picked = pickPosition(viewer.scene, event.endPosition)
    if (!picked) return
    const corner = Cartographic.fromCartesian(picked)
    setPreview(normalizedRectangle(firstCorner, corner))
    updateCornerMarker(picked, '终点')
  }, ScreenSpaceEventType.MOUSE_MOVE)
  drawHandler.setInputAction(() => {
    if (drawEnabled.value) cancelDraw()
  }, ScreenSpaceEventType.RIGHT_CLICK)
  sourceText.value = '在贴地矩形上点击确定第一角点'
}

function finishDraw(rectangle: Rectangle): void {
  if (!viewer || !created) return
  const lonSpan = CesiumMath.toDegrees(rectangle.east - rectangle.west)
  const latSpan = CesiumMath.toDegrees(rectangle.north - rectangle.south)
  if (lonSpan < 0.0015 || latSpan < 0.0015) {
    statusMessage.value = '框选范围过小，请放大后重新框选'
    cancelDraw()
    return
  }
  destroyDrawHandler()
  drawEnabled.value = false
  void applyDrawnRegion(rectangle)
}

async function applyDrawnRegion(rectangle: Rectangle): Promise<void> {
  if (!viewer || viewer.isDestroyed() || !created) return
  processingRegion.value = true
  setPreview(rectangle)
  try {
    const extentDeg = {
      west: CesiumMath.toDegrees(rectangle.west),
      south: CesiumMath.toDegrees(rectangle.south),
      east: CesiumMath.toDegrees(rectangle.east),
      north: CesiumMath.toDegrees(rectangle.north)
    }
    await sampleAndStartSimulation(extentDeg, '矩形区域', '已切换到新框选区域：点击地图任意位置可移动水源', true, 1)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    statusMessage.value = `地形采样或重建失败：${detail}`
    hidePreview()
  } finally {
    processingRegion.value = false
  }
}

async function sampleAndStartSimulation(
  extentDeg: { west: number; south: number; east: number; north: number },
  label: string,
  hint: string,
  doFly: boolean,
  flyDuration: number
): Promise<void> {
  if (!viewer || viewer.isDestroyed()) return
  const provider = viewer.terrainProvider
  const cols = 256
  const rows = Math.min(512, aspectRows(cols, extentDeg))
  statusMessage.value = `正在采样${label}地形（${cols}×${rows}）…`
  const grid = await sampleTerrainHeights(provider, extentDeg, cols, rows)
  if (disposed || !viewer || viewer.isDestroyed()) return
  const range = grid.max - grid.min
  const scale = range > 1e-6 ? range : 1
  const small = document.createElement('canvas')
  small.width = cols
  small.height = rows
  const smallCtx = small.getContext('2d')
  if (!smallCtx) throw new Error('无法创建高度图画布')
  const imageData = smallCtx.createImageData(cols, rows)
  for (let i = 0; i < cols * rows; i += 1) {
    const value = Math.round(Math.min(1, Math.max(0, (grid.pixels[i] - grid.min) / scale)) * 255)
    imageData.data[i * 4] = value
    imageData.data[i * 4 + 1] = value
    imageData.data[i * 4 + 2] = value
    imageData.data[i * 4 + 3] = 255
  }
  smallCtx.putImageData(imageData, 0, 0)
  const big = document.createElement('canvas')
  big.width = 1024
  big.height = 1024
  const bigCtx = big.getContext('2d')
  if (!bigCtx) throw new Error('无法创建高度图画布')
  bigCtx.imageSmoothingEnabled = true
  bigCtx.imageSmoothingQuality = 'high'
  bigCtx.drawImage(small, 0, 0, 1024, 1024)
  statusMessage.value = '正在重建该区域的流体模拟…'

  destroySimulation()
  hidePreview()
  simExtent = [extentDeg.west, extentDeg.south, extentDeg.east, extentDeg.north]
  simMinElevation = grid.min
  simMaxElevation = grid.max
  startSimulation(big)
  statusMessage.value = ''
  sourceText.value = hint
  if (doFly) flyToExtent(simExtent, flyDuration)
}

function destroySimulation(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (sim) {
    sim.destroy()
    sim = undefined
  }
  if (sourceMarker) {
    viewer.entities.remove(sourceMarker)
    sourceMarker = undefined
  }
}

function flyToExtent(extent: Extent, duration = 1): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: Rectangle.fromDegrees(...extent),
    orientation: {
      heading: 0,
      pitch: CesiumMath.toRadians(-42),
      roll: 0
    },
    duration
  })
}

function startSimulation(image: HTMLImageElement | HTMLCanvasElement): void {
  if (!viewer || viewer.isDestroyed() || !created) return
  sim = new FluidSphDemo(
    viewer,
    {
      waterAddRate: ui.waterAddRate,
      waterSourceRadius: ui.waterSourceRadius,
      gravity: ui.gravity,
      initialWaterLevel: ui.initialWaterLevel,
      depth: Math.round(ui.depth),
      shallow: parseColor(ui.shallowColor),
      deep: parseColor(ui.deepColor),
      waterAlpha: ui.waterAlpha,
      waterSource: new Cartesian2(0.5, 0.5)
    },
    { minElevation: simMinElevation, maxElevation: simMaxElevation },
    image,
    simExtent
  )
  sim.setRunning(running.value)
  sim.setFlowVisible(ui.showFlow)
  setupClickHandler()
}

async function resetSimulation(): Promise<void> {
  if (!viewer || viewer.isDestroyed() || !created || processingRegion.value) return
  processingRegion.value = true
  try {
    if (drawEnabled.value) cancelDraw()
    await sampleAndStartSimulation(
      { west: defaultExtent[0], south: defaultExtent[1], east: defaultExtent[2], north: defaultExtent[3] },
      '默认区域',
      '已重置回默认区域：点击地图任意位置可移动水源',
      true,
      1
    )
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    processingRegion.value = false
  }
}

function toggleRunning(): void {
  running.value = !running.value
  if (sim) sim.setRunning(running.value)
  sourceText.value = running.value ? '模拟运行中：点击地图任意位置可移动水源' : '已暂停：点击「运行」继续推进流体模拟'
}

function toggleAddSource(): void {
  addSource.value = !addSource.value
  sourceText.value = addSource.value ? '水源设置已开启：点击地形移动水源' : '水源设置已关闭：拖动视角观察水流'
}

async function mountScene(): Promise<void> {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '正在加载地形…' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.msaaSamples = 4
    viewer.scene.highDynamicRange = true
    createPreviewEntities()
    statusMessage.value = '正在加载Cesium World Terrain…'
    await loadWorldTerrain(viewer)
    if (disposed || !viewer || viewer.isDestroyed()) return
    created = true
    await sampleAndStartSimulation(
      { west: defaultExtent[0], south: defaultExtent[1], east: defaultExtent[2], north: defaultExtent[3] },
      '默认区域',
      '默认区域模拟已就绪：点击地图任意位置可移动水源',
      true,
      0
    )
  } catch (error) {
    if (!disposed) {
      statusMessage.value = error instanceof Error ? error.message : String(error)
    }
  }
}

onMounted(() => {
  void mountScene()
})

onBeforeUnmount(() => {
  disposed = true
  if (drawHandler && !drawHandler.isDestroyed()) drawHandler.destroy()
  drawHandler = undefined
  if (handler && !handler.isDestroyed()) handler.destroy()
  handler = undefined
  if (sim) {
    sim.destroy()
    sim = undefined
  }
  if (viewer && !viewer.isDestroyed()) {
    if (sourceMarker) viewer.entities.remove(sourceMarker)
    if (cornerMarker) viewer.entities.remove(cornerMarker)
    if (previewPolygon) viewer.entities.remove(previewPolygon)
    if (previewOutline) viewer.entities.remove(previewOutline)
  }
  sourceMarker = undefined
  cornerMarker = undefined
  previewPolygon = undefined
  previewOutline = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="fluid-sph-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="sph-panel">
      <div class="panel-title">SPH 地形流体模拟</div>
      <div class="param-row">
        <span class="param-label">水源速率</span>
        <input v-model.number="ui.waterAddRate" class="param-slider" type="range" min="0" max="0.12" step="0.001" />
        <span class="param-value">{{ ui.waterAddRate.toFixed(3) }}</span>
      </div>
      <div class="param-row">
        <span class="param-label">水源半径</span>
        <input v-model.number="ui.waterSourceRadius" class="param-slider" type="range" min="0.01" max="0.2" step="0.005" />
        <span class="param-value">{{ ui.waterSourceRadius.toFixed(3) }}</span>
      </div>
      <div class="param-row">
        <span class="param-label">重力强度</span>
        <input v-model.number="ui.gravity" class="param-slider" type="range" min="0.1" max="10" step="0.1" />
        <span class="param-value">{{ ui.gravity.toFixed(1) }}</span>
      </div>
      <div class="param-row">
        <span class="param-label">初始水位</span>
        <input v-model.number="ui.initialWaterLevel" class="param-slider" type="range" min="0" max="1" step="0.01" />
        <span class="param-value">{{ ui.initialWaterLevel.toFixed(2) }}</span>
      </div>
      <div class="param-row">
        <span class="param-label">渲染质量</span>
        <input v-model.number="ui.depth" class="param-slider" type="range" min="50" max="300" step="10" />
        <span class="param-value">{{ ui.depth }}</span>
      </div>
      <div class="param-row">
        <span class="param-label">水不透明度</span>
        <input v-model.number="ui.waterAlpha" class="param-slider" type="range" min="0.1" max="1" step="0.05" />
        <span class="param-value">{{ ui.waterAlpha.toFixed(2) }}</span>
      </div>
      <div class="param-row">
        <span class="param-label">浅水色</span>
        <input v-model="ui.shallowColor" class="color-input" type="color" />
      </div>
      <div class="param-row">
        <span class="param-label">深水色</span>
        <input v-model="ui.deepColor" class="color-input" type="color" />
      </div>
      <div class="btn-row">
        <button class="btn" :class="{ on: drawEnabled }" :disabled="processingRegion" @click="toggleDraw">{{ drawEnabled ? '取消框选' : '绘制区域' }}</button>
        <button class="btn primary" @click="toggleRunning">{{ running ? '暂停' : '运行' }}</button>
        <button class="btn" :disabled="processingRegion" @click="resetSimulation">重置</button>
      </div>
      <div class="btn-row">
        <button class="btn" :class="{ on: addSource }" :disabled="drawEnabled || processingRegion" @click="toggleAddSource">{{ addSource ? '水源开' : '水源关' }}</button>
        <label class="chk-label" :class="{ on: ui.showFlow }">
          <input v-model="ui.showFlow" type="checkbox" />
          <span>流向箭头</span>
        </label>
      </div>
      <div class="hint">{{ sourceText }}</div>
      <div class="note">GPU 端以粒子与光滑核函数求解压力、重力与边界约束，多缓冲逐帧推进水位场；点击「绘制区域」可在任意地形上框选矩形范围重建模拟，开启「流向箭头」查看水体运动方向。</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.fluid-sph-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #172c3c; }
.cesium-container { width: 100%; height: 100%; }
.sph-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 7px; width: 250px; padding: 11px; border: 1px solid rgba(163, 204, 222, 0.25); border-radius: 9px; background: rgba(13, 34, 49, 0.84); backdrop-filter: blur(6px); color: #deeff5; max-height: calc(100% - 24px); overflow: auto; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 2px; }
.param-row { display: flex; align-items: center; gap: 8px; }
.param-label { flex: 0 0 62px; font-size: 11px; color: #c3dce5; }
.param-slider { flex: 1; min-width: 0; height: 4px; accent-color: #79b7cd; }
.param-value { flex: 0 0 38px; color: #9fc2cf; font-size: 10px; text-align: right; }
.color-input { width: 34px; height: 18px; padding: 0; border: 1px solid rgba(163, 204, 222, 0.3); border-radius: 4px; background: none; cursor: pointer; }
.btn-row { display: flex; gap: 6px; align-items: center; }
.btn { flex: 1; padding: 5px 4px; border: 1px solid rgba(163, 204, 222, 0.3); border-radius: 6px; background: rgba(163, 204, 222, 0.12); color: #deeff5; font-size: 11px; cursor: pointer; }
.btn.primary { background: rgba(87, 149, 174, 0.45); border-color: rgba(121, 183, 205, 0.6); }
.btn.on { background: rgba(246, 202, 85, 0.3); border-color: rgba(246, 202, 85, 0.6); }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.chk-label { flex: 1; display: flex; align-items: center; gap: 5px; justify-content: center; padding: 5px 4px; border: 1px solid rgba(163, 204, 222, 0.3); border-radius: 6px; background: rgba(163, 204, 222, 0.12); color: #c3dce5; font-size: 11px; cursor: pointer; }
.chk-label input { accent-color: #79b7cd; margin: 0; }
.chk-label.on { background: rgba(121, 183, 205, 0.28); border-color: rgba(121, 183, 205, 0.6); }
.hint { color: #8eacb8; font-size: 10px; line-height: 1.4; }
.note { color: #6f93a1; font-size: 10px; line-height: 1.4; border-top: 1px solid rgba(163, 204, 222, 0.15); padding-top: 6px; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
