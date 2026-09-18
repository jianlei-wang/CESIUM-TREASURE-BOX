<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import {
  Cartesian3,
  Color,
  JulianDate,
  Math as CesiumMath,
  type Viewer
} from 'cesium'
import {
  createAtmosphereStage,
  loadAtmosphereLUTs,
  TEMPORAL_QUALITY_PRESETS,
  type AtmosphereStageOptions,
  type AtmosphereStageHandle,
  type AtmosphereLUTs
} from '../../lib/cesium-geospatial/cesium-core'
import {
  createMapScene,
  destroyScene,
  loadBingImagery
} from '../../lib/cesium-scene'

type CameraPreset = {
  lon: number
  lat: number
  height: number
  heading: number
  pitch: number
}

const PRESETS: Record<'day' | 'dusk' | 'night', { time: string; cam: CameraPreset }> = {
  // 北极附近高纬度夏日白天（local ~12:30，太阳高悬）
  day: { time: '2026-08-28T17:30:00Z', cam: { lon: -80.6057, lat: 64.5197, height: 7852, heading: 68.8, pitch: -17.8 } },
  // 西五区傍晚（local ~19:30，太阳刚入地平线晨昏带）
  dusk: { time: '2026-08-28T23:30:00Z', cam: { lon: -80.6, lat: 33.9, height: 15000, heading: 70, pitch: -22 } },
  // 西五区深夜（local ~23:30，夜间曝光 + 月光）
  night: { time: '2026-08-29T04:30:00Z', cam: { lon: -80.6, lat: 33.9, height: 15000, heading: 50, pitch: -15 } }
}

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载大气 LUT…')
const ui = reactive({
  preset: 'day' as keyof typeof PRESETS,
  autoExposure: true,
  exposure: 1.2,
  lensFlare: false,
  nativeLighting: false
})

const viewer = shallowRef<Viewer | undefined>(undefined)
const atmosphereHandle = shallowRef<AtmosphereStageHandle | undefined>(undefined)
let lutsReady = false
let disposed = false
let buildSeq = 0

function applyPreset(preset: keyof typeof PRESETS): void {
  const viewerInstance = viewer.value
  if (!viewerInstance || viewerInstance.isDestroyed()) return
  const entry = PRESETS[preset]
  viewerInstance.clock.currentTime = JulianDate.fromIso8601(entry.time)
  viewerInstance.clock.shouldAnimate = false
  viewerInstance.clock.multiplier = 1
  viewerInstance.camera.setView({
    destination: Cartesian3.fromDegrees(entry.cam.lon, entry.cam.lat, entry.cam.height),
    orientation: {
      heading: CesiumMath.toRadians(entry.cam.heading),
      pitch: CesiumMath.toRadians(entry.cam.pitch),
      roll: 0
    }
  })
}

function buildOptions(): AtmosphereStageOptions {
  return {
    lensFlare: ui.lensFlare,
    exposureFollowTimeline: ui.autoExposure,
    exposure: ui.exposure,
    inscatterScale: 8,
    groundLighting: 1,
    groundDim: 0.43,
    temporalEma: true,
    temporalLowAlpha: TEMPORAL_QUALITY_PRESETS.low.lowAlpha,
    temporalHighAlpha: TEMPORAL_QUALITY_PRESETS.low.highAlpha,
    depthTemporal: false,
    moon: true
  }
}

async function rebuildChain(): Promise<void> {
  const viewerInstance = viewer.value
  if (!viewerInstance || viewerInstance.isDestroyed()) return
  const current = ++buildSeq
  try {
    const old = atmosphereHandle.value
    if (old) {
      old.destroy()
      atmosphereHandle.value = undefined
    }
    if (!lutsReady) {
      const scene = viewerInstance.scene as unknown as { context: unknown }
      const luts = await loadAtmosphereLUTs(
        scene.context as Parameters<typeof loadAtmosphereLUTs>[0],
        '/geo/luts'
      )
      lutsReady = true
    }
    if (disposed || current !== buildSeq) return
    const handle = createAtmosphereStage(viewerInstance.scene, lutsRef(), buildOptions())
    atmosphereHandle.value = handle
  } catch (error) {
    if (!disposed) {
      statusMessage.value = error instanceof Error ? error.message : String(error)
    }
  }
}

let lutsCache: AtmosphereLUTs | undefined
function lutsRef(): AtmosphereLUTs {
  return lutsCache!
}

async function initScene(): Promise<void> {
  if (!container.value) return
  const instance = createMapScene(container.value, {
    onStatus: (message) => {
      statusMessage.value = message
    }
  })
  viewer.value = instance
  const scene = instance.scene
  scene.logarithmicDepthBuffer = true
  scene.globe.enableLighting = ui.nativeLighting
  scene.globe.showGroundAtmosphere = false
  scene.fog.enabled = false
  if (scene.sun != null) scene.sun.show = false
  if (scene.moon != null) scene.moon.show = false
  scene.globe.baseColor = Color.fromCssColorString('#3a3a3a')
  scene.backgroundColor = Color.BLACK
  scene.globe.tileCacheSize = 5000
  scene.globe.preloadAncestors = true
  loadBingImagery(instance)
  ;(window as unknown as { __geoMapLayers?: number }).__geoMapLayers = instance.scene.imageryLayers.length
  applyPreset(ui.preset)

  statusMessage.value = '正在加载大气 LUT…'
  try {
    const context = (scene as unknown as { context: unknown }).context
    lutsCache = await loadAtmosphereLUTs(
      context as Parameters<typeof loadAtmosphereLUTs>[0],
      '/geo/luts'
    )
    lutsReady = true
  } catch (error) {
    if (!disposed) {
      statusMessage.value = `大气 LUT 加载失败：${error instanceof Error ? error.message : String(error)}`
    }
    return
  }
  if (disposed) return
  try {
    const handle = createAtmosphereStage(instance.scene, lutsRef(), buildOptions())
    atmosphereHandle.value = handle
    statusMessage.value = '大气链就绪（天空散射 + 大气透视 + HDR）'
    ;(window as unknown as { __atmoGeoReady?: boolean }).__atmoGeoReady = true
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = setTimeout(() => {
      if (!disposed) statusMessage.value = ''
    }, 2000)
  } catch (error) {
    if (!disposed) {
      statusMessage.value = error instanceof Error ? error.message : String(error)
    }
  }
}

