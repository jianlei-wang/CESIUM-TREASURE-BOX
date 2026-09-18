<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Cartesian3, ScreenSpaceEventHandler, ScreenSpaceEventType, type Viewer } from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import { GpuParticleSystem } from '../particle-effect/lib'

const container = ref<HTMLElement | null>(null)
const errorMessage = ref('')
const statusMessage = ref('正在加载 Bing 地图…')
const active = ref(true)

const controls = reactive({
  size: 128,
  speed: 6,
  lifetime: 5,
  turbulence: 12,
  lift: 5,
  coneAngle: 0.5,
  radius: 3,
  heightScale: 1.2
})

const emitter = reactive({
  lon: 116.4,
  lat: 39.9,
  height: 80
})

const SMOKE_COLORS = ['#ffffff', '#d8d8d8', '#b0b0b0', '#8a8a8a', '#6a6a6a']

let viewer: Viewer | undefined
let layer: GpuParticleSystem | undefined
let handler: ScreenSpaceEventHandler | undefined
let disposed = false

const sceneCallbacks: SceneCallbacks = {
  onStatus: (message) => {
    statusMessage.value = message
  },
  onBasemapReady: () => {
    statusMessage.value = ''
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function applyOptions(): void {
  if (!layer) return
  layer.updateOptions({
    size: controls.size,
    initialSpeed: [controls.speed * 0.5, controls.speed],
    lifetime: [controls.lifetime * 0.5, controls.lifetime],
    turbulence: controls.turbulence,
    lift: controls.lift,
    coneAngle: controls.coneAngle,
    emitterRadius: controls.radius,
    heightScale: controls.heightScale
  })
}

function flyToEmitter(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(emitter.lon, emitter.lat, emitter.height + 1600)
  })
}

function handleClick(event: ScreenSpaceEventHandler.PositionedEvent): void {
  if (!viewer || viewer.isDestroyed()) return
  const cartesian = viewer.scene.camera.pickEllipsoid(event.position, viewer.scene.globe.ellipsoid)
  if (!cartesian) return
  const carto = viewer.scene.globe.ellipsoid.cartesianToCartographic(cartesian)
  emitter.lon = (carto.longitude * 180) / Math.PI
  emitter.lat = (carto.latitude * 180) / Math.PI
  layer?.updateOptions({
    emitter: { lon: emitter.lon, lat: emitter.lat, height: emitter.height }
  })
}

function setupClickHandler(): void {
  if (!viewer) return
  handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  handler.setInputAction(handleClick, ScreenSpaceEventType.LEFT_CLICK)
}

onMounted(() => {
  if (!container.value) return

  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
  } catch (error) {
    errorMessage.value = toErrorMessage(error)
    statusMessage.value = ''
  }

  if (viewer) {
    layer = new GpuParticleSystem(viewer, {
      size: controls.size,
      emitter: { lon: emitter.lon, lat: emitter.lat, height: emitter.height },
      colors: SMOKE_COLORS,
      blendMode: 'alpha',
      lifetime: [controls.lifetime * 0.5, controls.lifetime],
      initialSpeed: [controls.speed * 0.5, controls.speed],
      coneAngle: controls.coneAngle,
      gravity: 0,
      drag: 0.3,
      turbulence: controls.turbulence,
      lift: controls.lift,
      emissionRate: 0.02,
      continuous: true,
      pointSize: [10, 30],
      pointGrowth: 20,
      emitterRadius: controls.radius,
      heightScale: controls.heightScale,
      initializer: 'emitter',
      emitAll: true,
      displayRange: [0, 30]
    })
    setupClickHandler()
    flyToEmitter()
  }
})

