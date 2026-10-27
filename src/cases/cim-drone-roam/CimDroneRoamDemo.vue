<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as Cesium from 'cesium'
import { createMapScene, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'

type Waypoint = { lon: number; lat: number; height: number }

const MODEL_URL = '/models/flying_drone/drone_lite.glb'
const SECONDS_PER_SAMPLE = 0.55
const SAMPLE_COUNT = 240

const WAYPOINTS: Waypoint[] = [
  { lon: 108.93, lat: 34.196, height: 360 },
  { lon: 108.964, lat: 34.188, height: 520 },
  { lon: 108.998, lat: 34.214, height: 720 },
  { lon: 108.992, lat: 34.246, height: 860 },
  { lon: 108.958, lat: 34.256, height: 640 },
  { lon: 108.924, lat: 34.232, height: 430 }
]

const container = ref<HTMLElement>()
const statusMessage = ref('')
const modelState = ref('待开始')
const playing = ref(false)
const followEnabled = ref(true)
const speed = ref(6)
const progress = ref(0)
const cameraBack = ref(220)
const cameraUp = ref(80)
const cameraRight = ref(0)
const readout = ref('尚未开始')
const totalDuration = ref('0.0')

let viewer: ReturnType<typeof createMapScene> | undefined
let startTime: Cesium.JulianDate | undefined
let stopTime: Cesium.JulianDate | undefined
let totalSeconds = 0
let positionProperty: Cesium.SampledPositionProperty | undefined
let routeEntity: Cesium.Entity | undefined
let overviewEntity: Cesium.Entity | undefined
let startMarker: Cesium.Entity | undefined
let tickListener: ((clock: Cesium.Clock) => void) | undefined
let followListener: (() => void) | undefined
let disposed = false
let hasStarted = false

const scratchMatrix = new Cesium.Matrix4()
const scratchRotation = new Cesium.Matrix3()
const scratchOffset = new Cesium.Cartesian3()
const scratchForward = new Cesium.Cartesian3()
const scratchRight = new Cesium.Cartesian3()
const scratchUp = new Cesium.Cartesian3()
const scratchEnuMatrix = new Cesium.Matrix4()
const scratchEnuRotation = new Cesium.Matrix3()
const scratchTransformValues = new Array<number>(16).fill(0)

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

function buildSamples(): Waypoint[] {
  const count = WAYPOINTS.length
  const samples: Waypoint[] = []
  for (let i = 0; i <= SAMPLE_COUNT; i += 1) {
    const t = (i / SAMPLE_COUNT) * count
    const segment = Math.floor(t) % count
    const local = t - Math.floor(t)
    const p0 = WAYPOINTS[(segment - 1 + count) % count]
    const p1 = WAYPOINTS[segment]
    const p2 = WAYPOINTS[(segment + 1) % count]
    const p3 = WAYPOINTS[(segment + 2) % count]
    samples.push({
      lon: catmullRom(p0.lon, p1.lon, p2.lon, p3.lon, local),
      lat: catmullRom(p0.lat, p1.lat, p2.lat, p3.lat, local),
      height: catmullRom(p0.height, p1.height, p2.height, p3.height, local)
    })
  }
  return samples
}

function createRoute(): void {
  if (!viewer || viewer.isDestroyed()) return
  const samples = buildSamples()
  totalSeconds = SAMPLE_COUNT * SECONDS_PER_SAMPLE * 1.02
  totalDuration.value = totalSeconds.toFixed(1)
  startTime = Cesium.JulianDate.fromDate(new Date())
  stopTime = Cesium.JulianDate.addSeconds(startTime, totalSeconds, new Cesium.JulianDate())

  const property = new Cesium.SampledPositionProperty()
  property.setInterpolationOptions({
    interpolationDegree: 3,
    interpolationAlgorithm: Cesium.LagrangePolynomialApproximation
  })
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]
    const time = Cesium.JulianDate.addSeconds(startTime, i * SECONDS_PER_SAMPLE, new Cesium.JulianDate())
    property.addSample(time, Cesium.Cartesian3.fromDegrees(sample.lon, sample.lat, sample.height))
  }
  positionProperty = property

  const baseOrientation = new Cesium.VelocityOrientationProperty(property)

  routeEntity = viewer.entities.add({
    availability: new Cesium.TimeIntervalCollection([
      new Cesium.TimeInterval({ start: startTime, stop: stopTime })
    ]),
    position: property,
    orientation: baseOrientation,
    model: {
      uri: MODEL_URL,
      minimumPixelSize: 64,
      maximumScale: 400,
      scale: 12
    },
    path: {
      resolution: 2,
      width: 5,
      leadTime: 0,
      trailTime: 38,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.18,
        taperPower: 0.55,
        color: Cesium.Color.fromCssColorString('#5fffe0')
      })
    }
  })

  const flat: number[] = []
  for (const sample of samples) {
    flat.push(sample.lon, sample.lat, sample.height)
  }
  overviewEntity = viewer.entities.add({
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat),
      width: 2,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString('#6ee7ff').withAlpha(0.5),
        dashLength: 26
      })
    }
  })

  startMarker = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(samples[0].lon, samples[0].lat, samples[0].height),
    point: {
      pixelSize: 9,
      color: Cesium.Color.fromCssColorString('#5fffe0'),
      outlineColor: Cesium.Color.fromCssColorString('#062031'),
      outlineWidth: 2
    },
    label: {
      text: '航线起点',
      font: '600 12px "Microsoft YaHei", sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.fromCssColorString('#062031'),
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -18),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  })

  viewer.clock.startTime = startTime.clone()
  viewer.clock.stopTime = stopTime.clone()
  viewer.clock.currentTime = startTime.clone()
  viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP
  viewer.clock.multiplier = speed.value
  viewer.clock.shouldAnimate = false
  progress.value = 0
  readout.value = '航线已就绪'
  modelState.value = '待开始'
}

