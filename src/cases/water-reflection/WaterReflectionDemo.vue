<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  CallbackPositionProperty,
  CallbackProperty,
  Cartesian3,
  Cartographic,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  HeadingPitchRoll,
  JulianDate,
  Quaternion,
  type Entity,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain, type SceneCallbacks } from '../../lib/cesium-scene'
import WaterReflectionPrimitive, { type WaterReflectionOption } from './WaterReflectionPrimitive'
import { LIJIANG_WATER_POSITIONS } from './water-positions'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')

const rippleSize = ref(50)
const waterAlpha = ref(0.9)
const reflectivity = ref(0.3)
const distortionScale = ref(3.7)
const waterHeight = ref(1480)
const lightX = ref(0)
const lightY = ref(0)
const lightZ = ref(1)
const sunShiny = ref(100)
const waterColor = ref('#00aeff')
const boxSize = ref(50)
const boxSpeed = ref(3)
const boxColor = ref('#42A5F5')
const showBox = ref(true)

let viewer: Viewer | undefined
let waterPrimitive: WaterReflectionPrimitive | undefined
let centerEllipsoid: Entity | undefined
let floatingBox: Entity | undefined
let preUpdateListener: ((scene: any, time: JulianDate) => void) | undefined

function createPositions(): Cartographic[] {
  return LIJIANG_WATER_POSITIONS.map(([longitude, latitude]) =>
    Cartographic.fromDegrees(longitude, latitude, waterHeight.value + 5 * Math.random())
  )
}

function syncWaterUniforms(): void {
  if (!waterPrimitive) return
  waterPrimitive.rippleSize = rippleSize.value
  waterPrimitive.waterAlpha = waterAlpha.value
  waterPrimitive.reflectivity = reflectivity.value
  waterPrimitive.distortionScale = distortionScale.value
  waterPrimitive.height = waterHeight.value
  waterPrimitive.lightDirection = new Cartesian3(lightX.value, lightY.value, lightZ.value)
  waterPrimitive.sunShiny = sunShiny.value
  waterPrimitive.waterColor = waterColor.value
}

function syncBox(): void {
  if (!floatingBox) return
  const size = boxSize.value
  if (floatingBox.box) {
    floatingBox.box.dimensions = new ConstantProperty(new Cartesian3(size, size, size))
    floatingBox.box.material = new ColorMaterialProperty(Color.fromCssColorString(boxColor.value).withAlpha(0.8))
  }
  floatingBox.show = showBox.value
}

