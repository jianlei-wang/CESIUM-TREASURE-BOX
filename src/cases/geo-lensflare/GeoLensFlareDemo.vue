<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { Cartesian3, Color, JulianDate, type Viewer } from 'cesium'
import {
  createAtmosphereStage,
  loadAtmosphereLUTs,
  TEMPORAL_QUALITY_PRESETS,
  type AtmosphereStageOptions,
  type AtmosphereStageHandle,
  type AtmosphereLUTs
} from '../../lib/cesium-geospatial/cesium-core'
import { computeSunDirectionEcef, aimCameraToward } from '../geo-common/aim'
import {
  createMapScene,
  destroyScene,
  loadBingImagery
} from '../../lib/cesium-scene'

type CameraPreset = {
  lon: number
  lat: number
  height: number
  pitchOffset: number
}

const EARTH_RADIUS_M = 6378137

// 两档太阳相对位置：相机基点选在地物丰富区附近，视线实时瞄准真实太阳方向。
// 2026-09-05 档位修正：glare 旧 23:45Z 太阳俯仰 -0.82°（地平下，无辉光可打）；
// glare 改 23:20Z（elev≈9°），golden 改 22:30Z（elev≈13.6°），均高于地平保证太阳可见。
const PRESETS: Record<'glare' | 'golden', { time: string; cam: CameraPreset }> = {
  // 逆光海面——太阳贴近地平线，halo 贴地泛开
  glare: { time: '2026-08-28T23:20:00Z', cam: { lon: -80.6, lat: 26.5, height: 9000, pitchOffset: -2 } },
  // 金色时刻——低角度暖色长鬼影
  golden: { time: '2026-08-28T22:30:00Z', cam: { lon: -77.6, lat: 34.5, height: 12000, pitchOffset: 0 } }
}

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载大气 LUT…')
const ui = reactive({
  preset: 'glare' as keyof typeof PRESETS,
  enabled: true,
  intensity: 1.0,
  threshold: 0.82,
  ghost: 1.0,
  halo: 1.0,
  blur: 1.0
})

const viewer = shallowRef<Viewer | undefined>(undefined)
const atmosphereHandle = shallowRef<AtmosphereStageHandle | undefined>(undefined)
let lutsReady = false
let disposed = false
let buildSeq = 0
let lutsCache: AtmosphereLUTs | undefined

function applyPreset(preset: keyof typeof PRESETS): void {
  const viewerInstance = viewer.value
  if (!viewerInstance || viewerInstance.isDestroyed()) return
  const entry = PRESETS[preset]
  viewerInstance.clock.currentTime = JulianDate.fromIso8601(entry.time)
  viewerInstance.clock.shouldAnimate = false
  viewerInstance.clock.multiplier = 1
  const origin = Cartesian3.fromDegrees(entry.cam.lon, entry.cam.lat, entry.cam.height)
  const sunDir = computeSunDirectionEcef(viewerInstance.clock.currentTime, new Cartesian3())
  aimCameraToward(viewerInstance.camera, origin, sunDir, entry.cam.pitchOffset, 0)
}

