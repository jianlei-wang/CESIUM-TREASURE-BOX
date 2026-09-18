<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
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

type PickResult = {
  cartesian: Cartesian3
  cartesianTerrain: Cartesian3
  cartesianModel: Cartesian3 | undefined
}

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const stepCount = ref(100)
const analyzing = ref(false)
const analysisResult = ref('')
const picking = ref(false)
const pickHint = ref('')

const DEFAULT_START = Cartesian3.fromDegrees(98.71707797694049, 27.777299704639537, 2800.0)
const DEFAULT_END = Cartesian3.fromDegrees(98.71707797694049, 27.807299704639537, 3500.0)

let viewer: Viewer | undefined
let startEntity: { id?: string } | undefined
let endEntity: { id?: string } | undefined
let line1Entity: { id?: string } | undefined
let line2Entity: { id?: string } | undefined
let barrierEntity: { id?: string } | undefined
let handler: ScreenSpaceEventHandler | undefined
let startPoint: Cartesian3 | undefined = DEFAULT_START
let endPoint: Cartesian3 | undefined = DEFAULT_END

function convertCartesian3ToCartesian2(worldPoint: Cartesian3): Cartesian2 | undefined {
  if (!viewer) return undefined
  return viewer.scene.cartesianToCanvasCoordinates(worldPoint)
}

function calculateSpatialDistance(startPoint: Cartesian3, endPoint: Cartesian3): number {
  return Cartesian3.distance(startPoint, endPoint)
}

function calculateWindowDistance(startPoint: Cartesian2, endPoint: Cartesian2): number {
  return Math.sqrt((endPoint.y - startPoint.y) ** 2 + (endPoint.x - startPoint.x) ** 2)
}

function findWindowPositionByPixelInterval(
  startPosition: Cartesian2,
  endPosition: Cartesian2,
  interval: number
): Cartesian2 {
  const result = new Cartesian2(0, 0)
  const length = Math.sqrt((endPosition.x - startPosition.x) ** 2 + (endPosition.y - startPosition.y) ** 2)
  if (length < interval) return result
  result.x = (interval / length) * (endPosition.x - startPosition.x) + startPosition.x
  result.y = (interval / length) * (endPosition.y - startPosition.y) + startPosition.y
  return result
}

function findCartesian3ByDistance(
  startPosition: Cartesian3,
  endPosition: Cartesian3,
  interval: number
): Cartesian3 {
  const result = new Cartesian3(0, 0, 0)
  const length = Cartesian3.distance(startPosition, endPosition)
  if (length < interval) return result
  result.x = (interval / length) * (endPosition.x - startPosition.x) + startPosition.x
  result.y = (interval / length) * (endPosition.y - startPosition.y) + startPosition.y
  result.z = (interval / length) * (endPosition.z - startPosition.z) + startPosition.z
  return result
}

function pickCartesian(windowPosition: Cartesian2): PickResult | undefined {
  if (!viewer) return undefined
  const cartesianModel = viewer.scene.pickPosition(windowPosition)
  const ray = viewer.camera.getPickRay(windowPosition)
  if (!ray) return undefined
  const cartesianTerrain = viewer.scene.globe.pick(ray, viewer.scene)
  if (cartesianModel === undefined && cartesianTerrain === undefined) return undefined
  return {
    cartesian: cartesianModel || cartesianTerrain!,
    cartesianModel,
    cartesianTerrain: cartesianTerrain!
  }
}