watch([rippleSize, waterAlpha, reflectivity, distortionScale, waterHeight, lightX, lightY, lightZ, sunShiny, waterColor], syncWaterUniforms)
watch([boxSize, boxColor, showBox], syncBox)

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.clock.multiplier = 1.5
    viewer.scene.globe.depthTestAgainstTerrain = true
    statusMessage.value = '正在加载Cesium World Terrain...'
    await loadWorldTerrain(viewer)
    if (!viewer || viewer.isDestroyed()) return
    statusMessage.value = ''

    const options: WaterReflectionOption = {
      height: waterHeight.value,
      positions: createPositions(),
      rippleSize: rippleSize.value,
      waterAlpha: waterAlpha.value,
      waterColor: Color.fromCssColorString(waterColor.value),
      reflectivity: reflectivity.value,
      lightDirection: new Cartesian3(lightX.value, lightY.value, lightZ.value),
      sunShiny: sunShiny.value,
      distortionScale: distortionScale.value
    }
    waterPrimitive = new WaterReflectionPrimitive(viewer, options)

    centerEllipsoid = viewer.entities.add({
      position: Cartesian3.fromDegrees(100.66438, 26.56388, 1600),
      ellipsoid: {
        radii: new Cartesian3(100, 100, 100),
        outline: true,
        outlineColor: Color.BLACK,
        material: Color.YELLOW
      }
    })

    const boxSizeValue = boxSize.value
    floatingBox = viewer.entities.add({
      name: 'Floating Box',
      position: new CallbackPositionProperty(() => {
        const time = viewer!.clock.currentTime
        const seconds = JulianDate.secondsDifference(time, JulianDate.fromDate(new Date()))
        const verticalOffset = 3 * Math.sin(seconds * boxSpeed.value)
        const horizontalOffsetX = 2 * Math.sin(seconds * boxSpeed.value * 0.3)
        const horizontalOffsetY = 2 * Math.cos(seconds * boxSpeed.value * 0.4)
        return Cartesian3.fromDegrees(
          100.66938 + horizontalOffsetX * 0.0001,
          26.56588 + horizontalOffsetY * 0.0001,
          waterHeight.value + 2 + verticalOffset
        )
      }, false),
      box: {
        dimensions: new Cartesian3(boxSizeValue, boxSizeValue, boxSizeValue),
        material: Color.fromCssColorString(boxColor.value).withAlpha(0.8),
        outline: true,
        outlineColor: Color.BLACK
      },
      show: showBox.value
    })

    preUpdateListener = (scene: any, time: JulianDate) => {
      if (floatingBox && floatingBox.show) {
        const seconds = JulianDate.secondsDifference(time, JulianDate.fromDate(new Date()))
        const rotationSpeed = boxSpeed.value * 0.3
        floatingBox.orientation = new CallbackProperty(() => Quaternion.fromHeadingPitchRoll(
          new HeadingPitchRoll(
            seconds * rotationSpeed,
            seconds * rotationSpeed * 0.7,
            seconds * rotationSpeed * 0.5
          )
        ), true)
      }
    }
    viewer.scene.preUpdate.addEventListener(preUpdateListener)

    viewer.flyTo([centerEllipsoid, floatingBox], {
      duration: 1,
      offset: {
        heading: 90 * Math.PI / 180,
        pitch: -25 * Math.PI / 180,
        range: 2500
      }
    })
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  if (viewer && preUpdateListener && !viewer.isDestroyed()) {
    viewer.scene.preUpdate.removeEventListener(preUpdateListener)
  }
  preUpdateListener = undefined
  if (waterPrimitive) {
    waterPrimitive.destroy()
  }
  waterPrimitive = undefined
  centerEllipsoid = undefined
  floatingBox = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="water-reflection-shell">
    <div ref="container" class="cesium-container"></div>
    <div class="water-reflection-panel">
      <div class="panel-title">Primitive 真实水面倒影</div>
      <div class="param-row"><span>波纹大小</span><input v-model.number="rippleSize" type="range" min="0" max="300" step="1"><b>{{ rippleSize }}</b></div>
      <div class="param-row"><span>水面透明度</span><input v-model.number="waterAlpha" type="range" min="0" max="1" step="0.01"><b>{{ waterAlpha.toFixed(2) }}</b></div>
      <div class="param-row"><span>水面反射率</span><input v-model.number="reflectivity" type="range" min="0" max="1" step="0.01"><b>{{ reflectivity.toFixed(2) }}</b></div>
      <div class="param-row"><span>水面扭曲强度</span><input v-model.number="distortionScale" type="range" min="0" max="8" step="0.1"><b>{{ distortionScale.toFixed(1) }}</b></div>
      <label>水体颜色 <input v-model="waterColor" type="color"></label>
      <div class="param-row"><span>水面高度</span><input v-model.number="waterHeight" type="range" min="1470" max="1520" step="1"><b>{{ waterHeight }}</b></div>
      <div class="sub-title">光照方向</div>
      <div class="param-row"><span>X</span><input v-model.number="lightX" type="range" min="-1" max="1" step="0.1"><b>{{ lightX.toFixed(1) }}</b></div>
      <div class="param-row"><span>Y</span><input v-model.number="lightY" type="range" min="-1" max="1" step="0.1"><b>{{ lightY.toFixed(1) }}</b></div>
      <div class="param-row"><span>Z</span><input v-model.number="lightZ" type="range" min="-1" max="1" step="0.1"><b>{{ lightZ.toFixed(1) }}</b></div>
      <div class="param-row"><span>太阳高光强度</span><input v-model.number="sunShiny" type="range" min="1" max="100" step="1"><b>{{ sunShiny }}</b></div>
      <div class="sub-title">浮动盒子</div>
      <div class="param-row"><span>盒子大小</span><input v-model.number="boxSize" type="range" min="30" max="80" step="1"><b>{{ boxSize }}</b></div>
      <div class="param-row"><span>盒子移动速度</span><input v-model.number="boxSpeed" type="range" min="0.1" max="3" step="0.1"><b>{{ boxSpeed.toFixed(1) }}</b></div>
      <label>盒子颜色 <input v-model="boxColor" type="color"></label>
      <div class="toggle-row"><span>显示盒子</span><button class="toggle" :class="{ on: showBox }" @click="showBox = !showBox"><i></i></button></div>
    </div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.water-reflection-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }.cesium-container { width: 100%; height: 100%; }.water-reflection-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 8px; width: 252px; max-height: calc(100% - 24px); overflow-y: auto; padding: 11px; border: 1px solid rgba(137,210,233,.28); border-radius: 9px; background: rgba(8,32,49,.86); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 10px; }.panel-title { font-size: 12px; font-weight: 700; }.sub-title { margin-top: 2px; color: #8fc8dd; font-size: 11px; font-weight: 600; }.toggle-row,.param-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.param-row input[type='range'] { flex: 1; min-width: 0; accent-color: #52c4e8; }.param-row b { flex: 0 0 38px; color: #9cc9d8; font-size: 9px; text-align: right; }.toggle { position: relative; width: 36px; height: 18px; border-radius: 999px; background: rgba(137,210,233,.35); }.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e8f8fb; transition: transform .2s; }.toggle.on { background: #36a8cc; }.toggle.on i { transform: translateX(18px); }.water-reflection-panel label { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #bdd9e4; }.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