function buildOptions(): AtmosphereStageOptions {
  return {
    lensFlare: ui.enabled,
    lensFlareIntensity: ui.intensity,
    lensFlareThreshold: ui.threshold,
    lensFlareGhost: ui.ghost,
    lensFlareHalo: ui.halo,
    lensFlarePreBlur: ui.blur,
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

function lutsRef(): AtmosphereLUTs {
  return lutsCache!
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
      lutsCache = luts
      lutsReady = true
    }
    if (disposed || current !== buildSeq) return
    const handle = createAtmosphereStage(viewerInstance.scene, lutsRef(), buildOptions())
    atmosphereHandle.value = handle
    ;(window as unknown as { __geoFlareHandle?: unknown }).__geoFlareHandle = handle
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
  scene.globe.enableLighting = false
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
    ;(window as unknown as { __geoFlareHandle?: unknown }).__geoFlareHandle = handle
    statusMessage.value = '镜头光晕就绪（Occlusion + Ghost + Halo）'
    ;(window as unknown as { __geoFlareReady?: boolean }).__geoFlareReady = true
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

let chainTimer: ReturnType<typeof setTimeout> | undefined
let statusTimer: ReturnType<typeof setTimeout> | undefined
function scheduleChainRebuild(): void {
  if (chainTimer) clearTimeout(chainTimer)
  chainTimer = setTimeout(() => {
    chainTimer = undefined
    void rebuildChain()
  }, 250)
}

// 2026-09-05 live 调参：滑块改 uniform（handle.setLensFlare 原地写 live 快照，每帧生效），
// 不再销毁重建——重建命中 Cesium stage-name textureCache 陈旧条目，重建后 flare 视觉丢失。
// handle 未就绪（初始创建失败等）时兜底 rebuildChain。
function applyLensFlareLive(): void {
  const handle = atmosphereHandle.value
  if (!handle) {
    scheduleChainRebuild()
    return
  }
  handle.setLensFlare({
    enabled: ui.enabled,
    intensity: ui.intensity,
    thresholdLevel: ui.threshold,
    ghostAmount: ui.ghost,
    haloAmount: ui.halo,
    preBlurRadius: ui.blur
  })
}

watch(
  () => ui.enabled,
  () => applyLensFlareLive()
)
watch(
  () => ui.intensity,
  () => applyLensFlareLive()
)
watch(
  () => ui.threshold,
  () => applyLensFlareLive()
)
watch(
  () => ui.ghost,
  () => applyLensFlareLive()
)
watch(
  () => ui.halo,
  () => applyLensFlareLive()
)
watch(
  () => ui.blur,
  () => applyLensFlareLive()
)

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
  <div class="geo-flare-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="geo-panel">
      <div class="panel-title">镜头光晕与高光</div>

      <div class="preset-row">
        <button
          v-for="item in ([
            { key: 'glare', label: '逆光' },
            { key: 'golden', label: '金色时刻' }
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
        <span class="toggle-label">镜头光晕（视线对日）</span>
        <button
          class="toggle"
          :class="{ on: ui.enabled }"
          :aria-label="ui.enabled ? '关闭镜头光晕' : '开启镜头光晕'"
          @click="ui.enabled = !ui.enabled"
        >
          <i></i>
        </button>
      </div>

      <div class="param-row">
        <span class="param-label">总强度</span>
        <input
          v-model.number="ui.intensity"
          class="param-slider"
          type="range"
          min="0"
          max="3"
          step="0.05"
        />
        <span class="param-value">{{ ui.intensity.toFixed(2) }}</span>
      </div>

      <div class="param-row">
        <span class="param-label">亮度阈值</span>
        <input
          v-model.number="ui.threshold"
          class="param-slider"
          type="range"
          min="0.4"
          max="1.6"
          step="0.01"
        />
        <span class="param-value">{{ ui.threshold.toFixed(2) }}</span>
      </div>

      <div class="param-row">
        <span class="param-label">鬼影强度</span>
        <input
          v-model.number="ui.ghost"
          class="param-slider"
          type="range"
          min="0"
          max="2.5"
          step="0.05"
        />
        <span class="param-value">{{ ui.ghost.toFixed(2) }}</span>
      </div>

      <div class="param-row">
        <span class="param-label">光晕强度</span>
        <input
          v-model.number="ui.halo"
          class="param-slider"
          type="range"
          min="0"
          max="3"
          step="0.05"
        />
        <span class="param-value">{{ ui.halo.toFixed(2) }}</span>
      </div>

      <div class="param-row">
        <span class="param-label">模糊半径</span>
        <input
          v-model.number="ui.blur"
          class="param-slider"
          type="range"
          min="0.3"
          max="3"
          step="0.1"
        />
        <span class="param-value">{{ ui.blur.toFixed(1) }}</span>
      </div>

      <div class="note-line">障碍遮挡采样 → 灰度高光抠像 → 长条鬼影 + 柔光光晕</div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.geo-flare-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #14100b; }
.cesium-container { width: 100%; height: 100%; }
.geo-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 9px; width: 252px; padding: 11px; border: 1px solid rgba(222, 186, 138, 0.28); border-radius: 9px; background: rgba(34, 27, 18, 0.84); backdrop-filter: blur(6px); color: #f0e4d2; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.preset-row { display: flex; gap: 6px; }
.preset-chip { flex: 1; padding: 4px 0; border: 1px solid rgba(222, 186, 138, 0.32); border-radius: 6px; background: transparent; color: #e3d3b6; font-size: 11px; cursor: pointer; }
.preset-chip.active { background: #b07b38; border-color: #b07b38; color: #fff; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; }
.toggle-label, .param-label { font-size: 11px; color: #e3d3b6; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(222, 186, 138, 0.4); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff2dd; transition: transform 0.2s; }
.toggle.on { background: #b07b38; }
.toggle.on i { transform: translateX(18px); }
.param-row { display: flex; align-items: center; gap: 8px; }
.param-label { flex: 0 0 48px; }
.param-slider { flex: 1; min-width: 0; height: 4px; accent-color: #d8a35c; }
.param-value { flex: 0 0 52px; color: #bda37d; font-size: 10px; text-align: right; }
.note-line { margin-top: 2px; padding-top: 7px; border-top: 1px solid rgba(222, 186, 138, 0.2); color: #bda37d; font-size: 10px; line-height: 1.5; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 420px; padding: 8px 14px; border: 1px solid rgba(222,186,138,.45); border-radius: 7px; color: #fdf3e4; background: rgba(34, 27, 18, 0.9); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
