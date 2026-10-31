<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from 'vue'
import { Cartesian3, ScreenSpaceEventType } from 'cesium'
import {
  AnalogVideo,
  ColorIsolation,
  DigitalVideo,
  DroneDisplay,
  Dufour,
  Infrared,
  Jello,
  LensDistortion,
  Lightning,
  MotionBlur,
  Precipitation,
  RainRings,
  SnowLine,
  SpeedLines,
  Spotlight,
  Super8,
  Technicolor,
  TiltShift,
  ValleyFog
} from '../cesium-helpers-lib/packages/cesium-post-process/src/cesium-post-process.js'
import { useHelperViewer } from '../cesium-helpers-lib/use-helper-viewer'
import '../cesium-helpers-lib/helper-ui.css'

type Effect = { active: boolean } & Record<string, unknown>

type Slider = { name: string; label: string; min: number; max: number; step: number; value: number }
type EffectSpec = { key: string; label: string; sliders: Slider[] }

const ORDER = [
  'snowLine',
  'valleyFog',
  'spotlight',
  'precipitation',
  'rainRings',
  'lightning',
  'dufour',
  'tiltShift',
  'motionBlur',
  'speedLines',
  'colorIsolation',
  'infrared',
  'technicolor',
  'super8',
  'lensDistortion',
  'jello',
  'droneDisplay',
  'analogVideo',
  'digitalVideo'
]

const SPECS: EffectSpec[] = [
  { key: 'snowLine', label: '雪线', sliders: [
    { name: 'altitude', label: '海拔 (m)', min: 500, max: 4000, step: 50, value: 2000 },
    { name: 'transition', label: '过渡 (m)', min: 0, max: 1000, step: 10, value: 200 },
    { name: 'maxSlope', label: '最大坡度 (°)', min: 10, max: 80, step: 1, value: 50 },
    { name: 'coverage', label: '覆盖', min: 0, max: 1, step: 0.05, value: 1 }
  ] },
  { key: 'valleyFog', label: '山谷雾', sliders: [
    { name: 'top', label: '雾顶 (m)', min: 400, max: 3000, step: 10, value: 1500 },
    { name: 'density', label: '浓度', min: 0.0005, max: 0.02, step: 0.0005, value: 0.005 },
    { name: 'softness', label: '柔和 (m)', min: 0, max: 500, step: 10, value: 100 }
  ] },
  { key: 'spotlight', label: '聚光灯', sliders: [
    { name: 'power', label: '强度', min: 0, max: 4, step: 0.1, value: 1 },
    { name: 'radius', label: '半径 (m)', min: 20, max: 2000, step: 10, value: 200 },
    { name: 'softness', label: '柔化', min: 0, max: 1, step: 0.05, value: 0.5 },
    { name: 'darkness', label: '暗度', min: 0, max: 1, step: 0.05, value: 0.8 }
  ] },
  { key: 'precipitation', label: '降水', sliders: [
    { name: 'intensity', label: '强度', min: 0, max: 1, step: 0.05, value: 0.5 },
    { name: 'snow', label: '降雪', min: 0, max: 1, step: 0.05, value: 0 },
    { name: 'wind', label: '风向 (°)', min: 0, max: 60, step: 1, value: 10 },
    { name: 'speed', label: '速度', min: 0.25, max: 2, step: 0.05, value: 1 }
  ] },
  { key: 'rainRings', label: '雨圈', sliders: [
    { name: 'intensity', label: '强度', min: 0, max: 1, step: 0.05, value: 0.5 },
    { name: 'cell', label: '格距 (m)', min: 0.5, max: 10, step: 0.1, value: 2 },
    { name: 'reach', label: '波及 (m)', min: 0.05, max: 1.5, step: 0.05, value: 0.35 }
  ] },
  { key: 'lightning', label: '闪电', sliders: [
    { name: 'intensity', label: '强度', min: 0, max: 1, step: 0.05, value: 0.5 },
    { name: 'cloudBase', label: '云底 (m)', min: 500, max: 5000, step: 50, value: 2500 },
    { name: 'radius', label: '半径 (m)', min: 1000, max: 15000, step: 500, value: 5000 }
  ] },
  { key: 'dufour', label: 'Dufour 地图', sliders: [
    { name: 'spacing', label: '间距 (px)', min: 3, max: 12, step: 0.5, value: 3.5 },
    { name: 'strokeLength', label: '笔长', min: 2, max: 30, step: 1, value: 14 },
    { name: 'oblique', label: '斜射光', min: 0, max: 1, step: 0.05, value: 0.8 }
  ] },
  { key: 'tiltShift', label: '移轴', sliders: [
    { name: 'range', label: '清晰带', min: 0.05, max: 1, step: 0.05, value: 0.3 },
    { name: 'blur', label: '模糊', min: 1, max: 10, step: 0.5, value: 4 },
    { name: 'saturation', label: '饱和度', min: 0, max: 1, step: 0.05, value: 0.3 }
  ] },
  { key: 'motionBlur', label: '运动模糊', sliders: [
    { name: 'strength', label: '强度', min: 0, max: 1, step: 0.05, value: 1 },
    { name: 'exposure', label: '曝光 (s)', min: 0.005, max: 0.1, step: 0.005, value: 0.04 }
  ] },
  { key: 'speedLines', label: '速度线', sliders: [
    { name: 'strength', label: '强度', min: 0, max: 1, step: 0.05, value: 1 }
  ] },
  { key: 'colorIsolation', label: '色彩隔离', sliders: [
    { name: 'hue', label: '色相 (°)', min: 0, max: 359, step: 1, value: 0 },
    { name: 'range', label: '范围 (°)', min: 5, max: 120, step: 1, value: 60 }
  ] },
  { key: 'infrared', label: '红外', sliders: [
    { name: 'strength', label: '强度', min: 0, max: 1, step: 0.05, value: 1 }
  ] },
  { key: 'technicolor', label: '特艺彩色', sliders: [
    { name: 'strength', label: '强度', min: 0, max: 1, step: 0.05, value: 1 }
  ] },
  { key: 'super8', label: '超 8 胶片', sliders: [
    { name: 'fade', label: '褪色', min: 0, max: 1, step: 0.05, value: 0.5 },
    { name: 'grain', label: '颗粒', min: 0, max: 0.5, step: 0.01, value: 0.15 },
    { name: 'weave', label: '抖动 (px)', min: 0, max: 5, step: 0.1, value: 1.5 },
    { name: 'lightLeaks', label: '漏光', min: 0, max: 1, step: 0.05, value: 0.5 }
  ] },
  { key: 'lensDistortion', label: '广角镜头', sliders: [
    { name: 'distortion', label: '畸变', min: 0, max: 1, step: 0.05, value: 0.5 },
    { name: 'vignette', label: '暗角', min: 0, max: 1, step: 0.05, value: 0.5 }
  ] },
  { key: 'jello', label: '果冻效应', sliders: [
    { name: 'amount', label: '幅度', min: 0, max: 1, step: 0.05, value: 0.1 },
    { name: 'frequency', label: '频率 (Hz)', min: 2, max: 80, step: 1, value: 30 }
  ] },
  { key: 'droneDisplay', label: '无人机 OSD', sliders: [
    { name: 'opacity', label: '不透明度', min: 0, max: 1, step: 0.05, value: 1 }
  ] },
  { key: 'analogVideo', label: '模拟图传', sliders: [
    { name: 'noise', label: '噪点', min: 0, max: 1, step: 0.05, value: 0.5 },
    { name: 'interference', label: '干扰', min: 0, max: 1, step: 0.05, value: 0.15 }
  ] },
  { key: 'digitalVideo', label: '数字图传', sliders: [
    { name: 'breakup', label: '马赛克', min: 0, max: 1, step: 0.05, value: 0.5 }
  ] }
]

