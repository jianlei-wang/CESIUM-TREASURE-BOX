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
import { ORDER, SPECS } from './effects'

type Effect = { active: boolean } & Record<string, unknown>

const props = withDefaults(
  defineProps<{
    title: string
    hint: string
    keys: string[]
    initial?: string[]
  }>(),
  { initial: () => [] }
)

const activeOrder = ORDER.filter((key) => props.keys.includes(key))
const specs = SPECS.filter((spec) => props.keys.includes(spec.key))

const constructors: Record<string, (viewer: never) => Effect> = {
  snowLine: (viewer) => new SnowLine(viewer) as unknown as Effect,
  valleyFog: (viewer) => new ValleyFog(viewer) as unknown as Effect,
  spotlight: (viewer) => new Spotlight(viewer) as unknown as Effect,
  precipitation: (viewer) => new Precipitation(viewer) as unknown as Effect,
  rainRings: (viewer) => new RainRings(viewer) as unknown as Effect,
  lightning: (viewer) => new Lightning(viewer) as unknown as Effect,
  dufour: (viewer) => new Dufour(viewer) as unknown as Effect,
  tiltShift: (viewer) => new TiltShift(viewer) as unknown as Effect,
  motionBlur: (viewer) => new MotionBlur(viewer, { exposure: 0.04 }) as unknown as Effect,
  speedLines: (viewer) => new SpeedLines(viewer) as unknown as Effect,
  colorIsolation: (viewer) => new ColorIsolation(viewer) as unknown as Effect,
  infrared: (viewer) => new Infrared(viewer) as unknown as Effect,
  technicolor: (viewer) => new Technicolor(viewer) as unknown as Effect,
  super8: (viewer) => new Super8(viewer) as unknown as Effect,
  lensDistortion: (viewer) => new LensDistortion(viewer) as unknown as Effect,
  jello: (viewer) => new Jello(viewer) as unknown as Effect,
  droneDisplay: (viewer) => new DroneDisplay(viewer) as unknown as Effect,
  analogVideo: (viewer) => new AnalogVideo(viewer) as unknown as Effect,
  digitalVideo: (viewer) => new DigitalVideo(viewer) as unknown as Effect
}

const container = ref<HTMLElement | null>(null)
const effects: Record<string, Effect> = {}
const enabled = reactive<Record<string, boolean>>(
  Object.fromEntries(specs.map((spec) => [spec.key, props.initial.includes(spec.key)]))
)
const values = reactive<Record<string, number>>(
  Object.fromEntries(specs.flatMap((spec) => spec.sliders.map((slider) => [`${spec.key}.${slider.name}`, slider.value])))
)
const openKey = ref<string | null>(null)
const followCursor = ref(false)
const inFront = ref(false)

function applyOrder(key: string): void {
  const later = activeOrder.slice(activeOrder.indexOf(key) + 1)
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
  for (const key of props.keys) {
    const factory = constructors[key]
    if (factory) effects[key] = factory(instance as never)
  }

  for (const spec of specs) {
    for (const slider of spec.sliders) {
      ;(effects[spec.key] as Record<string, unknown>)[slider.name] = values[`${spec.key}.${slider.name}`]
    }
  }

  for (const key of props.initial) {
    const effect = effects[key]
    if (!effect) continue
    effect.active = true
    enabled[key] = true
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
      <div class="helper-title">{{ props.title }}</div>
      <p class="helper-hint">{{ props.hint }}</p>

      <div v-for="spec in specs" :key="spec.key" class="fx-item">
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
