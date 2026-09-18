<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Color,
  Ellipsoid,
  PointPrimitiveCollection,
  PolylineCollection,
  ScreenSpaceEventType,
  ScreenSpaceEventHandler,
  VerticalOrigin,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  setTerrainEnabled,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import {
  pickPosition,
  spatialDistance,
  surfaceDistance,
  projectedDistance,
  MouseTooltip,
  makeLineMaterial
} from '../measure-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const useTerrain = ref(true)
const measuring = ref(false)
const spatialResult = ref('--')
const surfaceResult = ref('--')
const projectedResult = ref('--')

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let tooltip: MouseTooltip | undefined
let disposed = false

let vertexPoints: PointPrimitiveCollection | undefined
let previewPoint: PointPrimitiveCollection | undefined
let previewLine: PolylineCollection | undefined
let measureLine: PolylineCollection | undefined
let worldTerrainLoaded = false

const collected: Cartesian3[] = []
let previewPos: Cartesian3 | undefined

function formatSeg(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(3)} km`
  return `${meters.toFixed(3)} m`
}

function clearEntities(): void {
  if (viewer) viewer.entities.removeAll()
  vertexPoints?.removeAll()
  previewPoint?.removeAll()
  previewLine?.removeAll()
  measureLine?.removeAll()
}

function addVertex(position: Cartesian3): void {
  vertexPoints?.add({
    position,
    color: Color.fromCssColorString('#ffd166'),
    pixelSize: 9,
    outlineColor: Color.WHITE,
    outlineWidth: 1.5,
    disableDepthTestDistance: Number.POSITIVE_INFINITY
  })
}

function addSegmentLabel(pos: Cartesian3, prev: Cartesian3, index: number): void {
  if (!viewer) return
  const scene = viewer.scene
  const s = formatSeg(spatialDistance(prev, pos))
  const p = formatSeg(projectedDistance(prev, pos))
  const sf = useTerrain.value && worldTerrainLoaded
    ? formatSeg(surfaceDistance(scene, prev, pos))
    : s
  viewer.entities.add({
    position: pos,
    label: {
      text: `第${index}点\n空间 ${s}\n地表 ${sf}\n投影 ${p}`,
      font: '12px sans-serif',
      fillColor: Color.fromCssColorString('#ffe08a'),
      outlineColor: Color.BLACK,
      outlineWidth: 3,
      backgroundColor: Color.fromCssColorString('#0a2030').withAlpha(0.72),
      showBackground: true,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(12, -14)
    }
  })
}

function updatePreview(): void {
  previewPoint?.removeAll()
  previewLine?.removeAll()
  if (!previewPos || collected.length === 0) return
  previewPoint?.add({
    position: previewPos,
    color: Color.fromCssColorString('#8ab4f8'),
    pixelSize: 6,
    outlineColor: Color.WHITE,
    outlineWidth: 1,
    disableDepthTestDistance: Number.POSITIVE_INFINITY
  })
  previewLine?.add({
    positions: [collected[collected.length - 1], previewPos],
    width: 2,
    material: makeLineMaterial(Color.fromCssColorString('#8ab4f8').withAlpha(0.7))
  })
}

function computeTotal(): void {
  if (collected.length < 2) return
  let s = 0
  let sf = 0
  let p = 0
  for (let i = 1; i < collected.length; i++) {
    const a = collected[i - 1]
    const b = collected[i]
    s += spatialDistance(a, b)
    p += projectedDistance(a, b)
    sf += useTerrain.value && worldTerrainLoaded
      ? surfaceDistance(viewer!.scene, a, b)
      : spatialDistance(a, b)
  }
  spatialResult.value = formatSeg(s)
  surfaceResult.value = formatSeg(sf)
  projectedResult.value = formatSeg(p)
}

function startMeasurement(): void {
  resetMeasurement()
  measuring.value = true
  resultMessage.value = '单击加点，双击或右键结束'
}

function finishMeasurement(): void {
  if (!measuring.value) return
  measuring.value = false
  previewPos = undefined
  previewPoint?.removeAll()
  previewLine?.removeAll()
  tooltip?.hide()
  if (collected.length >= 2) {
    computeTotal()
    resultMessage.value = '测量完成，左上侧面板显示最终结果'
  } else {
    resultMessage.value = '点数不足，请至少采集 2 个点'
  }
}

function resetMeasurement(): void {
  collected.length = 0
  previewPos = undefined
  measuring.value = false
  spatialResult.value = '--'
  surfaceResult.value = '--'
  projectedResult.value = '--'
  clearEntities()
  tooltip?.hide()
  resultMessage.value = ''
}

function onToggleMeasure(): void {
  if (measuring.value) {
    finishMeasurement()
  } else {
    startMeasurement()
  }
}

function onMouseMove(event: { endPosition: Cartesian2 }): void {
  if (!viewer || !tooltip) return
  if (!measuring.value) {
    tooltip.hide()
    previewPos = undefined
    return
  }
  const pos = pickPosition(viewer.scene, event.endPosition)
  if (!pos) {
    tooltip.hide()
    previewPos = undefined
    return
  }
  const carto = Ellipsoid.WGS84.cartesianToCartographic(pos)
  const lon = carto.longitude * 180 / Math.PI
  const lat = carto.latitude * 180 / Math.PI
  let content = '单击加点，双击或右键结束<br>'
  content += `经度 ${lon.toFixed(6)}°<br>纬度 ${lat.toFixed(6)}°<br>高度 ${carto.height.toFixed(1)} m`
  if (collected.length >= 1) {
    const last = collected[collected.length - 1]
    const s = formatSeg(spatialDistance(last, pos))
    const p = formatSeg(projectedDistance(last, pos))
    const sf = useTerrain.value && worldTerrainLoaded
      ? formatSeg(surfaceDistance(viewer.scene, last, pos))
      : s
    content += `<br>空间 ${s}<br>地表 ${sf}<br>投影 ${p}`
  }
  tooltip.setContent(content)
  tooltip.setPosition(event.endPosition.x, event.endPosition.y)
  tooltip.show()
  previewPos = pos
  if (measuring.value) updatePreview()
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || !measuring.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  collected.push(pos)
  addVertex(pos)
  if (collected.length >= 2) {
    const prev = collected[collected.length - 2]
    measureLine?.add({
      positions: [prev, pos],
      width: 3,
      material: makeLineMaterial(Color.fromCssColorString('#ffb84d'))
    })
    addSegmentLabel(pos, prev, collected.length)
  }
  tooltip?.hide()
}

function onTerrainChanged(): void {
  if (!measuring.value && collected.length >= 2) computeTotal()
}

function applyTerrain(enabled: boolean): void {
  if (!viewer) return
  if (enabled) {
    statusMessage.value = '正在加载Cesium World Terrain...'
    setTerrainEnabled(viewer, true)
      .then(() => {
        if (disposed) return
        worldTerrainLoaded = true
        statusMessage.value = ''
        onTerrainChanged()
      })
      .catch((error: unknown) => {
        if (!disposed) {
          worldTerrainLoaded = false
          statusMessage.value = error instanceof Error ? error.message : String(error)
          onTerrainChanged()
        }
      })
  } else {
    setTerrainEnabled(viewer, false).catch(() => {})
    worldTerrainLoaded = false
    statusMessage.value = ''
    onTerrainChanged()
  }
}

watch(useTerrain, (value) => applyTerrain(value))

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.scene.globe.depthTestAgainstTerrain = true
    vertexPoints = viewer.scene.primitives.add(new PointPrimitiveCollection())
    previewPoint = viewer.scene.primitives.add(new PointPrimitiveCollection())
    previewLine = viewer.scene.primitives.add(new PolylineCollection())
    measureLine = viewer.scene.primitives.add(new PolylineCollection())
    tooltip = new MouseTooltip(container.value)

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { endPosition: Cartesian2 }) => onMouseMove(event), ScreenSpaceEventType.MOUSE_MOVE)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction(() => { if (measuring.value) finishMeasurement() }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
    handler.setInputAction(() => { if (measuring.value) finishMeasurement() }, ScreenSpaceEventType.RIGHT_CLICK)

    if (useTerrain.value) {
      applyTerrain(true)
    }
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  handler?.destroy()
  handler = undefined
  tooltip?.destroy()
  tooltip = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="distance-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="control-panel">
      <div class="panel-title">距离量测</div>
      <div class="control-row">
        <label class="switch-label">启用地形</label>
        <input v-model="useTerrain" type="checkbox" />
      </div>
      <div class="button-row">
        <button class="action-button primary" @click="onToggleMeasure">
          {{ measuring ? '结束测量' : '开始测量' }}
        </button>
        <button class="action-button danger" @click="resetMeasurement">清除</button>
      </div>
      <div class="hint">单击加点，双击或右键结束</div>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>
    <div class="result-panel">
      <div class="result-title">量测结果</div>
      <div class="result-item"><span class="result-name">空间距离</span><span class="result-value">{{ spatialResult }}</span></div>
      <div class="result-item"><span class="result-name">地表距离</span><span class="result-value">{{ surfaceResult }}</span></div>
      <div class="result-item"><span class="result-name">投影距离</span><span class="result-value">{{ projectedResult }}</span></div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.distance-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 250px; padding: 12px; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 32, 49, 0.84); backdrop-filter: blur(6px); color: #ddf2f8; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.control-row { display: flex; align-items: center; justify-content: space-between; padding: 3px 0; }
.switch-label { font-size: 11px; color: #bdd9e4; }
.button-row { display: flex; gap: 8px; margin-top: 8px; }
.action-button { flex: 1; height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #257f9e; color: #edfaff; }
.action-button.danger { background: #7a3b4a; color: #ffe3ea; }
.result-panel { position: absolute; top: 12px; left: 12px; z-index: 10; width: 220px; padding: 12px; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 32, 49, 0.84); backdrop-filter: blur(6px); color: #ddf2f8; }
.result-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.result-item { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; }
.result-name { color: #7fb6c9; }
.result-value { color: #d9eff6; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.hint { margin-top: 8px; font-size: 11px; color: #7fb6c9; }
.result-message { margin-top: 6px; font-size: 11px; color: #8be0b2; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>

<style>
.distance-shell .measure-tooltip { position: absolute; padding: 5px 8px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 5px; background: rgba(8, 32, 49, 0.92); color: #d9eff6; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.5; white-space: nowrap; pointer-events: none; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); }
</style>
