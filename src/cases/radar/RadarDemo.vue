<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantProperty,
  HeadingPitchRoll,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Transforms,
  type Entity,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { pickPosition } from '../measure-lib'
import { RadarPrimitiveMaterialProperty, registerRadarMaterial } from '../radar-lib/radar-material'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const resultMessage = ref('')
const placing = ref(false)
const radarCount = ref(0)

const colorHex = ref('#00e5ff')
const headingDeg = ref(45)
const length = ref(2000)
const bottomRadius = ref(1000)
const thickness = ref(0.4)
const repeat = ref(15)
const duration = ref(2000)
const offset = ref(0)

const RADAR_LON = 120.38
const RADAR_LAT = 36.08

let viewer: Viewer | undefined
let handler: ScreenSpaceEventHandler | undefined
let removeTick: (() => void) | undefined
let radarEntity: Entity | undefined

function makeMaterial(): RadarPrimitiveMaterialProperty {
  return new RadarPrimitiveMaterialProperty({
    color: Color.fromCssColorString(colorHex.value),
    duration: duration.value,
    repeat: repeat.value,
    offset: offset.value,
    thickness: thickness.value
  })
}

function removeRadars(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const entity of viewer.entities.values) {
    const cylinder = (entity as { cylinder?: { material?: unknown } }).cylinder
    if (cylinder?.material instanceof RadarPrimitiveMaterialProperty) {
      viewer.entities.remove(entity)
    }
  }
  radarEntity = undefined
  radarCount.value = 0
}

function createRadar(lon: number, lat: number): void {
  if (!viewer || viewer.isDestroyed()) return
  const position = Cartesian3.fromDegrees(lon, lat, 0)
  const orientation = Transforms.headingPitchRollQuaternion(
    position,
    new HeadingPitchRoll(CesiumMath.toRadians(headingDeg.value), 0, 0)
  )
  radarEntity = viewer.entities.add({
    position,
    orientation,
    cylinder: {
      length: length.value,
      topRadius: 0,
      bottomRadius: bottomRadius.value,
      material: makeMaterial()
    }
  })
  radarCount.value = 1
  resultMessage.value = `雷达锥体已放置于 ${lon.toFixed(4)}, ${lat.toFixed(4)}`
}

function onLeftClick(event: { position: Cartesian2 }): void {
  if (!viewer || viewer.isDestroyed() || !placing.value) return
  const pos = pickPosition(viewer.scene, event.position)
  if (!pos) return
  const carto = Cartographic.fromCartesian(pos)
  removeRadars()
  createRadar(CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude))
}

function updateRadar(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (radarCount.value === 0) {
    createRadar(RADAR_LON, RADAR_LAT)
    return
  }
  for (const entity of viewer.entities.values) {
    const cylinder = (entity as { cylinder?: { material?: unknown; length?: unknown; bottomRadius?: unknown } }).cylinder
    if (!cylinder) continue
    const m = cylinder.material
    if (!(m instanceof RadarPrimitiveMaterialProperty)) continue
    m.color = Color.fromCssColorString(colorHex.value)
    m.duration = duration.value
    m.repeat = repeat.value
    m.offset = offset.value
    m.thickness = thickness.value
    cylinder.length = length.value
    cylinder.bottomRadius = bottomRadius.value
    if (entity.position) {
      const pos = entity.position.getValue()
      if (pos) {
        entity.orientation = new ConstantProperty(
          Transforms.headingPitchRollQuaternion(
            pos,
            new HeadingPitchRoll(CesiumMath.toRadians(headingDeg.value), 0, 0)
          )
        )
      }
    }
  }
  resultMessage.value = `雷达参数已更新(方向角 ${headingDeg.value}°)`
}

