<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Cartesian3,
  ClockRange,
  ClockStep,
  Color,
  JulianDate,
  LagrangePolynomialApproximation,
  Math as CesiumMath,
  PolylineGlowMaterialProperty,
  SampledPositionProperty,
  ShadowMode,
  TimeInterval,
  TimeIntervalCollection,
  VelocityOrientationProperty,
  type Viewer
} from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, loadWorldTerrain, type SceneCallbacks } from '../../lib/cesium-scene'
import {
  SPEED_OPTIONS,
  buildTicks,
  clamp,
  daylightStops,
  degToPct,
  formatClock,
  fromUnix,
  pctToDeg,
  pointerToDeg,
  polarDeg,
  toUnix
} from './timeline-math'

type StyleId = 'aurora' | 'sundial' | 'cinema'
type RangeId = 'loop' | 'clamp' | 'free'
type DragMode = 'none' | 'scrub' | 'pan'

const STYLES: { id: StyleId; title: string }[] = [
  { id: 'aurora', title: '极光丝带' },
  { id: 'sundial', title: '日晷环轨' },
  { id: 'cinema', title: '胶片光轨' }
]

const RANGE_MODES: { id: RangeId; title: string }[] = [
  { id: 'loop', title: '循环' },
  { id: 'clamp', title: '钳制' },
  { id: 'free', title: '自由' }
]

const BUILDINGS = [
  { lon: 116.3952, lat: 39.9091, w: 38, d: 28, h: 72, c: '#e8eef4' },
  { lon: 116.3966, lat: 39.9084, w: 52, d: 34, h: 118, c: '#f2ebe0' },
  { lon: 116.3984, lat: 39.9090, w: 30, d: 30, h: 86, c: '#dde6ee' },
  { lon: 116.3972, lat: 39.9072, w: 44, d: 26, h: 54, c: '#efe6d6' },
  { lon: 116.3995, lat: 39.9078, w: 36, d: 36, h: 140, c: '#d9e3ec' },
  { lon: 116.3948, lat: 39.9070, w: 48, d: 22, h: 64, c: '#f7f1e6' },
  { lon: 116.4008, lat: 39.9096, w: 26, d: 40, h: 96, c: '#e3ebf2' },
  { lon: 116.3936, lat: 39.9086, w: 32, d: 32, h: 48, c: '#eee4d4' }
]

const PATH = [
  [116.392, 39.912, 86],
  [116.402, 39.911, 94],
  [116.405, 39.905, 78],
  [116.398, 39.901, 90],
  [116.390, 39.904, 82],
  [116.392, 39.912, 86]
]

const container = ref<HTMLElement | null>(null)
const trackRef = ref<HTMLElement | null>(null)
const needleRef = ref<HTMLElement | null>(null)
const sundialRef = ref<SVGSVGElement | null>(null)
const statusMessage = ref('正在加载 Bing 地图…')
const styleId = ref<StyleId>('aurora')
const rangeId = ref<RangeId>('loop')
const lighting = ref(true)
const shadows = ref(true)
const playing = ref(true)
const reversed = ref(false)
const realtime = ref(false)
const multiplierAbs = ref(600)
const clockText = ref('')
const viewStartSec = ref(0)
const viewEndSec = ref(0)
const currentSec = ref(0)
const clockStartSec = ref(0)
const clockStopSec = ref(0)

let viewer: Viewer | undefined
let disposed = false
let stopTick: (() => void) | undefined
let dragMode: DragMode = 'none'
let resumeAfterScrub = false
let panOriginX = 0
let panOriginStart = 0
let panOriginEnd = 0
let pendingClick: { x: number; t: number } | undefined

