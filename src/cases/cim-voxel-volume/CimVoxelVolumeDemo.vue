<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as Cesium from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import { buildVolume } from '../cim-sim-lib/noise'
import { VolumePrimitive } from '../cim-sim-lib/volume-primitive'
import { CLOUD_FRAGMENT } from '../cim-sim-lib/shaders'

const VOLUME_SIZE = 64
const VOLUME_CENTER = { lon: 108.96, lat: 34.22, height: 72000 }
const VOLUME_SCALE = 46000

const container = ref<HTMLElement>()
const statusMessage = ref('')
const threshold = ref(0.34)
const opacity = ref(0.62)
const steps = ref(96)
const animate = ref(true)
const seed = ref(20261025)
const visible = ref(true)
const textureInfo = ref(`${VOLUME_SIZE}³`)

let viewer: ReturnType<typeof createMapScene> | undefined
let primitive: VolumePrimitive | undefined
let disposed = false

const uniforms = {
  uThreshold: () => threshold.value,
  uOpacity: () => opacity.value,
  uSteps: () => steps.value,
  uAnimate: () => (animate.value ? 1 : 0),
  uTime: () => (animate.value ? performance.now() / 1000 : 0)
}

function buildPrimitive(): void {
  if (!viewer || viewer.isDestroyed()) return
  const center = Cesium.Cartesian3.fromDegrees(VOLUME_CENTER.lon, VOLUME_CENTER.lat, VOLUME_CENTER.height)
  const modelMatrix = Cesium.Matrix4.multiply(
    Cesium.Matrix4.fromTranslation(center),
    Cesium.Matrix4.fromUniformScale(VOLUME_SCALE),
    new Cesium.Matrix4()
  )
  const data = buildVolume(VOLUME_SIZE, seed.value, 'cloud')
  primitive = new VolumePrimitive({
    modelMatrix,
    dimensions: new Cesium.Cartesian3(1, 1, 1),
    size: VOLUME_SIZE,
    data,
    fragmentShaderSource: CLOUD_FRAGMENT,
    uniforms,
    translucent: true
  })
  viewer.scene.primitives.add(primitive)
}

function rebuild(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (primitive) {
    viewer.scene.primitives.remove(primitive)
    primitive.destroy()
    primitive = undefined
  }
  buildPrimitive()
  viewer.scene.requestRender()
}

function regenerate(): void {
  seed.value = Math.floor(Math.random() * 1e9)
  rebuild()
}

function toggleVisible(): void {
  primitive?.setShow(visible.value)
}

function toggleAnimate(): void {
  if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender()
}

function flyToVolume(): void {
  if (!viewer || viewer.isDestroyed()) return
  const center = Cesium.Cartesian3.fromDegrees(VOLUME_CENTER.lon, VOLUME_CENTER.lat, VOLUME_CENTER.height)
  viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, VOLUME_SCALE * 0.55), {
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(26),
      Cesium.Math.toRadians(-26),
      VOLUME_SCALE * 2.1
    ),
    duration: 1.5
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
    loadBingImagery(viewer, sceneCallbacks)
    const sceneContext = (viewer.scene as unknown as { context?: { webgl2?: boolean } }).context
    const webgl2 = sceneContext?.webgl2 === true
    if (!webgl2) {
      statusMessage.value = '当前环境不支持 WebGL2，无法创建三维纹理。'
      return
    }
    const center = Cesium.Cartesian3.fromDegrees(VOLUME_CENTER.lon, VOLUME_CENTER.lat, VOLUME_CENTER.height)
    viewer.camera.setView({
      destination: center,
      orientation: {
        heading: Cesium.Math.toRadians(26),
        pitch: Cesium.Math.toRadians(-26),
        roll: 0
      }
    })
    buildPrimitive()
    flyToVolume()
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (viewer && !viewer.isDestroyed() && primitive) {
    viewer.scene.primitives.remove(primitive)
    primitive.destroy()
    primitive = undefined
  }
  destroyScene(viewer)
  viewer = undefined
  void disposed
})
</script>