const container = ref<HTMLElement | null>(null)
const effects: Record<string, Effect> = {}
const enabled = reactive<Record<string, boolean>>(Object.fromEntries(SPECS.map((spec) => [spec.key, false])))
const values = reactive<Record<string, number>>(
  Object.fromEntries(SPECS.flatMap((spec) => spec.sliders.map((slider) => [`${spec.key}.${slider.name}`, slider.value])))
)
const openKey = ref<string | null>(null)
const followCursor = ref(false)
const inFront = ref(false)

function applyOrder(key: string): void {
  const later = ORDER.slice(ORDER.indexOf(key) + 1)
  for (const name of later) {
    const effect = effects[name]
    if (effect && enabled[name]) {
      effect.active = false
      effect.active = true
    }
  }
}

function setFocus(focus: Cartesian3 | undefined): void {
  for (const name of ['tiltShift', 'spotlight', 'speedLines']) {
    const effect = effects[name] as { focus?: Cartesian3 } | undefined
    if (effect) effect.focus = focus
  }
}

const { viewer, status } = useHelperViewer(container, { smooth: true }, (instance) => {
  effects.snowLine = new SnowLine(instance) as unknown as Effect
  effects.valleyFog = new ValleyFog(instance) as unknown as Effect
  effects.spotlight = new Spotlight(instance) as unknown as Effect
  effects.precipitation = new Precipitation(instance) as unknown as Effect
  effects.rainRings = new RainRings(instance) as unknown as Effect
  effects.lightning = new Lightning(instance) as unknown as Effect
  effects.dufour = new Dufour(instance) as unknown as Effect
  effects.tiltShift = new TiltShift(instance) as unknown as Effect
  effects.motionBlur = new MotionBlur(instance, { exposure: 0.04 }) as unknown as Effect
  effects.speedLines = new SpeedLines(instance) as unknown as Effect
  effects.colorIsolation = new ColorIsolation(instance) as unknown as Effect
  effects.infrared = new Infrared(instance) as unknown as Effect
  effects.technicolor = new Technicolor(instance) as unknown as Effect
  effects.super8 = new Super8(instance) as unknown as Effect
  effects.lensDistortion = new LensDistortion(instance) as unknown as Effect
  effects.jello = new Jello(instance) as unknown as Effect
  effects.droneDisplay = new DroneDisplay(instance) as unknown as Effect
  effects.analogVideo = new AnalogVideo(instance) as unknown as Effect
  effects.digitalVideo = new DigitalVideo(instance) as unknown as Effect

  for (const spec of SPECS) {
    for (const slider of spec.sliders) {
      ;(effects[spec.key] as Record<string, unknown>)[slider.name] = values[`${spec.key}.${slider.name}`]
    }
  }

  instance.screenSpaceEventHandler.setInputAction(
    ({ position }: { position: { x: number; y: number } }) => {
      const focus = instance.scene.pickPosition(position as never)
      if (focus) setFocus(focus)
    },
    ScreenSpaceEventType.LEFT_CLICK
  )
  instance.screenSpaceEventHandler.setInputAction(
    ({ endPosition }: { endPosition: { x: number; y: number } }) => {
      if (followCursor.value) {
        const focus = instance.scene.pickPosition(endPosition as never)
        if (focus && effects.spotlight) (effects.spotlight as { focus?: Cartesian3 }).focus = focus
      }
    },
    ScreenSpaceEventType.MOUSE_MOVE
  )

  return () => {
    for (const effect of Object.values(effects)) effect.active = false
  }
})

