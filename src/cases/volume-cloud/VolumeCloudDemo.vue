<script setup lang="ts">
import { Cartesian3, Color, JulianDate, SkyAtmosphere, type PostProcessStage, type Viewer } from 'cesium'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import { createCloudState, createVolumetricCloudStage, DEFAULT_CLOUD_PROFILE, updateCloudRuntime, type CloudQuality } from '../volume-cloud-lib/volume-cloud'

const container = ref<HTMLElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const loading = ref(true)
const quality = ref<CloudQuality>('Low')

const profile = reactive({ ...DEFAULT_CLOUD_PROFILE })

const cloudBaseKm = computed({
  get: () => Number((profile.cloudBase / 1000).toFixed(1)),
  set: (v: number) => { profile.cloudBase = v * 1000 }
})
const cloudThicknessKm = computed({
  get: () => Number((profile.cloudThickness / 1000).toFixed(1)),
  set: (v: number) => { profile.cloudThickness = v * 1000 }
})
const highBaseKm = computed({
  get: () => Number((profile.highCloudBase / 1000).toFixed(1)),
  set: (v: number) => { profile.highCloudBase = v * 1000 }
})
const highThicknessKm = computed({
  get: () => Number((profile.highCloudThickness / 1000).toFixed(1)),
  set: (v: number) => { profile.highCloudThickness = v * 1000 }
})

let viewer: Viewer | undefined
let stage: PostProcessStage | undefined
let removeTick: (() => void) | undefined
const state = createCloudState()

function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('')
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function applyColor(key: 'sunLightColor' | 'ambientTop' | 'ambientBot', value: string): void {
  profile[key] = hexToRgb(value)
}

function mountCloudPass(): void {
  if (!viewer) return
  stage = createVolumetricCloudStage(profile, state, quality.value)
  viewer.scene.postProcessStages.add(stage)
}

function applyQuality(q: CloudQuality): void {
  quality.value = q
  if (!viewer || !stage) return
  viewer.scene.postProcessStages.remove(stage)
  stage = createVolumetricCloudStage(profile, state, q)
  viewer.scene.postProcessStages.add(stage)
}

async function mountScene(): Promise<void> {
  if (!container.value) return
  const callbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '正在初始化体积云渲染…' }
  }
  try {
    viewer = createMapScene(container.value, callbacks)
    loadBingImagery(viewer, callbacks)

    viewer.scene.globe.enableLighting = true
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.highDynamicRange = true
    viewer.scene.skyAtmosphere = new SkyAtmosphere(viewer.scene.globe.ellipsoid)

    const now = new Date()
    now.setUTCHours(4, 0, 0, 0)
    viewer.clock.currentTime = JulianDate.fromDate(now)

    updateCloudRuntime(state, profile, 0)
    mountCloudPass()

    removeTick = viewer.clock.onTick.addEventListener(() => {
      const nowTime = performance.now()
      const dt = (nowTime - state.lastFrameTime) / 1000.0
      state.lastFrameTime = nowTime
      updateCloudRuntime(state, profile, dt)
      viewer?.scene.requestRender()
    })

    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(116.39, 39.9, 2000.0),
      orientation: { heading: 0, pitch: 0, roll: 0 },
      duration: 2
    })

    loading.value = false
    statusMessage.value = '体积云渲染已就绪，可调整参数或拖动视角观察云层变化。'
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
    loading.value = false
  }
}

onMounted(() => { void mountScene() })