watch([colorHex, headingDeg, length, bottomRadius, thickness, repeat, duration, offset], () => {
  if (viewer && !viewer.isDestroyed()) updateRadar()
})

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    registerRadarMaterial()
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(RADAR_LON + 0.02, RADAR_LAT - 0.02, 12000)
    })

    handler = new ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((event: { position: Cartesian2 }) => onLeftClick(event), ScreenSpaceEventType.LEFT_CLICK)

    removeTick = viewer.clock.onTick.addEventListener(() => {
      if (placing.value) viewer?.scene.requestRender()
    })

    createRadar(RADAR_LON, RADAR_LAT)
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  removeTick?.()
  removeTick = undefined
  handler?.destroy()
  handler = undefined
  removeRadars()
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="radar-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">雷达波效果</div>

      <button class="action-button primary" :class="{ active: placing }" @click="placing = !placing">
        {{ placing ? '放置中… 点击地图定位雷达' : '点击地图放置雷达' }}
      </button>
      <button class="action-button danger" @click="removeRadars(); resultMessage = '已移除全部雷达'">清除雷达({{ radarCount }})</button>
      <button class="action-button neutral" @click="createRadar(RADAR_LON, RADAR_LAT)">重置默认位置</button>

      <div class="section-title">雷达参数</div>
      <div class="control-row">
        <span class="row-label">颜色</span>
        <input v-model="colorHex" type="color" class="color-input" />
      </div>
      <div class="control-row">
        <span class="row-label">方向角(°)</span>
        <input v-model.number="headingDeg" type="range" min="0" max="360" step="1" />
        <span class="row-value">{{ headingDeg }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">锥体长度(m)</span>
        <input v-model.number="length" type="range" min="200" max="8000" step="100" />
        <span class="row-value">{{ length }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">底部半径(m)</span>
        <input v-model.number="bottomRadius" type="range" min="200" max="6000" step="100" />
        <span class="row-value">{{ bottomRadius }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">波纹厚度</span>
        <input v-model.number="thickness" type="range" min="0.1" max="0.9" step="0.05" />
        <span class="row-value">{{ thickness.toFixed(2) }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">波纹数量</span>
        <input v-model.number="repeat" type="range" min="2" max="50" step="1" />
        <span class="row-value">{{ repeat }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">扫描周期(ms)</span>
        <input v-model.number="duration" type="range" min="500" max="8000" step="100" />
        <span class="row-value">{{ duration }}</span>
      </div>
      <div class="control-row">
        <span class="row-label">偏移量</span>
        <input v-model.number="offset" type="range" min="0" max="1" step="0.05" />
        <span class="row-value">{{ offset.toFixed(2) }}</span>
      </div>

      <p class="hint">开启放置后单击地图定位雷达锥体；参数修改实时生效。</p>
      <div v-if="resultMessage" class="result-message">{{ resultMessage }}</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.radar-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 248px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; }
.section-title { margin-top: 10px; margin-bottom: 6px; font-size: 11px; color: #8ea5c2; }
.control-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; }
.row-label { flex: 0 0 auto; color: #c3d5e8; font-size: 11px; }
.row-value { flex: 0 0 48px; text-align: right; color: #9fb8d4; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.control-row input[type="range"] { flex: 1; min-width: 0; accent-color: #2f80ed; }
.control-row input[type="color"] { width: 40px; height: 24px; padding: 0; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 5px; background: transparent; cursor: pointer; }
.action-button { width: 100%; height: 28px; margin-top: 6px; border: 0; border-radius: 5px; cursor: pointer; font-size: 11px; }
.action-button.primary { background: #2f80ed; color: #eef4ff; }
.action-button.primary.active { background: #1f6f96; }
.action-button.danger { background: #7a3b4a; color: #ffe3ea; }
.action-button.neutral { background: #2c3a52; color: #c3d5e8; }
.hint { margin: 8px 0 0; font-size: 11px; color: #7f96b3; line-height: 1.5; }
.result-message { margin-top: 6px; font-size: 11px; color: #8be0b2; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