const ticks = computed(() => buildTicks(viewStartSec.value, viewEndSec.value, styleId.value === 'cinema' ? 9 : 13))
const needlePct = computed(() => {
  const span = viewEndSec.value - viewStartSec.value
  if (span <= 0) return 50
  return clamp(((currentSec.value - viewStartSec.value) / span) * 100, -4, 104)
})
const rangeBand = computed(() => {
  const span = viewEndSec.value - viewStartSec.value
  if (span <= 0) return { left: '0%', width: '100%' }
  const left = clamp(((clockStartSec.value - viewStartSec.value) / span) * 100, 0, 100)
  const right = clamp(((clockStopSec.value - viewStartSec.value) / span) * 100, 0, 100)
  return { left: `${left}%`, width: `${Math.max(right - left, 0)}%` }
})
const dayGradient = computed(() => daylightStops(viewStartSec.value, viewEndSec.value))
const needleDeg = computed(() => pctToDeg(needlePct.value))
const sunPos = computed(() => polarDeg(needleDeg.value, 142))
const analog = computed(() => {
  const d = new Date(currentSec.value * 1000)
  const s = d.getSeconds() + d.getMilliseconds() / 1000
  const m = d.getMinutes() + s / 60
  const h = (d.getHours() % 12) + m / 60
  return { h: h * 30, m: m * 6, s: s * 6 }
})
const sundialTicks = computed(() =>
  ticks.value.filter((t) => t.major).map((t) => {
    const deg = pctToDeg(t.pct)
    const a = polarDeg(deg, 148)
    const b = polarDeg(deg, 136)
    const l = polarDeg(deg, 118)
    return { ...t, deg, a, b, l }
  })
)
const arcD = computed(() => {
  const a = polarDeg(-120, 142)
  const b = polarDeg(120, 142)
  return `M ${a.x} ${a.y} A 142 142 0 1 1 ${b.x} ${b.y}`
})
const needleLine = computed(() => {
  const a = polarDeg(needleDeg.value, 72)
  const b = polarDeg(needleDeg.value, 150)
  return { a, b }
})

function applyCurrent(sec: number): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.clock.currentTime = fromUnix(sec)
  currentSec.value = sec
  clockText.value = formatClock(new Date(sec * 1000))
}

function applyLighting(on: boolean): void {
  lighting.value = on
  if (!viewer || viewer.isDestroyed()) return
  viewer.scene.globe.enableLighting = on
  viewer.scene.globe.dynamicAtmosphereLighting = on
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = on
}

function applyShadows(on: boolean): void {
  shadows.value = on
  if (!viewer || viewer.isDestroyed()) return
  viewer.shadows = on
}

function applyRange(id: RangeId): void {
  rangeId.value = id
  if (!viewer || viewer.isDestroyed()) return
  viewer.clock.clockRange = id === 'loop' ? ClockRange.LOOP_STOP : id === 'clamp' ? ClockRange.CLAMPED : ClockRange.UNBOUNDED
}

function exitRealtime(): void {
  realtime.value = false
  if (!viewer || viewer.isDestroyed()) return
  viewer.clock.clockStep = ClockStep.SYSTEM_CLOCK_MULTIPLIER
  viewer.clock.multiplier = reversed.value ? -multiplierAbs.value : multiplierAbs.value
}

function setSpeed(value: number): void {
  multiplierAbs.value = value
  if (!viewer || viewer.isDestroyed()) return
  exitRealtime()
  viewer.clock.multiplier = reversed.value ? -value : value
  viewer.clock.shouldAnimate = true
  playing.value = true
}

function togglePlay(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (realtime.value) exitRealtime()
  viewer.clock.shouldAnimate = !viewer.clock.shouldAnimate
  playing.value = viewer.clock.shouldAnimate
}

function toggleReverse(): void {
  if (!viewer || viewer.isDestroyed()) return
  reversed.value = !reversed.value
  exitRealtime()
  viewer.clock.multiplier = reversed.value ? -multiplierAbs.value : multiplierAbs.value
  viewer.clock.shouldAnimate = true
  playing.value = true
}

function jumpStart(): void {
  if (!viewer || viewer.isDestroyed()) return
  applyCurrent(clockStartSec.value)
}

function jumpEnd(): void {
  if (!viewer || viewer.isDestroyed()) return
  applyCurrent(clockStopSec.value)
}