function sightline(startWorldPoint: Cartesian3, endWorldPoint: Cartesian3): Cartesian3 {
  const barrierPoint = Cartesian3.ZERO.clone()
  const startPoint = convertCartesian3ToCartesian2(startWorldPoint)
  const endPoint = convertCartesian3ToCartesian2(endWorldPoint)
  if (!startPoint || !endPoint) return barrierPoint

  const worldLength = calculateSpatialDistance(startWorldPoint, endWorldPoint)
  const windowLength = calculateWindowDistance(startPoint, endPoint)
  const worldInterval = worldLength / stepCount.value
  const windowInterval = windowLength / stepCount.value

  for (let i = 1; i < stepCount.value; i++) {
    const tempWindowPoint = findWindowPositionByPixelInterval(startPoint, endPoint, windowInterval * i)
    const tempPoint = findCartesian3ByDistance(startWorldPoint, endWorldPoint, worldInterval * i)
    const surfaceResult = pickCartesian(tempWindowPoint)
    if (!surfaceResult) continue
    const tempRad = Cartographic.fromCartesian(tempPoint)
    const surfaceRad = Cartographic.fromCartesian(surfaceResult.cartesian)
    if (surfaceRad.height > tempRad.height) {
      return tempPoint
    }
  }
  return barrierPoint
}

function clearLines(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (line1Entity?.id) viewer.entities.removeById(line1Entity.id)
  if (line2Entity?.id) viewer.entities.removeById(line2Entity.id)
  if (barrierEntity?.id) viewer.entities.removeById(barrierEntity.id)
  line1Entity = undefined
  line2Entity = undefined
  barrierEntity = undefined
}

