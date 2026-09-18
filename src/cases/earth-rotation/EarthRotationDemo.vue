<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  CzmlDataSource,
  defined,
  JulianDate,
  Matrix4,
  SceneMode,
  Transforms,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type SceneCallbacks
} from '../../lib/cesium-scene'
import czmlUrl from './data/simple.czml?url'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const rotateEnabled = ref(false)
const rotateSpeed = ref(2000)

let viewer: Viewer | undefined
let disposed = false
let preUpdateListener: ((scene: any, time: JulianDate) => void) | undefined

function icrf(scene: any, time: JulianDate): void {
  if (!viewer || viewer.scene.mode !== SceneMode.SCENE3D) return
  const icrfToFixed = Transforms.computeIcrfToFixedMatrix(time)
  if (defined(icrfToFixed)) {
    const camera = viewer.camera
    const offset = Cartesian3.clone(camera.position)
    const transform = Matrix4.fromRotationTranslation(icrfToFixed)
    camera.lookAtTransform(transform, offset)
  }
}

function onRotateChange(value: boolean): void {
  if (!viewer || viewer.isDestroyed()) return
  if (value) {
    viewer.clock.multiplier = rotateSpeed.value
    viewer.clock.shouldAnimate = true
    preUpdateListener = (scene: any, time: JulianDate) => {
      icrf(scene, time)
    }
    viewer.scene.postUpdate.addEventListener(preUpdateListener)
  } else {
    viewer.clock.multiplier = 1.0
    if (preUpdateListener) {
      viewer.scene.postUpdate.removeEventListener(preUpdateListener)
      preUpdateListener = undefined
    }
    viewer.camera.lookAtTransform(Matrix4.IDENTITY)
  }
}

function onSpeedChange(value: number): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.clock.multiplier = value
}

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.scene.globe.depthTestAgainstTerrain = true

    const dataSource = await CzmlDataSource.load(czmlUrl)
    if (disposed || !viewer || viewer.isDestroyed()) return
    await viewer.dataSources.add(dataSource)
    viewer.clock.multiplier = 1.0
    viewer.clock.shouldAnimate = true

    statusMessage.value = ''
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (viewer && preUpdateListener && !viewer.isDestroyed()) {
    viewer.scene.postUpdate.removeEventListener(preUpdateListener)
  }
  preUpdateListener = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="rotation-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="rotation-panel">
      <div class="panel-title">地球自转</div>
      <div class="row">
        <span class="row-label">自转</span>
        <button class="toggle" :class="{ on: rotateEnabled }" :aria-label="rotateEnabled ? '停止自转' : '开始自转'" @click="rotateEnabled = !rotateEnabled; onRotateChange(rotateEnabled)"><i></i></button>
      </div>
      <div class="row">
        <span class="row-label">转动速度</span>
        <input v-model.number="rotateSpeed" class="slider" type="range" min="200" max="5000" step="100" @change="onSpeedChange(rotateSpeed)" />
        <b class="value">{{ rotateSpeed }}</b>
      </div>
      <div class="hint">采用 ICRF 惯性参考系实现地球自转，可加载卫星轨道数据观察相对运动。</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.rotation-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.rotation-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 8px; width: 252px; padding: 11px; border: 1px solid rgba(157, 188, 224, 0.22); border-radius: 9px; background: rgba(10, 26, 52, 0.84); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.row-label { flex: 0 0 56px; color: #c3d5e8; font-size: 11px; }
.slider { flex: 1; min-width: 0; height: 4px; accent-color: #2f80ed; }.value { flex: 0 0 40px; color: #9fc2cf; font-size: 10px; text-align: right; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(157, 188, 224, 0.35); cursor: pointer; }.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e7f5f8; transition: transform 0.2s; }.toggle.on { background: #2f80ed; }.toggle.on i { transform: translateX(18px); }
.hint { font-size: 10px; color: #6d84a3; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
