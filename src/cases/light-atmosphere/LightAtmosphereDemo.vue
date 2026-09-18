<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import {
  Cartesian3,
  ClockStep,
  JulianDate,
  Math as CesiumMath,
  SunLight,
  type Viewer
} from 'cesium'
import { useWhiteModelTileset } from '../../lib/use-white-model-tileset'
import InfoTip from '../../components/InfoTip.vue'
import '../../lib/lighting-panel.css'

const base = useWhiteModelTileset({ skyAtmosphere: true, skyBox: true })

const SKY_ATMOSPHERE_LIGHT_BASE = 50
const GLOBE_ATMOSPHERE_LIGHT_BASE = 10

const MULTIPLIER_OPTIONS = [
  { value: 60, label: '1 分钟/帧' },
  { value: 600, label: '10 分钟/帧' },
  { value: 1800, label: '30 分钟/帧' },
  { value: 3600, label: '1 小时/帧' }
]

const ui = reactive({
  hour: 12,
  animate: true,
  multiplier: 600,
  sunIntensity: 3,
  atmosphereIntensity: 1,
  mieAnisotropy: 0.9,
  hueShift: 0
})

const timeLabel = ref('')
const sunLight = shallowRef<SunLight | undefined>(undefined)
let viewerRef: Viewer | undefined
let preRenderOff: (() => void) | undefined

function timeAtHour(hour: number): JulianDate {
  const date = new Date()
  date.setUTCHours(Math.floor(hour) % 24, Math.round((hour % 1) * 60), 0, 0)
  return JulianDate.fromDate(date)
}

function updateTimeLabel(): void {
  const viewer = viewerRef
  if (!viewer || viewer.isDestroyed()) return
  const date = JulianDate.toDate(viewer.clock.currentTime)
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  timeLabel.value = `UTC ${hh}:${mm}`
}

function apply(): void {
  const viewer = viewerRef
  if (!viewer || viewer.isDestroyed()) return
  const scene = viewer.scene
  viewer.clock.clockStep = ClockStep.TICK_DEPENDENT
  viewer.clock.shouldAnimate = ui.animate
  viewer.clock.multiplier = ui.multiplier
  viewer.clock.currentTime = timeAtHour(ui.hour)

  if (sunLight.value) sunLight.value.intensity = ui.sunIntensity
  const sky = scene.skyAtmosphere
  if (sky) {
    sky.atmosphereLightIntensity = SKY_ATMOSPHERE_LIGHT_BASE * ui.atmosphereIntensity
    sky.atmosphereMieAnisotropy = ui.mieAnisotropy
    sky.hueShift = ui.hueShift
  }
  const globe = scene.globe
  if (globe) {
    globe.atmosphereLightIntensity = GLOBE_ATMOSPHERE_LIGHT_BASE * ui.atmosphereIntensity
    globe.atmosphereMieAnisotropy = ui.mieAnisotropy
    globe.atmosphereHueShift = ui.hueShift
  }
  updateTimeLabel()
  scene.requestRender()
}

function lookAtHorizon(): void {
  const viewer = viewerRef
  if (!viewer || viewer.isDestroyed()) return
  const carto = viewer.camera.positionCartographic
  const height = Math.max(carto.height, 4000)
  viewer.camera.setView({
    destination: Cartesian3.fromRadians(carto.longitude, carto.latitude, height),
    orientation: { heading: CesiumMath.toRadians(-63), pitch: CesiumMath.toRadians(-8), roll: 0 }
  })
  viewer.scene.requestRender()
}

function onTilesetReady(viewer: Viewer): void {
  viewerRef = viewer
  const scene = viewer.scene
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true
  scene.globe.enableLighting = true
  scene.globe.showGroundAtmosphere = true
  scene.globe.dynamicAtmosphereLighting = true
  scene.globe.dynamicAtmosphereLightingFromSun = true
  sunLight.value = new SunLight({ intensity: ui.sunIntensity })
  scene.light = sunLight.value

  const handler = () => updateTimeLabel()
  scene.preRender.addEventListener(handler)
  preRenderOff = () => scene.preRender.removeEventListener(handler)

  apply()
}

onMounted(async () => {
  await base.mount(onTilesetReady)
})

onBeforeUnmount(() => {
  preRenderOff?.()
  preRenderOff = undefined
  viewerRef = undefined
  sunLight.value = undefined
  base.teardown()
})
</script>