function removeRoute(): void {
  if (!viewer || viewer.isDestroyed()) return
  for (const entity of [routeEntity, overviewEntity, startMarker]) {
    if (entity) viewer.entities.remove(entity)
  }
  routeEntity = undefined
  overviewEntity = undefined
  startMarker = undefined
  positionProperty = undefined
}

function updateReadout(): void {
  if (!viewer || viewer.isDestroyed() || !startTime || !positionProperty) return
  const time = viewer.clock.currentTime
  const position = positionProperty.getValue(time)
  if (position) {
    const cartographic = Cesium.Cartographic.fromCartesian(position)
    const lon = Cesium.Math.toDegrees(cartographic.longitude)
    const lat = Cesium.Math.toDegrees(cartographic.latitude)
    readout.value = `${lon.toFixed(4)}, ${lat.toFixed(4)} · ${Math.round(cartographic.height)} m`
  }
  if (!playing.value) return
  const elapsed = Cesium.JulianDate.secondsDifference(time, startTime)
  progress.value = Math.max(0, Math.min(100, (elapsed / totalSeconds) * 100))
}

function applyFollow(): void {
  if (!viewer || viewer.isDestroyed() || !followEnabled.value || !routeEntity) return
  const time = viewer.clock.currentTime
  const position = routeEntity.position?.getValue(time)
  const orientation = routeEntity.orientation?.getValue(time)
  if (!position || !orientation) return
  Cesium.Matrix3.fromQuaternion(orientation, scratchRotation)
  Cesium.Matrix3.getColumn(scratchRotation, 0, scratchForward)
  Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(position, scratchUp)
  const verticalPart = Cesium.Cartesian3.dot(scratchForward, scratchUp)
  Cesium.Cartesian3.multiplyByScalar(scratchUp, verticalPart, scratchRight)
  Cesium.Cartesian3.subtract(scratchForward, scratchRight, scratchForward)
  if (Cesium.Cartesian3.magnitudeSquared(scratchForward) < 1e-10) {
    Cesium.Transforms.eastNorthUpToFixedFrame(position, Cesium.Ellipsoid.WGS84, scratchEnuMatrix)
    Cesium.Matrix4.getMatrix3(scratchEnuMatrix, scratchEnuRotation)
    Cesium.Matrix3.getColumn(scratchEnuRotation, 0, scratchForward)
  }
  Cesium.Cartesian3.normalize(scratchForward, scratchForward)
  Cesium.Cartesian3.cross(scratchUp, scratchForward, scratchRight)
  Cesium.Cartesian3.normalize(scratchRight, scratchRight)

  scratchTransformValues[0] = scratchForward.x
  scratchTransformValues[1] = scratchForward.y
  scratchTransformValues[2] = scratchForward.z
  scratchTransformValues[3] = 0
  scratchTransformValues[4] = scratchRight.x
  scratchTransformValues[5] = scratchRight.y
  scratchTransformValues[6] = scratchRight.z
  scratchTransformValues[7] = 0
  scratchTransformValues[8] = scratchUp.x
  scratchTransformValues[9] = scratchUp.y
  scratchTransformValues[10] = scratchUp.z
  scratchTransformValues[11] = 0
  scratchTransformValues[12] = position.x
  scratchTransformValues[13] = position.y
  scratchTransformValues[14] = position.z
  scratchTransformValues[15] = 1
  Cesium.Matrix4.fromArray(scratchTransformValues, 0, scratchMatrix)

  scratchOffset.x = -cameraBack.value
  scratchOffset.y = -cameraRight.value
  scratchOffset.z = cameraUp.value
  viewer.camera.lookAtTransform(scratchMatrix, scratchOffset)
}