function centerOn(sec: number): void {
  const span = Math.max(viewEndSec.value - viewStartSec.value, 3600)
  viewStartSec.value = sec - span * 0.5
  viewEndSec.value = sec + span * 0.5
}

function jumpToNow(): number {
  const nowSec = Date.now() / 1000
  if (nowSec < clockStartSec.value || nowSec > clockStopSec.value) {
    const pad = 12 * 3600
    clockStartSec.value = Math.min(clockStartSec.value, nowSec - pad)
    clockStopSec.value = Math.max(clockStopSec.value, nowSec + pad)
    if (viewer && !viewer.isDestroyed()) {
      viewer.clock.startTime = fromUnix(clockStartSec.value)
      viewer.clock.stopTime = fromUnix(clockStopSec.value)
    }
  }
  applyCurrent(nowSec)
  centerOn(nowSec)
  return nowSec
}

function toggleRealtime(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (realtime.value) {
    exitRealtime()
    return
  }
  jumpToNow()
  realtime.value = true
  reversed.value = false
  viewer.clock.clockStep = ClockStep.SYSTEM_CLOCK
  viewer.clock.multiplier = 1
  viewer.clock.shouldAnimate = true
  playing.value = true
}

function timeAtClientX(el: HTMLElement, clientX: number): number {
  const rect = el.getBoundingClientRect()
  const u = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1)
  return viewStartSec.value + u * (viewEndSec.value - viewStartSec.value)
}

function zoomAt(sec: number, factor: number): void {
  const span = viewEndSec.value - viewStartSec.value
  const maxSpan = Math.max(clockStopSec.value - clockStartSec.value, 3600) * 8
  const newSpan = clamp(span * factor, 30, maxSpan)
  const u = span <= 0 ? 0.5 : clamp((sec - viewStartSec.value) / span, 0, 1)
  viewStartSec.value = sec - newSpan * u
  viewEndSec.value = sec + newSpan * (1 - u)
}

function autoFollow(): void {
  const span = viewEndSec.value - viewStartSec.value
  if (span <= 0) return
  const pct = (currentSec.value - viewStartSec.value) / span
  if (pct >= 0.08 && pct <= 0.92) return
  viewStartSec.value = currentSec.value - span * 0.5
  viewEndSec.value = currentSec.value + span * 0.5
}

function onTick(): void {
  if (!viewer || viewer.isDestroyed()) return
  const sec = toUnix(viewer.clock.currentTime)
  currentSec.value = sec
  clockText.value = formatClock(new Date(sec * 1000))
  playing.value = viewer.clock.shouldAnimate
  if (dragMode === 'none' && (playing.value || realtime.value)) autoFollow()
}

function onTrackPointerDown(e: PointerEvent): void {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const t = timeAtClientX(el, e.clientX)
  const needleBox = needleRef.value?.getBoundingClientRect()
  const onNeedle = !!needleBox && Math.abs(e.clientX - (needleBox.left + needleBox.width / 2)) < 16
  if (e.button === 2 || e.shiftKey) {
    dragMode = 'pan'
    panOriginX = e.clientX
    panOriginStart = viewStartSec.value
    panOriginEnd = viewEndSec.value
    pendingClick = undefined
    return
  }
  if (onNeedle) {
    startScrub(t)
    pendingClick = undefined
    return
  }
  pendingClick = { x: e.clientX, t }
  dragMode = 'none'
}

function startScrub(t: number): void {
  if (!viewer || viewer.isDestroyed()) return
  dragMode = 'scrub'
  resumeAfterScrub = viewer.clock.shouldAnimate
  viewer.clock.shouldAnimate = false
  playing.value = false
  applyCurrent(t)
}

