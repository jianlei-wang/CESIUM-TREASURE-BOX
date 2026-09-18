<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Cartesian3, Color, EllipsoidSurfaceAppearance, GeometryInstance, GroundPrimitive, Material, PolygonGeometry, PolygonHierarchy, type Viewer } from 'cesium'
import waterNormals from './waterNormalsSmall.jpg'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

const container = ref<HTMLElement | null>(null)
const enabled = ref(true)
const frequency = ref(800)
const animationSpeed = ref(0.03)
const amplitude = ref(8)
const baseWaterColor = ref('#0c6680')
const blendColor = ref('#165b7b')
const boundaryText = ref('116.375,39.905;116.405,39.905;116.412,39.920;116.392,39.933;116.370,39.921')
const statusMessage = ref('正在加载 Bing 地图…')
let viewer: Viewer | undefined
let waterPrimitive: GroundPrimitive | undefined
let waterMaterial: Material | undefined

function parseBoundary(value: string): Array<{ longitude: number; latitude: number }> {
  const points = value.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [longitude, latitude] = part.split(',').map(Number)
    return { longitude, latitude }
  })
  if (points.length < 3 || points.some((point) => !Number.isFinite(point.longitude) || !Number.isFinite(point.latitude))) throw new Error('边界需要至少三个“经度,纬度”坐标')
  return points
}

function createHierarchy(): PolygonHierarchy {
  return new PolygonHierarchy(parseBoundary(boundaryText.value).map((point) => Cartesian3.fromDegrees(point.longitude, point.latitude)))
}

function createWaterPrimitive(): GroundPrimitive {
  if (!viewer || !waterMaterial) throw new Error('水面场景尚未初始化')
  const geometryInstance = new GeometryInstance({
    geometry: new PolygonGeometry({ polygonHierarchy: createHierarchy() })
  })
  return viewer.scene.primitives.add(new GroundPrimitive({
    geometryInstances: geometryInstance,
    appearance: new EllipsoidSurfaceAppearance({ material: waterMaterial })
  }))
}

function updateMaterial(): void {
  if (!waterMaterial) return
  waterMaterial.uniforms.frequency = frequency.value
  waterMaterial.uniforms.animationSpeed = animationSpeed.value
  waterMaterial.uniforms.amplitude = amplitude.value
  waterMaterial.uniforms.baseWaterColor = Color.fromCssColorString(baseWaterColor.value)
  waterMaterial.uniforms.blendColor = Color.fromCssColorString(blendColor.value)
}

function applyBoundary(): void {
  try {
    if (!viewer || !waterPrimitive) return
    const points = parseBoundary(boundaryText.value)
    viewer.scene.primitives.remove(waterPrimitive)
    waterPrimitive = createWaterPrimitive()
    waterPrimitive.show = enabled.value
    viewer?.camera.flyTo({ destination: Cartesian3.fromDegrees(points[0].longitude, points[0].latitude, 4500) })
    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
}

watch([frequency, animationSpeed, amplitude, baseWaterColor, blendColor], updateMaterial)
watch(enabled, (value) => { if (waterPrimitive) waterPrimitive.show = value })

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = { onStatus: (message) => { statusMessage.value = message }, onBasemapReady: () => { statusMessage.value = '' } }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    waterMaterial = new Material({
      fabric: {
        type: 'Water',
        uniforms: {
          baseWaterColor: Color.fromCssColorString(baseWaterColor.value),
          blendColor: Color.fromCssColorString(blendColor.value),
          normalMap: waterNormals,
          frequency: frequency.value,
          animationSpeed: animationSpeed.value,
          amplitude: amplitude.value
        }
      }
    })
    waterPrimitive = createWaterPrimitive()
    viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(116.39, 39.916, 4500) })
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (waterPrimitive && viewer && !viewer.isDestroyed()) {
    viewer.scene.primitives.remove(waterPrimitive)
  }
  waterPrimitive = undefined
  waterMaterial = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="builtin-water-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="builtin-water-panel">
      <div class="panel-title">Cesium 内置动态水面</div>
      <div class="toggle-row"><span>效果开关</span><button class="toggle" :class="{ on: enabled }" @click="enabled = !enabled"><i></i></button></div>
      <div class="param-row"><span>频率</span><input v-model.number="frequency" type="range" min="100" max="1600" step="50"><b>{{ frequency }}</b></div>
      <div class="param-row"><span>动画速度</span><input v-model.number="animationSpeed" type="range" min="0.005" max="0.08" step="0.005"><b>{{ animationSpeed.toFixed(3) }}</b></div>
      <div class="param-row"><span>波幅</span><input v-model.number="amplitude" type="range" min="1" max="20" step="1"><b>{{ amplitude }}</b></div>
      <label>基础水色 <input v-model="baseWaterColor" type="color"></label>
      <label>混合水色 <input v-model="blendColor" type="color"></label>
      <label>边界坐标<textarea v-model="boundaryText"></textarea></label>
      <button class="apply-button" @click="applyBoundary">应用边界</button>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.builtin-water-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }.cesium-container { width: 100%; height: 100%; }.builtin-water-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 8px; width: 250px; padding: 11px; border: 1px solid rgba(137,210,233,.28); border-radius: 9px; background: rgba(8,32,49,.86); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 10px; }.panel-title { font-size: 12px; font-weight: 700; }.toggle-row,.param-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.param-row input[type='range'] { flex: 1; min-width: 0; accent-color: #52c4e8; }.param-row b { flex: 0 0 36px; color: #9cc9d8; font-size: 9px; text-align: right; }.toggle { position: relative; width: 36px; height: 18px; border-radius: 999px; background: rgba(137,210,233,.35); }.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e8f8fb; transition: transform .2s; }.toggle.on { background: #36a8cc; }.toggle.on i { transform: translateX(18px); }.builtin-water-panel label { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #bdd9e4; }.builtin-water-panel textarea { width: 145px; min-height: 48px; resize: vertical; border: 1px solid rgba(137,210,233,.24); border-radius: 4px; background: #102b40; color: #d9eff6; font: 9px/1.4 monospace; }.apply-button { min-height: 25px; border-radius: 5px; background: #257f9e; color: #edfaff; font-size: 11px; }.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
