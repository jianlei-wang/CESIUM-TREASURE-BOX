<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { Viewer } from 'cesium'
import CesiumPathFlyover from '../cesium-helpers-lib/packages/cesium-path-flyover/src/cesium-path-flyover.js'
import {
  AnalogVideo,
  DigitalVideo,
  DroneDisplay,
  Jello,
  MotionBlur
} from '../cesium-helpers-lib/packages/cesium-post-process/src/cesium-post-process.js'
import FlyoverCaptions from '../cesium-helpers-lib/flyover-captions'
import { exportFlyover, videoSupport } from '../cesium-helpers-lib/flyover-export'
import { useHelperViewer } from '../cesium-helpers-lib/use-helper-viewer'
import HelperToggle from '../cesium-helpers-lib/HelperToggle.vue'
import '../cesium-helpers-lib/helper-ui.css'

type Effect = { active: boolean }
type Flyover = {
  duration: number
  progress: number
  name?: string
  points?: unknown[]
  load(url: string): Promise<void>
  play(): Promise<void>
  stop(): void
  destroy(): void
  progressChanged: { addEventListener(fn: (progress: number) => void): void }
}
type Captions = {
  active: boolean
  canvas: HTMLCanvasElement
  load(): Promise<void>
  destroy(): void
}

const TRACKS = [
  { key: 'baulmes-valley', label: '峡谷下行至 Baulmes', file: 'Tour_Baulmes_valley.gpx' },
  { key: 'mont-de-baulmes', label: 'Mont de Baulmes 环线 16 km', file: 'Tour_du_Mont_de_Baulmes.gpx' },
  { key: 'rechy', label: 'Vallon de Rechy 峡谷段 8 km', file: 'Vallon_de_Rechy_gorge.gpx' },
  { key: 'suchet', label: 'Le Suchet 14 km / 爬升 900 m', file: 'Suchet.gpx' }
]

const PRESETS: Record<string, [number, number] | null> = {
  default: [0.5, 0.5],
  pilot: [0, 0],
  spectator: [1, 0.8],
  drone: [0.6, 1]
}

const VIDEO_SUPPORT = videoSupport()

const container = ref<HTMLElement | null>(null)
const trackKey = ref(TRACKS[0].key)
const preset = ref('default')
const styleDial = ref(0.5)
const motionDial = ref(0.5)
const placeNames = ref(true)
const motionBlurOn = ref(false)
const fpvOn = ref(false)

const state = ref<'loading' | 'ready' | 'playing' | 'failed' | 'exporting'>('loading')
const progress = ref(0)
const message = ref('')
const durationText = ref('0:00')
const videoOrientation = ref<'portrait' | 'landscape'>('portrait')
const videoQuality = ref('540')
const videoFps = ref('30')
const exportRunning = ref(false)
const exportPercent = ref(0)
const exportEta = ref('')
const exportResult = ref<{ blob: Blob; name: string; size: string } | null>(null)
const exportError = ref('')
const showExport = ref(false)

let flyover: Flyover | null = null
let captions: Captions | null = null
let captionsLoaded: Promise<void> = Promise.resolve()
let effects: { motionBlur: Effect; drone: Effect[] } | null = null
let loadToken = 0
let controller: AbortController | null = null
let exportViewerRef: Viewer | null = null

const settingsLocked = computed(() => state.value === 'playing' || state.value === 'exporting')
const canExport = computed(() => state.value === 'ready' && VIDEO_SUPPORT.supported)

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function videoSize(): [number, number] {
  const short = Number(videoQuality.value)
  const long = Math.round((short * 16) / 9)
  return videoOrientation.value === 'portrait' ? [short, long] : [long, short]
}

const exportSummary = computed(() => {
  const [width, height] = videoSize()
  const fps = Number(videoFps.value)
  const seconds = flyover?.duration ?? 0
  return `${clock(seconds)} · ${width} × ${height} · ${fps} fps · ${Math.round(fps * seconds)} 帧`
})

const exportEstimate = computed(() => {
  const [width, height] = videoSize()
  const seconds = flyover?.duration ?? 0
  const frames = Math.round(Number(videoFps.value) * seconds)
  const estimate = frames * ((width * height) / 1e6) * 0.1
  const rounded = Math.max(5, Math.round(estimate / 5) * 5)
  return rounded < 60 ? `预计约 ${rounded} 秒` : `预计约 ${Math.round(estimates(estimate))} 分钟`
})

