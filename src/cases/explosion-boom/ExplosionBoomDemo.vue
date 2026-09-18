<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Cartesian3, ScreenSpaceEventHandler, ScreenSpaceEventType, type Viewer } from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import { GpuParticleSystem } from '../particle-effect/lib'

const container = ref<HTMLElement | null>(null)
const errorMessage = ref('')
const statusMessage = ref('正在加载 Bing 地图…')

const controls = reactive({
  paused: false,
  speed: 1,
  lifecycle: 3,
  cloudSize: 190,
  noiseScale: 1,
  noiseDetail: 8,
  cloudDensity: 1,
  smokeAmount: 1,
  cloudRadius: 0.3,
  edgeSoftness: 0.05,
  colorFrequency: 5.5
})

const emitter = reactive({
  lon: 114.3,
  lat: 30.5,
  height: 8
})

let viewer: Viewer | undefined
let layer: GpuParticleSystem | undefined
let handler: ScreenSpaceEventHandler | undefined
let removeCompletionWatcher: (() => void) | undefined

const sceneCallbacks: SceneCallbacks = {
  onStatus: (message) => {
    statusMessage.value = message
  },
  onBasemapReady: () => {
    statusMessage.value = ''
  }
}

function getEmitter() {
  return { lon: emitter.lon, lat: emitter.lat, height: emitter.height }
}

function applyOptions(): void {
  layer?.updateOptions({
    size: 1,
    initialSpeed: [0, 0],
    lifetime: [3600, 3600],
    turbulence: 0,
    lift: 0,
    gravity: 0,
    coneAngle: Math.PI,
    emitterRadius: 0,
    pointSize: [controls.cloudSize, controls.cloudSize],
    pointGrowth: 0,
    emissionRate: 1,
    heightScale: 1,
    style: 'noise-cloud',
    noiseScale: controls.noiseScale,
    noiseDetail: controls.noiseDetail,
    cloudDensity: controls.cloudDensity,
    smokeAmount: controls.smokeAmount,
    cloudRadius: controls.cloudRadius,
    edgeSoftness: controls.edgeSoftness,
    colorFrequency: controls.colorFrequency
  })
}

function createExplosion(): void {
  if (!viewer || viewer.isDestroyed()) return
  removeCompletionWatcher?.()
  removeCompletionWatcher = undefined
  layer?.destroy()
  const explosion = new GpuParticleSystem(viewer, {
    size: 1,
    emitter: getEmitter(),
    colors: ['#ffffff'],
    blendMode: 'additive',
    lifetime: [controls.lifecycle, controls.lifecycle],
    initialSpeed: [0, 0],
    coneAngle: Math.PI,
    gravity: 0,
    drag: 0,
    turbulence: 0,
    lift: 0,
    emissionRate: 0,
    continuous: false,
    pointSize: [controls.cloudSize, controls.cloudSize],
    pointGrowth: 0,
    emitterRadius: 0,
    heightScale: 1,
    initializer: 'sphere',
    emitAll: true,
    displayRange: [0, 80],
    style: 'noise-cloud',
    noiseScale: controls.noiseScale,
    noiseDetail: controls.noiseDetail,
    cloudDensity: controls.cloudDensity,
    smokeAmount: controls.smokeAmount,
    cloudRadius: controls.cloudRadius,
    edgeSoftness: controls.edgeSoftness,
    colorFrequency: controls.colorFrequency
  })
  layer = explosion
  explosion.setPaused(controls.paused)
  removeCompletionWatcher = viewer.scene.postRender.addEventListener(() => {
    if (explosion.simulationTime < controls.lifecycle) return
    explosion.show = false
    removeCompletionWatcher?.()
    removeCompletionWatcher = undefined
  })
}

function applyPosition(): void {
  if (!Number.isFinite(emitter.lon) || !Number.isFinite(emitter.lat) || Math.abs(emitter.lon) > 180 || Math.abs(emitter.lat) > 90) {
    errorMessage.value = '请输入有效经纬度：经度范围 -180 至 180，纬度范围 -90 至 90'
    return
  }
  errorMessage.value = ''
  layer?.updateEmitter(getEmitter())
  viewer?.scene.requestRender()
}

function flyToEmitter(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(emitter.lon, emitter.lat, emitter.height + 1400)
  })
}

function handleClick(event: ScreenSpaceEventHandler.PositionedEvent): void {
  if (!viewer || viewer.isDestroyed()) return
  const cartesian = viewer.scene.camera.pickEllipsoid(event.position, viewer.scene.globe.ellipsoid)
  if (!cartesian) return
  const cartographic = viewer.scene.globe.ellipsoid.cartesianToCartographic(cartesian)
  emitter.lon = (cartographic.longitude * 180) / Math.PI
  emitter.lat = (cartographic.latitude * 180) / Math.PI
  applyPosition()
}

function togglePause(): void {
  controls.paused = !controls.paused
  layer?.setPaused(controls.paused)
}

function restartFire(): void {
  controls.paused = false
  createExplosion()
}

function applySpeed(): void {
  layer?.setTimeScale(controls.speed)
}

onMounted(() => {
  if (!container.value) return
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    createExplosion()
    handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(handleClick, ScreenSpaceEventType.LEFT_CLICK)
    flyToEmitter()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
    statusMessage.value = ''
  }
})