function load(): void {
  if (!viewer || viewer.isDestroyed() || !startEntity || !endEntity) return
  clearLines()
  analyzing.value = true
  analysisResult.value = ''
  statusMessage.value = '正在计算通视…'

  setTimeout(() => {
    if (!viewer || viewer.isDestroyed()) return
    if (!startPoint || !endPoint) {
      analyzing.value = false
      statusMessage.value = '请先设置观测点与目的点'
      return
    }
    const start = startPoint
    const end = endPoint
    const center = sightline(start, end)

    if (center.x === 0 && center.y === 0 && center.z === 0) {
      analysisResult.value = '可视'
      line1Entity = viewer.entities.add({
        polyline: {
          positions: [start, end],
          width: 3,
          material: Color.GREEN,
          clampToGround: false
        }
      })
    } else {
      analysisResult.value = '不可视（存在障碍点）'
      line1Entity = viewer.entities.add({
        polyline: {
          positions: [start, center],
          width: 3,
          material: Color.GREEN,
          clampToGround: false
        }
      })
      line2Entity = viewer.entities.add({
        polyline: {
          positions: [center, end],
          width: 3,
          material: Color.RED,
          clampToGround: false
        }
      })
      barrierEntity = viewer.entities.add({
        position: center,
        point: {
          pixelSize: 12,
          color: Color.ORANGE,
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: '障碍点',
          font: '11pt monospace',
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      })
    }
    analyzing.value = false
    statusMessage.value = ''
  }, 50)
}

function clears(): void {
  clearLines()
  analysisResult.value = ''
}

function setStartPoint(position: Cartesian3): void {
  startPoint = position
  const carto = Cartographic.fromCartesian(position)
  const startEntityAny = startEntity as unknown as {
    position: { setValue: (v: Cartesian3) => void }
    label?: { text: { setValue: (v: string) => void } }
  }
  startEntityAny.position.setValue(position)
  if (startEntityAny.label) {
    startEntityAny.label.text.setValue(`观测点 ${CesiumMath.toDegrees(carto.longitude).toFixed(4)}°, ${CesiumMath.toDegrees(carto.latitude).toFixed(4)}°`)
  }
}

function setEndPoint(position: Cartesian3): void {
  endPoint = position
  const carto = Cartographic.fromCartesian(position)
  const endEntityAny = endEntity as unknown as {
    position: { setValue: (v: Cartesian3) => void }
    label?: { text: { setValue: (v: string) => void } }
  }
  endEntityAny.position.setValue(position)
  if (endEntityAny.label) {
    endEntityAny.label.text.setValue(`目的点 ${CesiumMath.toDegrees(carto.longitude).toFixed(4)}°, ${CesiumMath.toDegrees(carto.latitude).toFixed(4)}°`)
  }
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !picking.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  if (!startPoint) {
    setStartPoint(pos)
    pickHint.value = '已设置观测点，请点击地图设置目的点'
  } else {
    setEndPoint(pos)
    picking.value = false
    pickHint.value = ''
  }
}

function startPicking(): void {
  if (!viewer || viewer.isDestroyed()) return
  clearLines()
  analysisResult.value = ''
  setStartPoint(DEFAULT_START)
  setEndPoint(DEFAULT_END)
  startPoint = undefined
  endPoint = undefined
  picking.value = true
  pickHint.value = '请点击地图设置观测点'
}

function cancelPicking(): void {
  picking.value = false
  pickHint.value = ''
}

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '正在加载地形…' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.globe.maximumScreenSpaceError = 2
    statusMessage.value = '正在加载 Cesium World Terrain...'
    try {
      await loadWorldTerrain(viewer)
    } catch {
      statusMessage.value = '地形加载失败，已降级为全球椭球体。'
    }
    if (!viewer || viewer.isDestroyed()) return

    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(98.685331, 27.780325, 7318.6),
      orientation: {
        heading: CesiumMath.toRadians(73),
        pitch: CesiumMath.toRadians(-52.2),
        roll: 0.0
      }
    })

    startEntity = viewer.entities.add({
      position: DEFAULT_START,
      point: {
        pixelSize: 5,
        color: Color.RED,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: '观测点',
        font: '12pt monospace',
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
    endEntity = viewer.entities.add({
      position: DEFAULT_END,
      point: {
        pixelSize: 5,
        color: Color.RED,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: '目的点',
        font: '12pt monospace',
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)

    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  handler?.destroy()
  handler = undefined
  if (viewer && !viewer.isDestroyed()) {
    clearLines()
    if (startEntity?.id) viewer.entities.removeById(startEntity.id)
    if (endEntity?.id) viewer.entities.removeById(endEntity.id)
  }
  startEntity = undefined
  endEntity = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="perspective-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">透视分析（通视分析）</div>

      <div class="section-title">分析参数</div>
      <div class="control-row">
        <span class="row-label">分段数</span>
        <input v-model.number="stepCount" type="range" min="50" max="300" step="10" />
        <span class="row-value">{{ stepCount }}</span>
      </div>

      <button class="action-button primary" :disabled="analyzing || picking" @click="load">
        {{ analyzing ? '分析中…' : '开始分析' }}
      </button>
      <button class="action-button accent" :disabled="analyzing" @click="startPicking">
        {{ picking ? '正在选点…' : '手动选点' }}
      </button>
      <button class="action-button danger" @click="clears">清除结果</button>

      <p v-if="analysisResult" class="result" :class="{ 'result-ok': analysisResult === '可视' }">
        {{ analysisResult }}
      </p>
      <p v-if="picking" class="result pick-hint">{{ pickHint || '点击地图依次设置观测点与目的点' }}</p>

      <p class="hint">
        思路：将观测点与被观测点连成的线段分割成无限多的小段，逐段比较「实际高程」与「线段理论高程」——
        若实际高程 &gt; 理论高程则不通视，该点为障碍点。
      </p>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.perspective-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 268px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 42px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.action-button { width: 100%; height: 28px; margin-top: 10px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; background: #2f80ed; color: #eef4ff; }
.action-button.accent { margin-top: 6px; background: #8a6d1a; color: #fff3d6; }
.action-button.danger { margin-top: 6px; background: #4a5a72; color: #ffd6d6; }
.action-button:disabled { opacity: 0.5; cursor: not-allowed; }
.result { margin: 10px 0 0; padding: 6px 8px; border-radius: 4px; font-size: 12px; font-weight: 700; background: rgba(255, 77, 79, 0.18); color: #ff8a8a; text-align: center; }
.result-ok { background: rgba(82, 196, 26, 0.18); color: #95de64; }
.pick-hint { background: rgba(250, 173, 20, 0.18); color: #ffd666; }
.hint { margin: 8px 0 0; font-size: 10px; color: #9fb8d4; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
