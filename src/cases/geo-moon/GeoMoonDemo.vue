<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { Cartesian3, Color, JulianDate, type Viewer } from 'cesium'
import {
  createAtmosphereStage,
  computeMoonIlluminatedFractionFromDirections,
  loadAtmosphereLUTs,
  TEMPORAL_QUALITY_PRESETS,
  type AtmosphereStageOptions,
  type AtmosphereStageHandle,
  type AtmosphereLUTs
} from '../../lib/cesium-geospatial/cesium-core'
import { computeSunDirectionEcef, computeMoonDirectionEcef, aimCameraToward } from '../geo-common/aim'
import {
  createMapScene,
  destroyScene,
  loadBingImagery
} from '../../lib/cesium-scene'

const EARTH_RADIUS_M = 6378137
const VIEW_ALT_M = 2400e3

const PRESETS: Record<string, { label: string; time: string }> = {
  crescent: { label: '蛾眉月', time: '2026-08-19T04:30:00Z' },
  quarter: { label: '上弦月', time: '2026-08-22T03:00:00Z' },
  gibbous: { label: '盈凸月', time: '2026-08-25T02:30:00Z' },
  full: { label: '满月', time: '2026-08-28T22:00:00Z' }
}

const TINTS: Record<'cool' | 'neutral' | 'warm', { label: string; rgb: [number, number, number] }> = {
  cool: { label: '冷蓝', rgb: [0.72, 1, 1.32] },
  neutral: { label: '中性', rgb: [1, 1, 1] },
  warm: { label: '暖白', rgb: [1.06, 0.94, 0.82] }
}

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载大气 LUT…')
const ui = reactive({
  preset: 'full' as string,
  disk: true,
  tint: 'cool' as keyof typeof TINTS,
  radiance: 1546,
  angularRadius: 0.014,
  glow: 200000
})
const hudLine = ref('')

const viewer = shallowRef<Viewer | undefined>(undefined)
const atmosphereHandle = shallowRef<AtmosphereStageHandle | undefined>(undefined)
let lutsReady = false
let disposed = false
let buildSeq = 0
let lutsCache: AtmosphereLUTs | undefined
let rafHandle = 0

function frameMoon(): void {
  const viewerInstance = viewer.value
  if (!viewerInstance || viewerInstance.isDestroyed()) return
  const time = viewerInstance.clock.currentTime
  const moonDir = computeMoonDirectionEcef(time, Cartesian3.ZERO, new Cartesian3())
  const origin = Cartesian3.multiplyByScalar(
    Cartesian3.normalize(moonDir, new Cartesian3()),
    EARTH_RADIUS_M + VIEW_ALT_M,
    new Cartesian3()
  )
  // 从「月下点」高轨俯瞰——月亮悬于顶，低俯见夜晚地球临边
  aimCameraToward(viewerInstance.camera, origin, moonDir, -34, 0)
}

function applyPreset(preset: string): void {
  const viewerInstance = viewer.value
  if (!viewerInstance || viewerInstance.isDestroyed()) return
  const entry = PRESETS[preset]
  if (!entry) return
  viewerInstance.clock.currentTime = JulianDate.fromIso8601(entry.time)
  viewerInstance.clock.shouldAnimate = false
  viewerInstance.clock.multiplier = 1
  frameMoon()
}

function buildOptions(): AtmosphereStageOptions {
  const tint = TINTS[ui.tint]
  return {
    moon: ui.disk,
    moonRadianceScale: ui.radiance,
    moonAngularRadius: ui.angularRadius,
    moonTint: new Cartesian3(tint.rgb[0], tint.rgb[1], tint.rgb[2]),
    moonSkyGlowScale: ui.glow,
    exposureFollowTimeline: true,
    lensFlare: false,
    inscatterScale: 8,
    groundLighting: 1,
    groundDim: 0.43,
    temporalEma: true,
    temporalLowAlpha: TEMPORAL_QUALITY_PRESETS.low.lowAlpha,
    temporalHighAlpha: TEMPORAL_QUALITY_PRESETS.low.highAlpha,
    depthTemporal: false
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
  } catch (error) {
    if (!disposed) {
      statusMessage.value = error instanceof Error ? error.message : String(error)
    }
  }
}

