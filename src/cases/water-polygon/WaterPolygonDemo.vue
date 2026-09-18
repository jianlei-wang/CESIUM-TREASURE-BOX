<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Cartesian3, Color, ConstantProperty, PolygonHierarchy, type Entity, type Viewer } from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import { registerWaterMaterial } from '../../lib/water'
import { DynamicWaterMaterialProperty, type WaterUniforms } from './DynamicWaterMaterialProperty'

type BoundaryPoint = { longitude: number; latitude: number }

const container = ref<HTMLElement | null>(null)
const enabled = ref(true)
const waveSpeed = ref(0.75)
const waveScale = ref(2.2)
const waveHeight = ref(0.12)
const clarity = ref(1)
const boundaryText = ref('116.375,39.905;116.405,39.905;116.412,39.920;116.392,39.933;116.370,39.921')
const statusMessage = ref('正在加载 Bing 地图…')
let viewer: Viewer | undefined
let waterEntity: Entity | undefined
let removePostUpdate: (() => void) | undefined
let elapsed = 0
let lastFrameTime = 0
const waterUniforms: WaterUniforms = { time: 0, waveSpeed: 0.75, waveScale: 2.2, waveHeight: 0.12, clarity: 1 }

function parseBoundary(value: string): BoundaryPoint[] {
  const points = value.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [longitude, latitude] = part.split(',').map(Number)
    return { longitude, latitude }
  })
  if (points.length < 3 || points.some((point) => !Number.isFinite(point.longitude) || !Number.isFinite(point.latitude))) {
    throw new Error('边界需要至少三个“经度,纬度”坐标，使用分号分隔')
  }
  return points
}

function createHierarchy(points: BoundaryPoint[]): PolygonHierarchy {
  return new PolygonHierarchy(points.map((point) => Cartesian3.fromDegrees(point.longitude, point.latitude, 30)))
}

function updateMaterial(): void {
  waterUniforms.waveSpeed = waveSpeed.value
  waterUniforms.waveScale = waveScale.value
  waterUniforms.waveHeight = waveHeight.value
  waterUniforms.clarity = clarity.value
  waterUniforms.time = elapsed
}

function updateEnabled(): void {
  if (waterEntity) waterEntity.show = enabled.value
}

function applyBoundary(): void {
  try {
    const points = parseBoundary(boundaryText.value)
    if (!waterEntity?.polygon) return
    waterEntity.polygon.hierarchy = new ConstantProperty(createHierarchy(points))
    viewer?.camera.flyTo({ destination: Cartesian3.fromDegrees(points[0].longitude, points[0].latitude, 4500) })
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
}

watch([waveSpeed, waveScale, waveHeight, clarity], updateMaterial)
watch(enabled, updateEnabled)

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    registerWaterMaterial()
    waterEntity = viewer.entities.add({
      polygon: {
        hierarchy: createHierarchy(parseBoundary(boundaryText.value)),
        material: new DynamicWaterMaterialProperty(waterUniforms),
        perPositionHeight: true,
        outline: true,
        outlineColor: Color.fromCssColorString('#8dd7ed').withAlpha(0.8)
      }
    })
    viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(116.39, 39.916, 4500) })
    const onPostUpdate = () => {
      const now = performance.now()
      if (lastFrameTime > 0) elapsed += Math.min((now - lastFrameTime) / 1000, 0.1)
      lastFrameTime = now
      updateMaterial()
    }
    viewer.scene.postUpdate.addEventListener(onPostUpdate)
    removePostUpdate = () => viewer?.scene.postUpdate.removeEventListener(onPostUpdate)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  removePostUpdate?.()
  waterEntity = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="water-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="water-panel">
      <div class="panel-title">动态多边形水面</div>
      <div class="toggle-row"><span class="toggle-label">效果开关</span><button class="toggle" :class="{ on: enabled }" :aria-label="enabled ? '关闭水面效果' : '开启水面效果'" @click="enabled = !enabled"><i></i></button></div>
      <div class="param-row"><span class="param-label">流速</span><input v-model.number="waveSpeed" class="param-slider" type="range" min="0.1" max="2" step="0.05" /><span class="param-value">{{ waveSpeed.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">波纹</span><input v-model.number="waveScale" class="param-slider" type="range" min="0.5" max="5" step="0.1" /><span class="param-value">{{ waveScale.toFixed(1) }}</span></div>
      <div class="param-row"><span class="param-label">波高</span><input v-model.number="waveHeight" class="param-slider" type="range" min="0.02" max="0.35" step="0.01" /><span class="param-value">{{ waveHeight.toFixed(2) }}</span></div>
      <div class="param-row"><span class="param-label">清澈</span><input v-model.number="clarity" class="param-slider" type="range" min="0.4" max="1.4" step="0.05" /><span class="param-value">{{ clarity.toFixed(2) }}</span></div>
      <label class="boundary-label" for="water-boundary">边界坐标</label>
      <textarea id="water-boundary" v-model="boundaryText" class="boundary-input" aria-label="多边形边界坐标"></textarea>
      <button class="apply-button" @click="applyBoundary">应用边界</button>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.water-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.water-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 8px; width: 250px; padding: 11px; border: 1px solid rgba(137, 210, 233, 0.28); border-radius: 9px; background: rgba(8, 32, 49, 0.84); backdrop-filter: blur(6px); color: #ddf2f8; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; }
.toggle-label, .param-label, .boundary-label { font-size: 11px; color: #bdd9e4; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(137, 210, 233, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e8f8fb; transition: transform 0.2s; }
.toggle.on { background: #36a8cc; }.toggle.on i { transform: translateX(18px); }
.param-row { display: flex; align-items: center; gap: 8px; }.param-label { flex: 0 0 30px; }.param-slider { flex: 1; min-width: 0; height: 4px; accent-color: #52c4e8; }.param-value { flex: 0 0 34px; color: #9cc9d8; font-size: 10px; text-align: right; }
.boundary-label { margin-top: 2px; }.boundary-input { min-height: 50px; resize: vertical; border: 1px solid rgba(137, 210, 233, 0.24); border-radius: 5px; background: rgba(3, 19, 31, 0.65); color: #d9eff6; font: 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }.apply-button { height: 25px; border: 0; border-radius: 5px; background: #257f9e; color: #edfaff; cursor: pointer; font-size: 11px; }.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