<template>
  <div class="cvv-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="cvv-panel">
      <div class="panel-title">体素云团</div>
      <div class="panel-subtitle">三维纹理 · 光线步进积分</div>

      <div class="section-title">密度场</div>
      <div class="cvv-param">
        <span>密度阈值</span>
        <input v-model.number="threshold" type="range" min="0.05" max="0.85" step="0.01" />
        <b>{{ threshold.toFixed(2) }}</b>
      </div>
      <div class="cvv-param">
        <span>云团浓度</span>
        <input v-model.number="opacity" type="range" min="0.1" max="1" step="0.02" />
        <b>{{ opacity.toFixed(2) }}</b>
      </div>
      <div class="cvv-param">
        <span>步进次数</span>
        <input v-model.number="steps" type="range" min="32" max="200" step="8" />
        <b>{{ steps }}</b>
      </div>

      <div class="section-title">运行</div>
      <div class="cvv-row">
        <button class="cvv-toggle" :class="{ on: animate }" @click="animate = !animate; toggleAnimate()">
          {{ animate ? '漂移: 开' : '漂移: 关' }}
        </button>
        <button class="cvv-toggle" :class="{ on: visible }" @click="visible = !visible; toggleVisible()">
          {{ visible ? '显示: 开' : '显示: 关' }}
        </button>
      </div>
      <div class="cvv-row">
        <button class="cvv-btn" @click="regenerate">重新生成</button>
        <button class="cvv-btn ghost" @click="flyToVolume">重置视角</button>
      </div>

      <div class="cvv-metrics">
        <div><span>纹理尺寸</span><strong>{{ textureInfo }}</strong></div>
        <div><span>包围盒</span><strong>{{ (VOLUME_SCALE / 1000).toFixed(0) }} km</strong></div>
      </div>
      <div class="cvv-hint">降低阈值会显现更稀薄的云体；提高步进次数可获得更平滑的积分结果</div>
    </div>

    <div v-if="statusMessage" class="cvv-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.cvv-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #061421; color: #e8fbff; font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; }
.cesium-container { width: 100%; height: 100%; }
.cvv-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 7px; width: 246px; max-height: calc(100% - 24px); overflow-y: auto; padding: 11px; border: 1px solid rgba(91, 255, 226, 0.28); border-radius: 9px; background: rgba(8, 28, 43, 0.9); backdrop-filter: blur(6px); }
.panel-title { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
.panel-subtitle { font-size: 11px; color: #7da9b8; }
.section-title { margin-top: 4px; padding: 2px 0 1px; border-bottom: 1px solid rgba(91, 255, 226, 0.18); font-size: 11px; font-weight: 700; color: #5fffe0; }
.cvv-row { display: flex; gap: 6px; }
.cvv-btn { flex: 1; height: 26px; padding: 0 8px; border: 0; border-radius: 5px; background: #257f9e; color: #edfaff; cursor: pointer; font-size: 11px; }
.cvv-btn.ghost { background: rgba(13, 42, 58, 0.78); border: 1px solid rgba(91, 255, 226, 0.24); color: #b9dce7; }
.cvv-toggle { flex: 1; height: 26px; border: 1px solid rgba(91, 255, 226, 0.24); border-radius: 5px; background: rgba(13, 42, 58, 0.78); color: #7da9b8; font-size: 11px; cursor: pointer; }
.cvv-toggle.on { color: #e8fbff; border-color: #5fffe0; }
.cvv-param { display: flex; align-items: center; gap: 8px; }
.cvv-param span { flex: 0 0 62px; font-size: 11px; color: #bdd9e4; }
.cvv-param input { flex: 1; min-width: 0; height: 4px; accent-color: #5fffe0; }
.cvv-param b { flex: 0 0 36px; color: #9cc9d8; font-size: 10px; text-align: right; }
.cvv-hint { padding: 4px 7px; border-radius: 5px; background: rgba(13, 42, 58, 0.6); color: #7da9b8; font-size: 11px; line-height: 1.4; }
.cvv-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.cvv-metrics > div { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border: 1px solid rgba(54, 141, 255, 0.18); border-radius: 6px; background: rgba(13, 42, 58, 0.6); }
.cvv-metrics span { font-size: 10px; color: #7da9b8; }
.cvv-metrics strong { font-size: 12px; color: #e8fbff; }
.cvv-status { position: absolute; inset: 0; z-index: 9; display: grid; place-items: center; padding: 24px; color: #d9eff6; background: rgba(4, 23, 37, 0.72); font-size: 12px; }
</style>