<template>
  <div class="lgt-shell">
    <div :ref="base.container" class="lgt-canvas"></div>

    <div class="lgt-panel">
      <div class="lgt-title">光照效果 · 大气动态光照</div>

      <div class="lgt-section">时间控制</div>
      <div class="lgt-row">
        <span class="lgt-label">时刻<InfoTip title="时刻" text="模拟世界时的小时数，决定太阳相对地球的方向。拖动可观察全天不同时刻的昼夜与大气受光变化。" /></span>
        <input v-model.number="ui.hour" class="lgt-range" type="range" min="0" max="24" step="0.25" @input="apply" />
        <span class="lgt-value">{{ ui.hour.toFixed(2) }}h</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">播放动画<InfoTip title="播放动画" text="开启后场景时钟随渲染帧自动推进，昼夜循环连续播放；关闭时固定在当前时刻。" /></span>
        <button class="lgt-toggle" :class="{ on: ui.animate }" @click="ui.animate = !ui.animate; apply()"><i></i></button>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">时间倍率<InfoTip title="时间倍率" text="每帧推进的模拟秒数。倍率越大昼夜更替越快，用于快速预览一整天的光照与大气变化。" /></span>
        <select v-model.number="ui.multiplier" class="lgt-select" @change="apply">
          <option v-for="item in MULTIPLIER_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>

      <div class="lgt-section">光照参数</div>
      <div class="lgt-row">
        <span class="lgt-label">太阳光强度<InfoTip title="太阳光强度" text="SunLight.intensity，太阳直射光的强度，直接决定地表与建筑的明暗对比和阴影强度。" /></span>
        <input v-model.number="ui.sunIntensity" class="lgt-range" type="range" min="0" max="8" step="0.1" @input="apply" />
        <span class="lgt-value">{{ ui.sunIntensity.toFixed(1) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">大气光强度<InfoTip title="大气光强度" text="大气受光亮度的倍率，同时作用于天空大气与地面大气，1.00x 为 Cesium 默认亮度。数值越大，天空散射与地平线越明亮。" /></span>
        <input v-model.number="ui.atmosphereIntensity" class="lgt-range" type="range" min="0" max="3" step="0.05" @input="apply" />
        <span class="lgt-value">{{ ui.atmosphereIntensity.toFixed(2) }}x</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">Mie 各向异性<InfoTip title="Mie 各向异性" text="Mie 散射相位函数的各向异性系数 G，可调 -0.9~0.9，默认 0.9。正值让太阳附近的散射光更集中（强前向散射、日周光晕更明显），负值转为后向散射。0.9 与 -0.9 差异最大，需朝太阳方向观察日周光晕才明显。" /></span>
        <input v-model.number="ui.mieAnisotropy" class="lgt-range" type="range" min="-0.9" max="0.9" step="0.01" @input="apply" />
        <span class="lgt-value">{{ ui.mieAnisotropy.toFixed(2) }}</span>
      </div>
      <div class="lgt-row">
        <span class="lgt-label">大气色调<InfoTip title="大气色调" text="大气色相偏移，取值范围 -0.3~0.3（约 ±108°），默认 0。正值与负值使大气沿色环向相反方向偏色，绝对值越大偏色越明显；同时作用于天空大气与地面大气。" /></span>
        <input v-model.number="ui.hueShift" class="lgt-range" type="range" min="-0.3" max="0.3" step="0.01" @input="apply" />
        <span class="lgt-value">{{ ui.hueShift.toFixed(2) }}</span>
      </div>

      <div class="lgt-section">观测视角</div>
      <div class="lgt-btn-row">
        <button class="lgt-btn" @click="lookAtHorizon">看向地平线</button>
        <button class="lgt-btn ghost" @click="base.flyToCity()">俯视城市</button>
      </div>
      <p class="lgt-hint" style="margin-top: 6px">大气散射与色调在地平线附近最明显，切换视角后再调节大气参数即可直观观察到变化。</p>

      <div class="lgt-hud">
        场景时刻 {{ timeLabel || '--:--' }}
        <InfoTip title="场景时刻" text="当前场景时钟对应的 UTC 时间，随播放动画与时间倍率实时更新，可据此定位昼夜与大气受光所处时段。" />
      </div>
      <p class="lgt-hint">动态大气光照依赖 globe.enableLighting 与 dynamicAtmosphereLighting；昼夜明暗由 SunLight 随时刻计算，大气光强度会同时作用于天空大气与地面大气，时间倍率为每帧推进的模拟秒数。</p>
    </div>

    <div v-if="base.statusMessage.value" class="lgt-status">{{ base.statusMessage.value }}</div>
  </div>
</template>
