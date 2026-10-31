<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import {
  Cartesian3,
  Cartographic,
  Color,
  HeadingPitchRoll,
  HeightReference,
  Math as CesiumMath,
  Matrix4,
  Transforms,
  sampleTerrainMostDetailed
} from 'cesium'
import CesiumDrone, { jammingAt } from '../cesium-helpers-lib/packages/cesium-drone/src/cesium-drone.js'
import {
  AnalogVideo,
  DigitalVideo,
  DroneDisplay,
  Jello,
  LensDistortion,
  MotionBlur,
  Precipitation,
  SpeedLines
} from '../cesium-helpers-lib/packages/cesium-post-process/src/cesium-post-process.js'
import { useHelperViewer } from '../cesium-helpers-lib/use-helper-viewer'
import HelperToggle from '../cesium-helpers-lib/HelperToggle.vue'
import '../cesium-helpers-lib/helper-ui.css'

type Effect = { active: boolean }
type Drone = {
  active: boolean
  collision: boolean
  rxLoss: boolean
  speed: number
  boostSpeed: number
  speedNow: number
  heightNow?: number
  layout: 'game' | 'mode2'
  crashed: { addEventListener(fn: () => void): void }
  respawn(position?: Cartesian3): void
}
type VideoEffect = Effect & { interference: number; breakup: number }

const OBSTACLES = [
  { ahead: 60, right: 0, width: 16, depth: 10, height: 12, bottom: -1, alpha: 1 },
  { ahead: 40, right: -30, width: 14, depth: 14, height: 1, bottom: 8, alpha: 1 },
  { ahead: 40, right: 30, width: 14, depth: 10, height: 12, bottom: -1, alpha: 0.5 }
]
const JAMMERS = [
  { longitude: 6.56, latitude: 46.77, range: 2000 },
  { longitude: 6.497, latitude: 46.803, range: 2000 },
  { longitude: 6.532, latitude: 46.725, range: 2000 }
]
const RX_LOSS = 0.8
const RX_LOSS_DISTANCE = 790

const container = ref<HTMLElement | null>(null)
const active = ref(false)
const collision = ref(true)
const rain = ref(false)
const video = ref<'analog' | 'digital'>('analog')
const layout = ref<'game' | 'mode2'>('game')
const lost = ref(false)
const speedText = ref('')

let drone: Drone | null = null
let precipitation: Effect | null = null
let motionBlur: Effect | null = null
let speedLines: Effect | null = null
let lensDistortion: Effect | null = null
let jello: Effect | null = null
let droneDisplay: Effect | null = null
let analogVideo: VideoEffect | null = null
let digitalVideo: VideoEffect | null = null
let syncStack: (() => void) | null = null
let lostTimer: number | undefined

