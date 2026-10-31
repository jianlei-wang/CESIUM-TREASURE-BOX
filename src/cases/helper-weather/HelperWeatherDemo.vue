<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  Cartesian3,
  ClockRange,
  JulianDate,
  Math as CesiumMath,
  type Viewer
} from 'cesium'
import CesiumAudio from '../cesium-helpers-lib/packages/cesium-audio/src/cesium-audio.js'
import {
  Clouds,
  Lightning,
  Precipitation
} from '../cesium-helpers-lib/packages/cesium-post-process/src/cesium-post-process.js'
import { hourlyRadarMap, latestHour, type RadarMap } from '../cesium-helpers-lib/meteoswiss'
import { useHelperViewer } from '../cesium-helpers-lib/use-helper-viewer'
import HelperToggle from '../cesium-helpers-lib/HelperToggle.vue'
import '../cesium-helpers-lib/helper-ui.css'

type MapEffect = {
  active: boolean
  map?: RadarMap
  nextMap?: RadarMap
  mapBlend: number
}
type PrecipitationEffect = MapEffect & { localIntensity: number; cloudBase: number }
type LightningEffect = MapEffect & {
  intensity: number
  strikeEvent: { addEventListener(fn: (ground: Cartesian3) => void): void }
}
type Audio = { active: boolean }

const SPEED_OF_SOUND = 343
const THUNDER_RANGE = 20000
const RAIN_GAIN = 0.5
const HOUR = 3600 * 1000
const FRAME_DURATION = 700
const PRELOAD = 3
const MAX_FAILURES = 3
const LAST = 167

const container = ref<HTMLElement | null>(null)
const loading = ref(true)
const playing = ref(false)
const index = ref(LAST)
const hourLabel = ref('正在载入雷达…')
const soundOn = ref(false)
const available = ref(false)

let viewerRef: Viewer | null = null
let clouds: (MapEffect & { active: boolean }) | null = null
let precipitation: PrecipitationEffect | null = null
let lightning: LightningEffect | null = null
let audioContext: AudioContext | undefined
let rainGain: GainNode | undefined
let thunderBuffer: Promise<AudioBuffer> | undefined
let first: Date | undefined
let run = 0
let failures = 0
let disposed = false
let tickListener: (() => void) | undefined
let postRender: (() => void) | undefined

const hourFormatter = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })

function hourAt(i: number): Date {
  return new Date((first as Date).getTime() + i * HOUR)
}

function indexAt(time: JulianDate): number {
  const millis = JulianDate.toDate(time).getTime() - (first as Date).getTime()
  return CesiumMath.clamp(Math.floor(millis / HOUR) + 1, 0, LAST)
}

