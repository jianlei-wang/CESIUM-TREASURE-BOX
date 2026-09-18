<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { Color, JulianDate, type Viewer } from 'cesium'
import {
  createAtmosphereStage,
  loadAtmosphereLUTs,
  TEMPORAL_QUALITY_PRESETS,
  type AtmosphereStageOptions,
  type AtmosphereStageHandle,
  type AtmosphereLUTs
} from '../../lib/cesium-geospatial/cesium-core'
import {
  createCloudsStage,
  loadWeatherTextures,
  type CloudsStageHandle,
  type CloudsWeatherPreset,
  type CloudsQualityPreset,
  type WeatherTextures
} from '../../lib/cesium-geospatial/cesium-clouds'
import {
  createMapScene,
  destroyScene,
  loadBingImagery
} from '../../lib/cesium-scene'
import { Cartesian3, Math as CesiumMath } from 'cesium'

const VIEW_TIME = '2026-08-28T20:00:00Z'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载云噪声资产…')
const ui = reactive({
  weather: 'fair' as CloudsWeatherPreset | undefined,
  quality: 'medium' as CloudsQualityPreset,
  shadowPass: true,
  temporal: false,
  overlayExposure: 12
})

const viewer = shallowRef<Viewer | undefined>(undefined)
const atmosphereHandle = shallowRef<AtmosphereStageHandle | undefined>(undefined)
const cloudsHandle = shallowRef<CloudsStageHandle | undefined>(undefined)
let lutsReady = false
let weatherReady = false
let disposed = false
let buildSeq = 0
let lutsCache: AtmosphereLUTs | undefined
let weatherCache: WeatherTextures | undefined

function lutsRef(): AtmosphereLUTs {
  return lutsCache!
}
function weatherRef(): WeatherTextures {
  return weatherCache!
}

