<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantProperty,
  Ellipsoid,
  PointPrimitiveCollection,
  PolygonHierarchy,
  PolylineCollection,
  ScreenSpaceEventType,
  ScreenSpaceEventHandler,
  Transforms,
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
  arrowHeadPositions,
  bearing,
  pickPosition,
  MouseTooltip,
  makeLineMaterial,
  makeDashMaterial
} from '../measure-lib'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const useTerrain = ref(true)
const measuring = ref(false)
const bearingResult = ref('--')
const angleResult = ref('--')
const quadrantResult = ref('--')

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let tooltip: MouseTooltip | undefined
let disposed = false

let vertexPoints: PointPrimitiveCollection | undefined
let previewPoint: PointPrimitiveCollection | undefined
let previewLine: PolylineCollection | undefined
let northLine: PolylineCollection | undefined
let verticalLine: PolylineCollection | undefined
let measureLine: PolylineCollection | undefined
let verticalArrowEntity: Entity | undefined
let resultLabelEntity: Entity | undefined
let worldTerrainLoaded = false

const collected: Cartesian3[] = []
let previewPos: Cartesian3 | undefined

function clearEntities(): void {
  if (viewer) viewer.entities.removeAll()
  verticalArrowEntity = undefined
  resultLabelEntity = undefined
  vertexPoints?.removeAll()
  previewPoint?.removeAll()
  previewLine?.removeAll()
  northLine?.removeAll()
  verticalLine?.removeAll()
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

function quadrantName(deg: number): string {
  if (deg >= 337.5 || deg < 22.5) return '正北'
  if (deg < 67.5) return '东北'
  if (deg < 112.5) return '正东'
  if (deg < 157.5) return '东南'
  if (deg < 202.5) return '正南'
  if (deg < 247.5) return '西南'
  if (deg < 292.5) return '正西'
  return '西北'
}

function computeResult(): void {
  if (!viewer || collected.length < 2) return
  const a = collected[0]
  const b = collected[collected.length - 1]
  const deg = bearing(a, b)
  bearingResult.value = `${deg.toFixed(2)}°`
  angleResult.value = `${deg.toFixed(2)}°`
  quadrantResult.value = quadrantName(deg)

  if (resultLabelEntity) {
    viewer.entities.remove(resultLabelEntity)
    resultLabelEntity = undefined
  }
  resultLabelEntity = viewer.entities.add({
    position: b,
    label: {
      text: `方位角: ${bearingResult.value} (${quadrantResult.value})`,
      font: '13px sans-serif',
      fillColor: Color.fromCssColorString('#ffd166'),
      outlineColor: Color.BLACK,
      outlineWidth: 4,
      backgroundColor: Color.fromCssColorString('#102b40').withAlpha(0.72),
      showBackground: true,
      pixelOffset: new Cartesian2(0, -26),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      horizontalOrigin: 0,
      verticalOrigin: 0
    }
  })
}

function onTerrainChanged(): void {
  if (!viewer) return
  if (collected.length >= 1) {
    const end = collected.length >= 2 ? collected[1] : previewPos
    if (end) drawReferenceLines(collected[0], end)
  }
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
  resultMessage.value = '单击选起点，移动鼠标实时查看方位角，再次单击或双击/右键结束'
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
    drawReferenceLines(collected[0], collected[1])
    computeResult()
    resultMessage.value = '测量完成，左上侧面板显示最终结果'
  } else {
    northLine?.removeAll()
    verticalLine?.removeAll()
    resultMessage.value = '点数不足，请至少采集 2 个点'
  }
}

function resetMeasurement(): void {
  collected.length = 0
  previewPos = undefined
  measuring.value = false
  bearingResult.value = '--'
  angleResult.value = '--'
  quadrantResult.value = '--'
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

function updateArrow(entity: Entity | undefined, tip: Cartesian3, direction: Cartesian3, length: number, halfWidth: number, color: string): Entity | undefined {
  if (!viewer) return entity
  if (!entity) {
    entity = viewer.entities.add({
      polygon: {
        hierarchy: new PolygonHierarchy([]),
        material: Color.fromCssColorString(color).withAlpha(0.95),
        outline: true,
        outlineColor: Color.fromCssColorString(color),
        outlineWidth: 1
      }
    })
  }
  entity.polygon!.hierarchy = new ConstantProperty(new PolygonHierarchy(arrowHeadPositions(tip, direction, length, halfWidth)))
  return entity
}

function sampleGroundLine(start: Cartesian3, dir: Cartesian3, length: number, samples: number): Cartesian3[] {
  const pts: Cartesian3[] = []
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples
    const p = Cartesian3.add(start, Cartesian3.multiplyByScalar(dir, length * t, new Cartesian3()), new Cartesian3())
    const c = Cartographic.fromCartesian(p)
    let h = 0
    if (viewer && worldTerrainLoaded) {
      const gh = viewer.scene.globe.getHeight(c)
      if (gh !== undefined) h = gh
    }
    pts.push(Cartesian3.fromRadians(c.longitude, c.latitude, h + 2))
  }
  return pts
}

