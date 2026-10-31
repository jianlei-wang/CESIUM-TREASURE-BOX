<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { BoundingSphere, HeadingPitchRange, Math as CesiumMath, type Viewer } from 'cesium'
import CesiumPathFlyover from '../cesium-helpers-lib/packages/cesium-path-flyover/src/cesium-path-flyover.js'
import FlyoverCaptions from '../cesium-helpers-lib/flyover-captions'
import { exportFlyover, isCodecSupported, BITS_PER_PIXEL } from '../cesium-helpers-lib/flyover-export'
import {
  approximately,
  clock,
  FPS,
  fileSize,
  megabytes,
  renderEstimate,
  tabTitle,
  videoSize,
  type Orientation
} from '../cesium-helpers-lib/flyover-studio-model'
import { useHelperViewer } from '../cesium-helpers-lib/use-helper-viewer'
import HelperToggle from '../cesium-helpers-lib/HelperToggle.vue'
import '../cesium-helpers-lib/helper-ui.css'

type Effect = { active: boolean }
type Flyover = {
  duration: number
  progress: number
  distance?: number
  name?: string
  points?: unknown[]
  load(url: string): Promise<void>
  play(): Promise<void>
  stop(): void
  destroy(): void
  progressChanged: { addEventListener(fn: (progress: number) => void): void }
}
type Captions = { active: boolean; canvas: HTMLCanvasElement; load(): Promise<void>; destroy(): void }
type Source = { url: string; name: string; owned: boolean }

const SAMPLE: Source = {
  url: `${import.meta.env.BASE_URL}helpers/tracks/Tour_Baulmes_valley.gpx`,
  name: '峡谷下行至 Baulmes',
  owned: false
}

const PRESETS: Record<string, { label: string; dials: [number, number]; hint: string }> = {
  default: { label: '默认', dials: [0.5, 0.5], hint: '从后方略微高处跟随轨迹。' },
  pilot: { label: '飞行员', dials: [0, 0], hint: '贴近标记点、低空跟随，转弯时侧倾。' },
  spectator: { label: '旁观', dials: [1, 0.8], hint: '高远宽阔，翻越山脊取景。' },
  drone: { label: '无人机', dials: [0.6, 1], hint: '漂浮松散，像迎风的无人机一样游移。' }
}

const container = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const stage = ref<'empty' | 'ready' | 'playing' | 'rendering' | 'done'>('empty')
const preset = ref('default')
const orientation = ref<Orientation>('portrait')
const quality = ref('720')
const fps = ref(FPS)
const placeNames = ref(true)
const progress = ref(0)
const timeText = ref('0:00 / 0:00')
const trackName = ref('')
const error = ref('')
const busy = ref(false)
const encodable = ref(true)
const renderPercent = ref(0)
const renderEta = ref('')
const renderFrames = ref('')
const resultUrl = ref('')
const resultName = ref('')
const resultSize = ref('')
const resultFile = ref<File | null>(null)
const canShare = ref(false)
const duration = ref(0)

let flyover: Flyover | null = null
let captions: Captions | null = null
let captionsLoaded: Promise<void> = Promise.resolve()
let source: Source | null = null
let viewerRef: Viewer | null = null
let controller: AbortController | null = null
let wakeLock: WakeLockSentinel | undefined
let renderTitle = ''
let encoderCheck = 0

const smallScreen = window.matchMedia('(max-width: 40em)')
if (smallScreen.matches) quality.value = '540'

const videoDims = computed(() => videoSize(orientation.value, quality.value))

const summary = computed(() => {
  const seconds = duration.value
  const [width, height] = videoDims.value
  const estimate = renderEstimate(seconds, orientation.value, quality.value, fps.value)
  return `${clock(seconds)} 视频 · ${width} × ${height} · ${fps.value} fps · ${megabytes(
    fileSize(seconds, orientation.value, quality.value, fps.value)
  )} · ${approximately(estimate)}`
})

const idle = computed(() => stage.value === 'ready' && !busy.value)
const settingsLocked = computed(() => !idle.value)
const canRender = computed(() => idle.value && encodable.value)
const presetHint = computed(() => PRESETS[preset.value]?.hint ?? '')

const { status } = useHelperViewer(container, {}, async (instance) => {
  viewerRef = instance
  instance.scene.globe.lambertDiffuseMultiplier = 0.35
  instance.scene.globe.vertexShadowDarkness = 0.7
  void checkEncoder()
  return () => {
    controller?.abort()
    releaseWakeLock()
    flyover?.destroy()
    captions?.destroy()
    flyover = null
    captions = null
    viewerRef = null
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  }
})