function describeHour(i: number): string {
  const end = hourAt(i)
  const start = new Date(end.getTime() - HOUR)
  const day = start.toLocaleDateString('zh-CN', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${day} · ${hourFormatter.formatRange(start, end)}`
}

const sliderPercent = computed(() => (100 * index.value) / LAST)
const canStep = computed(() => available.value && !loading.value)

const { status } = useHelperViewer(container, {}, async (instance) => {
  viewerRef = instance
  // 全国俯瞰、正对地面：雷达的雨与云一屏可见
  instance.camera.setView({
    destination: Cartesian3.fromDegrees(8.9, 46.95, 520000),
    orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 }
  })

  const cloudEffect = new Clouds(instance, { wind: 0.05, drift: 15 }) as unknown as MapEffect
  const rainEffect = new Precipitation(instance, { intensity: 1 }) as unknown as PrecipitationEffect
  const boltEffect = new Lightning(instance, { intensity: 0, radius: 30000 }) as unknown as LightningEffect
  clouds = cloudEffect
  precipitation = rainEffect
  lightning = boltEffect
  cloudEffect.active = true
  rainEffect.active = true
  boltEffect.active = true

  const clock = instance.clock
  clock.multiplier = HOUR / FRAME_DURATION
  clock.clockRange = ClockRange.LOOP_STOP
  instance.scene.maximumRenderTimeChange = 300

  boltEffect.strikeEvent.addEventListener((ground) => {
    void handleThunder(ground)
  })

  tickListener = () => {
    if (!clock.shouldAnimate) return
    const i = indexAt(clock.currentTime)
    if (i !== index.value) {
      void step(i)
    } else {
      // 从这一小时开始时的图和下一小时的图之间混合；暂停时保持不动
      const blend = CesiumMath.clamp(
        (JulianDate.toDate(clock.currentTime).getTime() - hourAt(i).getTime()) / HOUR + 1,
        0,
        1
      )
      if (precipitation) precipitation.mapBlend = blend
      if (clouds) clouds.mapBlend = blend
    }
  }
  clock.onTick.addEventListener(tickListener)

  postRender = () => {
    if (!audioContext || audioContext.state !== 'running' || !rainGain || !precipitation) return
    const below = instance.scene.camera.positionCartographic.height < precipitation.cloudBase
    rainGain.gain.setTargetAtTime(
      below ? RAIN_GAIN * precipitation.localIntensity : 0,
      audioContext.currentTime,
      0.1
    )
  }
  instance.scene.postRender.addEventListener(postRender)

  try {
    const latest = await latestHour()
    if (disposed) return
    first = new Date(latest.getTime() - LAST * HOUR)
    clock.startTime = JulianDate.fromDate(hourAt(-1))
    clock.stopTime = JulianDate.fromDate(latest)
    available.value = true
    syncClock()
    await showHour()
  } catch (error) {
    console.error(error)
    hourLabel.value = '雷达暂不可用'
    loading.value = false
  }

  return () => {
    disposed = true
    run++
    clock.onTick.removeEventListener(tickListener as never)
    if (postRender) instance.scene.postRender.removeEventListener(postRender)
    tickListener = undefined
    postRender = undefined
    if (clouds) clouds.active = false
    if (precipitation) precipitation.active = false
    if (lightning) lightning.active = false
    clouds = null
    precipitation = null
    lightning = null
    viewerRef = null
    void audioContext?.close()
    audioContext = undefined
    rainGain = undefined
  }
})

function syncClock(): void {
  const instance = viewerRef
  if (!instance || !first) return
  instance.clock.currentTime = JulianDate.fromDate(new Date(hourAt(index.value).getTime() - HOUR / 2))
}

async function showHour(): Promise<boolean> {
  if (!first) return false
  const i = index.value
  loading.value = true
  hourLabel.value = `${describeHour(i)} · 载入中…`
  try {
    const map = await hourlyRadarMap(hourAt(i))
    if (i !== index.value) return false
    if (precipitation) {
      precipitation.map = map
      precipitation.nextMap = undefined
      precipitation.mapBlend = 0
    }
    if (clouds) {
      clouds.map = map
      clouds.nextMap = undefined
      clouds.mapBlend = 0
    }
    if (lightning) {
      lightning.map = map
      lightning.intensity = 1
    }
    hourLabel.value = describeHour(i)
    return true
  } catch (error) {
    console.error(error)
    if (i === index.value) hourLabel.value = `${describeHour(i)} · 没有雷达数据`
    return false
  } finally {
    if (i === index.value) loading.value = false
  }
}

function setPlaying(value: boolean): void {
  const instance = viewerRef
  if (!instance) return
  playing.value = value
  run++
  failures = 0
  instance.clock.shouldAnimate = value
}

async function step(i: number): Promise<void> {
  const instance = viewerRef
  if (!instance) return
  const current = run
  instance.clock.shouldAnimate = false
  index.value = i
  const loaded = await showHour()
  if (current !== run) return
  failures = loaded ? 0 : failures + 1
  if (failures === MAX_FAILURES) {
    setPlaying(false)
    return
  }
  for (let ahead = 1; ahead <= PRELOAD; ahead++) {
    hourlyRadarMap(hourAt((i + ahead) % (LAST + 1))).catch(() => {})
  }
  hourlyRadarMap(hourAt((i + 1) % (LAST + 1))).then(
    (next) => {
      if (current !== run || i !== index.value) return
      if (precipitation) precipitation.nextMap = next
      if (clouds) clouds.nextMap = next
    },
    () => {}
  )
  instance.clock.shouldAnimate = true
}

function goTo(i: number): void {
  setPlaying(false)
  index.value = CesiumMath.clamp(i, 0, LAST)
  syncClock()
  void showHour()
}

function togglePlay(): void {
  setPlaying(!playing.value)
}

function onSlide(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  index.value = value
  hourLabel.value = describeHour(value)
}

function onSlideEnd(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  goTo(value)
}

async function handleThunder(ground: Cartesian3): Promise<void> {
  const instance = viewerRef
  if (!instance || !audioContext || audioContext.state !== 'running' || !thunderBuffer) return
  const distance = Cartesian3.distance(ground, instance.scene.camera.positionWC)
  if (distance > THUNDER_RANGE) return
  const panner = new PannerNode(audioContext, {
    panningModel: 'HRTF',
    distanceModel: 'inverse',
    refDistance: 1000
  })
  panner.connect(audioContext.destination)
  const audio = new CesiumAudio(instance, ground, panner) as Audio
  audio.active = true
  const source = new AudioBufferSourceNode(audioContext, { buffer: await thunderBuffer })
  source.connect(panner)
  source.onended = () => {
    audio.active = false
    panner.disconnect()
  }
  source.start(audioContext.currentTime + distance / SPEED_OF_SOUND)
}

async function loadSound(url: string): Promise<AudioBuffer> {
  const response = await fetch(url)
  return (audioContext as AudioContext).decodeAudioData(await response.arrayBuffer())
}

async function toggleSound(value: boolean): Promise<void> {
  soundOn.value = value
  if (!audioContext) {
    if (!value) return
    // 音频上下文只能由用户手势启动
    audioContext = new AudioContext()
    thunderBuffer = loadSound(`${import.meta.env.BASE_URL}helpers/sounds/thunder.mp3`)
    rainGain = new GainNode(audioContext, { gain: 0 })
    rainGain.connect(audioContext.destination)
    const rain = new AudioBufferSourceNode(audioContext, {
      buffer: await loadSound(`${import.meta.env.BASE_URL}helpers/sounds/rain.mp3`),
      loop: true
    })
    rain.connect(rainGain)
    rain.start()
  } else if (value) {
    await audioContext.resume()
  } else {
    await audioContext.suspend()
  }
}

onBeforeUnmount(() => {
  disposed = true
  void audioContext?.close()
})
</script>

<template>
  <div class="helper-shell">
    <div ref="container" class="helper-canvas"></div>

    <div class="helper-panel is-wide">
      <div class="helper-title">雷达天气</div>
      <p class="helper-hint">
        MeteoSwiss 雷达看到的雨、云与闪电，按最近 7 天逐小时回放。飞近可以看到云，还能钻进云里。
      </p>
      <p class="helper-hint">开声音后，雷声从落雷处传来，每 343 米晚一秒，建议戴耳机。</p>

      <HelperToggle :model-value="soundOn" label="声音" @update:model-value="toggleSound" />

      <div class="helper-actions">
        <button class="helper-button" :disabled="!canStep || index === 0" @click="goTo(index - 1)">上一小时</button>
        <button class="helper-button" :class="{ 'is-active': playing }" :disabled="!canStep" @click="togglePlay">
          {{ playing ? '暂停' : '播放' }}
        </button>
        <button class="helper-button" :disabled="!canStep || index === LAST" @click="goTo(index + 1)">下一小时</button>
      </div>

      <div class="helper-field">
        <div class="helper-row">
          <span class="helper-row-label">时次</span>
          <span class="helper-value">{{ hourLabel }}</span>
        </div>
        <input
          class="helper-range"
          type="range"
          min="0"
          :max="LAST"
          step="1"
          :value="index"
          :disabled="!available"
          :style="{ accentColor: '#36c5e8' }"
          @input="onSlide"
          @change="onSlideEnd"
        />
        <div class="helper-row">
          <span class="helper-row-label">进度</span>
          <span class="helper-value">{{ Math.round(sliderPercent) }}%</span>
        </div>
      </div>
    </div>

    <div v-if="status" class="helper-status">{{ status }}</div>
  </div>
</template>