function onTrackPointerMove(e: PointerEvent): void {
  const el = trackRef.value
  if (!el) return
  if (pendingClick && Math.abs(e.clientX - pendingClick.x) > 4) {
    dragMode = 'pan'
    panOriginX = pendingClick.x
    panOriginStart = viewStartSec.value
    panOriginEnd = viewEndSec.value
    pendingClick = undefined
  }
  if (dragMode === 'scrub') {
    applyCurrent(timeAtClientX(el, e.clientX))
    return
  }
  if (dragMode === 'pan') {
    const rect = el.getBoundingClientRect()
    const span = panOriginEnd - panOriginStart
    const dt = -((e.clientX - panOriginX) / Math.max(rect.width, 1)) * span
    viewStartSec.value = panOriginStart + dt
    viewEndSec.value = panOriginEnd + dt
  }
}

function onTrackPointerUp(): void {
  if (pendingClick) applyCurrent(pendingClick.t)
  pendingClick = undefined
  if (dragMode === 'scrub' && viewer && !viewer.isDestroyed()) {
    viewer.clock.shouldAnimate = resumeAfterScrub
    playing.value = resumeAfterScrub
  }
  dragMode = 'none'
}

function onTrackWheel(e: WheelEvent): void {
  e.preventDefault()
  const el = trackRef.value
  if (!el) return
  const t = timeAtClientX(el, e.clientX)
  zoomAt(t, e.deltaY > 0 ? 1.18 : 1 / 1.18)
}

function onSundialPointerDown(e: PointerEvent): void {
  const svg = sundialRef.value
  if (!svg) return
  svg.setPointerCapture(e.pointerId)
  startScrub(timeFromSundial(svg, e))
}

function onSundialPointerMove(e: PointerEvent): void {
  const svg = sundialRef.value
  if (!svg || dragMode !== 'scrub') return
  applyCurrent(timeFromSundial(svg, e))
}

function timeFromSundial(svg: SVGSVGElement, e: PointerEvent): number {
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const m = svg.getScreenCTM()
  const p = m ? pt.matrixTransform(m.inverse()) : { x: 180, y: 188 }
  const pct = degToPct(pointerToDeg(p.x, p.y))
  const span = viewEndSec.value - viewStartSec.value
  return viewStartSec.value + (pct / 100) * span
}

function onSundialWheel(e: WheelEvent): void {
  e.preventDefault()
  zoomAt(currentSec.value, e.deltaY > 0 ? 1.18 : 1 / 1.18)
}

function addSceneContent(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const b of BUILDINGS) {
    viewer.entities.add({
      position: Cartesian3.fromDegrees(b.lon, b.lat, b.h / 2),
      box: {
        dimensions: new Cartesian3(b.w, b.d, b.h),
        material: Color.fromCssColorString(b.c),
        shadows: ShadowMode.ENABLED
      }
    })
  }

  const start = fromUnix(clockStartSec.value)
  const stop = fromUnix(clockStopSec.value)
  const span = clockStopSec.value - clockStartSec.value
  const property = new SampledPositionProperty()
  property.setInterpolationOptions({
    interpolationDegree: 2,
    interpolationAlgorithm: LagrangePolynomialApproximation
  })
  for (let i = 0; i < PATH.length; i += 1) {
    const [lon, lat, h] = PATH[i]
    const t = JulianDate.addSeconds(start, (span * i) / (PATH.length - 1), new JulianDate())
    property.addSample(t, Cartesian3.fromDegrees(lon, lat, h))
  }
  viewer.entities.add({
    availability: new TimeIntervalCollection([new TimeInterval({ start, stop })]),
    position: property,
    orientation: new VelocityOrientationProperty(property),
    box: {
      dimensions: new Cartesian3(10, 6, 3),
      material: Color.fromCssColorString('#ffd36a'),
      shadows: ShadowMode.CAST_ONLY
    },
    path: {
      leadTime: 0,
      trailTime: 7200,
      width: 2.4,
      resolution: 120,
      material: new PolylineGlowMaterialProperty({
        glowPower: 0.22,
        color: Color.fromCssColorString('#ffe08a')
      })
    }
  })
}