watch(
  () => ui.preset,
  (preset) => {
    applyPreset(preset)
  }
)

watch(
  () => ui.nativeLighting,
  (enabled) => {
    const viewerInstance = viewer.value
    if (!viewerInstance || viewerInstance.isDestroyed()) return
    viewerInstance.scene.globe.enableLighting = enabled
  }
)

let chainTimer: ReturnType<typeof setTimeout> | undefined
let statusTimer: ReturnType<typeof setTimeout> | undefined
function scheduleChainRebuild(): void {
  if (chainTimer) clearTimeout(chainTimer)
  chainTimer = setTimeout(() => {
    chainTimer = undefined
    void rebuildChain()
  }, 250)
}

watch(
  () => ui.autoExposure,
  () => scheduleChainRebuild()
)

watch(
  () => ui.lensFlare,
  () => scheduleChainRebuild()
)

function onExposureChange(): void {
  if (!ui.autoExposure) void rebuildChain()
}

onMounted(() => {
  void initScene()
})

onBeforeUnmount(() => {
  disposed = true
  if (chainTimer) clearTimeout(chainTimer)
  if (statusTimer) clearTimeout(statusTimer)
  const handle = atmosphereHandle.value
  if (handle) handle.destroy()
  atmosphereHandle.value = undefined
  const cache = lutsCache
  lutsCache = undefined
  lutsReady = false
  if (cache) {
    cache.transmittance.destroy()
    cache.scattering.destroy()
    cache.irradiance.destroy()
    cache.higherOrderScattering.destroy()
  }
  destroyScene(viewer.value)
})
</script>

<template>
  <div class="geo-atmosphere-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="geo-panel">
      <div class="panel-title">物理大气与动态曝光</div>

      <div class="preset-row">
        <button
          v-for="item in ([
            { key: 'day', label: '白昼' },
            { key: 'dusk', label: '晨昏' },
            { key: 'night', label: '夜晚' }
          ] as const)"
          :key="item.key"
          class="preset-chip"
          :class="{ active: ui.preset === item.key }"
          @click="ui.preset = item.key"
        >
          {{ item.label }}
        </button>
      </div>

      <div class="toggle-row">
        <span class="toggle-label">自动曝光（按太阳高度）</span>
        <button
          class="toggle"
          :class="{ on: ui.autoExposure }"
          :aria-label="ui.autoExposure ? '关闭自动曝光' : '开启自动曝光'"
          @click="ui.autoExposure = !ui.autoExposure"
        >
          <i></i>
        </button>
      </div>

      <div v-if="!ui.autoExposure" class="param-row">
        <span class="param-label">曝光</span>
        <input
          v-model.number="ui.exposure"
          class="param-slider"
          type="range"
          min="0.05"
          max="2"
          step="0.05"
          @change="onExposureChange"
        />
        <span class="param-value">{{ ui.exposure.toFixed(2) }}</span>
      </div>

      <div class="toggle-row">
        <span class="toggle-label">镜头光晕</span>
        <button
          class="toggle"
          :class="{ on: ui.lensFlare }"
          :aria-label="ui.lensFlare ? '关闭镜头光晕' : '开启镜头光晕'"
          @click="ui.lensFlare = !ui.lensFlare"
        >
          <i></i>
        </button>
      </div>

      <div class="toggle-row">
        <span class="toggle-label">Cesium 原生地面光照</span>
        <button
          class="toggle"
          :class="{ on: ui.nativeLighting }"
          :aria-label="ui.nativeLighting ? '关闭原生光照' : '开启原生光照'"
          @click="ui.nativeLighting = !ui.nativeLighting"
        >
          <i></i>
        </button>
      </div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.geo-atmosphere-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #101c24; }
.cesium-container { width: 100%; height: 100%; }
.geo-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 9px; width: 250px; padding: 11px; border: 1px solid rgba(173, 200, 215, 0.25); border-radius: 9px; background: rgba(18, 35, 48, 0.82); backdrop-filter: blur(6px); color: #d9e8ee; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.preset-row { display: flex; gap: 6px; }
.preset-chip { flex: 1; padding: 4px 0; border: 1px solid rgba(173, 200, 215, 0.3); border-radius: 6px; background: transparent; color: #c4d4dc; font-size: 11px; cursor: pointer; }
.preset-chip.active { background: #5d9bb6; border-color: #5d9bb6; color: #fff; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; }
.toggle-label, .param-label { font-size: 11px; color: #c4d4dc; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(173, 200, 215, 0.35); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e2f0f4; transition: transform 0.2s; }
.toggle.on { background: #5d9bb6; }
.toggle.on i { transform: translateX(18px); }
.param-row { display: flex; align-items: center; gap: 8px; }
.param-label { flex: 0 0 38px; }
.param-slider { flex: 1; min-width: 0; height: 4px; accent-color: #79afc3; }
.param-value { flex: 0 0 38px; color: #9bb5c1; font-size: 10px; text-align: right; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 420px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
