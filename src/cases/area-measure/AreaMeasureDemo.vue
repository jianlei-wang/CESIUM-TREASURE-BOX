<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Color,
  ConstantProperty,
  Ellipsoid,
  PointPrimitiveCollection,
  PolygonHierarchy,
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
  formatArea,
  pickPosition,
  polygonCentroid,
  spatialArea,
  surfaceArea,
  projectedArea,
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
let areaLine: PolylineCollection | undefined
let polygonEntity: Entity | undefined
let resultLabelEntity: Entity | undefined
let worldTerrainLoaded = false

const collected: Cartesian3[] = []
let previewPos: Cartesian3 | undefined

function clearEntities(): void {
  if (viewer) viewer.entities.removeAll()
  polygonEntity = undefined
  resultLabelEntity = undefined
  vertexPoints?.removeAll()
  previewPoint?.removeAll()
  previewLine?.removeAll()
  areaLine?.removeAll()
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

function updatePolygon(positions: Cartesian3[]): void {
  if (!viewer) return
  if (positions.length < 3) {
    if (polygonEntity) {
      polygonEntity.polygon!.hierarchy = new ConstantProperty(new PolygonHierarchy([]))
    }
    return
  }
  if (!polygonEntity) {
    polygonEntity = viewer.entities.add({
      polygon: {
        hierarchy: new PolygonHierarchy([]),
        material: Color.fromCssColorString('#ffb84d').withAlpha(0.22),
        outline: true,
        outlineColor: Color.fromCssColorString('#ffb84d').withAlpha(0.85),
        outlineWidth: 1
      }
    })
  }
  polygonEntity.polygon!.hierarchy = new ConstantProperty(new PolygonHierarchy(positions))
}

function updatePreview(): void {
  previewPoint?.removeAll()
  previewLine?.removeAll()
  if (!previewPos || collected.length === 0) {
    updatePolygon(collected.length >= 3 ? collected : [])
    return
  }
  previewPoint?.add({
    position: previewPos,
    color: Color.fromCssColorString('#8ab4f8'),
    pixelSize: 6,
    outlineColor: Color.WHITE,
    outlineWidth: 1,
    disableDepthTestDistance: Number.POSITIVE_INFINITY
  })
  previewLine?.add({
    positions: [...collected, previewPos],
    width: 2,
    material: makeLineMaterial(Color.fromCssColorString('#8ab4f8').withAlpha(0.7))
  })
  if (collected.length >= 2) {
    updatePolygon([...collected, previewPos])
  }
}

function renderResultLabel(): void {
  if (!viewer || collected.length < 3) return
  if (resultLabelEntity) {
    viewer.entities.remove(resultLabelEntity)
    resultLabelEntity = undefined
  }
  const centroid = polygonCentroid(collected)
  const normal = Ellipsoid.WGS84.geodeticSurfaceNormal(centroid)
  const pos = Cartesian3.add(centroid, Cartesian3.multiplyByScalar(normal, 15, new Cartesian3()), new Cartesian3())
  resultLabelEntity = viewer.entities.add({
    position: pos,
    label: {
      text: `空间面积 ${spatialResult.value}\n地表面积 ${surfaceResult.value}\n投影面积 ${projectedResult.value}`,
      font: '12px sans-serif',
      fillColor: Color.fromCssColorString('#ffd166'),
      outlineColor: Color.BLACK,
      outlineWidth: 4,
      backgroundColor: Color.fromCssColorString('#102b40').withAlpha(0.72),
      showBackground: true,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      horizontalOrigin: 0,
      verticalOrigin: 1
    }
  })
}

function computeResult(): void {
  if (!viewer || collected.length < 3) return
  const pts = collected.slice()
  spatialResult.value = formatArea(spatialArea(pts))
  projectedResult.value = formatArea(projectedArea(pts))
  surfaceResult.value = useTerrain.value && worldTerrainLoaded
    ? formatArea(surfaceArea(viewer.scene, pts))
    : spatialResult.value
  renderResultLabel()
}

function onTerrainChanged(): void {
  if (collected.length >= 3) computeResult()
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
  resultMessage.value = '单击加点围合多边形，双击或右键结束'
}

function finishMeasurement(): void {
  if (!measuring.value) return
  measuring.value = false
  previewPos = undefined
  previewPoint?.removeAll()
  previewLine?.removeAll()
  tooltip?.hide()
  if (collected.length >= 3) {
    areaLine?.removeAll()
    areaLine?.add({
      positions: [...collected, collected[0]],
      width: 3,
      material: makeLineMaterial(Color.fromCssColorString('#ffb84d'))
    })
    updatePolygon(collected.slice())
    computeResult()
    resultMessage.value = '测量完成，左上侧面板显示最终结果'
  } else {
    resultMessage.value = '点数不足，请至少采集 3 个点'
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
  let content = '单击加点围合多边形，双击或右键结束<br>'
  content += `经度 ${lon.toFixed(6)}°<br>纬度 ${lat.toFixed(6)}°<br>高度 ${carto.height.toFixed(1)} m`

  if (measuring.value && collected.length >= 2) {
    const temp = [...collected, pos]
    let live = formatArea(spatialArea(temp))
    if (useTerrain.value && worldTerrainLoaded) {
      live = formatArea(surfaceArea(viewer.scene, temp))
    }
    content += `<br>围合面积: ${live}`
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
  if (collected.length >= 3) updatePreview()
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
    areaLine = viewer.scene.primitives.add(new PolylineCollection())
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
  <div class="area-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="control-panel">
      <div class="panel-title">面积量测</div>
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
      <div class="hint">单击加点围合多边形，双击或右键结束</div>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>
    <div class="result-panel">
      <div class="result-title">量测结果</div>
      <div class="result-item"><span class="result-name">空间面积</span><span class="result-value">{{ spatialResult }}</span></div>
      <div class="result-item"><span class="result-name">地表面积</span><span class="result-value">{{ surfaceResult }}</span></div>
      <div class="result-item"><span class="result-name">投影面积</span><span class="result-value">{{ projectedResult }}</span></div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.area-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
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
.area-shell .measure-tooltip { position: absolute; padding: 5px 8px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 5px; background: rgba(8, 32, 49, 0.92); color: #d9eff6; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.5; white-space: nowrap; pointer-events: none; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); }
</style>