onMounted(async () => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => { statusMessage.value = message },
    onBasemapReady: () => { statusMessage.value = '' }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
    const stop = new Date(start.getTime() + 86400000)
    clockStartSec.value = start.getTime() / 1000
    clockStopSec.value = stop.getTime() / 1000
    viewStartSec.value = clockStartSec.value
    viewEndSec.value = clockStopSec.value
    const nowSec = now.getTime() / 1000
    const current = nowSec >= clockStartSec.value && nowSec <= clockStopSec.value ? nowSec : clockStartSec.value + 6 * 3600

    viewer.clock.startTime = fromUnix(clockStartSec.value)
    viewer.clock.stopTime = fromUnix(clockStopSec.value)
    viewer.clock.currentTime = fromUnix(current)
    viewer.clock.clockRange = ClockRange.LOOP_STOP
    viewer.clock.clockStep = ClockStep.SYSTEM_CLOCK_MULTIPLIER
    viewer.clock.multiplier = 600
    viewer.clock.shouldAnimate = true
    viewer.clock.canAnimate = true

    viewer.scene.globe.enableLighting = true
    viewer.scene.globe.dynamicAtmosphereLighting = true
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true
    viewer.shadows = true
    viewer.terrainShadows = ShadowMode.RECEIVE_ONLY
    viewer.shadowMap.darkness = 0.38
    viewer.shadowMap.size = 2048
    viewer.shadowMap.softShadows = true

    addSceneContent()
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(116.3974, 39.9038, 760),
      orientation: {
        heading: CesiumMath.toRadians(22),
        pitch: CesiumMath.toRadians(-36),
        roll: 0
      }
    })
    stopTick = viewer.clock.onTick.addEventListener(onTick)
    onTick()
    await loadWorldTerrain(viewer).catch(() => undefined)
    if (disposed) return
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  stopTick?.()
  stopTick = undefined
  destroyScene(viewer)
  viewer = undefined
})
</script>