function showTime(): void {
  const seconds = (flyover?.progress ?? 0) * (flyover?.duration ?? 0)
  timeText.value = `${clock(seconds)} / ${clock(flyover?.duration ?? 0)}`
}

function followProgress(value: number): void {
  const shown = Math.round(value * 1000) / 1000
  if (Math.abs(progress.value - shown) > 1e-6) progress.value = shown
  showTime()
}

async function checkEncoder(): Promise<void> {
  const check = ++encoderCheck
  const [width, height] = videoDims.value
  const answer = await isCodecSupported('avc1.42001f', width, height, fps.value)
  if (check !== encoderCheck) return
  encodable.value = answer
}

function release(track: Source | null): void {
  if (track?.owned) URL.revokeObjectURL(track.url)
}

function overview(instance: Viewer, run: Flyover): void {
  if (!run.points?.length) return
  const sphere = BoundingSphere.fromPoints(run.points as never)
  instance.camera.flyToBoundingSphere(sphere, {
    offset: new HeadingPitchRange(instance.camera.heading, CesiumMath.toRadians(-45), sphere.radius * 2.5),
    duration: 2,
    complete: () => {
      window.setTimeout(() => {
        if (run === flyover && stage.value === 'ready') flyToFrame(instance, run, 0)
      }, 1000)
    }
  })
}

function flyToFrame(instance: Viewer, run: Flyover, distance = 0): void {
  const camera = instance.camera
  const from = {
    destination: camera.position.clone(),
    orientation: { direction: camera.direction.clone(), up: camera.up.clone() }
  }
  run.distance = distance
  const to = {
    destination: camera.position.clone(),
    orientation: { heading: camera.heading, pitch: camera.pitch, roll: 0 }
  }
  camera.setView(from)
  camera.flyTo({ ...to, duration: 2 })
}

async function load(next: Source = source as Source): Promise<boolean> {
  if (!viewerRef || !next) return false
  const reload = next === source
  error.value = ''
  busy.value = true
  const [style, motion] = PRESETS[preset.value].dials
  const run = new CesiumPathFlyover(viewerRef, { style, motion }) as Flyover
  try {
    await run.load(next.url)
  } catch (caught) {
    console.error(caught)
    run.destroy()
    busy.value = false
    if (reload) {
      error.value = '无法重新载入这条轨迹，请检查网络后重试。'
    } else {
      release(next)
      error.value = '这个文件里没有可用的 GPS 轨迹，请从运动应用导出 GPX 后再试。'
    }
    return false
  }
  // 换预设时接着旧轨迹的同一位置，方便就地比较
  const at = reload ? (flyover?.distance ?? 0) : 0
  flyover?.destroy()
  captions?.destroy()
  flyover = run
  if (!reload) release(source)
  source = next
  run.progressChanged.addEventListener(followProgress)
  const overlay = new FlyoverCaptions(viewerRef, run as never) as Captions
  overlay.active = placeNames.value
  captions = overlay
  captionsLoaded = overlay.load().catch((caught) => console.error(caught))
  progress.value = 0
  trackName.value = run.name ?? next.name
  duration.value = run.duration
  showTime()
  busy.value = false
  stage.value = 'ready'
  void checkEncoder()
  if (reload) flyToFrame(viewerRef, run, at)
  else overview(viewerRef, run)
  return true
}

function openFile(file: File): void {
  void load({ url: URL.createObjectURL(file), name: file.name, owned: true })
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) openFile(file)
}

function trySample(): void {
  void load(SAMPLE).then((loaded) => {
    if (loaded) void startPlay()
  })
}

function onPreset(name: string): void {
  preset.value = name
  void load()
}

function onVideoSetting(): void {
  error.value = ''
  void checkEncoder()
}

function togglePlaceNames(value: boolean): void {
  placeNames.value = value
  if (captions) captions.active = value
  viewerRef?.scene.requestRender()
}

function onScrub(): void {
  if (!flyover) return
  viewerRef?.camera.cancelFlight()
  flyover.progress = progress.value
  showTime()
}

async function startPlay(): Promise<void> {
  if (!flyover) return
  viewerRef?.camera.cancelFlight()
  stage.value = 'playing'
  await flyover.play()
  if (stage.value === 'playing') stage.value = 'ready'
}

function togglePlay(): void {
  if (!flyover) return
  if (stage.value === 'playing') flyover.stop()
  else void startPlay()
}