onBeforeUnmount(() => {
  removeCompletionWatcher?.()
  removeCompletionWatcher = undefined
  handler?.destroy()
  handler = undefined
  layer?.destroy()
  layer = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="effect-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="effect-panel">
      <div class="panel-title">爆炸特效-噪声云团</div>

      <div class="section">
        <div class="section-title">火焰位置</div>
        <div class="grid-row">
          <label class="field">
            <span>经度</span>
            <input v-model.number="emitter.lon" type="number" step="0.01" @change="applyPosition" />
          </label>
          <label class="field">
            <span>纬度</span>
            <input v-model.number="emitter.lat" type="number" step="0.01" @change="applyPosition" />
          </label>
        </div>
        <div class="btn-row">
          <button class="file-btn" @click="flyToEmitter">飞往火焰位置</button>
        </div>
        <p class="hint">点击地图或输入经纬度，粒子火焰直接锚定到地球坐标</p>
      </div>

      <div class="section">
        <div class="section-title">动画控制</div>
        <div class="btn-row">
          <button class="file-btn" @click="togglePause">{{ controls.paused ? '继续' : '暂停' }}</button>
          <button class="file-btn primary" @click="restartFire">重新引爆</button>
        </div>
        <label class="slider-row">
          <span>云团速度 {{ controls.speed.toFixed(1) }}x</span>
          <input v-model.number="controls.speed" type="range" min="0.05" max="8" step="0.05" @input="applySpeed" />
        </label>
        <label class="slider-row">
          <span>生命周期 {{ controls.lifecycle.toFixed(1) }} 秒</span>
          <input v-model.number="controls.lifecycle" type="range" min="0.2" max="30" step="0.1" />
        </label>
      </div>

      <div class="section">
        <div class="section-title">Shadertoy 单团云爆</div>
        <label class="slider-row">
          <span>云团显示尺寸 {{ controls.cloudSize }}px</span>
          <input v-model.number="controls.cloudSize" type="range" min="20" max="1200" step="10" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>噪声尺度 {{ controls.noiseScale.toFixed(2) }}</span>
          <input v-model.number="controls.noiseScale" type="range" min="0.1" max="8" step="0.05" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>fbm 细节 {{ controls.noiseDetail }} octave</span>
          <input v-model.number="controls.noiseDetail" type="range" min="1" max="8" step="1" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>云团密度 {{ controls.cloudDensity.toFixed(2) }}</span>
          <input v-model.number="controls.cloudDensity" type="range" min="0.05" max="5" step="0.05" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>烟化程度 {{ controls.smokeAmount.toFixed(2) }}</span>
          <input v-model.number="controls.smokeAmount" type="range" min="0" max="5" step="0.05" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>爆炸半径 {{ controls.cloudRadius.toFixed(2) }}</span>
          <input v-model.number="controls.cloudRadius" type="range" min="0.02" max="1.5" step="0.01" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>边缘柔和度 {{ controls.edgeSoftness.toFixed(3) }}</span>
          <input v-model.number="controls.edgeSoftness" type="range" min="0.001" max="0.5" step="0.005" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>调色频率 {{ controls.colorFrequency.toFixed(1) }}</span>
          <input v-model.number="controls.colorFrequency" type="range" min="0.1" max="30" step="0.1" @input="applyOptions" />
        </label>
        <p class="hint">固定编号避免分割线；透明形状遮罩仅绘制云团区域。</p>
      </div>
    </div>

    <div v-if="errorMessage" class="effect-error">{{ errorMessage }}</div>
    <div v-if="statusMessage" class="effect-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.effect-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.effect-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 10px; width: 236px; max-height: calc(100% - 24px); overflow-y: auto; padding: 11px; border: 1px solid rgba(157, 188, 224, 0.22); border-radius: 9px; background: rgba(10, 26, 52, 0.82); backdrop-filter: blur(6px); color: #dce8f5; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.section { display: flex; flex-direction: column; gap: 7px; padding-top: 8px; border-top: 1px dashed rgba(157, 188, 224, 0.18); }
.section-title { font-size: 10px; color: #8ea5c2; }
.grid-row { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.field { display: flex; flex-direction: column; gap: 2px; }
.field span { font-size: 9px; color: #8ea5c2; }
.field input { width: 100%; padding: 3px 5px; border: 1px solid rgba(157, 188, 224, 0.24); border-radius: 4px; background: rgba(20, 42, 78, 0.6); color: #e6eef9; font-size: 11px; }
.type-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.type-btn, .file-btn { width: 100%; padding: 6px 4px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 6px; background: transparent; color: #c4d3e8; font-size: 11px; cursor: pointer; }
.type-btn { padding: 5px 4px; font-size: 10px; }
.type-btn.active { border-color: #f5a24e; background: rgba(245, 130, 50, 0.2); color: #fff; }
.file-btn:hover { border-color: #5eacf5; background: rgba(75, 145, 220, 0.14); color: #fff; }
.file-btn.primary { border-color: rgba(255, 150, 60, 0.5); color: #ffcf9e; }
.btn-row { display: flex; gap: 6px; }
.slider-row { display: flex; flex-direction: column; gap: 3px; font-size: 10px; color: #c4d3e8; }
.slider-row input[type='range'] { width: 100%; }
.hint { margin: 0; color: #7b90ac; font-size: 9px; line-height: 1.5; }
.effect-error { position: absolute; left: 12px; bottom: 12px; z-index: 10; max-width: 60%; padding: 7px 10px; border: 1px solid rgba(255, 157, 157, 0.4); border-radius: 6px; background: rgba(80, 20, 30, 0.9); color: #ffb4b4; font-size: 10px; line-height: 1.5; }
.effect-status { position: absolute; inset: 0; z-index: 9; display: grid; place-items: center; padding: 24px; background: rgba(8, 21, 40, 0.72); color: #dce8f5; font-size: 12px; }
</style>