function updateHud(): void {
  if (disposed) return
  const viewerInstance = viewer.value
  if (viewerInstance && !viewerInstance.isDestroyed()) {
    const time = viewerInstance.clock.currentTime
    const sun = computeSunDirectionEcef(time, new Cartesian3())
    const moon = computeMoonDirectionEcef(time, Cartesian3.ZERO, new Cartesian3())
    const phase = computeMoonIlluminatedFractionFromDirections(sun, moon)
    hudLine.value = `月相 ${Math.round(phase * 100)}% · 月光照明由月相与月向共同驱动`
  }
  rafHandle = requestAnimationFrame(updateHud)
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
    statusMessage.value = '月球渲染就绪（月面纹理 + 月晕 + 月光照明）'
    ;(window as unknown as { __geoMoonReady?: boolean }).__geoMoonReady = true
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = setTimeout(() => {
      if (!disposed) statusMessage.value = ''
    }, 2000)
    rafHandle = requestAnimationFrame(updateHud)
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

watch(
  () => ui.disk,
  () => scheduleChainRebuild()
)
watch(
  () => ui.tint,
  () => scheduleChainRebuild()
)
watch(
  () => ui.radiance,
  () => scheduleChainRebuild()
)
watch(
  () => ui.angularRadius,
  () => scheduleChainRebuild()
)
watch(
  () => ui.glow,
  () => scheduleChainRebuild()
)

onMounted(() => {
  void initScene()
})

onBeforeUnmount(() => {
  disposed = true
  if (rafHandle) cancelAnimationFrame(rafHandle)
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
  <div class="geo-moon-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="geo-panel">
      <div class="panel-title">月球与月光照明</div>

      <div class="preset-row moon-preset-row">
        <button
          v-for="(item, key) in PRESETS"
          :key="key"
          class="preset-chip"
          :class="{ active: ui.preset === key }"
          @click="ui.preset = key"
        >
          {{ item.label }}
        </button>
      </div>

      <div class="toggle-row">
        <span class="toggle-label">月盘（带月面纹理）</span>
        <button
          class="toggle"
          :class="{ on: ui.disk }"
          :aria-label="ui.disk ? '关闭月盘' : '开启月盘'"
          @click="ui.disk = !ui.disk"
        >
          <i></i>
        </button>
      </div>

      <div class="toggle-row tint-row">
        <span class="toggle-label">月光色调</span>
        <div class="tint-group">
          <button
            v-for="(tintItem, tintKey) in TINTS"
            :key="tintKey"
            class="tint-chip"
            :class="{ active: ui.tint === tintKey }"
            @click="ui.tint = tintKey as keyof typeof TINTS"
          >
            {{ tintItem.label }}
          </button>
        </div>
      </div>

      <div class="param-row">
        <span class="param-label">月光强度</span>
        <input
          v-model.number="ui.radiance"
          class="param-slider"
          type="range"
          min="0"
          max="4000"
          step="50"
        />
        <span class="param-value">{{ ui.radiance.toFixed(0) }}</span>
      </div>

      <div class="param-row">
        <span class="param-label">月晕亮度</span>
        <input
          v-model.number="ui.glow"
          class="param-slider"
          type="range"
          min="0"
          max="400000"
          step="5000"
        />
        <span class="param-value">{{ (ui.glow / 1000).toFixed(0) }}k</span>
      </div>

      <div class="param-row">
        <span class="param-label">盘径</span>
        <input
          v-model.number="ui.angularRadius"
          class="param-slider"
          type="range"
          min="0.004"
          max="0.04"
          step="0.001"
        />
        <span class="param-value">{{ (ui.angularRadius * 1000).toFixed(1) }}mrad</span>
      </div>

      <div class="note-line">Simon1994 月位 + ICRF→Fixed · 月面 albedo × Oren-Nayar · 月晕天空散射</div>
    </div>

    <div v-if="hudLine" class="moon-hud">{{ hudLine }}</div>
    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.geo-moon-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #05070f; }
.cesium-container { width: 100%; height: 100%; }
.geo-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 9px; width: 258px; padding: 11px; border: 1px solid rgba(160, 180, 220, 0.28); border-radius: 9px; background: rgba(12, 18, 38, 0.85); backdrop-filter: blur(6px); color: #dce4f2; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.preset-row { display: flex; gap: 5px; }
.moon-preset-row .preset-chip { flex: 1; }
.preset-chip { flex: 1; padding: 4px 0; border: 1px solid rgba(160, 180, 220, 0.3); border-radius: 6px; background: transparent; color: #b9c6dd; font-size: 11px; cursor: pointer; }
.preset-chip.active { background: #4a6bb0; border-color: #4a6bb0; color: #fff; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; }
.toggle-label, .param-label { font-size: 11px; color: #b9c6dd; }
.toggle { position: relative; width: 36px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(160, 180, 220, 0.4); cursor: pointer; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e6ecf8; transition: transform 0.2s; }
.toggle.on { background: #4a6bb0; }
.toggle.on i { transform: translateX(18px); }
.tint-row { justify-content: flex-start; gap: 10px; }
.tint-group { display: flex; gap: 5px; }
.tint-chip { padding: 2px 7px; border: 1px solid rgba(160, 180, 220, 0.3); border-radius: 5px; background: transparent; color: #b9c6dd; font-size: 10px; cursor: pointer; }
.tint-chip.active { background: #4a6bb0; border-color: #4a6bb0; color: #fff; }
.param-row { display: flex; align-items: center; gap: 8px; }
.param-label { flex: 0 0 48px; }
.param-slider { flex: 1; min-width: 0; height: 4px; accent-color: #7a92cf; }
.param-value { flex: 0 0 52px; color: #8fa3c8; font-size: 10px; text-align: right; }
.note-line { margin-top: 2px; padding-top: 7px; border-top: 1px solid rgba(160, 180, 220, 0.2); color: #8fa3c8; font-size: 10px; line-height: 1.5; }
.moon-hud { position: absolute; top: 12px; left: 12px; z-index: 9; padding: 6px 12px; border: 1px solid rgba(160,180,220,.4); border-radius: 7px; color: #e0e8f8; background: rgba(8, 14, 32, 0.82); font-size: 11px; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 420px; padding: 8px 14px; border: 1px solid rgba(160,180,220,.45); border-radius: 7px; color: #eef2fc; background: rgba(8, 14, 32, 0.9); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
</style>