<template>
  <div class="widget-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="control-panel">
      <div class="panel-title">自定义时间轴控件</div>
      <div class="row">
        <span class="row-label">样式</span>
      </div>
      <div class="seg">
        <button v-for="s in STYLES" :key="s.id" :class="{ on: styleId === s.id }" @click="styleId = s.id">{{ s.title }}</button>
      </div>
      <div class="row">
        <span class="row-label">时钟范围</span>
      </div>
      <div class="seg">
        <button v-for="m in RANGE_MODES" :key="m.id" :class="{ on: rangeId === m.id }" @click="applyRange(m.id)">{{ m.title }}</button>
      </div>
      <p class="hint">单击刻度跳转时间，拖动指针刮擦，拖动空白处平移时间窗，滚轮缩放。时间轴上的日照、阴影、实时为图标开关；实时会跳到当前时刻并定位指针。</p>
    </div>

    <div class="dock" :class="styleId">
      <div class="transport">
        <button class="icon-btn" title="跳到开始" @click="jumpStart">
          <svg viewBox="0 0 12 12"><path d="M2 2 h1.4 v8 H2 Z M10 2.2 L4.2 6 L10 9.8 Z" fill="currentColor"/></svg>
        </button>
        <button class="icon-btn" title="反向播放" :class="{ on: reversed }" @click="toggleReverse">
          <svg viewBox="0 0 12 12"><path d="M9.8 2 L3.4 6 L9.8 10 Z" fill="currentColor"/></svg>
        </button>
        <button class="icon-btn play" :title="playing ? '暂停' : '播放'" @click="togglePlay">
          <svg v-if="!playing" viewBox="0 0 12 12"><path d="M3 1.6 L10.4 6 L3 10.4 Z" fill="currentColor"/></svg>
          <svg v-else viewBox="0 0 12 12"><path d="M2.8 2 h2.3 v8 H2.8 Z M6.9 2 h2.3 v8 H6.9 Z" fill="currentColor"/></svg>
        </button>
        <button class="icon-btn" title="跳到结束" @click="jumpEnd">
          <svg viewBox="0 0 12 12"><path d="M8.6 2 H10 v8 H8.6 Z M2 2.2 L7.8 6 L2 9.8 Z" fill="currentColor"/></svg>
        </button>
        <span class="sep"></span>
        <button class="icon-btn" :class="{ on: lighting }" :title="lighting ? '关闭光照' : '开启光照'" @click="applyLighting(!lighting)">
          <svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="2.1" fill="currentColor"/><g stroke="currentColor" stroke-width="1.15" stroke-linecap="round" fill="none"><path d="M6 1.15 v1.35 M6 9.5 v1.35 M1.15 6 h1.35 M9.5 6 h1.35 M2.55 2.55 l.95 .95 M8.5 8.5 l.95 .95 M2.55 9.45 l.95 -.95 M8.5 3.5 l.95 -.95"/></g></svg>
        </button>
        <button class="icon-btn" :class="{ on: shadows }" :title="shadows ? '关闭阴影' : '开启阴影'" @click="applyShadows(!shadows)">
          <svg viewBox="0 0 12 12"><path d="M2.2 3.1 h5.2 v5.2 H2.2 Z" fill="currentColor"/><path d="M7.4 4.2 l2.4 1.5 v5.2 l-2.4 -1.5 Z" fill="currentColor" opacity="0.5"/><path d="M3.4 8.3 h5.2 l2.4 1.5 H5.8 Z" fill="currentColor" opacity="0.28"/></svg>
        </button>
        <button class="icon-btn" :class="{ on: realtime }" :title="realtime ? '退出实时' : '实时定位到当前时间'" @click="toggleRealtime()">
          <svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.35" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6 3.35 V6.15 L8.05 7.35" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="6" r="0.85" fill="currentColor"/></svg>
        </button>
      </div>

      <div v-if="styleId !== 'sundial'" ref="trackRef" class="track-wrap" @pointerdown="onTrackPointerDown" @pointermove="onTrackPointerMove" @pointerup="onTrackPointerUp" @pointercancel="onTrackPointerUp" @wheel.prevent="onTrackWheel" @contextmenu.prevent>
        <div class="day-strip" :style="{ background: `linear-gradient(90deg, ${dayGradient})` }"></div>
        <div class="range-band" :style="rangeBand"></div>
        <div v-for="(t, i) in ticks" :key="i" class="tick" :class="{ major: t.major }" :style="{ left: t.pct + '%' }">
          <span v-if="t.label">{{ t.label }}</span>
        </div>
        <div ref="needleRef" class="needle" :style="{ left: needlePct + '%' }">
          <b></b>
          <em>{{ clockText.slice(11) }}</em>
        </div>
      </div>

      <div v-else class="sundial-box">
        <svg ref="sundialRef" class="sundial-svg" viewBox="0 0 360 220" @pointerdown="onSundialPointerDown" @pointermove="onSundialPointerMove" @pointerup="onTrackPointerUp" @pointercancel="onTrackPointerUp" @wheel.prevent="onSundialWheel" @contextmenu.prevent>
          <defs>
            <linearGradient id="arcMetal" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#8a6a32"/>
              <stop offset="50%" stop-color="#f3d48a"/>
              <stop offset="100%" stop-color="#8a6a32"/>
            </linearGradient>
            <radialGradient id="sunGrad" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stop-color="#fff4c8"/>
              <stop offset="55%" stop-color="#ffb03a"/>
              <stop offset="100%" stop-color="#c45a10"/>
            </radialGradient>
          </defs>
          <path :d="arcD" fill="none" stroke="url(#arcMetal)" stroke-width="10" stroke-linecap="round"/>
          <path :d="arcD" fill="none" stroke="rgba(255,220,140,0.35)" stroke-width="2" transform="translate(0,3)"/>
          <g v-for="(t, i) in sundialTicks" :key="i">
            <line :x1="t.a.x" :y1="t.a.y" :x2="t.b.x" :y2="t.b.y" stroke="#e7c984" stroke-width="1.4"/>
            <text :x="t.l.x" :y="t.l.y" text-anchor="middle" dominant-baseline="middle" fill="#d7c089" font-size="8">{{ t.label }}</text>
          </g>
          <line :x1="needleLine.a.x" :y1="needleLine.a.y" :x2="needleLine.b.x" :y2="needleLine.b.y" stroke="#ffd27a" stroke-width="2"/>
          <circle :cx="sunPos.x" :cy="sunPos.y" r="9" fill="url(#sunGrad)"/>
          <g transform="translate(180,168)">
            <circle r="34" fill="#14110c" stroke="#c4a05a" stroke-width="1.5"/>
            <line :x2="0" :y2="-18" stroke="#e8d5a4" stroke-width="2.2" stroke-linecap="round" :transform="`rotate(${analog.h})`"/>
            <line :x2="0" :y2="-24" stroke="#f3e6c0" stroke-width="1.4" stroke-linecap="round" :transform="`rotate(${analog.m})`"/>
            <line :x2="0" :y2="-26" stroke="#ffb03a" stroke-width="0.8" :transform="`rotate(${analog.s})`"/>
            <circle r="2.4" fill="#ffd27a"/>
          </g>
        </svg>
      </div>

      <div class="meta">
        <div class="speeds">
          <button v-for="s in SPEED_OPTIONS" :key="s.value" :class="{ on: multiplierAbs === s.value && !realtime }" @click="setSpeed(s.value)">{{ s.label }}</button>
        </div>
        <div class="readout">{{ clockText }}</div>
      </div>
    </div>

    <div v-if="statusMessage" class="status-mask">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.widget-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #152b4c; }