function buildAtmosphereOptions(): AtmosphereStageOptions {
  return {
    lensFlare: false,
    exposureFollowTimeline: true,
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

async function rebuildClouds(): Promise<void> {
  const viewerInstance = viewer.value
  if (!viewerInstance || viewerInstance.isDestroyed()) return
  const current = ++buildSeq
  try {
    const old = cloudsHandle.value
    if (old) {
      old.destroy()
      cloudsHandle.value = undefined
    }
    if (!lutsReady || !weatherReady) return
    if (disposed || current !== buildSeq) return
    const handle = createCloudsStage(viewerInstance.scene, lutsRef(), weatherRef(), {
      clouds: true,
      weatherPreset: ui.weather,
      shadowPass: ui.shadowPass,
      temporal: ui.temporal,
      cloudsOverlayExposure: ui.overlayExposure,
      quality: ui.quality
    })
    if (!handle) return
    cloudsHandle.value = handle
    atmosphereHandle.value?.insertStageBeforeLensFlare(handle.overlayStage)
  } catch (error) {
    if (!disposed) {
      statusMessage.value = error instanceof Error ? error.message : String(error)
    }
  }
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
  scene.globe.enableLighting = true
  scene.globe.showGroundAtmosphere = false
  scene.fog.enabled = false
  if (scene.sun != null) scene.sun.show = false
  if (scene.moon != null) scene.moon.show = false
  scene.backgroundColor = Color.BLACK
  scene.globe.baseColor = Color.BLACK
  scene.globe.tileCacheSize = 5000
  scene.globe.preloadAncestors = true
  loadBingImagery(instance)
  ;(window as unknown as { __geoMapLayers?: number }).__geoMapLayers = instance.scene.imageryLayers.length

  instance.clock.currentTime = JulianDate.fromIso8601(VIEW_TIME)
  instance.clock.shouldAnimate = false
  instance.clock.multiplier = 1
  instance.camera.setView({
    destination: Cartesian3.fromDegrees(-118.35, 34.0, 9000),
    orientation: {
      heading: CesiumMath.toRadians(-85),
      pitch: CesiumMath.toRadians(-12),
      roll: 0
    }
  })

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
    const handle = createAtmosphereStage(instance.scene, lutsRef(), buildAtmosphereOptions())
    atmosphereHandle.value = handle
  } catch (error) {
    if (!disposed) {
      statusMessage.value = error instanceof Error ? error.message : String(error)
    }
    return
  }
  if (disposed) return

  statusMessage.value = '正在加载云噪声资产…'
  try {
    const context = (scene as unknown as { context: unknown }).context
    weatherCache = await loadWeatherTextures(
      context as Parameters<typeof loadWeatherTextures>[0],
      '/geo/clouds'
    )
    weatherReady = true
  } catch (error) {
    if (!disposed) {
      statusMessage.value = `云资产加载失败：${error instanceof Error ? error.message : String(error)}`
    }
    return
  }
  if (disposed) return
  try {
    await rebuildClouds()
    if (!disposed) {
      statusMessage.value = '体积云就绪（Raymarch + 大气光照 + 时域重建）'
      ;(window as unknown as { __geoCloudsReady?: boolean }).__geoCloudsReady = true
      if (statusTimer) clearTimeout(statusTimer)
      statusTimer = setTimeout(() => {
        if (!disposed) statusMessage.value = ''
      }, 2000)
    }
  } catch (error) {
    if (!disposed) {
      statusMessage.value = error instanceof Error ? error.message : String(error)
    }
  }
}

const WEATHER_ITEMS: { key: CloudsWeatherPreset | undefined; label: string }[] = [
  { key: 'clear', label: '晴朗' },
  { key: 'fair', label: '少云' },
  { key: 'cloudy', label: '多云' },
  { key: 'overcast', label: '阴天' }
]

const QUALITY_ITEMS: { key: CloudsQualityPreset; label: string }[] = [
  { key: 'low', label: 'L' },
  { key: 'medium', label: 'M' },
  { key: 'high', label: 'H' },
  { key: 'ultra', label: 'U' }
]

function onWeatherChange(key: CloudsWeatherPreset | undefined): void {
  ui.weather = key
  const handle = cloudsHandle.value
  if (handle) handle.setWeatherPreset(key)
}

function onQualityChange(key: CloudsQualityPreset): void {
  ui.quality = key
  const handle = cloudsHandle.value
  if (handle) handle.setQuality(key)
}

let chainTimer: ReturnType<typeof setTimeout> | undefined
let statusTimer: ReturnType<typeof setTimeout> | undefined
function scheduleCloudsRebuild(): void {
  if (chainTimer) clearTimeout(chainTimer)
  chainTimer = setTimeout(() => {
    chainTimer = undefined
    void rebuildClouds()
  }, 300)
}

watch(
  () => ui.shadowPass,
  () => scheduleCloudsRebuild()
)
watch(
  () => ui.temporal,
  () => scheduleCloudsRebuild()
)
watch(
  () => ui.overlayExposure,
  () => scheduleCloudsRebuild()
)

onMounted(() => {
  void initScene()
})

onBeforeUnmount(() => {
  disposed = true
  if (chainTimer) clearTimeout(chainTimer)
  if (statusTimer) clearTimeout(statusTimer)
  const clouds = cloudsHandle.value
  if (clouds) clouds.destroy()
  cloudsHandle.value = undefined
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
  <div class="geo-clouds-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="geo-panel">
      <div class="panel-title">体积云 Raymarch</div>

      <div class="preset-row">
        <button
          v-for="item in WEATHER_ITEMS"
          :key="item.label"
          class="preset-chip"
          :class="{ active: ui.weather === item.key }"
          @click="onWeatherChange(item.key)"
        >
          {{ item.label }}
        </button>
      </div>

      <div class="toggle-row">
        <span class="toggle-label">云内自阴影（级联阴影）</span>
        <button
          class="toggle"
          :class="{ on: ui.shadowPass }"
          :aria-label="ui.shadowPass ? '关闭云自阴影' : '开启云自阴影'"
          @click="ui.shadowPass = !ui.shadowPass"
        >
          <i></i>
        </button>
      </div>

      <div class="toggle-row">
        <span class="toggle-label">时域重建（1/4 分迈）</span>
        <button
          class="toggle"
          :class="{ on: ui.temporal }"
          :aria-label="ui.temporal ? '关闭时域重建' : '开启时域重建'"
          @click="ui.temporal = !ui.temporal"
        >
          <i></i>
        </button>
      </div>

      <div class="param-row">
        <span class="param-label">云曝光</span>
        <input
          v-model.number="ui.overlayExposure"
          class="param-slider"
          type="range"
          min="1"
          max="40"
          step="0.5"
        />
        <span class="param-value">{{ ui.overlayExposure.toFixed(1) }}</span>
      </div>

      <div class="param-row quality-row">
        <span class="param-label">质量档</span>
        <div class="quality-group">
          <button
            v-for="item in QUALITY_ITEMS"
            :key="item.key"
            class="quality-chip"
            :class="{ active: ui.quality === item.key }"
            @click="onQualityChange(item.key)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>

      <div class="note-line">weather 3D 分布烘焙 · 分层 raymarch · Beer-Lambert 光照 · ACES 合成</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.geo-clouds-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #0c1418; }
.cesium-container { width: 100%; height: 100%; }
.geo-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 9px; width: 258px; padding: 11px; border: 1px solid rgba(180, 210, 225, 0.28); border-radius: 9px; background: rgba(20, 32, 40, 0.84); backdrop-filter: blur(6px); color: #e2edf2; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.preset-row { display: flex; gap: 5px; }
.preset-chip { flex: 1; padding: 4px 0; border: 1px solid rgba(180, 210, 225, 0.3); border-radius: 6px; background: transparent; color: #c2d4dc; font-size: 11px; cursor: pointer; }
.preset-chip.active { background: #52839c; border-color: #52839c; color: #fff; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; }
.toggle-label, .param-label { font-size: 11px; color: #c2d4dc; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(180, 210, 225, 0.4); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #eaf4f8; transition: transform 0.2s; }
.toggle.on { background: #52839c; }
.toggle.on i { transform: translateX(18px); }
.param-row { display: flex; align-items: center; gap: 8px; }
.param-label { flex: 0 0 48px; }
.param-slider { flex: 1; min-width: 0; height: 4px; accent-color: #6ba5c0; }
.param-value { flex: 0 0 48px; color: #93b2bf; font-size: 10px; text-align: right; }
.quality-row { justify-content: space-between; }
.quality-group { display: flex; gap: 5px; }
.quality-chip { width: 26px; height: 22px; border: 1px solid rgba(180, 210, 225, 0.3); border-radius: 5px; background: transparent; color: #c2d4dc; font-size: 10px; cursor: pointer; }
.quality-chip.active { background: #52839c; border-color: #52839c; color: #fff; }
.note-line { margin-top: 2px; padding-top: 7px; border-top: 1px solid rgba(180, 210, 225, 0.2); color: #93b2bf; font-size: 10px; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 420px; padding: 8px 14px; border: 1px solid rgba(160,205,225,.45); border-radius: 7px; color: #eff7fa; background: rgba(10, 22, 30, 0.9); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