function startRoam(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (!routeEntity) createRoute()
  if (!hasStarted) {
    viewer.clock.currentTime = viewer.clock.startTime.clone()
    hasStarted = true
  }
  viewer.clock.multiplier = speed.value
  viewer.clock.shouldAnimate = true
  playing.value = true
  modelState.value = '巡航中'
  if (followEnabled.value) applyFollow()
}

function pauseRoam(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.clock.shouldAnimate = false
  playing.value = false
  modelState.value = '已暂停'
}

function stopRoam(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.clock.shouldAnimate = false
  playing.value = false
  removeRoute()
  hasStarted = false
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  progress.value = 0
  readout.value = '尚未开始'
  modelState.value = '待开始'
  flyToOverview()
}

function toggleFollow(): void {
  if (!viewer || viewer.isDestroyed()) return
  if (!followEnabled.value) {
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  } else {
    applyFollow()
  }
}

function onSeek(): void {
  if (!viewer || viewer.isDestroyed() || !startTime) return
  viewer.clock.shouldAnimate = false
  playing.value = false
  hasStarted = true
  const seconds = (progress.value / 100) * totalSeconds
  viewer.clock.currentTime = Cesium.JulianDate.addSeconds(startTime, seconds, new Cesium.JulianDate())
  updateReadout()
}

function onSpeedChange(): void {
  if (viewer && !viewer.isDestroyed()) viewer.clock.multiplier = speed.value
}

function flyToOverview(): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(108.961, 34.222, 16000),
    orientation: {
      heading: 0,
      pitch: -Math.PI / 2,
      roll: 0
    },
    duration: 1.2
  })
}

function showOverview(): void {
  if (!viewer || viewer.isDestroyed()) return
  followEnabled.value = false
  flyToOverview()
}

onMounted(() => {
  if (!container.value) return
  const sceneCallbacks: SceneCallbacks = {
    onStatus: (message) => {
      statusMessage.value = message
    },
    onBasemapReady: () => {
      statusMessage.value = ''
    }
  }
  try {
    viewer = createMapScene(container.value, sceneCallbacks)
    loadBingImagery(viewer, sceneCallbacks)
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(108.961, 34.222, 16000),
      orientation: {
        heading: 0,
        pitch: -Math.PI / 2,
        roll: 0
      }
    })
    createRoute()
    tickListener = () => updateReadout()
    viewer.clock.onTick.addEventListener(tickListener)
    followListener = () => applyFollow()
    viewer.scene.preRender.addEventListener(followListener)
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : String(error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (viewer && !viewer.isDestroyed()) {
    if (tickListener) viewer.clock.onTick.removeEventListener(tickListener)
    if (followListener) viewer.scene.preRender.removeEventListener(followListener)
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
    removeRoute()
  }
  tickListener = undefined
  followListener = undefined
  destroyScene(viewer)
  viewer = undefined
  void disposed
})
</script>