.cesium-container { width: 100%; height: 100%; }
.control-panel { position: absolute; top: 12px; left: 12px; z-index: 10; width: 268px; padding: 12px; border: 1px solid rgba(157, 188, 224, 0.28); border-radius: 9px; background: rgba(10, 26, 52, 0.86); backdrop-filter: blur(6px); color: #dce8f5; box-sizing: border-box; }
.panel-title { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.row-label { color: #c3d5e8; font-size: 11px; }
.seg { display: flex; gap: 4px; margin-top: 6px; }
.seg button { flex: 1; height: 24px; border: 1px solid rgba(157, 188, 224, 0.25); border-radius: 5px; background: rgba(8, 22, 44, 0.7); color: #c5d7ea; font-size: 10px; cursor: pointer; }
.seg button.on { background: #2f80ed; border-color: #5aa2ff; color: #fff; }
.hint { margin: 10px 0 0; font-size: 10px; color: #7f96b3; line-height: 1.55; }
.status-mask { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 9; width: max-content; max-width: 380px; padding: 8px 14px; border: 1px solid rgba(137,210,233,.4); border-radius: 7px; color: #e8f4fa; background: rgba(8, 21, 40, 0.88); box-shadow: 0 3px 12px rgba(0,0,0,.35); font-size: 12px; pointer-events: none; text-align: center; line-height: 1.5; }

.dock { position: absolute; left: 0; right: 0; bottom: 0; z-index: 11; display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; gap: 8px 12px; padding: 10px 14px 12px; user-select: none; touch-action: none; }
.transport { display: flex; align-items: center; gap: 4px; }
.icon-btn { width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 7px; background: transparent; color: inherit; cursor: pointer; }
.icon-btn svg { width: 12px; height: 12px; }
.icon-btn:hover, .icon-btn.on { background: rgba(255,255,255,0.12); }
.icon-btn.play { width: 32px; height: 32px; border-radius: 50%; }
.sep { width: 1px; height: 16px; margin: 0 4px; background: currentColor; opacity: 0.28; }
.track-wrap { position: relative; height: 54px; border-radius: 8px; overflow: hidden; cursor: ew-resize; }
.day-strip { position: absolute; left: 0; right: 0; top: 18px; height: 10px; opacity: 0.9; }
.range-band { position: absolute; top: 16px; height: 14px; border-radius: 7px; pointer-events: none; }
.tick { position: absolute; top: 8px; width: 1px; height: 8px; background: rgba(255,255,255,0.28); transform: translateX(-0.5px); }
.tick.major { height: 14px; background: rgba(255,255,255,0.7); }
.tick span { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); white-space: nowrap; font-size: 9px; letter-spacing: 0.02em; }
.needle { position: absolute; top: 0; bottom: 0; width: 12px; transform: translateX(-6px); pointer-events: none; }
.needle b { position: absolute; left: 5px; top: 4px; bottom: 4px; width: 2px; border-radius: 2px; }
.needle em { position: absolute; left: 50%; top: 0; transform: translateX(-50%); padding: 1px 5px; border-radius: 4px; font-style: normal; font-size: 9px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.meta { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.speeds { display: flex; flex-wrap: wrap; gap: 4px; }
.speeds button { height: 22px; padding: 0 8px; border-radius: 999px; border: 1px solid transparent; background: rgba(255,255,255,0.08); color: inherit; font-size: 10px; cursor: pointer; }
.speeds button.on { background: rgba(255,255,255,0.2); }
.readout { font-size: 12px; font-variant-numeric: tabular-nums; letter-spacing: 0.04em; }
.sundial-box { grid-column: 1 / -1; }
.sundial-svg { display: block; width: 100%; height: 168px; cursor: grab; }

.dock.aurora { background: linear-gradient(180deg, rgba(7, 28, 42, 0.55), rgba(4, 16, 28, 0.94)); border-top: 1px solid rgba(90, 255, 210, 0.28); box-shadow: 0 -18px 48px rgba(20, 255, 190, 0.08); color: #d7fff2; }
.dock.aurora .icon-btn.play { background: radial-gradient(circle at 40% 30%, #7dffd2, #1aa784); color: #06241c; }
.dock.aurora .day-strip { box-shadow: 0 0 16px rgba(80, 255, 210, 0.35); border-radius: 6px; }
.dock.aurora .range-band { background: rgba(90, 255, 210, 0.16); box-shadow: inset 0 0 0 1px rgba(120, 255, 220, 0.35); }
.dock.aurora .needle b { background: #9fffe0; box-shadow: 0 0 10px #5dffc8; }
.dock.aurora .needle em { background: rgba(8, 40, 34, 0.9); color: #bffff0; }
.dock.aurora .speeds button.on { background: #1aa784; color: #e9fff8; }

.dock.cinema { background: #100e0c; border-top: 1px solid #3d3428; color: #f0d9a8; box-shadow: 0 -16px 40px rgba(0,0,0,0.45); }
.dock.cinema .track-wrap { background: repeating-linear-gradient(90deg, #1a1612 0 7px, #100e0c 7px 18px); padding: 0; }
.dock.cinema .day-strip { top: 20px; height: 12px; opacity: 1; mix-blend-mode: screen; }
.dock.cinema .range-band { background: rgba(255, 176, 48, 0.18); }
.dock.cinema .tick { background: #5a4c3a; }
.dock.cinema .tick.major { background: #e2c48a; }
.dock.cinema .needle b { width: 3px; left: 4.5px; background: #ffb000; }
.dock.cinema .needle em { background: #ffb000; color: #1a1206; font-weight: 700; }
.dock.cinema .icon-btn.play { background: #ffb000; color: #1a1206; }
.dock.cinema .speeds button.on { background: #ffb000; color: #1a1206; }
.dock.cinema .readout { letter-spacing: 0.12em; text-transform: uppercase; font-size: 11px; }

.dock.sundial { left: 50%; right: auto; width: min(440px, calc(100% - 24px)); transform: translateX(-50%); bottom: 10px; border-radius: 18px 18px 10px 10px; background: radial-gradient(circle at 50% 120%, #2a2114, #0d0b08 62%); border: 1px solid #7a6236; color: #e7d3a1; padding-bottom: 10px; grid-template-columns: 1fr; }
.dock.sundial .transport { justify-content: center; }
.dock.sundial .icon-btn.play { background: linear-gradient(180deg, #f3d48a, #b8862e); color: #2a1c08; }
.dock.sundial .speeds button.on { background: #c4a05a; color: #1a140a; }
.dock.sundial .readout { color: #f3e1b0; }
</style>