function onDragOver(event: DragEvent): void {
  event.preventDefault()
  if (!busy.value && (stage.value === 'empty' || stage.value === 'ready') && event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (file && !busy.value && (stage.value === 'empty' || stage.value === 'ready')) openFile(file)
}

async function keepAwake(): Promise<void> {
  try {
    const lock = await (navigator as any).wakeLock?.request?.('screen')
    if (stage.value === 'rendering') wakeLock = lock
    else await lock?.release()
  } catch {
    // 不支持或用户拒绝时静默跳过
  }
}

function releaseWakeLock(): void {
  wakeLock?.release?.().catch(() => {})
  wakeLock = undefined
}

function downloadName(): string {
  const raw = flyover?.name || source?.name || 'flyover'
  return (
    raw
      .replace(/\.[^.]+$/, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '') || 'flyover'
  )
}

async function render(): Promise<void> {
  if (!viewerRef || !flyover) return
  error.value = ''
  const [width, height] = videoDims.value
  viewerRef.camera.cancelFlight()
  stage.value = 'rendering'
  renderPercent.value = 0
  renderEta.value = '正在准备…'
  renderFrames.value = ''
  renderTitle = document.title
  void keepAwake()
  controller = new AbortController()
  const stopped = new Promise<void>((resolve) => controller?.signal.addEventListener('abort', () => resolve(), { once: true }))
  let blob: Blob | undefined
  let failure: Error | undefined
  try {
    await Promise.race([captionsLoaded, stopped])
    if (!controller.signal.aborted) {
      blob = await exportFlyover({
        viewer: viewerRef,
        flyover,
        captions: captions ?? undefined,
        width,
        height,
        fps: fps.value,
        signal: controller.signal,
        onProgress: ({ frame, frames, perFrame }) => {
          const percent = Math.floor((100 * frame) / frames)
          renderPercent.value = percent
          document.title = tabTitle(percent)
          if (perFrame && frame >= FPS) renderEta.value = `剩余约 ${approximately(perFrame * (frames - frame))}`
          renderFrames.value = `第 ${frame + 1} / ${frames} 帧`
        }
      })
    }
  } catch (caught) {
    console.error(caught)
    failure = caught instanceof Error ? caught : new Error(String(caught))
  } finally {
    releaseWakeLock()
    document.title = renderTitle
  }
  if (!blob) {
    stage.value = 'ready'
    if (failure) error.value = `无法生成视频：${failure.message}`
    return
  }
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  const name = `${downloadName()}.mp4`
  resultUrl.value = URL.createObjectURL(blob)
  resultName.value = name
  resultSize.value = `${(blob.size / 1e6).toFixed(1)} MB`
  resultFile.value = new File([blob], name, { type: 'video/mp4' })
  canShare.value = (navigator as any).canShare?.({ files: [resultFile.value] }) ?? false
  stage.value = 'done'
}

function stopRender(): void {
  controller?.abort()
}

function download(): void {
  if (!resultUrl.value) return
  const anchor = document.createElement('a')
  anchor.href = resultUrl.value
  anchor.download = resultName.value
  anchor.click()
}

async function share(): Promise<void> {
  if (!resultFile.value) return
  try {
    await navigator.share({ files: [resultFile.value], title: trackName.value })
  } catch (caught) {
    if ((caught as Error).name !== 'AbortError') console.error(caught)
  }
}

function makeAnother(): void {
  stage.value = 'ready'
}

onBeforeUnmount(() => {
  controller?.abort()
  releaseWakeLock()
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
})
</script>

<template>
  <div class="helper-shell" @dragover="onDragOver" @drop="onDrop">
    <div ref="container" class="helper-canvas"></div>

    <input ref="fileInput" type="file" accept=".gpx,.geojson,.json" class="helper-hidden" @change="onPick" />

    <div v-if="stage === 'empty'" class="studio-intro">
      <div class="studio-intro-card">
        <div class="helper-title">飞行视频工作台</div>
        <p class="helper-hint">
          选一条 GPX 轨迹，挑好画幅与清晰度，逐帧渲染成 MP4 飞行视频。帧率与时长都固定，渲染期间可以放着去喝杯咖啡。
        </p>
        <div class="helper-actions">
          <button class="helper-button is-active" @click="fileInput?.click()">选择 GPX 文件</button>
          <button class="helper-button" @click="trySample">试试示例轨迹</button>
        </div>
        <p v-if="error" class="helper-hint">{{ error }}</p>
      </div>
    </div>

    <div v-if="stage !== 'empty'" class="helper-panel is-wide">
      <div class="helper-title">{{ trackName || '飞行视频工作台' }}</div>
      <p class="helper-hint">{{ presetHint }}</p>

      <div class="helper-field">
        <span class="helper-row-label">机位</span>
        <div class="helper-actions">
          <button
            v-for="(item, key) in PRESETS"
            :key="key"
            class="helper-button"
            :class="{ 'is-active': preset === key }"
            :disabled="settingsLocked"
            @click="onPreset(key)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>

      <div class="helper-field">
        <span class="helper-row-label">画幅</span>
        <div class="helper-actions">
          <button
            class="helper-button"
            :class="{ 'is-active': orientation === 'portrait' }"
            :disabled="settingsLocked"
            @click="orientation = 'portrait'; onVideoSetting()"
          >
            竖屏 9:16
          </button>
          <button
            class="helper-button"
            :class="{ 'is-active': orientation === 'landscape' }"
            :disabled="settingsLocked"
            @click="orientation = 'landscape'; onVideoSetting()"
          >
            横屏 16:9
          </button>
        </div>
      </div>

      <div class="helper-field">
        <span class="helper-row-label">清晰度</span>
        <div class="helper-actions">
          <button
            v-for="item in ['540', '720', '1080']"
            :key="item"
            class="helper-button"
            :class="{ 'is-active': quality === item }"
            :disabled="settingsLocked"
            @click="quality = item; onVideoSetting()"
          >
            {{ item }}p
          </button>
        </div>
      </div>

      <div class="helper-field">
        <span class="helper-row-label">帧率</span>
        <div class="helper-actions">
          <button
            v-for="item in [24, 30, 60]"
            :key="item"
            class="helper-button"
            :class="{ 'is-active': fps === item }"
            :disabled="settingsLocked"
            @click="fps = item; onVideoSetting()"
          >
            {{ item }} fps
          </button>
        </div>
      </div>

      <HelperToggle :model-value="placeNames" label="地名标注" @update:model-value="togglePlaceNames" />

      <div class="helper-actions">
        <button class="helper-button" :disabled="!(stage === 'ready' || stage === 'playing')" @click="togglePlay">
          {{ stage === 'playing' ? '暂停预览' : '播放预览' }}
        </button>
        <button class="helper-button" :disabled="settingsLocked" @click="fileInput?.click()">换一条轨迹</button>
      </div>

      <input
        v-model.number="progress"
        class="helper-range"
        type="range"
        min="0"
        max="1"
        step="0.001"
        :disabled="!(stage === 'ready' || stage === 'playing')"
        @input="onScrub"
      />
      <div class="helper-row">
        <span class="helper-row-label">时间</span>
        <span class="helper-value">{{ timeText }}</span>
      </div>

      <p class="helper-hint">{{ summary }}</p>
      <p v-if="!encodable" class="helper-hint">当前浏览器编码不了这个尺寸的 H.264，换个小一点清晰度。</p>

      <template v-if="stage === 'rendering'">
        <div class="helper-row">
          <span class="helper-row-label">渲染</span>
          <span class="helper-value">{{ renderPercent }}%</span>
        </div>
        <p class="helper-hint">{{ renderFrames }} {{ renderEta }}</p>
        <button class="helper-button is-active" @click="stopRender">停止渲染</button>
      </template>
      <button v-else class="helper-button is-active" :disabled="!canRender" @click="render">生成视频</button>

      <template v-if="stage === 'done'">
        <video class="studio-result" :src="resultUrl" controls playsinline></video>
        <p class="helper-hint">视频已就绪 · {{ resultSize }}</p>
        <div class="helper-actions">
          <button v-if="canShare" class="helper-button is-active" @click="share">分享视频</button>
          <button class="helper-button" :class="{ 'is-active': !canShare }" @click="download">下载视频</button>
          <button class="helper-button" @click="makeAnother">再做一段</button>
        </div>
      </template>

      <p v-if="error" class="helper-hint">{{ error }}</p>
    </div>

    <div v-if="status" class="helper-status">{{ status }}</div>
  </div>
</template>

<style scoped>
.studio-intro {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(4, 18, 28, 0.55);
}

.studio-intro-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(340px, 100%);
  padding: 16px 18px;
  border: 1px solid rgba(137, 210, 233, 0.28);
  border-radius: 10px;
  background: rgba(8, 32, 49, 0.94);
  color: #ddf2f8;
  font-size: 12px;
}

.studio-result {
  width: 100%;
  border-radius: 6px;
  background: #000;
}
</style>