const { viewer, status } = useHelperViewer(container, {}, async (instance) => {
  const [field] = await sampleTerrainMostDetailed(instance.terrainProvider, [Cartographic.fromDegrees(6.535, 46.78)])
  const takeOff = Cartesian3.fromRadians(field.longitude, field.latitude, (field.height ?? 0) + 2)
  const heading = CesiumMath.toRadians(120)
  instance.camera.cancelFlight()
  instance.camera.setView({ destination: takeOff, orientation: { heading, pitch: 0, roll: 0 } })

  const frame = Transforms.eastNorthUpToFixedFrame(takeOff)
  const grounds = await sampleTerrainMostDetailed(
    instance.terrainProvider,
    OBSTACLES.map(({ ahead, right }) => {
      const east = ahead * Math.sin(heading) + right * Math.cos(heading)
      const north = ahead * Math.cos(heading) - right * Math.sin(heading)
      return Cartographic.fromCartesian(Matrix4.multiplyByPoint(frame, new Cartesian3(east, north, 0), new Cartesian3()))
    })
  )
  OBSTACLES.forEach(({ width, depth, height, bottom, alpha }, index) => {
    const spot = grounds[index]
    const position = Cartesian3.fromRadians(spot.longitude, spot.latitude, (spot.height ?? 0) + bottom + height / 2)
    instance.entities.add({
      position,
      orientation: Transforms.headingPitchRollQuaternion(position, new HeadingPitchRoll(heading, 0, 0)),
      box: { dimensions: new Cartesian3(width, depth, height), material: Color.ORANGE.withAlpha(alpha) }
    })
  })

  const quad = new CesiumDrone(instance, { speed: 19, boostSpeed: 41, collision: collision.value }) as Drone
  drone = quad

  JAMMERS.forEach(({ longitude, latitude, range }) => {
    const position = Cartesian3.fromDegrees(longitude, latitude)
    instance.entities.add({
      position,
      point: {
        pixelSize: 12,
        color: Color.RED,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      ellipse: { semiMajorAxis: range, semiMinorAxis: range, material: Color.RED.withAlpha(0.15) }
    })
    instance.entities.add({
      position,
      ellipse: { semiMajorAxis: RX_LOSS_DISTANCE, semiMinorAxis: RX_LOSS_DISTANCE, material: Color.RED.withAlpha(0.3) }
    })
  })

  precipitation = new Precipitation(instance, { intensity: 0.5 }) as Effect
  motionBlur = new MotionBlur(instance, { exposure: 0.04 }) as Effect
  speedLines = new SpeedLines(instance) as Effect
  lensDistortion = new LensDistortion(instance, { distortion: 0.8 }) as Effect
  jello = new Jello(instance) as Effect
  droneDisplay = new DroneDisplay(instance) as Effect
  analogVideo = new AnalogVideo(instance) as unknown as VideoEffect
  digitalVideo = new DigitalVideo(instance) as unknown as VideoEffect

  const videoEffect = () => (video.value === 'analog' ? analogVideo : digitalVideo)
  syncStack = () => {
    const stack = [motionBlur, speedLines, lensDistortion, jello, droneDisplay, analogVideo, digitalVideo]
    stack.forEach((effect) => effect && (effect.active = false))
    const shown = [motionBlur, speedLines, lensDistortion, jello, droneDisplay, videoEffect()]
    shown.forEach((effect) => effect && (effect.active = true))
  }
  syncStack()
  precipitation.active = rain.value

  ;(instance.camera.frustum as { fov: number }).fov = CesiumMath.toRadians(115)

  quad.crashed.addEventListener(() => {
    if (analogVideo) analogVideo.interference = 1
    if (digitalVideo) digitalVideo.breakup = 1
    lost.value = true
    const jammed = quad.rxLoss
    window.clearTimeout(lostTimer)
    lostTimer = window.setTimeout(() => {
      lost.value = false
      if (digitalVideo) digitalVideo.breakup = 0.5
      quad.respawn(jammed ? takeOff : undefined)
    }, 1000)
  })

  const tick = () => {
    if (lost.value) return
    const fullBoost = quad.boostSpeed
    const speed = quad.speedNow
    const fast = CesiumMath.clamp((speed - 10) / (fullBoost - 10), 0, 1)
    if (motionBlur) (motionBlur as MotionBlur & { strength: number }).strength = fast
    if (speedLines) (speedLines as SpeedLines & { strength: number }).strength = 0.4 * CesiumMath.clamp((speed - quad.speed) / (fullBoost - quad.speed), 0, 1)
    if (jello) (jello as Jello & { amount: number }).amount = 0.05 + 0.15 * CesiumMath.clamp(speed / fullBoost, 0, 1)
    const height = quad.heightNow ?? 30
    const low = 0.05 + 0.3 * CesiumMath.clamp((30 - height) / 28, 0, 1)
    const jamming = jammingAt(instance.scene.globe, instance.camera.positionWC, JAMMERS)
    if (analogVideo) analogVideo.interference = Math.max(low, jamming)
    quad.rxLoss = jamming >= RX_LOSS
    if (droneDisplay) (droneDisplay as DroneDisplay & { rxLoss: boolean }).rxLoss = quad.rxLoss
    speedText.value = `${(speed * 3.6).toFixed(0)} km/h`
  }
  instance.clock.onTick.addEventListener(tick)

  // 等瓦片加载完再启动，避免一上来就掉进还没加载的地形；最多等 12 秒
  const globe = instance.scene.globe
  if (!globe.tilesLoaded) {
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(finish, 12000)
      function finish(): void {
        window.clearTimeout(timer)
        remove()
        resolve()
      }
      const remove = globe.tileLoadProgressEvent.addEventListener((count: number) => {
        if (count === 0) finish()
      })
      if (globe.tilesLoaded) finish()
    })
  }
  quad.active = active.value

  return () => {
    instance.clock.onTick.removeEventListener(tick)
    window.clearTimeout(lostTimer)
    quad.active = false
    ;[precipitation, motionBlur, speedLines, lensDistortion, jello, droneDisplay, analogVideo, digitalVideo].forEach((effect) => {
      if (effect) effect.active = false
    })
    drone = null
    syncStack = null
  }
})

function toggleActive(value: boolean): void {
  active.value = value
  if (drone) drone.active = value
}

function toggleCollision(value: boolean): void {
  collision.value = value
  if (drone) drone.collision = value
}

function toggleRain(value: boolean): void {
  rain.value = value
  if (precipitation) precipitation.active = value
}

function setVideo(value: 'analog' | 'digital'): void {
  video.value = value
  if (analogVideo) analogVideo.active = false
  if (digitalVideo) digitalVideo.active = false
  const effect = value === 'analog' ? analogVideo : digitalVideo
  if (effect) effect.active = true
}

function setLayout(value: 'game' | 'mode2'): void {
  layout.value = value
  if (drone) drone.layout = value
}

onBeforeUnmount(() => {
  window.clearTimeout(lostTimer)
  if (drone) drone.active = false
})
</script>

<template>
  <div class="helper-shell">
    <div ref="container" class="helper-canvas"></div>

    <div class="helper-panel">
      <div class="helper-title">穿越机模拟</div>
      <p class="helper-hint">
        W/S 升降，A/D 转向，方向键前后左右，R/F 俯仰相机，Shift 加速。红色区域是干扰场，信号过低会失联坠机。
      </p>
      <HelperToggle :model-value="active" label="启动飞行" @update:model-value="toggleActive" />
      <HelperToggle :model-value="collision" label="障碍碰撞" @update:model-value="toggleCollision" />
      <HelperToggle :model-value="rain" label="降雨" @update:model-value="toggleRain" />
      <div class="helper-field">
        <span class="helper-row-label">图传</span>
        <select class="helper-select" :value="video" @change="setVideo(($event.target as HTMLSelectElement).value as 'analog' | 'digital')">
          <option value="analog">模拟图传</option>
          <option value="digital">数字图传</option>
        </select>
      </div>
      <div class="helper-field">
        <span class="helper-row-label">摇杆布局</span>
        <select class="helper-select" :value="layout" @change="setLayout(($event.target as HTMLSelectElement).value as 'game' | 'mode2')">
          <option value="game">游戏手柄</option>
          <option value="mode2">遥控器 Mode 2</option>
        </select>
      </div>
      <div class="helper-row">
        <span class="helper-row-label">速度</span>
        <span class="helper-value">{{ speedText || '—' }}</span>
      </div>
    </div>

    <div v-if="lost" class="helper-status">信号丢失，正在重启…</div>
    <div v-else-if="status" class="helper-status">{{ status }}</div>
  </div>
</template>
