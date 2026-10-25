<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as Cesium from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import { VolumePrimitive } from '../cim-sim-lib/volume-primitive'
import { TERRAIN_FRAGMENT } from '../cim-sim-lib/shaders'

const SCENE_CENTER = { lon: 110, lat: 35, height: 82000 }
const SCENE_SCALE = 126000

const container = ref<HTMLElement>()
const statusMessage = ref('')
const terrainHeight = ref(0.22)
const seaLevel = ref(0.0)
const fog = ref(2.6)
const speed = ref(1.0)
const paused = ref(false)
const simTime = ref(0)

let viewer: ReturnType<typeof createMapScene> | undefined
let primitive: VolumePrimitive | undefined
let lastTime = 0
let timeListener: (() => void) | undefined
let disposed = false

const uniforms = {
  uHeight: () => terrainHeight.value,
  uSea: () => seaLevel.value,
  uFog: () => fog.value,
  uTime: () => simTime.value
}

function flyToTerrain(): void {
  if (!viewer || viewer.isDestroyed()) return
  const center = Cesium.Cartesian3.fromDegrees(SCENE_CENTER.lon, SCENE_CENTER.lat, SCENE_CENTER.height)
  viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, SCENE_SCALE * 0.62), {
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(34),
      Cesium.Math.toRadians(-24),
      SCENE_SCALE * 1.55
    ),
    duration: 1.6
  })
}

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => {
      statusMessage.value = message
    },
    onBasemapReady: () => {
      statusMessage.value = ''
    }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    viewer.resolutionScale = 0.75
    loadBingImagery(viewer, sceneCallbacks)
    const sceneContext = (viewer.scene as unknown as { context?: { webgl2?: boolean } }).context
    const webgl2 = sceneContext?.webgl2 === true
    if (!webgl2) {
      statusMessage.value = '当前环境不支持 WebGL2，无法运向着色器沙盘。'
      return
    }
    const center = Cesium.Cartesian3.fromDegrees(SCENE_CENTER.lon, SCENE_CENTER.lat, SCENE_CENTER.height)
    const modelMatrix = Cesium.Matrix4.multiply(
      Cesium.Matrix4.fromTranslation(center),
      Cesium.Matrix4.fromUniformScale(SCENE_SCALE),
      new Cesium.Matrix4()
    )
    primitive = new VolumePrimitive({
      modelMatrix,
      dimensions: new Cesium.Cartesian3(1, 1, 1),
      size: 2,
      useTexture: false,
      fragmentShaderSource: TERRAIN_FRAGMENT,
      uniforms,
      translucent: false
    })
    viewer.scene.primitives.add(primitive)

    lastTime = performance.now()
    timeListener = () => {
      const now = performance.now()
      const delta = Math.min(0.1, (now - lastTime) / 1000)
      lastTime = now
      if (!paused.value) {
        simTime.value += delta * speed.value
      }
    }
    viewer.scene.preRender.addEventListener(timeListener)
    flyToTerrain()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (viewer && !viewer.isDestroyed()) {
    if (timeListener) viewer.scene.preRender.removeEventListener(timeListener)
    if (primitive) {
      viewer.scene.primitives.remove(primitive)
      primitive.destroy()
      primitive = undefined
    }
  }
  timeListener = undefined
  destroyScene(viewer)
  viewer = undefined
  void disposed
})
</script>