function estimates(seconds: number): number {
  return seconds / 60
}

const { status, viewer } = useHelperViewer(container, {}, async (instance) => {
  exportViewerRef = instance
  const motionBlur = new MotionBlur(instance) as Effect
  // FPV 无人机画面：一点果冻效应、它的取景框，以及两条视频链路
  const drone = [
    new Jello(instance, { amount: 0.02 }) as Effect,
    new DroneDisplay(instance) as Effect,
    new AnalogVideo(instance) as Effect,
    new DigitalVideo(instance, { breakup: 0.15 }) as Effect
  ]
  effects = { motionBlur, drone }
  applyEffects()
  await loadTrack(instance)

  return () => {
    controller?.abort()
    flyover?.destroy()
    captions?.destroy()
    flyover = null
    captions = null
    if (effects) {
      effects.motionBlur.active = false
      effects.drone.forEach((effect) => (effect.active = false))
    }
    effects = null
    exportViewerRef = null
  }
})

function applyEffects(): void {
  if (!effects) return
  // 先关掉再按顺序打开，阶段顺序才稳定：模糊垫在无人机画面之下
  effects.motionBlur.active = false
  effects.drone.forEach((effect) => (effect.active = false))
  if (fpvOn.value) {
    effects.drone.forEach((effect) => (effect.active = true))
  }
  if (motionBlurOn.value) effects.motionBlur.active = true
  if (motionBlurOn.value && fpvOn.value) {
    effects.drone.forEach((effect) => (effect.active = false))
    effects.drone.forEach((effect) => (effect.active = true))
  }
}

function setState(next: typeof state.value): void {
  state.value = next
  if (!exportViewerRef) return
  // 运动中的相机看不到最精细的瓦片，但它们的加载和 18 级以上的地形上采样会吃掉帧率
  exportViewerRef.scene.globe.maximumScreenSpaceError = next === 'playing' ? 3 : 2
}

function showTime(): void {
  const seconds = (flyover?.progress ?? 0) * (flyover?.duration ?? 0)
  durationText.value = `${clock(seconds)} / ${clock(flyover?.duration ?? 0)}`
}

async function loadTrack(instance: Viewer, key = trackKey.value): Promise<void> {
  const token = ++loadToken
  setState('loading')
  message.value = '正在载入轨迹…'
  flyover?.destroy()
  captions?.destroy()
  captions = null
  const item = TRACKS.find((track) => track.key === key) ?? TRACKS[0]
  const url = `${import.meta.env.BASE_URL}helpers/tracks/${item.file}`
  const run = new CesiumPathFlyover(instance, {
    style: styleDial.value,
    motion: motionDial.value
  }) as Flyover
  flyover = run
  run.progressChanged.addEventListener((value: number) => {
    progress.value = Math.round(value * 1000) / 1000
    showTime()
  })
  try {
    await run.load(url)
  } catch (error) {
    if (token !== loadToken) return
    console.error(error)
    message.value = `轨迹加载失败：${error instanceof Error ? error.message : String(error)}`
    setState('failed')
    return
  }
  if (token !== loadToken) return
  const overlay = new FlyoverCaptions(instance, run as never) as Captions
  overlay.active = placeNames.value
  captions = overlay
  captionsLoaded = overlay.load().catch((error) => console.error(error))
  progress.value = 0
  flyToStart(instance, run)
  showTime()
  message.value = run.name ?? ''
  setState('ready')
}

function flyToStart(instance: Viewer, run: Flyover): void {
  const camera = instance.camera
  const from = {
    destination: camera.position.clone(),
    orientation: { direction: camera.direction.clone(), up: camera.up.clone() }
  }
  run.progress = 0
  const to = {
    destination: camera.position.clone(),
    orientation: { heading: camera.heading, pitch: camera.pitch, roll: 0 }
  }
  camera.setView(from)
  camera.flyTo({ ...to, duration: 2 })
}

function choosePreset(name: string): void {
  preset.value = name
  const dials = PRESETS[name]
  if (dials) {
    styleDial.value = dials[0]
    motionDial.value = dials[1]
  }
  if (viewer.value) void loadTrack(viewer.value)
}

function onDial(): void {
  preset.value = 'custom'
  if (viewer.value) void loadTrack(viewer.value)
}

function onTrackChange(): void {
  if (viewer.value) void loadTrack(viewer.value)
}