onBeforeUnmount(() => {
  removeTick?.()
  removeTick = undefined
  if (viewer && stage) {
    viewer.scene.postProcessStages.remove(stage)
  }
  stage = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="cloud-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="cloud-panel">
      <div class="panel-title">体积云效果</div>

      <div class="section">质量</div>
      <select class="select" v-model="quality" :disabled="loading" @change="applyQuality(quality)">
        <option value="Low">低</option>
        <option value="Medium">中</option>
        <option value="High">高</option>
        <option value="Ultra">极致</option>
      </select>

      <div class="section">云层</div>
      <label class="param-row">云底高度(km)<span class="param-value">{{ cloudBaseKm }}</span></label>
      <input class="range" type="range" min="1" max="30" step="0.1" v-model.number="cloudBaseKm" :disabled="loading" />
      <label class="param-row">云层厚度(km)<span class="param-value">{{ cloudThicknessKm }}</span></label>
      <input class="range" type="range" min="1" max="20" step="0.1" v-model.number="cloudThicknessKm" :disabled="loading" />
      <label class="param-row">云量覆盖<span class="param-value">{{ profile.cloudCover }}</span></label>
      <input class="range" type="range" min="0" max="1" step="0.01" v-model.number="profile.cloudCover" :disabled="loading" />
      <label class="param-row">密度<span class="param-value">{{ profile.density }}</span></label>
      <input class="range" type="range" min="0" max="10" step="0.1" v-model.number="profile.density" :disabled="loading" />
      <label class="param-row">噪声尺度<span class="param-value">{{ profile.noiseScale }}</span></label>
      <input class="range" type="range" min="0.1" max="3" step="0.05" v-model.number="profile.noiseScale" :disabled="loading" />
      <label class="param-row">细节强度<span class="param-value">{{ profile.detailStrength }}</span></label>
      <input class="range" type="range" min="0" max="5" step="0.1" v-model.number="profile.detailStrength" :disabled="loading" />
      <label class="param-row">天气尺度<span class="param-value">{{ profile.weatherScale }}</span></label>
      <input class="range" type="range" min="0.5" max="5" step="0.1" v-model.number="profile.weatherScale" :disabled="loading" />
      <label class="param-row">扭曲强度<span class="param-value">{{ profile.warpStrength }}</span></label>
      <input class="range" type="range" min="0" max="8" step="0.1" v-model.number="profile.warpStrength" :disabled="loading" />
      <label class="param-row">风速<span class="param-value">{{ profile.windSpeed }}</span></label>
      <input class="range" type="range" min="0" max="500" step="5" v-model.number="profile.windSpeed" :disabled="loading" />
      <label class="param-row">风向(°)<span class="param-value">{{ profile.windAngle }}</span></label>
      <input class="range" type="range" min="0" max="360" step="1" v-model.number="profile.windAngle" :disabled="loading" />

      <div class="section">高云</div>
      <label class="param-row">高云底(km)<span class="param-value">{{ highBaseKm }}</span></label>
      <input class="range" type="range" min="20" max="60" step="0.5" v-model.number="highBaseKm" :disabled="loading" />
      <label class="param-row">高云厚度(km)<span class="param-value">{{ highThicknessKm }}</span></label>
      <input class="range" type="range" min="0.05" max="2" step="0.05" v-model.number="highThicknessKm" :disabled="loading" />
      <label class="param-row">高云覆盖<span class="param-value">{{ profile.highCloudCover }}</span></label>
      <input class="range" type="range" min="0" max="1" step="0.01" v-model.number="profile.highCloudCover" :disabled="loading" />
      <label class="param-row">高云密度<span class="param-value">{{ profile.highDensity }}</span></label>
      <input class="range" type="range" min="0" max="2" step="0.05" v-model.number="profile.highDensity" :disabled="loading" />
      <label class="param-row">高云噪声尺度<span class="param-value">{{ profile.highNoiseScale }}</span></label>
      <input class="range" type="range" min="0.1" max="2" step="0.05" v-model.number="profile.highNoiseScale" :disabled="loading" />

      <div class="section">光照</div>
      <label class="param-row">曝光<span class="param-value">{{ profile.exposure }}</span></label>
      <input class="range" type="range" min="0.5" max="5" step="0.1" v-model.number="profile.exposure" :disabled="loading" />
      <label class="param-row">亮度<span class="param-value">{{ profile.brightness }}</span></label>
      <input class="range" type="range" min="0.5" max="8" step="0.1" v-model.number="profile.brightness" :disabled="loading" />
      <label class="param-row">光吸收<span class="param-value">{{ profile.lightAbsorption }}</span></label>
      <input class="range" type="range" min="0.1" max="5" step="0.05" v-model.number="profile.lightAbsorption" :disabled="loading" />
      <label class="param-row">阴影强度<span class="param-value">{{ profile.shadowIntensity }}</span></label>
      <input class="range" type="range" min="0" max="1.5" step="0.05" v-model.number="profile.shadowIntensity" :disabled="loading" />
      <label class="param-row">太阳光色<span class="param-value">{{ rgbToHex(profile.sunLightColor) }}</span></label>
      <input class="color" type="color" :value="rgbToHex(profile.sunLightColor)" :disabled="loading" @input="applyColor('sunLightColor', ($event.target as HTMLInputElement).value)" />
      <label class="param-row">顶部环境色<span class="param-value">{{ rgbToHex(profile.ambientTop) }}</span></label>
      <input class="color" type="color" :value="rgbToHex(profile.ambientTop)" :disabled="loading" @input="applyColor('ambientTop', ($event.target as HTMLInputElement).value)" />
      <label class="param-row">底部环境色<span class="param-value">{{ rgbToHex(profile.ambientBot) }}</span></label>
      <input class="color" type="color" :value="rgbToHex(profile.ambientBot)" :disabled="loading" @input="applyColor('ambientBot', ($event.target as HTMLInputElement).value)" />
      <label class="param-row">银边强度<span class="param-value">{{ profile.silverLining }}</span></label>
      <input class="range" type="range" min="0" max="20" step="0.5" v-model.number="profile.silverLining" :disabled="loading" />
      <label class="param-row">太阳辉光<span class="param-value">{{ profile.sunGlare }}</span></label>
      <input class="range" type="range" min="0" max="40" step="0.5" v-model.number="profile.sunGlare" :disabled="loading" />

      <div class="section">相位与混合</div>
      <label class="param-row">相位 G1<span class="param-value">{{ profile.phaseG1 }}</span></label>
      <input class="range" type="range" min="-0.9" max="0.9" step="0.05" v-model.number="profile.phaseG1" :disabled="loading" />
      <label class="param-row">相位 G2<span class="param-value">{{ profile.phaseG2 }}</span></label>
      <input class="range" type="range" min="-0.9" max="0.9" step="0.05" v-model.number="profile.phaseG2" :disabled="loading" />
      <label class="param-row">相位权重<span class="param-value">{{ profile.phaseWeight }}</span></label>
      <input class="range" type="range" min="0" max="1" step="0.05" v-model.number="profile.phaseWeight" :disabled="loading" />
      <label class="param-row">雾混合<span class="param-value">{{ profile.fogBlend }}</span></label>
      <input class="range" type="range" min="0" max="1" step="0.05" v-model.number="profile.fogBlend" :disabled="loading" />
      <label class="param-row">大气透视<span class="param-value">{{ profile.aerialPerspective }}</span></label>
      <input class="range" type="range" min="0" max="1" step="0.05" v-model.number="profile.aerialPerspective" :disabled="loading" />

      <p class="hint">采用光线步进的球面体积云后处理，拖动视角或调整参数实时观察云层光影变化。</p>
    </div>

    <div v-if="loading" class="status-mask">{{ statusMessage }}</div>
    <div v-else-if="statusMessage" class="status-toast">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.cloud-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #102b40; }
.cesium-container { width: 100%; height: 100%; }
.cloud-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 6px; width: 248px; max-height: calc(100% - 24px); overflow-y: auto; padding: 12px; border: 1px solid rgba(137,210,233,.3); border-radius: 9px; background: rgba(8,32,49,.88); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; }
.cloud-panel::-webkit-scrollbar { width: 4px; }
.cloud-panel::-webkit-scrollbar-thumb { background: rgba(137,210,233,.35); border-radius: 2px; }
.panel-title { font-size: 12px; font-weight: 700; }
.section { margin-top: 4px; padding-top: 6px; border-top: 1px solid rgba(137,210,233,.18); color: #36c5e8; font-size: 11px; font-weight: 600; }
.param-row { display: flex; align-items: center; justify-content: space-between; color: #bdd9e4; }
.param-value { min-width: 44px; text-align: right; color: #eaf7fb; font-variant-numeric: tabular-nums; }
.range { width: 100%; accent-color: #36c5e8; }
.color { width: 100%; height: 22px; border: 1px solid rgba(137,210,233,.3); border-radius: 4px; background: transparent; padding: 0; }
.select { width: 100%; border: 1px solid rgba(137,210,233,.3); border-radius: 4px; background: #102b40; color: #d9eff6; font-size: 10px; padding: 3px 4px; }
.hint { margin: 0; color: #a4c6d2; font-size: 10px; line-height: 1.4; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }
.status-toast { position: absolute; top: 12px; left: 50%; z-index: 9; transform: translateX(-50%); max-width: 70%; padding: 8px 16px; border: 1px solid rgba(137,210,233,.35); border-radius: 999px; background: rgba(8,32,49,.88); backdrop-filter: blur(6px); color: #ddf2f8; font-size: 11px; text-align: center; pointer-events: none; }
</style>