<template>
  <div class="cdr-shell">
    <div ref="container" class="cesium-container"></div>

    <div class="cdr-panel">
      <div class="panel-title">无人机航线漫游</div>
      <div class="panel-subtitle">闭合航线 · 跟随视角</div>

      <div class="section-title">状态</div>
      <div class="cdr-metrics">
        <div><span>任务</span><strong>{{ modelState }}</strong></div>
        <div><span>单圈</span><strong>{{ totalDuration }} s</strong></div>
      </div>
      <div class="cdr-hint">{{ readout }}</div>

      <div class="section-title">控制</div>
      <div class="cdr-row">
        <button class="cdr-btn" @click="startRoam">开始</button>
        <button class="cdr-btn ghost" @click="pauseRoam">暂停</button>
        <button class="cdr-btn ghost" @click="stopRoam">停止</button>
      </div>
      <div class="cdr-param">
        <span>进度</span>
        <input v-model.number="progress" type="range" min="0" max="100" step="0.5" @input="onSeek" />
        <b>{{ progress.toFixed(0) }}%</b>
      </div>
      <div class="cdr-param">
        <span>倍速</span>
        <input v-model.number="speed" type="range" min="1" max="18" step="1" @input="onSpeedChange" />
        <b>{{ speed }}x</b>
      </div>

      <div class="section-title">跟随</div>
      <button class="cdr-toggle" :class="{ on: followEnabled }" @click="followEnabled = !followEnabled; toggleFollow()">
        {{ followEnabled ? '跟随视角: 开' : '跟随视角: 关' }}
      </button>
      <div class="cdr-param">
        <span>后撤距离</span>
        <input v-model.number="cameraBack" type="range" min="40" max="380" step="10" />
        <b>{{ cameraBack }}</b>
      </div>
      <div class="cdr-param">
        <span>抬高距离</span>
        <input v-model.number="cameraUp" type="range" min="0" max="180" step="5" />
        <b>{{ cameraUp }}</b>
      </div>
      <div class="cdr-param">
        <span>横向偏移</span>
        <input v-model.number="cameraRight" type="range" min="-120" max="120" step="5" />
        <b>{{ cameraRight }}</b>
      </div>

      <button class="cdr-btn ghost" @click="showOverview">总览视角</button>
      <div class="cdr-hint">拖动进度会暂停巡航；关闭跟随后可自由旋转视角</div>
    </div>

    <div v-if="statusMessage" class="cdr-status">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.cdr-shell { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border-radius: 8px; background: #061421; color: #e8fbff; font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; }
.cesium-container { width: 100%; height: 100%; }
.cdr-panel { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; flex-direction: column; gap: 7px; width: 248px; max-height: calc(100% - 24px); overflow-y: auto; padding: 11px; border: 1px solid rgba(91, 255, 226, 0.28); border-radius: 9px; background: rgba(8, 28, 43, 0.9); backdrop-filter: blur(6px); }
.panel-title { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
.panel-subtitle { font-size: 11px; color: #7da9b8; }
.section-title { margin-top: 4px; padding: 2px 0 1px; border-bottom: 1px solid rgba(91, 255, 226, 0.18); font-size: 11px; font-weight: 700; color: #5fffe0; }
.cdr-row { display: flex; gap: 6px; }
.cdr-btn { flex: 1; height: 26px; padding: 0 8px; border: 0; border-radius: 5px; background: #257f9e; color: #edfaff; cursor: pointer; font-size: 11px; }
.cdr-btn.ghost { background: rgba(13, 42, 58, 0.78); border: 1px solid rgba(91, 255, 226, 0.24); color: #b9dce7; }
.cdr-toggle { height: 26px; border: 1px solid rgba(91, 255, 226, 0.24); border-radius: 5px; background: rgba(13, 42, 58, 0.78); color: #7da9b8; font-size: 11px; cursor: pointer; }
.cdr-toggle.on { color: #e8fbff; border-color: #5fffe0; }
.cdr-param { display: flex; align-items: center; gap: 8px; }
.cdr-param span { flex: 0 0 62px; font-size: 11px; color: #bdd9e4; }
.cdr-param input { flex: 1; min-width: 0; height: 4px; accent-color: #5fffe0; }
.cdr-param b { flex: 0 0 38px; color: #9cc9d8; font-size: 10px; text-align: right; }
.cdr-hint { padding: 4px 7px; border-radius: 5px; background: rgba(13, 42, 58, 0.6); color: #7da9b8; font-size: 11px; line-height: 1.4; }
.cdr-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.cdr-metrics > div { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border: 1px solid rgba(54, 141, 255, 0.18); border-radius: 6px; background: rgba(13, 42, 58, 0.6); }
.cdr-metrics span { font-size: 10px; color: #7da9b8; }
.cdr-metrics strong { font-size: 12px; color: #e8fbff; }
.cdr-status { position: absolute; inset: 0; z-index: 9; display: grid; place-items: center; padding: 24px; color: #d9eff6; background: rgba(4, 23, 37, 0.72); font-size: 12px; }
</style>