function scrubInput(): void {
  if (flyover) flyover.progress = progress.value
  showTime()
}

async function togglePlay(): Promise<void> {
  if (!flyover) return
  if (state.value === 'playing') {
    flyover.stop()
    return
  }
  setState('playing')
  await flyover.play()
  setState('ready')
}

function stopAndRewind(): void {
  if (!flyover) return
  flyover.stop()
  flyover.progress = 0
  showTime()
  setState('ready')
}

function togglePlaceNames(value: boolean): void {
  placeNames.value = value
  if (captions) captions.active = value
  viewer.value?.scene.requestRender()
}

function toggleMotionBlur(value: boolean): void {
  motionBlurOn.value = value
  applyEffects()
  viewer.value?.scene.requestRender()
}

function toggleFpv(value: boolean): void {
  fpvOn.value = value
  applyEffects()
  viewer.value?.scene.requestRender()
}

async function startExport(): Promise<void> {
  if (!flyover || !exportViewerRef) return
  exportError.value = ''
  exportResult.value = null
  exportRunning.value = true
  exportPercent.value = 0
  exportEta.value = '正在准备…'
  const saved = { blur: motionBlurOn.value, fpv: fpvOn.value }
  if (effects) {
    effects.motionBlur.active = false
    effects.drone.forEach((effect) => (effect.active = false))
  }
  setState('exporting')
  controller = new AbortController()
  const [width, height] = videoSize()
  const fps = Number(videoFps.value)
  try {
    await captionsLoaded
    const blob = await exportFlyover({
      viewer: exportViewerRef,
      flyover,
      captions: captions ?? undefined,
      width,
      height,
      fps,
      signal: controller.signal,
      onProgress: ({ frame, frames, perFrame }) => {
        const percent = Math.floor((100 * frame) / frames)
        exportPercent.value = percent
        exportEta.value =
          `第 ${frame + 1} / ${frames} 帧` +
          (perFrame && frame >= fps ? ` · 剩余约 ${Math.max(5, Math.round((perFrame * (frames - frame)) / 5) * 5)} 秒` : '')
      }
    })
    if (!blob) {
      exportEta.value = '已取消'
    } else {
      exportResult.value = {
        blob,
        name: `${trackKey.value}.mp4`,
        size: `${(blob.size / 1e6).toFixed(1)} MB`
      }
      exportPercent.value = 100
      exportEta.value = '导出完成'
    }
  } catch (error) {
    console.error(error)
    exportError.value = `导出失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    controller = null
    exportRunning.value = false
    motionBlurOn.value = saved.blur
    fpvOn.value = saved.fpv
    applyEffects()
    setState('ready')
  }
}

function cancelExport(): void {
  controller?.abort()
}

function saveVideo(): void {
  if (!exportResult.value) return
  const url = URL.createObjectURL(exportResult.value.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = exportResult.value.name
  anchor.click()
  URL.revokeObjectURL(url)
}

onBeforeUnmount(() => {
  controller?.abort()
})
</script>

<template>
  <div class="helper-shell">
    <div ref="container" class="helper-canvas"></div>

    <div class="helper-panel is-wide">
      <div class="helper-title">轨迹飞行</div>
      <p class="helper-hint">
        沿 GPX 轨迹的相机动画。轨迹贴地、相机自动避让山体，可叠加地名标注、运动模糊与 FPV 画面，并导出 MP4。
      </p>

      <div class="helper-field">
        <span class="helper-row-label">轨迹</span>
        <select v-model="trackKey" class="helper-select" :disabled="settingsLocked" @change="onTrackChange">
          <option v-for="track in TRACKS" :key="track.key" :value="track.key">{{ track.label }}</option>
        </select>
      </div>

      <div class="helper-field">
        <span class="helper-row-label">机位预设</span>
        <div class="helper-actions">
          <button
            v-for="name in ['default', 'pilot', 'spectator', 'drone']"
            :key="name"
            class="helper-button"
            :class="{ 'is-active': preset === name }"
            :disabled="settingsLocked"
            @click="choosePreset(name)"
          >
            {{ { default: '默认', pilot: '飞行员', spectator: '旁观', drone: '无人机' }[name] }}
          </button>
        </div>
      </div>

      <div class="helper-field">
        <div class="helper-row">
          <span class="helper-row-label">风格</span>
          <span class="helper-value">{{ styleDial.toFixed(1) }}</span>
        </div>
        <input
          v-model.number="styleDial"
          class="helper-range"
          type="range"
          min="0"
          max="1"
          step="0.1"
          :disabled="settingsLocked"
          @change="onDial"
        />
      </div>

      <div class="helper-field">
        <div class="helper-row">
          <span class="helper-row-label">动态</span>
          <span class="helper-value">{{ motionDial.toFixed(1) }}</span>
        </div>
        <input
          v-model.number="motionDial"
          class="helper-range"
          type="range"
          min="0"
          max="1"
          step="0.1"
          :disabled="settingsLocked"
          @change="onDial"
        />
      </div>

      <HelperToggle :model-value="placeNames" label="地名标注" @update:model-value="togglePlaceNames" />
      <HelperToggle :model-value="motionBlurOn" label="运动模糊" @update:model-value="toggleMotionBlur" />
      <HelperToggle :model-value="fpvOn" label="FPV 画面" @update:model-value="toggleFpv" />

      <div class="helper-actions">
        <button class="helper-button" :disabled="state !== 'ready' && state !== 'playing'" @click="togglePlay">
          {{ state === 'playing' ? '暂停' : '播放' }}
        </button>
        <button class="helper-button" :disabled="state !== 'ready' && state !== 'playing'" @click="stopAndRewind">
          停止并归零
        </button>
        <span class="helper-value">{{ durationText }}</span>
      </div>

      <input
        v-model.number="progress"
        class="helper-range"
        type="range"
        min="0"
        max="1"
        step="0.001"
        :disabled="state === 'loading' || state === 'failed'"
        @input="scrubInput"
      />

      <button class="helper-button" :disabled="!canExport" @click="showExport = !showExport">
        {{ showExport ? '收起导出' : '导出视频' }}
      </button>

      <template v-if="showExport">
        <div class="helper-field">
          <span class="helper-row-label">画幅</span>
          <div class="helper-actions">
            <button
              class="helper-button"
              :class="{ 'is-active': videoOrientation === 'portrait' }"
              @click="videoOrientation = 'portrait'"
            >
              竖屏 9:16
            </button>
            <button
              class="helper-button"
              :class="{ 'is-active': videoOrientation === 'landscape' }"
              @click="videoOrientation = 'landscape'"
            >
              横屏 16:9
            </button>
          </div>
        </div>
        <div class="helper-field">
          <span class="helper-row-label">清晰度</span>
          <div class="helper-actions">
            <button
              v-for="quality in ['540', '720', '1080']"
              :key="quality"
              class="helper-button"
              :class="{ 'is-active': videoQuality === quality }"
              @click="videoQuality = quality"
            >
              {{ quality }}p
            </button>
          </div>
        </div>
        <div class="helper-field">
          <span class="helper-row-label">帧率</span>
          <div class="helper-actions">
            <button
              v-for="fps in ['24', '30', '60']"
              :key="fps"
              class="helper-button"
              :class="{ 'is-active': videoFps === fps }"
              @click="videoFps = fps"
            >
              {{ fps }} fps
            </button>
          </div>
        </div>
        <p class="helper-hint">{{ exportSummary }}</p>
        <p class="helper-hint">
          逐帧渲染并等瓦片加载完毕，{{ exportEstimate }}；导出期间地图会缩放到视频尺寸。
        </p>
        <p v-if="!VIDEO_SUPPORT.supported" class="helper-hint">{{ VIDEO_SUPPORT.reason }}</p>
        <div class="helper-actions">
          <button v-if="!exportRunning" class="helper-button" :disabled="!canExport" @click="startExport">开始导出</button>
          <button v-else class="helper-button is-active" @click="cancelExport">停止导出</button>
          <button v-if="exportResult" class="helper-button is-active" @click="saveVideo">保存视频</button>
        </div>
        <template v-if="exportRunning || exportResult || exportError">
          <div class="helper-row">
            <span class="helper-row-label">进度</span>
            <span class="helper-value">{{ exportPercent }}%</span>
          </div>
          <p class="helper-hint">{{ exportEta }}</p>
        </template>
        <p v-if="exportResult" class="helper-hint">视频已就绪 · {{ exportResult.size }}</p>
        <p v-if="exportError" class="helper-hint">{{ exportError }}</p>
      </template>

      <p v-if="message" class="helper-hint">{{ message }}</p>
    </div>

    <div v-if="status" class="helper-status">{{ status }}</div>
  </div>
</template>
