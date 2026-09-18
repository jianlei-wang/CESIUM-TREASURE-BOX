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
  type Entity,
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
  heightDiff,
  pickPosition,
  MouseTooltip,
  makeLineMaterial
} from '../measure-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const useTerrain = ref(true)
const measuring = ref(false)
const heightAResult = ref('--')
const heightBResult = ref('--')
const diffResult = ref('--')

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
let labelEntities: Entity[] = []

function clearEntities(): void {
  if (viewer) viewer.entities.removeAll()
  labelEntities = []
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

function computeResult(): void {
  if (!viewer || collected.length < 2) return
  const a = collected[0]
  const b = collected[collected.length - 1]
  const { heightA, heightB, diff } = heightDiff(a, b)
  heightAResult.value = `${heightA.toFixed(1)} m`
  heightBResult.value = `${heightB.toFixed(1)} m`
  diffResult.value = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} m`

  const mid = Cartesian3.midpoint(a, b, new Cartesian3())
  const labels = [
    { text: `A点高度: ${heightAResult.value}`, color: '#4dd0ff', pos: a, offsetY: -24 },
    { text: `B点高度: ${heightBResult.value}`, color: '#4dd0ff', pos: b, offsetY: -24 },
    { text: `高差: ${diffResult.value}`, color: '#ffb84d', pos: mid, offsetY: 24 }
  ]
  labelEntities.forEach((entity) => { viewer?.entities.remove(entity) })
  labelEntities = []
  labels.forEach((item) => {
    const entity = viewer?.entities.add({
      position: item.pos,
      label: {
        text: item.text,
        font: '13px sans-serif',
        fillColor: Color.fromCssColorString(item.color),
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        backgroundColor: Color.fromCssColorString('#102b40').withAlpha(0.72),
        showBackground: true,
        pixelOffset: new Cartesian2(0, item.offsetY),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        horizontalOrigin: 0,
        verticalOrigin: 0
      }
    })
    if (entity) labelEntities.push(entity)
  })
}

function onTerrainChanged(): void {
  if (collected.length >= 2) computeResult()
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

function startMeasurement(): void {
  resetMeasurement()
  measuring.value = true
  resultMessage.value = '单击选起点与终点，第二个点完成后自动结束'
}

function finishMeasurement(): void {
  if (!measuring.value) return
  measuring.value = false
  previewPos = undefined
  previewPoint?.removeAll()
  previewLine?.removeAll()
  tooltip?.hide()
  if (collected.length >= 2) {
    measureLine?.removeAll()
    measureLine?.add({
      positions: collected.slice(),
      width: 3,
      material: makeLineMaterial(Color.fromCssColorString('#ffb84d'))
    })
    computeResult()
    resultMessage.value = '测量完成，结果已显示'
  } else {
    resultMessage.value = '点数不足，请至少采集 2 个点'
  }
}

function resetMeasurement(): void {
  collected.length = 0
  previewPos = undefined
  measuring.value = false
  heightAResult.value = '--'
  heightBResult.value = '--'
  diffResult.value = '--'
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
  let content = '单击选起点与终点，第二个点完成后自动结束<br>'
  content += `经度 ${lon.toFixed(6)}°<br>纬度 ${lat.toFixed(6)}°<br>高度 ${carto.height.toFixed(1)} m`

  if (measuring.value && collected.length >= 1) {
    const last = collected[collected.length - 1]
    const lastCarto = Ellipsoid.WGS84.cartesianToCartographic(last)
    const diff = carto.height - lastCarto.height
    content += `<br>高差: ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} m`
  }
  tooltip.setContent(content)
  tooltip.setPosition(event.endPosition.x, event.endPosition.y)
  tooltip.show()
  previewPos = pos
  if (measuring.value && collected.length >= 1) {
    previewPoint?.removeAll()
    previewPoint?.add({
      position: pos,
      color: Color.fromCssColorString('#8ab4f8'),
      pixelSize: 6,
      outlineColor: Color.WHITE,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    })
    previewLine?.removeAll()
    previewLine?.add({
      positions: [collected[collected.length - 1], pos],
      width: 2,
      material: makeLineMaterial(Color.fromCssColorString('#8ab4f8').withAlpha(0.7))
    })
  }
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || !measuring.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  collected.push(pos)
  addVertex(pos)
  if (collected.length >= 2) {
    finishMeasurement()
    return
  }
  tooltip?.hide()
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
  <div class="height-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="control-panel">
      <div class="panel-title">高度量测</div>
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
      <div class="result-block">
        <div class="result-item"><span class="result-name">A点高度</span><span class="result-value">{{ heightAResult }}</span></div>
        <div class="result-item"><span class="result-name">B点高度</span><span class="result-value">{{ heightBResult }}</span></div>
        <div class="result-item"><span class="result-name">高差</span><span class="result-value">{{ diffResult }}</span></div>
      </div>
      <div class="hint">单击选起点与终点，第二个点完成后自动结束</div>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.height-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 250px; padding: 12px; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 32, 49, 0.84); backdrop-filter: blur(6px); color: #ddf2f8; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.control-row { display: flex; align-items: center; justify-content: space-between; padding: 3px 0; }
.switch-label { font-size: 11px; color: #bdd9e4; }
.button-row { display: flex; gap: 8px; margin-top: 8px; }
.action-button { flex: 1; height: 28px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #257f9e; color: #edfaff; }
.action-button.danger { background: #7a3b4a; color: #ffe3ea; }
.result-block { margin-top: 8px; border-top: 1px solid rgba(137, 210, 233, 0.18); padding-top: 6px; }
.result-item { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; }
.result-name { color: #7fb6c9; }
.result-value { color: #d9eff6; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.hint { margin-top: 8px; font-size: 11px; color: #7fb6c9; }
.result-message { margin-top: 6px; font-size: 11px; color: #8be0b2; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>

<style>
.height-shell .measure-tooltip { position: absolute; padding: 5px 8px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 5px; background: rgba(8, 32, 49, 0.92); color: #d9eff6; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.5; white-space: nowrap; pointer-events: none; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); }
</style>