<template>
  <div class="cst-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="cst-panel">
      <div class="panel-title">着色器地形沙盘</div>
      <div class="panel-subtitle">分形噪声 · 光线步进 · 海面反射</div>

      <div class="section-title">地形</div>
      <div class="cst-param">
        <span>起伏幅度</span>
        <input v-model.number="terrainHeight" type="range" min="0.05" max="0.42" step="0.01" />
        <b>{{ terrainHeight.toFixed(2) }}</b>
      </div>
      <div class="cst-param">
        <span>海平面</span>
        <input v-model.number="seaLevel" type="range" min="-0.16" max="0.16" step="0.005" />
        <b>{{ seaLevel.toFixed(2) }}</b>
      </div>
      <div class="cst-param">
        <span>大气浓度</span>
        <input v-model.number="fog" type="range" min="0" max="8" step="0.2" />
        <b>{{ fog.toFixed(1) }}</b>
      </div>

      <div class="section-title">动画</div>
      <div class="cst-param">
        <span>流速</span>
        <input v-model.number="speed" type="range" min="0" max="3" step="0.1" />
        <b>{{ speed.toFixed(1) }}x</b>
      </div>
      <div class="cst-row">
        <button class="cst-toggle" :class="{ on: !paused }" @click="paused = !paused">
          {{ paused ? '动画: 暂停' : '动画: 运行' }}
        </button>
        <button class="cst-btn ghost" @click="flyToTerrain">重置视角</button>
      </div>

      <div class="cst-metrics">
        <div><span>步进次数</span><strong>48</strong></div>
        <div><span>场景边长</span><strong>{{ (SCENE_SCALE / 1000).toFixed(0) }} km</strong></div>
      </div>
      <div class="cst-hint">地表、海面与天空全部在片元着色器中计算，旋转视角可观察不同光照与雾效</div>
    </div>

    <div v-if="statusMessage" class="cst-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.cst-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #061421; color: #e8fbff; font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; }
.cesium-container { width: 100%; height: 100%; }
.cst-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 7px; width: 246px; max-height: calc(100% - 24px); overflow-y: auto; padding: 11px; border: 1px solid rgba(91, 255, 226, 0.28); border-radius: 9px; background: rgba(8, 28, 43, 0.9); backdrop-filter: blur(6px); }
.panel-title { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
.panel-subtitle { font-size: 11px; color: #7da9b8; }
.section-title { margin-top: 4px; padding: 2px 0 1px; border-bottom: 1px solid rgba(91, 255, 226, 0.18); font-size: 11px; font-weight: 700; color: #5fffe0; }
.cst-row { display: flex; gap: 6px; }
.cst-btn { flex: 1; height: 26px; padding: 0 8px; border: 0; border-radius: 5px; background: #257f9e; color: #edfaff; cursor: pointer; font-size: 11px; }
.cst-btn.ghost { background: rgba(13, 42, 58, 0.78); border: 1px solid rgba(91, 255, 226, 0.24); color: #b9dce7; }
.cst-toggle { flex: 1; height: 26px; border: 1px solid rgba(91, 255, 226, 0.24); border-radius: 5px; background: rgba(13, 42, 58, 0.78); color: #7da9b8; font-size: 11px; cursor: pointer; }
.cst-toggle.on { color: #e8fbff; border-color: #5fffe0; }
.cst-param { display: flex; align-items: center; gap: 8px; }
.cst-param span { flex: 0 0 62px; font-size: 11px; color: #bdd9e4; }
.cst-param input { flex: 1; min-width: 0; height: 4px; accent-color: #5fffe0; }
.cst-param b { flex: 0 0 36px; color: #9cc9d8; font-size: 10px; text-align: right; }
.cst-hint { padding: 4px 7px; border-radius: 5px; background: rgba(13, 42, 58, 0.6); color: #7da9b8; font-size: 11px; line-height: 1.4; }
.cst-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.cst-metrics > div { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border: 1px solid rgba(54, 141, 255, 0.18); border-radius: 6px; background: rgba(13, 42, 58, 0.6); }
.cst-metrics span { font-size: 10px; color: #7da9b8; }
.cst-metrics strong { font-size: 12px; color: #e8fbff; }
.cst-status { position: absolute; inset: 0; z-index: 9; display: grid; place-items: center; padding: 24px; color: #d9eff6; background: rgba(4, 23, 37, 0.72); font-size: 12px; }
</style>