function toggleEffect(key: string): void {
  enabled[key] = !enabled[key]
  const effect = effects[key]
  if (!effect) return
  effect.active = enabled[key]
  if (enabled[key]) {
    openKey.value = key
    applyOrder(key)
  }
}

function onSlider(key: string, name: string, raw: string): void {
  const value = Number(raw)
  values[`${key}.${name}`] = value
  const effect = effects[key] as Record<string, unknown> | undefined
  if (effect) effect[name] = value
}

function toggleFollow(value: boolean): void {
  followCursor.value = value
}

function toggleInFront(value: boolean): void {
  inFront.value = value
  if (effects.lightning) (effects.lightning as unknown as { inFront: boolean }).inFront = value
}

function centerFocus(): void {
  setFocus(undefined)
}

onBeforeUnmount(() => {
  for (const effect of Object.values(effects)) effect.active = false
})
</script>

<template>
  <div class="helper-shell">
    <div ref="container" class="helper-canvas"></div>

    <div class="helper-panel is-wide">
      <div class="helper-title">屏幕后期特效</div>
      <p class="helper-hint">19 种屏幕空间特效按顺序叠加。展开一项可调参数，点击地图可把移轴、聚光与速度线聚焦到该点。</p>

      <div v-for="spec in SPECS" :key="spec.key" class="fx-item">
        <div class="fx-head">
          <button class="fx-toggle" type="button" :class="{ 'is-on': enabled[spec.key] }" @click="toggleEffect(spec.key)">
            <i></i>
          </button>
          <button class="fx-name" type="button" @click="openKey = openKey === spec.key ? null : spec.key">{{ spec.label }}</button>
        </div>
        <div v-if="openKey === spec.key && enabled[spec.key]" class="fx-body">
          <label v-for="slider in spec.sliders" :key="slider.name" class="helper-field">
            <span class="fx-row">
              <span class="helper-row-label">{{ slider.label }}</span>
              <span class="helper-value">{{ values[`${spec.key}.${slider.name}`] }}</span>
            </span>
            <input
              class="helper-range"
              type="range"
              :min="slider.min"
              :max="slider.max"
              :step="slider.step"
              :value="values[`${spec.key}.${slider.name}`]"
              @input="onSlider(spec.key, slider.name, ($event.target as HTMLInputElement).value)"
            />
          </label>
          <div v-if="spec.key === 'spotlight'" class="helper-row">
            <span class="helper-row-label">跟随光标</span>
            <button class="helper-toggle" :class="{ 'is-on': followCursor }" type="button" role="switch" :aria-checked="followCursor" @click="toggleFollow(!followCursor)">
              <i></i>
            </button>
          </div>
          <div v-if="spec.key === 'lightning'" class="helper-row">
            <span class="helper-row-label">置于镜头前</span>
            <button class="helper-toggle" :class="{ 'is-on': inFront }" type="button" role="switch" :aria-checked="inFront" @click="toggleInFront(!inFront)">
              <i></i>
            </button>
          </div>
        </div>
      </div>

      <button class="helper-button" type="button" @click="centerFocus">聚焦画面中心</button>
    </div>

    <div v-if="status" class="helper-status">{{ status }}</div>
  </div>
</template>

<style scoped>
.fx-item {
  border-top: 1px solid rgba(137, 210, 233, 0.16);
  padding-top: 6px;
}

.fx-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.fx-toggle {
  position: relative;
  flex: none;
  width: 30px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(137, 210, 233, 0.28);
  cursor: pointer;
}

.fx-toggle i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #e7f5f8;
  transition: transform 0.18s ease;
}

.fx-toggle.is-on {
  background: #2f80ed;
}

.fx-toggle.is-on i {
  transform: translateX(14px);
}

.fx-name {
  flex: 1;
  padding: 2px 0;
  border: 0;
  background: none;
  color: #ddf2f8;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.fx-name:hover {
  color: #36c5e8;
}

.fx-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 0 4px 38px;
}

.fx-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
</style>