function drawReferenceLines(start: Cartesian3, end: Cartesian3): void {
  northLine?.removeAll()
  verticalLine?.removeAll()
  const dist = Math.max(Cartesian3.distance(start, end), 1)
  const len = Math.max(dist * 1.2, 50)
  const enu = Transforms.eastNorthUpToFixedFrame(start)
  const north = new Cartesian3(enu[4], enu[5], enu[6])
  const northPts = sampleGroundLine(start, north, len, 20)
  northLine?.add({
    positions: northPts,
    width: 3,
    material: makeDashMaterial(Color.fromCssColorString('#7be09e'))
  })
  const normal = Ellipsoid.WGS84.geodeticSurfaceNormal(start)
  const upEnd = Cartesian3.add(
    start,
    Cartesian3.multiplyByScalar(normal, len, new Cartesian3()),
    new Cartesian3()
  )
  verticalLine?.add({
    positions: [start, upEnd],
    width: 3,
    material: makeDashMaterial(Color.fromCssColorString('#ff5a5a'))
  })
  verticalArrowEntity = updateArrow(
    verticalArrowEntity,
    upEnd,
    normal,
    Math.min(len * 0.18, 200),
    Math.min(len * 0.1, 110),
    '#ff5a5a'
  )
}

function drawAuxiliaryLines(start: Cartesian3, mouse: Cartesian3): void {
  previewPoint?.removeAll()
  previewLine?.removeAll()
  previewPoint?.add({
    position: mouse,
    color: Color.fromCssColorString('#8ab4f8'),
    pixelSize: 6,
    outlineColor: Color.WHITE,
    outlineWidth: 1,
    disableDepthTestDistance: Number.POSITIVE_INFINITY
  })
  previewLine?.add({
    positions: [start, mouse],
    width: 2,
    material: makeLineMaterial(Color.fromCssColorString('#8ab4f8').withAlpha(0.85))
  })
  drawReferenceLines(start, mouse)
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
  let content = '单击选起点，再次单击或双击/右键结束<br>'
  content += `经度 ${lon.toFixed(6)}°<br>纬度 ${lat.toFixed(6)}°<br>高度 ${carto.height.toFixed(1)} m`

  if (collected.length >= 1) {
    drawAuxiliaryLines(collected[collected.length - 1], pos)
    const deg = bearing(collected[collected.length - 1], pos)
    content += `<br>方位角: ${deg.toFixed(2)}° (${quadrantName(deg)})`
  }
  tooltip.setContent(content)
  tooltip.setPosition(event.endPosition.x, event.endPosition.y)
  tooltip.show()
  previewPos = pos
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
    northLine = viewer.scene.primitives.add(new PolylineCollection())
    verticalLine = viewer.scene.primitives.add(new PolylineCollection())
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
  <div class="bearing-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="control-panel">
      <div class="panel-title">方位角量测</div>
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
      <div class="hint">单击选起点，移动鼠标查看带箭头的指北/垂线参考，再次单击结束</div>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>
    <div class="result-panel">
      <div class="result-title">量测结果</div>
      <div class="result-item"><span class="result-name">方位角</span><span class="result-value">{{ bearingResult }}</span></div>
      <div class="result-item"><span class="result-name">角度</span><span class="result-value">{{ angleResult }}</span></div>
      <div class="result-item"><span class="result-name">方向</span><span class="result-value">{{ quadrantResult }}</span></div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.bearing-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
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
.bearing-shell .measure-tooltip { position: absolute; padding: 5px 8px; border: 1px solid rgba(137, 210, 233, 0.4); border-radius: 5px; background: rgba(8, 32, 49, 0.92); color: #d9eff6; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.5; white-space: nowrap; pointer-events: none; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); }
</style>