onBeforeUnmount(() => {
  disposed = true
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
      <div class="panel-title">GPU 烟雾粒子</div>

      <div class="section">
        <div class="section-title">发射点（点击地图可设置）</div>
        <div class="grid-row">
          <label class="field">
            <span>经度</span>
            <input v-model.number="emitter.lon" type="number" step="0.1" />
          </label>
          <label class="field">
            <span>纬度</span>
            <input v-model.number="emitter.lat" type="number" step="0.1" />
          </label>
          <label class="field">
            <span>高度(m)</span>
            <input v-model.number="emitter.height" type="number" step="10" />
          </label>
        </div>
        <div class="btn-row">
          <button class="file-btn" @click="flyToEmitter">飞往发射点</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">参数控制</div>
        <label class="slider-row">
          <span>粒子数 {{ controls.size * controls.size }}</span>
          <input v-model.number="controls.size" type="range" min="48" max="200" step="8" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>上升速度 {{ controls.speed }}</span>
          <input v-model.number="controls.speed" type="range" min="1" max="20" step="0.5" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>寿命 {{ controls.lifetime.toFixed(1) }}s</span>
          <input v-model.number="controls.lifetime" type="range" min="2" max="10" step="0.5" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>湍流扩散 {{ controls.turbulence }}</span>
          <input v-model.number="controls.turbulence" type="range" min="0" max="40" step="1" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>浮力 {{ controls.lift }}</span>
          <input v-model.number="controls.lift" type="range" min="0" max="15" step="0.5" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>发射锥角 {{ controls.coneAngle.toFixed(2) }}rad</span>
          <input v-model.number="controls.coneAngle" type="range" min="0.05" max="1.2" step="0.05" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>发射半径 {{ controls.radius }}m</span>
          <input v-model.number="controls.radius" type="range" min="0.5" max="15" step="0.5" @input="applyOptions" />
        </label>
        <label class="slider-row">
          <span>高度拉伸 {{ controls.heightScale }}x</span>
          <input v-model.number="controls.heightScale" type="range" min="0.2" max="3" step="0.1" @input="applyOptions" />
        </label>
        <label class="check-row">
          <input v-model="active" type="checkbox" @change="layer && (layer.show = active)" />
          <span>显示粒子</span>
        </label>
      </div>
    </div>

    <div v-if="errorMessage" class="effect-error">{{ errorMessage }}</div>
    <div v-if="statusMessage" class="effect-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.effect-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  border-radius: 8px;
  background: #152b4c;
}
.cesium-container {
  width: 100%;
  height: 100%;
}
.effect-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 236px;
  max-height: calc(100% - 24px);
  overflow-y: auto;
  padding: 11px;
  border-radius: 9px;
  background: rgba(10, 26, 52, 0.82);
  border: 1px solid rgba(157, 188, 224, 0.22);
  backdrop-filter: blur(6px);
  color: #dce8f5;
}
.panel-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-top: 8px;
  border-top: 1px dashed rgba(157, 188, 224, 0.18);
}
.section-title {
  font-size: 10px;
  color: #8ea5c2;
}
.grid-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 5px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.field span {
  font-size: 9px;
  color: #8ea5c2;
}
.field input {
  width: 100%;
  padding: 3px 5px;
  border-radius: 4px;
  border: 1px solid rgba(157, 188, 224, 0.24);
  background: rgba(20, 42, 78, 0.6);
  color: #e6eef9;
  font-size: 11px;
}
.btn-row {
  display: flex;
  gap: 6px;
}
.file-btn {
  width: 100%;
  padding: 6px 4px;
  border-radius: 6px;
  border: 1px solid rgba(157, 188, 224, 0.28);
  background: transparent;
  color: #c4d3e8;
  font-size: 11px;
  cursor: pointer;
}
.file-btn:hover {
  color: #fff;
  border-color: #5eacf5;
  background: rgba(75, 145, 220, 0.14);
}
.slider-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 10px;
  color: #c4d3e8;
}
.slider-row input[type='range'] {
  width: 100%;
}
.check-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #c4d3e8;
}
.effect-error {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 10;
  max-width: 60%;
  padding: 7px 10px;
  border-radius: 6px;
  background: rgba(80, 20, 30, 0.9);
  border: 1px solid rgba(255, 157, 157, 0.4);
  color: #ffb4b4;
  font-size: 10px;
  line-height: 1.5;
}
.effect-status {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: grid;
  place-items: center;
  padding: 24px;
  color: #dce8f5;
  background: rgba(8, 21, 40, 0.72);
  font-size: 12px;
}
</style>
