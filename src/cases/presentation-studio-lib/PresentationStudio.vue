<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import Icon from './components/Icon.vue'
import UiField from './components/UiField.vue'
import UiModal from './components/UiModal.vue'
import UiSection from './components/UiSection.vue'
import UiSwitch from './components/UiSwitch.vue'
import {
  ACTION_DEFINITIONS,
  EFFECT_DEFINITIONS,
  LANDMARKS,
  LANDMARK_MAP,
  LAYER_DEFINITIONS,
  PAGODA_CENTER,
  TIME_TARGET_LABELS,
  createAction,
  createProject,
  createSampleProject,
  createStep,
  createId,
  nowIso
} from './core/defaults'
import {
  buildTimeline,
  clamp,
  evaluateFrame,
  evaluateTimeline,
  globalTimeForStep,
  previewTimeForSelection,
  TIMELINE_FPS
} from './core/timeline'
import {
  buildTrackLanes,
  snapFrame,
  trackFrameRange,
  trackSnapPoints,
  trimmedFrames,
  type TrackClip
} from './core/tracks'
import { CURVE_PRESETS, curveForAction, curvePath, type CurvePreset } from './core/easing'
import { drawExportOverlay } from './core/export-overlay'
import { createBlankInitial, deepClone, formatClock, formatDate, hasPlayableActions } from './core/normalize'
import { recordDiagnostic } from './core/diagnostics'
import { hasStudioPlugins, runBeforeExportHooks, runProjectOpenHooks, runProjectSaveHooks } from './core/sdk'
import { parseProjectDocument, runtimeToDocument, serializeDocument } from './core/schema'
import { finalizeRoute } from './core/recorder'
import { PresentationScene, type CustomLayerState } from './core/scene'
import {
  downloadBlob,
  downloadText,
  readStore,
  readStoreSafe,
  storageDiagnostics,
  writeStoreSafe,
  type SaveResult,
  type StudioStore
} from './core/storage'
import { detectRecorderFormat } from './core/video'
import { profileFor } from './core/export-profile'
import { exportFrameSequence, exportRealtime, type ExportProgress } from './core/export-pipeline'
import {
  packStudioPackage,
  packPlayerPackage,
  unpackStudioPackage,
  packageFileName,
  type PackageAsset
} from './core/project-package'
import type {
  ActionType,
  CameraPose,
  CustomLayer,
  DialogState,
  EasingCurve,
  ExportSettings,
  ExportState,
  PlaybackMode,
  PopupView,
  PresentationAction,
  PresentationProject,
  PresentationStep,
  RuntimeState,
  SceneStatus,
  SubtitleView,
  ToastItem
} from './core/types'

const STAGE_HELP = '空格 播放/暂停 · ←/→ 单帧 · L 循环 · Home 回到开头 · H 隐藏界面 · F 全屏 · Ctrl+S 保存'

const playerParams = new URLSearchParams(window.location.search)
const isPlayerMode = ref(playerParams.get('player') === '1')
const playerProjectUrl = playerParams.get('project') ?? ''
const playerAssetBase = playerParams.get('assetBase') ?? ''
const playerLoadError = ref('')
const playerObjectUrls: string[] = []

function loadInitialStore(): {
  store: StudioStore
  signature: string
  snapshot: PresentationProject
  restored: boolean
  fromStorage: boolean
} {
  const saved = readStore()
  if (saved) {
    const index = saved.projects.findIndex((item) => item.id === saved.currentId)
    const base = saved.projects[index] ?? saved.projects[0]
    const signature = JSON.stringify(base)
    const snapshot = deepClone(base)
    let restored = false
    if (saved.draft && saved.draft.projectId === saved.currentId) {
      saved.projects[index] = deepClone(saved.draft.project)
      restored = true
    }
    return { store: saved, signature, snapshot, restored, fromStorage: true }
  }
  const sample = createSampleProject()
  return {
    store: { version: 1, currentId: sample.id, projects: [sample], draft: null },
    signature: JSON.stringify(sample),
    snapshot: deepClone(sample),
    restored: false,
    fromStorage: false
  }
}

const bootState = loadInitialStore()
const store = ref<StudioStore>(bootState.store)
const savedSignature = ref(bootState.signature)
const savedSnapshot = ref<PresentationProject | null>(bootState.snapshot)
type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'failed'
const saveStatus = ref<SaveStatus>(bootState.restored ? 'dirty' : 'clean')
const saveError = ref('')
const storageNotice = ref('')
const HISTORY_LIMIT = 40
const undoStack = ref<string[]>([])
const redoStack = ref<string[]>([])
const canUndo = computed(() => undoStack.value.length > 0)
const canRedo = computed(() => redoStack.value.length > 0)
let historyBaseline = ''
let historyTimer: number | undefined
let historyApplying = false

const project = computed<PresentationProject>(() => {
  return store.value.projects.find((item) => item.id === store.value.currentId) ?? store.value.projects[0]!
})
historyBaseline = JSON.stringify(project.value)
const timeline = computed(() => buildTimeline(project.value))
const total = computed(() => timeline.value.total)
const runtime = shallowRef<RuntimeState>(evaluateTimeline(timeline.value, 0, project.value.initial))

const selectedStepId = ref('')
const selectedActionId = ref('')

const selectedStep = computed<PresentationStep | null>(() => {
  return project.value.steps.find((step) => step.stepId === selectedStepId.value) ?? project.value.steps[0] ?? null
})

const selectedAction = computed<PresentationAction | null>(() => {
  if (!selectedStep.value || !selectedActionId.value) return null
  return selectedStep.value.actions.find((action) => action.actionId === selectedActionId.value) ?? null
})

const flyAction = computed(() => (selectedAction.value?.actionType === 'flyTo' ? selectedAction.value : null))
const routeAction = computed(() => (selectedAction.value?.actionType === 'recordRoute' ? selectedAction.value : null))
const layerAction = computed(() => (selectedAction.value?.actionType === 'layerToggle' ? selectedAction.value : null))
const timeAction = computed(() => (selectedAction.value?.actionType === 'timeAnimation' ? selectedAction.value : null))
const subtitleAction = computed(() => (selectedAction.value?.actionType === 'subtitle' ? selectedAction.value : null))
const popupAction = computed(() => (selectedAction.value?.actionType === 'popup' ? selectedAction.value : null))
const effectAction = computed(() => (selectedAction.value?.actionType === 'sceneEffect' ? selectedAction.value : null))
const easingAction = computed(() => {
  const action = selectedAction.value
  if (!action) return null
  return action.actionType === 'flyTo' || action.actionType === 'recordRoute' || action.actionType === 'timeAnimation'
    ? action
    : null
})
const activeCurve = computed<EasingCurve | null>(() => (easingAction.value ? curveForAction(easingAction.value) : null))
const activeCurvePath = computed(() => (activeCurve.value ? curvePath(activeCurve.value) : ''))
const activeCurveCustom = computed(() => Boolean(easingAction.value?.curve))

function setCurvePoint(key: keyof EasingCurve, event: Event): void {
  if (!easingAction.value || !activeCurve.value) return
  const input = event.target as HTMLInputElement
  const value = Number(input.value)
  const next = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : activeCurve.value[key]
  easingAction.value.curve = { ...activeCurve.value, [key]: next }
}

function applyCurvePreset(preset: CurvePreset): void {
  if (!easingAction.value) return
  easingAction.value.curve = { ...preset.curve }
}

function resetCurve(): void {
  if (!easingAction.value) return
  easingAction.value.curve = undefined
}

function setActionStart(event: Event): void {
  const input = event.target as HTMLInputElement
  const raw = input.value.trim()
  if (!selectedAction.value) return
  if (!raw) {
    selectedAction.value.start = undefined
    return
  }
  const value = Number(raw)
  selectedAction.value.start = Number.isFinite(value) && value > 0 ? Math.min(600, value) : undefined
}

const stageRef = ref<HTMLElement | null>(null)
const viewportRef = ref<HTMLElement | null>(null)
let scene: PresentationScene | null = null

const sceneStatus = reactive<SceneStatus>({
  ready: false,
  failed: false,
  message: '准备三维场景',
  detail: '正在创建 Cesium 视图'
})
const loading = computed(() => !sceneStatus.ready && !sceneStatus.failed)

const mode = ref<PlaybackMode>('idle')
const currentTime = ref(0)
const playbackRate = ref(1)
const loopPlayback = ref(false)
const uiHidden = ref(false)
const isFullscreen = ref(false)
const isCompact = ref(false)
const railLeftOpen = ref(true)
const railRightOpen = ref(true)

const isDirty = computed(() => JSON.stringify(project.value) !== savedSignature.value)
const saveLabel = computed(() => {
  if (saveStatus.value === 'saving') return '保存中'
  if (saveStatus.value === 'failed') return '保存失败'
  return isDirty.value ? '未保存' : '已保存'
})
const exportProfile = computed(() => profileFor({ ...exportSettings }))
const exportIsFrames = computed(() => (exportSettings.format ?? 'video') === 'frames')

const activeStepName = computed(() => runtime.value.step?.stepName ?? selectedStep.value?.stepName ?? '尚未选择步骤')

const stepMarkers = computed(() => {
  const duration = total.value || 1
  return timeline.value.steps.map((step, index) => ({
    id: step.step.stepId,
    index,
    left: (step.start / duration) * 100,
    width: (step.total / duration) * 100
  }))
})

const railTab = ref<'steps' | 'tracks'>('steps')
const trackLanes = computed(() => buildTrackLanes(timeline.value, TIMELINE_FPS))
const trackFrames = computed(() => Math.max(1, trackFrameRange(trackLanes.value)))
const playheadPercent = computed(() => clamp((currentTime.value * TIMELINE_FPS) / trackFrames.value, 0, 1) * 100)

function selectTrackClip(clip: TrackClip): void {
  selectedStepId.value = clip.stepId
  selectedActionId.value = clip.actionId
  previewAt(clip.startFrame / TIMELINE_FPS)
}

const draggingClipId = ref('')

function onTrackClipDragStart(clip: TrackClip, event: DragEvent): void {
  if (clip.locked) {
    event.preventDefault()
    toast('该片段已锁定，请先解锁', 'warn')
    return
  }
  draggingClipId.value = clip.id
  event.dataTransfer?.setData('text/plain', clip.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onTrackClipDrop(target: TrackClip): void {
  const source = trackLanes.value.flatMap((lane) => lane.clips).find((clip) => clip.id === draggingClipId.value)
  draggingClipId.value = ''
  if (!source || source.id === target.id) return
  if (target.locked) {
    toast('目标片段已锁定，无法插入', 'warn')
    return
  }
  const sourceStep = project.value.steps.find((step) => step.stepId === source.stepId)
  const targetStep = project.value.steps.find((step) => step.stepId === target.stepId)
  if (!sourceStep || !targetStep) return
  const sourceIndex = sourceStep.actions.findIndex((action) => action.actionId === source.actionId)
  if (sourceIndex < 0) return
  const [action] = sourceStep.actions.splice(sourceIndex, 1)
  if (!action) return
  action.start = undefined
  const insertAt = targetStep.actions.findIndex((item) => item.actionId === target.actionId)
  targetStep.actions.splice(insertAt < 0 ? targetStep.actions.length : insertAt, 0, action)
  selectedStepId.value = targetStep.stepId
  selectedActionId.value = action.actionId
  previewAt(target.startFrame / TIMELINE_FPS)
  toast('动作已移动到目标轨道位置')
}

interface TrimState {
  clip: TrackClip
  startX: number
  laneWidth: number
  frames: number
  startDurationFrames: number
  snapPoints: number[]
}

let trimState: TrimState | null = null

function trimSpeedOf(clip: TrackClip): number {
  const step = project.value.steps.find((item) => item.stepId === clip.stepId)
  const action = step?.actions.find((item) => item.actionId === clip.actionId)
  const cameraAction = action?.actionType === 'flyTo' || action?.actionType === 'recordRoute'
  return cameraAction ? clamp(step?.speedRate ?? 1, 0.25, 4) : 1
}

function onTrimStart(clip: TrackClip, event: PointerEvent): void {
  if (event.button !== 0) return
  if (clip.locked) {
    toast('该片段已锁定，请先解锁', 'warn')
    return
  }
  event.preventDefault()
  event.stopPropagation()
  const lane = (event.currentTarget as HTMLElement | null)?.closest('.ps-track__lane') as HTMLElement | null
  if (!lane) return
  const rect = lane.getBoundingClientRect()
  if (!rect.width) return
  trimState = {
    clip,
    startX: event.clientX,
    laneWidth: rect.width,
    frames: trackFrames.value,
    startDurationFrames: clip.durationFrames,
    snapPoints: trackSnapPoints(trackLanes.value, clip.id)
  }
  window.addEventListener('pointermove', onTrimMove)
  window.addEventListener('pointerup', onTrimEnd, { once: true })
}

function onTrimMove(event: PointerEvent): void {
  if (!trimState) return
  const { clip, startX, laneWidth, frames, startDurationFrames, snapPoints } = trimState
  const deltaFrames = Math.round(((event.clientX - startX) / laneWidth) * frames)
  const rawEnd = clip.startFrame + startDurationFrames + deltaFrames
  const snappedEnd = snapFrame(rawEnd, snapPoints)
  const durationFrames = trimmedFrames(clip.startFrame, Math.max(clip.startFrame + 1, snappedEnd), frames)
  const step = project.value.steps.find((item) => item.stepId === clip.stepId)
  const action = step?.actions.find((item) => item.actionId === clip.actionId)
  if (!action) return
  action.duration = clamp((durationFrames / TIMELINE_FPS) * trimSpeedOf(clip), 0.2, 600)
  previewAt((clip.startFrame + durationFrames) / TIMELINE_FPS)
}

function onTrimEnd(): void {
  if (!trimState) return
  window.removeEventListener('pointermove', onTrimMove)
  trimState = null
  toast('片段时长已调整，后续动作自动顺延')
}

function onLaneDrop(lane: { id: string; clips: TrackClip[] }, event: DragEvent): void {
  const source = trackLanes.value.flatMap((item) => item.clips).find((clip) => clip.id === draggingClipId.value)
  draggingClipId.value = ''
  if (!source || source.kind !== lane.id || source.locked) return
  const stepTiming = timeline.value.steps.find((item) => item.step.stepId === source.stepId)
  const step = project.value.steps.find((item) => item.stepId === source.stepId)
  const action = step?.actions.find((item) => item.actionId === source.actionId)
  if (!stepTiming || !action) return
  const target = event.currentTarget as HTMLElement | null
  if (!target) return
  const rect = target.getBoundingClientRect()
  if (!rect.width) return
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1)
  const stepStartFrame = Math.round(stepTiming.start * TIMELINE_FPS)
  const localRaw = Math.round(ratio * trackFrames.value - stepStartFrame)
  const localPoints = trackSnapPoints(trackLanes.value, source.id)
    .map((point) => point - stepStartFrame)
    .filter((point) => point >= 0)
  const localFrame = Math.max(0, snapFrame(localRaw, localPoints))
  action.start = localFrame > 0 ? Math.min(600, localFrame / TIMELINE_FPS) : undefined
  selectedStepId.value = source.stepId
  selectedActionId.value = source.actionId
  previewAt(Math.max(0, (stepStartFrame + localFrame) / TIMELINE_FPS))
  toast(localFrame > 0 ? '片段起点已调整并吸附' : '片段已恢复为自动衔接')
}

function seekTrack(event: MouseEvent): void {
  const target = event.currentTarget as HTMLElement | null
  if (!target) return
  const rect = target.getBoundingClientRect()
  if (!rect.width) return
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1)
  seek((ratio * trackFrames.value) / TIMELINE_FPS)
}

const recorderFormat = detectRecorderFormat()
const exportSettings = reactive<ExportSettings>({
  resolution: '1080p',
  fps: 30,
  mode: 'realtime',
  format: 'video',
  fit: 'contain'
})
const exportState = reactive<ExportState>({
  active: false,
  progress: 0,
  phase: 'preparing',
  message: '',
  mime: '',
  extension: ''
})

const recording = reactive({ active: false, startedAt: 0, elapsed: 0, sampleCount: 0 })
const recordingSmoothing = ref(0.45)

const dialog = reactive<DialogState>({ kind: null, value: '', note: '', projectId: '', message: '' })
const toasts = ref<ToastItem[]>([])
let toastSeed = 0
let pendingAction: (() => void) | null = null
let restoredNotice = bootState.restored

let rafId = 0
let lastFrameTs = 0
let recordingTimer: number | undefined
let draftTimer: number | undefined
let recordingSamples: { pose: CameraPose; elapsed: number }[] = []
let exportController: AbortController | null = null
let exportCancelled = false
let suspendDraft = false

const fileInputRef = ref<HTMLInputElement | null>(null)

function toast(text: string, tone: ToastItem['tone'] = 'info'): void {
  toastSeed += 1
  const item: ToastItem = { id: toastSeed, text, tone }
  toasts.value.push(item)
  window.setTimeout(() => {
    toasts.value = toasts.value.filter((entry) => entry.id !== item.id)
  }, 3600)
}

function initializeSelection(): void {
  const step = project.value.steps[0]
  selectedStepId.value = step?.stepId ?? ''
  selectedActionId.value = step?.actions[0]?.actionId ?? ''
}

function ensureSelection(): void {
  if (!project.value.steps.some((step) => step.stepId === selectedStepId.value)) {
    selectedStepId.value = project.value.steps[0]?.stepId ?? ''
  }
  if (!selectedStep.value) {
    selectedActionId.value = ''
    return
  }
  if (!selectedStep.value.actions.some((action) => action.actionId === selectedActionId.value)) {
    selectedActionId.value = selectedStep.value.actions[0]?.actionId ?? ''
  }
}

function applyRuntimeAt(time: number): void {
  const frame = Math.round(clamp(time, 0, total.value) * TIMELINE_FPS)
  const next = evaluateFrame(timeline.value, frame, project.value.initial, TIMELINE_FPS)
  runtime.value = next
  if (scene?.isReady) scene.applyRuntime(next)
}

function setSceneInputs(enabled: boolean): void {
  scene?.setCameraInputs(enabled)
}

function previewAt(time: number): void {
  pausePlayback()
  const clamped = clamp(time, 0, total.value)
  currentTime.value = clamped
  mode.value = 'preview'
  setSceneInputs(true)
  applyRuntimeAt(clamped)
}

function selectStep(step: PresentationStep, preview = true): void {
  selectedStepId.value = step.stepId
  selectedActionId.value = step.actions[0]?.actionId ?? ''
  if (preview) {
    const index = project.value.steps.findIndex((item) => item.stepId === step.stepId)
    previewAt(globalTimeForStep(timeline.value, Math.max(0, index), 0.002))
  }
}

function selectAction(action: PresentationAction): void {
  selectedActionId.value = action.actionId
  previewAt(previewTimeForSelection(timeline.value, selectedStepId.value, action.actionId))
}

function tick(timestamp: number): void {
  if (mode.value !== 'playing') {
    rafId = 0
    return
  }
  if (!lastFrameTs) lastFrameTs = timestamp
  const delta = Math.min(0.12, Math.max(0, (timestamp - lastFrameTs) / 1000))
  lastFrameTs = timestamp
  currentTime.value = Math.min(total.value, currentTime.value + delta * playbackRate.value)
  applyRuntimeAt(currentTime.value)
  if (currentTime.value >= total.value) {
    if (loopPlayback.value) {
      currentTime.value = 0
      lastFrameTs = timestamp
      applyRuntimeAt(0)
      rafId = requestAnimationFrame(tick)
      return
    }
    mode.value = 'paused'
    rafId = 0
    lastFrameTs = 0
    toast('演示已播放完毕', 'success')
    return
  }
  rafId = requestAnimationFrame(tick)
}

function startPlayback(): void {
  if (recording.active) {
    toast('请先结束航线录制再播放', 'warn')
    return
  }
  const playable = hasPlayableActions(project.value)
  if (!playable.ok) {
    toast(playable.message, 'warn')
    return
  }
  if (total.value <= 0.2) {
    toast('当前演示时间轴为空', 'warn')
    return
  }
  if (currentTime.value >= total.value - 0.02) currentTime.value = 0
  mode.value = 'playing'
  lastFrameTs = 0
  setSceneInputs(false)
  cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(tick)
}

function pausePlayback(): void {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  lastFrameTs = 0
  if (mode.value === 'playing') mode.value = 'paused'
  setSceneInputs(true)
}

function togglePlayback(): void {
  if (mode.value === 'playing') pausePlayback()
  else startPlayback()
}

function stopPlayback(): void {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  lastFrameTs = 0
  if (recording.active) cancelRecording()
  mode.value = 'idle'
  currentTime.value = 0
  setSceneInputs(true)
  applyRuntimeAt(0)
}

function stepFrame(seconds: number): void {
  pausePlayback()
  mode.value = 'preview'
  const next = clamp(
    Math.round((currentTime.value + seconds) * TIMELINE_FPS) / TIMELINE_FPS,
    0,
    total.value
  )
  currentTime.value = next
  applyRuntimeAt(next)
}

function seek(time: number): void {
  currentTime.value = clamp(time, 0, total.value)
  lastFrameTs = 0
  applyRuntimeAt(currentTime.value)
  if (mode.value === 'idle') mode.value = 'preview'
}

function previousStep(): void {
  const currentIndex = timeline.value.steps.findIndex((entry) => entry.step.stepId === runtime.value.step?.stepId)
  const target = timeline.value.steps[Math.max(0, currentIndex - 1)]
  if (!target) return
  selectedStepId.value = target.step.stepId
  selectedActionId.value = target.step.actions[0]?.actionId ?? ''
  previewAt(target.start + 0.001)
}

function nextStep(): void {
  const currentIndex = timeline.value.steps.findIndex((entry) => entry.step.stepId === runtime.value.step?.stepId)
  const target = timeline.value.steps[Math.min(timeline.value.steps.length - 1, currentIndex + 1)]
  if (!target) return
  selectedStepId.value = target.step.stepId
  selectedActionId.value = target.step.actions[0]?.actionId ?? ''
  previewAt(target.start + 0.001)
}

function scheduleDraft(): void {
  if (isPlayerMode.value || suspendDraft) return
  if (draftTimer) window.clearTimeout(draftTimer)
  draftTimer = window.setTimeout(() => {
    persistDraft()
  }, 600)
}

let persistQueue: Promise<void> = Promise.resolve()

function persistStore(options: { notify?: boolean; label?: string } = {}): Promise<boolean> {
  if (isPlayerMode.value) return Promise.resolve(true)
  const task = persistQueue.then(() => applyPersist(options))
  persistQueue = task.then(
    () => undefined,
    () => undefined
  )
  return task
}

async function applyPersist(options: { notify?: boolean; label?: string }): Promise<boolean> {
  if (isPlayerMode.value) return true
  if (saveStatus.value !== 'saving') saveStatus.value = 'saving'
  if (hasStudioPlugins()) runProjectSaveHooks(runtimeToDocument(project.value))
  const result: SaveResult = await writeStoreSafe(store.value)
  if (result.ok) {
    saveError.value = ''
    saveStatus.value = 'saved'
    if (result.warning) {
      storageNotice.value = result.warning
      if (options.notify) toast(result.warning, 'warn')
    } else {
      storageNotice.value = ''
    }
    if (options.notify) {
      recordDiagnostic('orchestration', 'save', 'info', { location: result.location, bytes: result.bytes })
      toast(
        `${options.label ?? '已保存'}（${result.location === 'localstorage' ? '本地快照' : 'IndexedDB + 本地快照'}）`,
        'success'
      )
    }
    return true
  }
  recordDiagnostic('orchestration', 'save-failed', 'error', { code: result.code, message: result.message })
  saveStatus.value = 'failed'
  saveError.value = result.message
  toast(`${options.label ?? '保存'}失败：${result.message}`, 'error')
  if (result.backup) downloadBlob(result.backup, `${safeFileName(project.value.name)}.recovery.json`)
  return false
}

function persistDraft(): void {
  store.value.draft = {
    projectId: project.value.id,
    project: deepClone(project.value),
    savedAt: nowIso()
  }
  saveStatus.value = 'dirty'
  void persistStore()
}

function commitBaseline(): void {
  savedSignature.value = JSON.stringify(project.value)
  savedSnapshot.value = deepClone(project.value)
  store.value.draft = null
  ensureSelection()
  saveStatus.value = 'clean'
  void persistStore()
}

function resetHistory(): void {
  if (historyTimer) window.clearTimeout(historyTimer)
  historyTimer = undefined
  undoStack.value = []
  redoStack.value = []
  historyBaseline = JSON.stringify(project.value)
}

function commitHistory(): void {
  if (historyTimer) {
    window.clearTimeout(historyTimer)
    historyTimer = undefined
  }
  if (historyApplying) return
  const current = JSON.stringify(project.value)
  if (current === historyBaseline) return
  undoStack.value = [...undoStack.value.slice(-(HISTORY_LIMIT - 1)), historyBaseline]
  redoStack.value = []
  historyBaseline = current
}

function scheduleHistory(): void {
  if (isPlayerMode.value || historyApplying) return
  if (historyTimer) window.clearTimeout(historyTimer)
  historyTimer = window.setTimeout(commitHistory, 550)
}

function applyHistorySnapshot(snapshot: string): void {
  const parsed = JSON.parse(snapshot) as PresentationProject
  const index = store.value.projects.findIndex((item) => item.id === parsed.id)
  if (index < 0) return
  historyApplying = true
  store.value.projects.splice(index, 1, parsed)
  historyBaseline = snapshot
  store.value.draft = { projectId: parsed.id, project: deepClone(parsed), savedAt: nowIso() }
  ensureSelection()
  currentTime.value = clamp(currentTime.value, 0, total.value)
  applyRuntimeAt(currentTime.value)
  scheduleDraft()
  scheduleCustomLayerSync()
  void nextTick(() => {
    historyApplying = false
  })
}

function undo(): void {
  commitHistory()
  const snapshot = undoStack.value[undoStack.value.length - 1]
  if (!snapshot) {
    toast('没有可撤销的操作', 'warn')
    return
  }
  undoStack.value = undoStack.value.slice(0, -1)
  redoStack.value = [...redoStack.value, JSON.stringify(project.value)]
  applyHistorySnapshot(snapshot)
  toast('已撤销上一步操作')
}

function redo(): void {
  commitHistory()
  const snapshot = redoStack.value[redoStack.value.length - 1]
  if (!snapshot) {
    toast('没有可重做的操作', 'warn')
    return
  }
  redoStack.value = redoStack.value.slice(0, -1)
  undoStack.value = [...undoStack.value, JSON.stringify(project.value)]
  applyHistorySnapshot(snapshot)
  toast('已重做上一步操作')
}

function saveProject(): void {
  if (isPlayerMode.value) {
    toast('只读播放模式无法保存工程', 'warn')
    return
  }
  project.value.updateTime = nowIso()
  const index = store.value.projects.findIndex((item) => item.id === project.value.id)
  const stored = deepClone(project.value)
  if (index >= 0) store.value.projects[index] = stored
  store.value.draft = null
  savedSignature.value = JSON.stringify(stored)
  savedSnapshot.value = deepClone(stored)
  void persistStore({ notify: true })
}

function discardChanges(): void {
  if (!savedSnapshot.value) return
  const index = store.value.projects.findIndex((item) => item.id === project.value.id)
  if (index >= 0) store.value.projects[index] = deepClone(savedSnapshot.value)
  initializeSelection()
  resetHistory()
  currentTime.value = 0
  applyRuntimeAt(0)
  toast('已恢复到上次保存的状态')
}

function guardUnsaved(action: () => void): void {
  if (!isDirty.value) {
    action()
    return
  }
  pendingAction = action
  openDialog('unsaved', project.value.name)
}

function saveAndContinue(): void {
  saveProject()
  const action = pendingAction
  pendingAction = null
  dialog.kind = null
  action?.()
}

function discardAndContinue(): void {
  discardChanges()
  const action = pendingAction
  pendingAction = null
  dialog.kind = null
  action?.()
}

function openDialog(kind: DialogState['kind'], value = '', projectId = ''): void {
  dialog.kind = kind
  dialog.value = value
  dialog.note = ''
  dialog.projectId = projectId
  dialog.message = ''
}

function closeDialog(): void {
  dialog.kind = null
  pendingAction = null
}

function confirmDialog(): void {
  const current = dialog.kind
  if (current === 'new') {
    const name = dialog.value.trim() || '未命名演示'
    const created = createProject(name, deepClone(project.value.initial))
    store.value.projects.push(created)
    store.value.currentId = created.id
    initializeSelection()
    commitBaseline()
    resetHistory()
    currentTime.value = 0
    applyRuntimeAt(0)
    dialog.kind = null
    toast('已创建新演示', 'success')
    return
  }
  if (current === 'rename') {
    const nextName = dialog.value.trim()
    if (nextName) project.value.name = nextName.slice(0, 60)
    dialog.kind = null
    return
  }
  if (current === 'saveAs') {
    const clone = deepClone(project.value)
    clone.id = createId('prj')
    clone.name = dialog.value.trim() || `${project.value.name} 副本`
    clone.createTime = nowIso()
    clone.updateTime = nowIso()
    store.value.projects.push(clone)
    store.value.currentId = clone.id
    initializeSelection()
    commitBaseline()
    resetHistory()
    currentTime.value = 0
    applyRuntimeAt(0)
    dialog.kind = null
    toast('已另存为新工程', 'success')
    return
  }
  if (current === 'projectSettings') {
    project.value.name = dialog.value.trim() || project.value.name
    project.value.note = dialog.note.slice(0, 800)
    dialog.kind = null
    return
  }
  if (current === 'deleteProject') {
    const index = store.value.projects.findIndex((item) => item.id === dialog.projectId)
    if (index < 0) {
      dialog.kind = null
      return
    }
    if (store.value.projects.length <= 1) {
      toast('至少保留一个演示工程', 'warn')
      dialog.kind = null
      return
    }
    const wasCurrent = project.value.id === dialog.projectId
    store.value.projects.splice(index, 1)
    dialog.kind = null
    if (wasCurrent) {
      store.value.currentId = store.value.projects[0]!.id
      initializeSelection()
      commitBaseline()
      resetHistory()
      currentTime.value = 0
      applyRuntimeAt(0)
    }
    toast('工程已删除')
    return
  }
  if (current === 'importError') {
    dialog.kind = null
    return
  }
  dialog.kind = null
}

function switchProject(id: string): void {
  if (id === project.value.id) return
  guardUnsaved(() => {
    store.value.currentId = id
    store.value.draft = null
    initializeSelection()
    const saved = store.value.projects.find((item) => item.id === id)
    savedSignature.value = JSON.stringify(saved ?? project.value)
    savedSnapshot.value = saved ? deepClone(saved) : null
    resetHistory()
    currentTime.value = 0
    mode.value = 'idle'
    applyRuntimeAt(0)
    toast(`已切换到「${project.value.name}」`)
  })
}

function createNewProject(): void {
  guardUnsaved(() => openDialog('new', '未命名演示'))
}

function openRename(): void {
  openDialog('rename', project.value.name)
}

function openSaveAs(): void {
  openDialog('saveAs', `${project.value.name} 副本`)
}

function openProjectSettings(): void {
  openDialog('projectSettings', project.value.name)
  dialog.note = project.value.note
}

function requestDeleteProject(id: string): void {
  const target = store.value.projects.find((item) => item.id === id)
  if (!target) return
  if (target.id === project.value.id && isDirty.value) {
    guardUnsaved(() => openDialog('deleteProject', target.name, id))
    return
  }
  openDialog('deleteProject', target.name, id)
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'presentation'
}

function exportProjectFile(): void {
  const document = runtimeToDocument(project.value)
  downloadText(serializeDocument(document), `${safeFileName(project.value.name)}.studio.json`)
  toast(`已导出 v${document.schemaVersion} 工程文档`, 'success')
}

async function collectLayerAssets(): Promise<{ assets: PackageAsset[]; warnings: string[] }> {
  const assets: PackageAsset[] = []
  const warnings: string[] = []
  for (const layer of project.value.customLayers) {
    const uri = layer.uri?.trim()
    if (!uri || uri.startsWith('studio://')) continue
    try {
      const response = await fetch(uri)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      const url = new URL(uri, window.location.href)
      const rawName = decodeURIComponent(url.pathname.split('/').pop() || `${layer.id}.bin`)
      assets.push({
        entry: {
          id: `asset_${layer.id}`,
          name: layer.name,
          kind: layer.kind,
          uri: `layers/${layer.id}/${safeFileName(rawName)}`,
          required: true
        },
        blob
      })
    } catch (error) {
      warnings.push(`无法打包图层「${layer.name}」：${error instanceof Error ? error.message : '资源不可访问'}`)
    }
  }
  return { assets, warnings }
}

async function exportProjectPackage(): Promise<void> {
  recordDiagnostic('orchestration', 'package-export-start', 'info', { format: 'studio' })
  try {
    const collected = await collectLayerAssets()
    const result = await packStudioPackage(project.value, collected.assets)
    if (collected.warnings.length) toast(collected.warnings.slice(0, 2).join('；'), 'warn')
    downloadBlob(result.blob, packageFileName(project.value))
    const size = (result.blob.size / 1024).toFixed(1)
    recordDiagnostic('orchestration', 'package-export', 'info', {
      format: 'studio',
      assets: result.assetCount,
      bytes: result.blob.size
    })
    toast(`工程包已导出：${result.assetCount} 个资源 · ${size} KB`, result.warnings.length ? 'warn' : 'success')
    if (result.warnings.length) dialog.message = result.warnings.join('；')
  } catch (error) {
    recordDiagnostic('orchestration', 'package-export-failed', 'error', {
      format: 'studio',
      message: error instanceof Error ? error.message : String(error)
    })
    toast(error instanceof Error ? error.message : '工程包导出失败', 'error')
  }
}

function playerBaseUrl(): string {
  const base = new URL(import.meta.env.BASE_URL || './', window.location.href)
  return base.href.endsWith('/') ? base.href : `${base.href}/`
}

async function exportPlayerPackage(): Promise<void> {
  recordDiagnostic('orchestration', 'package-export-start', 'info', { format: 'player' })
  try {
    const collected = await collectLayerAssets()
    const result = await packPlayerPackage(project.value, playerBaseUrl(), collected.assets)
    if (collected.warnings.length) toast(collected.warnings.slice(0, 2).join('；'), 'warn')
    downloadBlob(result.blob, `${safeFileName(project.value.name)}.player.zip`)
    const size = (result.blob.size / 1024).toFixed(1)
    recordDiagnostic('orchestration', 'package-export', 'info', {
      format: 'player',
      assets: result.assetCount,
      bytes: result.blob.size
    })
    toast(`播放器包已导出：${result.assetCount} 个资源 · ${size} KB`, result.warnings.length ? 'warn' : 'success')
  } catch (error) {
    recordDiagnostic('orchestration', 'package-export-failed', 'error', {
      format: 'player',
      message: error instanceof Error ? error.message : String(error)
    })
    toast(error instanceof Error ? error.message : '播放器包导出失败', 'error')
  }
}

function revokePlayerObjectUrls(): void {
  while (playerObjectUrls.length) {
    const url = playerObjectUrls.pop()
    if (url) URL.revokeObjectURL(url)
  }
}

function isAbsoluteUri(uri: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('//')
}

function resolvePlayerUris(target: PresentationProject, assets: Record<string, Blob> = {}, base = ''): void {
  for (const layer of target.customLayers) {
    const uri = layer.uri?.trim()
    if (!uri || isAbsoluteUri(uri)) continue
    const normalized = uri.replace(/^\.\//, '')
    const blob = assets[normalized] ?? assets[`assets/${normalized}`]
    if (blob) {
      const url = URL.createObjectURL(blob)
      playerObjectUrls.push(url)
      layer.uri = url
      continue
    }
    if (base) {
      try {
        layer.uri = new URL(uri, base).href
      } catch {
        /* 保留原始相对路径，由场景层报错 */
      }
    }
  }
}

function installPlayerProject(target: PresentationProject, assets: Record<string, Blob> = {}, base = ''): void {
  revokePlayerObjectUrls()
  resolvePlayerUris(target, assets, base)
  store.value.projects = [target]
  store.value.currentId = target.id
  store.value.draft = null
  savedSignature.value = JSON.stringify(target)
  savedSnapshot.value = deepClone(target)
  saveStatus.value = 'saved'
  saveError.value = ''
  initializeSelection()
  resetHistory()
  currentTime.value = 0
  playerLoadError.value = ''
  applyRuntimeAt(0)
  runProjectOpenHooks(target)
  if (scene?.isReady) void syncCustomLayersNow()
}

async function loadPlayerBlob(blob: Blob, name: string, base = ''): Promise<string[]> {
  const isZip = /\.zip($|\?)/i.test(name) || blob.type.includes('zip')
  let imported: PresentationProject
  let assets: Record<string, Blob> = {}
  let notes: string[] = []
  if (isZip) {
    const unpacked = await unpackStudioPackage(blob)
    imported = unpacked.parsed.project
    assets = unpacked.assets
    notes = [...unpacked.warnings, ...unpacked.checksumFailures.map((item) => `校验失败：${item}`)]
    if (unpacked.missingAssets.length) notes.push(`缺少必需资源：${unpacked.missingAssets.join('、')}`)
  } else {
    const parsed = parseProjectDocument(JSON.parse(await blob.text()))
    imported = parsed.project
    if (parsed.source !== 'studio-v2') notes = [`已从 ${parsed.source} 迁移为 v2 工程文档`]
  }
  installPlayerProject(imported, assets, base)
  return notes
}

async function loadPlayerProject(url: string): Promise<void> {
  playerLoadError.value = ''
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`工程文件加载失败：HTTP ${response.status}`)
    const notes = await loadPlayerBlob(await response.blob(), url, playerAssetBase)
    if (notes.length) toast(notes.slice(0, 3).join('；'), 'warn')
  } catch (error) {
    playerLoadError.value = error instanceof Error ? error.message : '无法加载工程文件'
    recordDiagnostic('resource', 'player-load-failed', 'error', { url, message: playerLoadError.value })
  }
}

async function retryPlayerLoad(): Promise<void> {
  if (playerProjectUrl) await loadPlayerProject(playerProjectUrl)
  if (!sceneStatus.ready && !sceneStatus.failed) await bootScene()
}

function triggerImport(): void {
  fileInputRef.value?.click()
}

async function onFilePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (isPlayerMode.value) {
    try {
      const notes = await loadPlayerBlob(file, file.name)
      toast(`已加载「${project.value.name}」`, 'success')
      if (notes.length) toast(notes.slice(0, 3).join('；'), 'warn')
      if (!sceneStatus.ready && !sceneStatus.failed) await bootScene()
    } catch (error) {
      playerLoadError.value = error instanceof Error ? error.message : '无法解析工程文件'
      recordDiagnostic('resource', 'player-file-failed', 'error', { message: playerLoadError.value })
    }
    return
  }
  try {
    let imported: PresentationProject
    let notes: string[] = []
    if (/\.zip$/i.test(file.name)) {
      const unpacked = await unpackStudioPackage(file)
      imported = unpacked.parsed.project
      notes = [...unpacked.warnings, ...unpacked.checksumFailures.map((name) => `校验失败：${name}`)]
      if (unpacked.missingAssets.length) notes.push(`缺少必需资源：${unpacked.missingAssets.join('、')}`)
    } else {
      const parsed = parseProjectDocument(JSON.parse(await file.text()))
      imported = parsed.project
      if (parsed.source !== 'studio-v2') notes = [`已从 ${parsed.source} 迁移为 v2 工程文档`]
    }
    if (store.value.projects.some((item) => item.id === imported.id)) imported.id = createId('prj')
    imported.updateTime = nowIso()
    store.value.projects.push(imported)
    store.value.currentId = imported.id
    store.value.draft = null
    savedSignature.value = JSON.stringify(project.value)
    savedSnapshot.value = deepClone(project.value)
    initializeSelection()
    resetHistory()
    currentTime.value = 0
    applyRuntimeAt(0)
    runProjectOpenHooks(imported)
    void persistStore({ label: '导入工程' })
    recordDiagnostic('orchestration', 'import', 'info', { name: imported.name, warnings: notes.length })
    toast(`已导入「${imported.name}」`, 'success')
    if (notes.length) toast(notes.slice(0, 3).join('；'), 'warn')
  } catch (error) {
    const message = error instanceof Error ? error.message : '无法解析工程文件'
    recordDiagnostic('orchestration', 'import-failed', 'error', { message })
    openDialog('importError', '', '')
    dialog.message = message
  }
}

function addStep(): void {
  const step = createStep(project.value.steps.length + 1)
  project.value.steps.push(step)
  selectStep(step, false)
  previewAt(globalTimeForStep(timeline.value, project.value.steps.length - 1, 0.002))
  toast('已新增步骤', 'success')
}

function duplicateStep(index: number): void {
  const source = project.value.steps[index]
  if (!source) return
  const clone = deepClone(source)
  clone.stepId = createId('step')
  clone.stepName = `${source.stepName} 副本`
  clone.actions.forEach((action) => {
    action.actionId = createId('act')
  })
  project.value.steps.splice(index + 1, 0, clone)
  selectStep(clone, false)
  toast('已复制步骤', 'success')
}

function deleteStep(index: number): void {
  if (project.value.steps.length <= 1) {
    toast('演示至少保留一个步骤', 'warn')
    return
  }
  const [removed] = project.value.steps.splice(index, 1)
  if (removed && removed.stepId === selectedStepId.value) {
    const next = project.value.steps[Math.min(index, project.value.steps.length - 1)]
    if (next) selectStep(next, false)
  }
  ensureSelection()
  applyRuntimeAt(clamp(currentTime.value, 0, total.value))
  toast('步骤已删除')
}

function moveStep(index: number, delta: number): void {
  const target = index + delta
  if (target < 0 || target >= project.value.steps.length) return
  const [item] = project.value.steps.splice(index, 1)
  if (!item) return
  project.value.steps.splice(target, 0, item)
  ensureSelection()
  applyRuntimeAt(clamp(currentTime.value, 0, total.value))
}

function addAction(type: ActionType): void {
  if (!selectedStep.value) return
  const camera = scene?.isReady ? scene.getPose() : project.value.initial.camera
  const action = createAction(type, {
    camera,
    layers: project.value.initial.layers,
    effects: project.value.initial.effects
  })
  if (action.actionType === 'flyTo') {
    action.camera = { ...camera }
  }
  if (action.actionType === 'subtitle' && action.subtitle.position === 'callout') {
    action.subtitle.callout = { longitude: PAGODA_CENTER.longitude, latitude: PAGODA_CENTER.latitude, height: 60 }
  }
  selectedStep.value.actions.push(action)
  selectedActionId.value = action.actionId
  previewAt(previewTimeForSelection(timeline.value, selectedStep.value.stepId, action.actionId))
  toast(`已添加「${ACTION_DEFINITIONS.find((item) => item.type === type)?.name ?? type}」动作`, 'success')
}

function moveAction(index: number, delta: number): void {
  if (!selectedStep.value) return
  const target = index + delta
  if (target < 0 || target >= selectedStep.value.actions.length) return
  const source = selectedStep.value.actions[index]
  const neighbor = selectedStep.value.actions[target]
  if (source?.locked || neighbor?.locked) return
  const [item] = selectedStep.value.actions.splice(index, 1)
  if (!item) return
  selectedStep.value.actions.splice(target, 0, item)
  applyRuntimeAt(clamp(currentTime.value, 0, total.value))
}

function duplicateAction(index: number): void {
  if (!selectedStep.value) return
  const source = selectedStep.value.actions[index]
  if (!source) return
  const clone = deepClone(source)
  clone.actionId = createId('act')
  clone.locked = false
  selectedStep.value.actions.splice(index + 1, 0, clone)
  selectedActionId.value = clone.actionId
  toast('已复制动作', 'success')
}

function deleteAction(index: number): void {
  if (!selectedStep.value) return
  selectedStep.value.actions.splice(index, 1)
  ensureSelection()
  applyRuntimeAt(clamp(currentTime.value, 0, total.value))
  toast('动作已删除')
}

let customLayerTimer: number | undefined
const customLayerStates = ref<Record<string, CustomLayerState>>({})

function refreshCustomLayerStates(): void {
  if (!scene?.isReady) {
    customLayerStates.value = {}
    return
  }
  const next: Record<string, CustomLayerState> = {}
  for (const state of scene.getCustomLayerStates()) next[state.id] = state
  customLayerStates.value = next
}

async function syncCustomLayersNow(): Promise<void> {
  if (!scene?.isReady) return
  await scene.syncCustomLayers(deepClone(project.value.customLayers))
  refreshCustomLayerStates()
}

function toggleCustomLayerLock(layer: CustomLayer): void {
  layer.locked = !layer.locked
  scheduleDraft()
}

function onCustomLayerOpacityChanged(): void {
  scheduleDraft()
  scheduleCustomLayerSync()
}

function toggleActionLock(action: PresentationAction): void {
  action.locked = !action.locked
  scheduleDraft()
}

function selectExportMode(format: ExportSettings['format'], mode: ExportSettings['mode']): void {
  exportSettings.format = format
  exportSettings.mode = mode
}

function scheduleCustomLayerSync(): void {
  if (customLayerTimer) window.clearTimeout(customLayerTimer)
  customLayerTimer = window.setTimeout(() => {
    void syncCustomLayersNow()
  }, 350)
}

async function retryCustomLayer(layer: CustomLayer): Promise<void> {
  if (!scene?.isReady) {
    toast('三维场景尚未就绪', 'warn')
    return
  }
  customLayerStates.value = { ...customLayerStates.value, [layer.id]: { id: layer.id, status: 'loading' } }
  await syncCustomLayersNow()
  const state = customLayerStates.value[layer.id]
  if (state?.status === 'ready') toast(`图层「${layer.name}」已加载`, 'success')
  else toast(state?.message ? `图层加载失败：${state.message}` : '图层加载失败', 'error')
}

function customLayerStatusLabel(status: CustomLayerState['status'] | undefined): string {
  if (status === 'loading') return '加载中'
  if (status === 'ready') return '已加载'
  if (status === 'error') return '失败'
  return '待配置'
}

function customLayerUriIssue(layer: CustomLayer): string {
  const uri = layer.uri.trim()
  if (!uri) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) && !/^https?:/i.test(uri)) return '仅支持 http(s) 或工程内相对路径'
  if (uri.startsWith('/') || /^[a-z]:[\\/]/i.test(uri) || uri.split('/').includes('..'))
    return '请使用工程内相对路径，避免绝对路径与上级目录'
  return ''
}

function addCustomLayer(kind: '3dtiles' | 'geojson' = '3dtiles'): void {
  project.value.customLayers.push({
    id: createId('layer'),
    name: kind === 'geojson' ? 'GeoJSON 图层' : '3D Tiles 图层',
    kind,
    uri: '',
    visible: true,
    locked: false,
    opacity: 1
  })
  scheduleDraft()
  scheduleCustomLayerSync()
}

function removeCustomLayer(id: string): void {
  const index = project.value.customLayers.findIndex((layer) => layer.id === id)
  if (index < 0) return
  project.value.customLayers.splice(index, 1)
  scheduleDraft()
  scheduleCustomLayerSync()
}

function moveCustomLayer(id: string, delta: number): void {
  const list = project.value.customLayers
  const index = list.findIndex((layer) => layer.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= list.length) return
  const [layer] = list.splice(index, 1)
  list.splice(target, 0, layer)
  scheduleDraft()
  scheduleCustomLayerSync()
}

function onCustomLayerEdited(layer: { uri: string }): void {
  if (!layer.uri.trim()) return
  scheduleDraft()
  scheduleCustomLayerSync()
}

function previewInitialState(): void {
  pausePlayback()
  currentTime.value = 0
  applyRuntimeAt(0)
}

function captureInitialCamera(): void {
  if (!scene?.isReady) {
    toast('三维场景尚未就绪', 'warn')
    return
  }
  project.value.initial.camera = scene.getPose()
  toast('已捕获当前视角为初始机位', 'success')
}

function resetInitialState(): void {
  project.value.initial = createBlankInitial()
  applyRuntimeAt(currentTime.value)
  toast('初始状态已重置')
}

function captureFlyCamera(): void {
  if (!flyAction.value || !scene?.isReady) {
    toast('三维场景尚未就绪', 'warn')
    return
  }
  flyAction.value.camera = scene.getPose()
  flyAction.value.targetId = null
  toast('已捕获当前视角', 'success')
}

function applyLandmarkToFly(id: string): void {
  const landmark = LANDMARK_MAP[id]
  if (!landmark || !flyAction.value) return
  flyAction.value.targetId = id
  flyAction.value.camera = { ...landmark.camera }
  toast(`机位已对齐「${landmark.name}」`, 'success')
}

function applyLandmarkToCallout(id: string): void {
  const landmark = LANDMARK_MAP[id]
  if (!landmark || !subtitleAction.value) return
  subtitleAction.value.subtitle.callout = {
    longitude: landmark.longitude,
    latitude: landmark.latitude,
    height: landmark.height + 30
  }
  toast(`标注锚点已设为「${landmark.name}」`, 'success')
}

function focusLandmark(id: string): void {
  const landmark = LANDMARK_MAP[id]
  if (!landmark || !scene?.isReady) {
    toast('三维场景尚未就绪', 'warn')
    return
  }
  pausePlayback()
  mode.value = 'idle'
  scene.setPose(landmark.camera, true)
  setSceneInputs(true)
  toast(`已定位到「${landmark.name}」`)
}

function sampleRecording(): void {
  if (!scene?.isReady || !recording.active) return
  const pose = scene.getPose()
  const elapsed = performance.now() - recording.startedAt
  recording.elapsed = elapsed
  recordingSamples.push({ pose, elapsed })
  recording.sampleCount = recordingSamples.length
  scene.setRecordingTrail(recordingSamples.map((item) => item.pose))
}

function startRecording(): void {
  if (!scene?.isReady) {
    toast('三维场景尚未就绪', 'warn')
    return
  }
  if (recording.active) return
  if (mode.value === 'playing') pausePlayback()
  if (!selectedStep.value) return
  recording.active = true
  recording.startedAt = performance.now()
  recording.elapsed = 0
  const first = scene.getPose()
  recordingSamples = [{ pose: first, elapsed: 0 }]
  recording.sampleCount = 1
  scene.clearRecordingTrail()
  scene.setRecordingTrail([first])
  scene.setCameraInputs(true)
  mode.value = 'recording'
  recordingTimer = window.setInterval(sampleRecording, 120)
  toast('开始录制：拖动三维场景，完成后停止录制', 'info')
}

function finishRecording(): void {
  if (!recording.active) return
  if (recordingTimer) window.clearInterval(recordingTimer)
  recordingTimer = undefined
  sampleRecording()
  scene?.clearRecordingTrail()
  const route = finalizeRoute(recordingSamples, recordingSmoothing.value)
  recording.active = false
  if (route.samples.length < 2) {
    toast('采样点不足，请录制更长的镜头', 'warn')
    mode.value = 'idle'
    applyRuntimeAt(currentTime.value)
    return
  }
  if (!selectedStep.value) {
    mode.value = 'idle'
    return
  }
  const action = createAction('recordRoute')
  if (action.actionType !== 'recordRoute') return
  action.route = route
  action.duration = Math.max(1.5, Math.round(route.recordedDuration * 10) / 10)
  action.entryBlend = 1.2
  action.showTrail = true
  action.note = '现场录制'
  selectedStep.value.actions.push(action)
  selectedActionId.value = action.actionId
  previewAt(previewTimeForSelection(timeline.value, selectedStep.value.stepId, action.actionId))
  toast(`航线已生成：${route.samples.length} 个采样点`, 'success')
}

function cancelRecording(): void {
  if (recordingTimer) window.clearInterval(recordingTimer)
  recordingTimer = undefined
  recording.active = false
  recordingSamples = []
  scene?.clearRecordingTrail()
  mode.value = 'idle'
  toast('已取消录制')
}

function smoothRoute(): void {
  if (!routeAction.value) return
  const route = finalizeRoute(
    routeAction.value.route.samples.map((sample) => ({
      pose: { ...sample },
      elapsed: sample.t * routeAction.value!.route.recordedDuration * 1000
    })),
    routeAction.value.route.smoothing
  )
  routeAction.value.route = route
  toast('航线已按当前强度重新平滑', 'success')
}

function purgeRoute(): void {
  if (!routeAction.value) return
  routeAction.value.route.samples = []
  routeAction.value.route.recordedDuration = 0
  routeAction.value.duration = 4
  toast('航线数据已清空')
}

function openExportDialog(): void {
  if (recording.active) {
    toast('请先结束航线录制再导出', 'warn')
    return
  }
  pausePlayback()
  const playable = hasPlayableActions(project.value)
  if (!playable.ok) {
    toast(playable.message, 'warn')
    return
  }
  if (exportSettings.format !== 'frames' && !recorderFormat) {
    toast('当前浏览器不支持 MediaRecorder，可切换为逐帧序列导出', 'warn')
  }
  openDialog('export', '', '')
}

function projectScaledPoint(width: number, height: number) {
  return (longitude: number, latitude: number, altitude: number) => {
    if (!scene?.isReady) return { x: 0, y: 0, visible: false }
    const point = scene.project(longitude, latitude, altitude)
    const canvas = scene.canvas
    const cssWidth = canvas?.clientWidth || width
    const cssHeight = canvas?.clientHeight || height
    return {
      x: (point.x / cssWidth) * width,
      y: (point.y / cssHeight) * height,
      visible: point.visible
    }
  }
}

async function startExport(): Promise<void> {
  if (!scene?.isReady || !scene.canvas) {
    toast('三维场景尚未就绪', 'warn')
    return
  }
  const profile = profileFor({ ...exportSettings })
  if (profile.format === 'video' && !recorderFormat) {
    toast('当前浏览器不支持视频导出，可切换为逐帧序列', 'error')
    return
  }
  const playable = hasPlayableActions(project.value)
  if (!playable.ok) {
    toast(playable.message, 'warn')
    return
  }
  dialog.kind = null
  pausePlayback()
  runBeforeExportHooks(profile)
  exportCancelled = false
  mode.value = 'exporting'
  exportState.active = true
  exportState.progress = 0
  exportState.phase = 'preparing'
  exportState.message = '准备导出环境'
  exportState.mime = profile.format === 'video' ? (recorderFormat?.mime ?? '') : 'image/png'
  exportState.extension = profile.format === 'video' ? (recorderFormat?.extension ?? 'webm') : 'zip'
  const controller = new AbortController()
  exportController = controller
  recordDiagnostic('export', 'start', 'info', {
    format: profile.format,
    width: profile.width,
    height: profile.height,
    fps: profile.fps
  })
  const viewportWidth = scene.canvas.clientWidth || 1280
  scene.setResolutionScale(clamp(profile.width / viewportWidth, 1, 2.4))
  await nextTick()
  const projectPoint = projectScaledPoint(profile.width, profile.height)
  const applyFrame = (next: RuntimeState): void => {
    runtime.value = next
    if (scene?.isReady) scene.applyRuntime(next)
  }
  try {
    const output = await (profile.format === 'frames' ? exportFrameSequence : exportRealtime)({
      profile,
      totalSeconds: total.value,
      signal: controller.signal,
      evaluate: (seconds) =>
        evaluateFrame(timeline.value, Math.round(seconds * profile.fps), project.value.initial, profile.fps),
      apply: applyFrame,
      requestRender: () => scene?.requestRender(),
      waitUntilVisible: async () => {
        const readiness = await scene?.waitUntilVisible(20000)
        if (readiness?.warnings.length && !exportCancelled) {
          exportState.message = readiness.warnings[0]
        }
      },
      sourceCanvas: () => scene?.canvas ?? null,
      drawOverlay: (ctx, width, height, state) => drawExportOverlay(ctx, width, height, state, projectPoint),
      onProgress: (progress: ExportProgress) => {
        exportState.phase = progress.phase
        exportState.progress = progress.progress
        exportState.message = progress.message
        if (progress.diagnostics?.warnings.length) storageNotice.value = progress.diagnostics.warnings[0]
      }
    })
    if (exportCancelled) return
    const filename = `${safeFileName(project.value.name)}.${output.extension}`
    downloadBlob(output.blob, filename)
    const size = (output.blob.size / 1024 / 1024).toFixed(1)
    recordDiagnostic('export', 'complete', 'info', {
      format: profile.format,
      bytes: output.blob.size,
      extension: output.extension
    })
    toast(`${profile.format === 'frames' ? '逐帧序列' : '视频'}已导出：${size} MB`, 'success')
  } catch (error) {
    if (exportCancelled || (error instanceof DOMException && error.name === 'AbortError')) {
      recordDiagnostic('export', 'cancelled', 'warn', { format: profile.format })
      toast('已取消导出')
    } else {
      const message = error instanceof Error ? error.message : '导出失败'
      recordDiagnostic('export', 'failed', 'error', { format: profile.format, message })
      toast(message, 'error')
    }
  } finally {
    exportController = null
    cleanupExport()
  }
}

function cleanupExport(): void {
  exportState.active = false
  exportState.phase = exportCancelled ? 'cancelled' : 'done'
  exportState.progress = 0
  exportState.message = ''
  mode.value = 'idle'
  scene?.setResolutionScale(1)
  currentTime.value = 0
  applyRuntimeAt(0)
}

function cancelExport(): void {
  exportCancelled = true
  exportController?.abort()
  exportController = null
}

function toggleFullscreen(): void {
  const target = stageRef.value
  if (!target) return
  if (document.fullscreenElement) {
    void document.exitFullscreen()
    return
  }
  void target.requestFullscreen?.()
}

function onFullscreenChange(): void {
  isFullscreen.value = document.fullscreenElement === stageRef.value
}

function formatPoseValue(value: number, digits = 4): string {
  return Number(value).toFixed(digits)
}

function subtitleStyle(view: SubtitleView): Record<string, string | number> {
  const param = view.param
  const style: Record<string, string | number> = {
    opacity: view.alpha,
    color: param.color,
    maxWidth: `${param.maxWidth}px`,
    fontSize: `${param.fontSize}px`,
    textAlign: param.align,
    '--ps-accent': param.accent
  }
  if (param.position === 'callout' && param.callout) {
    const point = scene?.isReady
      ? scene.project(param.callout.longitude, param.callout.latitude, param.callout.height)
      : { x: 0, y: 0, visible: false }
    if (!point.visible) style.opacity = 0
    style.left = `${point.x}px`
    style.top = `${point.y}px`
  }
  return style
}

function popupStyle(view: PopupView): Record<string, string | number> {
  const landmark = view.param.targetId ? LANDMARK_MAP[view.param.targetId] : null
  const point =
    landmark && scene?.isReady
      ? scene.project(landmark.longitude, landmark.latitude, landmark.height + 40)
      : { x: (scene?.canvas?.clientWidth ?? 900) / 2, y: (scene?.canvas?.clientHeight ?? 600) / 2, visible: true }
  const style: Record<string, string | number> = {
    opacity: point.visible ? view.alpha : 0,
    left: `${point.x}px`,
    top: `${point.y}px`,
    maxWidth: `${view.param.width}px`,
    '--ps-popup-accent': view.param.accent
  }
  return style
}

function onKeydown(event: KeyboardEvent): void {
  if (dialog.kind) {
    if (event.key === 'Escape') closeDialog()
    return
  }
  const target = event.target as HTMLElement | null
  if (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  ) {
    return
  }
  if (event.ctrlKey || event.metaKey) {
    if (isPlayerMode.value) {
      if (['s', 'e', 'z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        toast('只读播放模式，编辑功能已禁用', 'warn')
      }
      return
    }
    if (event.key.toLowerCase() === 's') {
      event.preventDefault()
      saveProject()
    }
    if (event.key.toLowerCase() === 'e') {
      event.preventDefault()
      openExportDialog()
    }
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    if (event.key.toLowerCase() === 'y') {
      event.preventDefault()
      redo()
    }
    return
  }
  if (event.code === 'Space') {
    event.preventDefault()
    togglePlayback()
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    stepFrame(-0.2)
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    stepFrame(0.2)
    return
  }
  if (event.key === 'Home') {
    event.preventDefault()
    stopPlayback()
    return
  }
  if (event.key.toLowerCase() === 'h') {
    uiHidden.value = !uiHidden.value
    return
  }
  if (event.key.toLowerCase() === 'l') {
    loopPlayback.value = !loopPlayback.value
    toast(loopPlayback.value ? '循环播放已开启' : '循环播放已关闭')
    return
  }
  if (event.key.toLowerCase() === 'f') {
    toggleFullscreen()
    return
  }
  if (event.key === 'Escape') {
    if (mode.value === 'recording') {
      cancelRecording()
      return
    }
    if (mode.value === 'playing') {
      pausePlayback()
      return
    }
    if (isCompact.value && (railLeftOpen.value || railRightOpen.value)) {
      railLeftOpen.value = false
      railRightOpen.value = false
      return
    }
    if (uiHidden.value) uiHidden.value = false
  }
}

function openRail(side: 'left' | 'right'): void {
  railLeftOpen.value = side === 'left'
  railRightOpen.value = side === 'right'
}

function closeRails(): void {
  railLeftOpen.value = false
  railRightOpen.value = false
}

function syncCompactLayout(compact: boolean): void {
  if (compact === isCompact.value) return
  isCompact.value = compact
  railLeftOpen.value = !compact
  railRightOpen.value = !compact
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (isPlayerMode.value || !isDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

async function bootScene(): Promise<void> {
  if (!viewportRef.value) return
  if (scene) {
    scene.destroy()
    scene = null
  }
  sceneStatus.ready = false
  sceneStatus.failed = false
  sceneStatus.message = '正在建立三维场景'
  sceneStatus.detail = 'Cesium Viewer · 卫星影像 · 3D Tiles'
  const instance = new PresentationScene(viewportRef.value, {
    onStatus: (message, detail) => {
      sceneStatus.message = message
      if (detail) sceneStatus.detail = detail
    },
    onWarning: (message) => toast(message, 'warn')
  })
  scene = instance
  try {
    await instance.init()
    sceneStatus.ready = true
    sceneStatus.message = '场景就绪'
    sceneStatus.detail = '可播放、录制与导出'
    applyRuntimeAt(currentTime.value)
    instance.setCameraInputs(true)
    await instance.syncCustomLayers(deepClone(project.value.customLayers))
    refreshCustomLayerStates()
  } catch (error) {
    const message = error instanceof Error ? error.message : '请检查网络与 WebGL 支持'
    sceneStatus.failed = true
    sceneStatus.message = '三维场景加载失败'
    sceneStatus.detail = message
    recordDiagnostic('resource', 'scene-failed', 'error', { message })
    toast('三维场景加载失败，请重试', 'error')
  }
}

watch(
  project,
  () => {
    if (suspendDraft) return
    scheduleDraft()
  },
  { deep: true }
)

watch(
  project,
  () => {
    scheduleHistory()
  },
  { deep: true }
)

watch(selectedStep, () => {
  ensureSelection()
})

watch(total, (value) => {
  if (currentTime.value > value) currentTime.value = value
})

let compactQuery: MediaQueryList | null = null

function onCompactChange(event: MediaQueryListEvent): void {
  syncCompactLayout(event.matches)
}

async function hydrateFromIndexedDb(): Promise<void> {
  if (isPlayerMode.value) return
  if (bootState.fromStorage) {
    const diag = await storageDiagnostics()
    if (diag.estimatedUsage && diag.estimatedQuota && diag.estimatedUsage > diag.estimatedQuota * 0.9) {
      storageNotice.value = '浏览器本地存储空间接近上限，建议导出工程包后清理旧工程'
    }
    return
  }
  const result = await readStoreSafe()
  if (!result.ok) {
    storageNotice.value = result.message
    if (result.raw) {
      toast('本地工程数据损坏，已保留原始备份', 'error')
    }
    return
  }
  if (isDirty.value || store.value.projects.length !== 1) return
  store.value = result.store
  const restored = store.value.projects.find((item) => item.id === store.value.currentId) ?? store.value.projects[0]
  savedSignature.value = JSON.stringify(restored)
  savedSnapshot.value = deepClone(restored)
  initializeSelection()
  resetHistory()
  applyRuntimeAt(0)
  if (result.warnings.length) storageNotice.value = result.warnings.join('；')
  recordDiagnostic('orchestration', 'restore', 'info', {
    projects: store.value.projects.length,
    location: result.location
  })
  toast(`已从 IndexedDB 恢复工程库（${store.value.projects.length} 个工程）`, 'info')
}

onMounted(async () => {
  compactQuery = window.matchMedia('(max-width: 760px)')
  syncCompactLayout(compactQuery.matches)
  compactQuery.addEventListener('change', onCompactChange)
  initializeSelection()
  applyRuntimeAt(0)
  if (isPlayerMode.value) {
    if (playerProjectUrl) await loadPlayerProject(playerProjectUrl)
    if (!playerLoadError.value) await bootScene()
  } else {
    void bootScene()
    void hydrateFromIndexedDb()
  }
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  if (restoredNotice && !isPlayerMode.value) {
    restoredNotice = false
    toast('已恢复上次未保存的编辑草稿', 'info')
  }
})

onBeforeUnmount(() => {
  revokePlayerObjectUrls()
  if (rafId) cancelAnimationFrame(rafId)
  if (recordingTimer) window.clearInterval(recordingTimer)
  if (draftTimer) window.clearTimeout(draftTimer)
  if (customLayerTimer) window.clearTimeout(customLayerTimer)
  if (scene) {
    scene.destroy()
    scene = null
  }
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  compactQuery?.removeEventListener('change', onCompactChange)
  compactQuery = null
})

const modeLabel = computed(() => {
  switch (mode.value) {
    case 'playing':
      return 'PLAYING'
    case 'paused':
      return 'PAUSED'
    case 'recording':
      return 'REC'
    case 'exporting':
      return 'EXPORT'
    case 'preview':
      return 'PREVIEW'
    default:
      return isPlayerMode.value ? 'PLAY' : 'EDIT'
  }
})
</script>

<template>
  <div
    ref="stageRef"
    class="ps-root"
    :class="{
      'is-cinema': uiHidden,
      'is-exporting': mode === 'exporting',
      'is-recording': mode === 'recording',
      'is-playing': mode === 'playing',
      'is-player': isPlayerMode
    }"
  >
    <div class="ps-stage">
      <div ref="viewportRef" class="ps-viewport" />
      <div class="ps-stage__grid" aria-hidden="true" />
      <div class="ps-stage__glow" aria-hidden="true" />

      <div class="ps-overlay">
        <div
          v-if="runtime.chapter"
          class="ps-chapter"
          :class="`is-${runtime.chapter.type}`"
          :style="{ opacity: runtime.chapter.alpha }"
        >
          <div v-if="runtime.chapter.type === 'dip'" class="ps-chapter__dip" />
          <div v-if="runtime.chapter.type === 'slide'" class="ps-chapter__slide" />
          <div class="ps-chapter__content">
            <div class="ps-chapter__index">{{ String(runtime.chapter.index).padStart(2, '0') }}</div>
            <div class="ps-chapter__rule" />
            <div class="ps-chapter__name">{{ runtime.chapter.name }}</div>
            <div class="ps-chapter__meta">
              STEP {{ String(runtime.chapter.index).padStart(2, '0') }} /
              {{ String(runtime.chapter.total).padStart(2, '0') }}
            </div>
            <div class="ps-chapter__bar"><span :style="{ width: `${runtime.chapter.progress * 100}%` }" /></div>
          </div>
        </div>

        <div
          v-for="(view, index) in runtime.subtitles"
          :key="`sub-${index}`"
          class="ps-subtitle"
          :class="[`is-${view.param.position}`, `bg-${view.param.background}`]"
          :style="subtitleStyle(view)"
        >
          <div class="ps-subtitle__accent" />
          <h3 v-if="view.param.title" class="ps-subtitle__title">{{ view.param.title }}</h3>
          <p class="ps-subtitle__text">{{ view.param.text }}</p>
        </div>

        <div
          v-for="(view, index) in runtime.popups"
          :key="`popup-${index}`"
          class="ps-popup"
          :class="`is-${view.param.placement}`"
          :style="popupStyle(view)"
        >
          <div class="ps-popup__accent" />
          <div class="ps-popup__title">{{ view.param.title }}</div>
          <div class="ps-popup__content">{{ view.param.content }}</div>
          <div class="ps-popup__meta">CITY LANDMARK / CESIUM</div>
        </div>

        <div v-if="mode === 'recording'" class="ps-recording">
          <div class="ps-recording__head">
            <span class="ps-recording__dot" />
            <span class="ps-recording__label">REC</span>
            <span class="ps-recording__clock">{{ formatClock(recording.elapsed / 1000) }}</span>
            <span class="ps-recording__count">{{ recording.sampleCount }} 帧</span>
          </div>
          <p class="ps-recording__hint">拖动或缩放三维场景，系统将实时采样相机轨迹</p>
          <div class="ps-recording__actions">
            <button type="button" class="ps-btn is-ghost" @click="cancelRecording">取消</button>
            <button type="button" class="ps-btn is-primary" @click="finishRecording">停止并生成航线</button>
          </div>
        </div>

        <div v-if="exportState.active" class="ps-export-hud">
          <div class="ps-export-hud__head">
            <Icon name="film" :size="16" />
            <span>{{ exportState.message }}</span>
            <button type="button" class="ps-icon-btn" aria-label="取消导出" @click="cancelExport">
              <Icon name="close" :size="14" />
            </button>
          </div>
          <div class="ps-export-hud__bar"><span :style="{ width: `${exportState.progress * 100}%` }" /></div>
          <div class="ps-export-hud__meta">
            <span>{{ Math.round(exportState.progress * 100) }}%</span>
            <span
              >{{ exportState.phase === 'finalizing' ? '封装中' : exportIsFrames ? '逐帧渲染' : '实时录制' }} ·
              {{ exportSettings.resolution.toUpperCase() }} · {{ exportSettings.fps }}fps</span
            >
          </div>
        </div>

        <div v-if="loading && !playerLoadError" class="ps-loading">
          <div class="ps-loading__spinner" />
          <div class="ps-loading__title">{{ sceneStatus.message }}</div>
          <div class="ps-loading__detail">{{ sceneStatus.detail }}</div>
          <div class="ps-loading__steps">
            <span class="is-on">Cesium</span>
            <span>影像</span>
            <span>3D Tiles</span>
            <span>演示数据</span>
          </div>
        </div>

        <div v-if="sceneStatus.failed" class="ps-loading is-failed">
          <Icon name="warning" :size="26" />
          <div class="ps-loading__title">{{ sceneStatus.message }}</div>
          <div class="ps-loading__detail">{{ sceneStatus.detail }}</div>
          <button type="button" class="ps-btn is-primary" @click="bootScene">重新加载场景</button>
        </div>

        <div v-if="isPlayerMode && playerLoadError && !sceneStatus.failed" class="ps-loading is-failed">
          <Icon name="warning" :size="26" />
          <div class="ps-loading__title">工程加载失败</div>
          <div class="ps-loading__detail">{{ playerLoadError }}</div>
          <div class="ps-player-error__actions">
            <button type="button" class="ps-btn is-primary" @click="retryPlayerLoad">重试</button>
            <button type="button" class="ps-btn is-ghost" @click="triggerImport">打开工程包</button>
          </div>
        </div>

        <div v-if="!uiHidden && mode !== 'playing' && mode !== 'exporting'" class="ps-stage-brand">
          <span class="ps-stage-brand__dot" />
          <span>PRESENTATION</span>
          <span v-if="isPlayerMode" class="ps-stage-brand__badge">READ ONLY</span>
          <span class="ps-stage-brand__name">{{ project.name }}</span>
          <span v-if="isDirty && !isPlayerMode" class="ps-stage-brand__dirty">未保存</span>
        </div>

        <div v-if="!uiHidden" class="ps-stage-actions">
          <button
            v-if="!isPlayerMode"
            type="button"
            class="ps-stage-btn ps-stage-btn--compact"
            :class="{ 'is-active': railLeftOpen }"
            title="工程与图层"
            @click="openRail('left')"
          >
            <Icon name="folder" :size="15" />
          </button>
          <button
            v-if="!isPlayerMode"
            type="button"
            class="ps-stage-btn ps-stage-btn--compact"
            :class="{ 'is-active': railRightOpen }"
            title="演示编排"
            @click="openRail('right')"
          >
            <Icon name="step" :size="15" />
          </button>
          <button v-if="isPlayerMode" type="button" class="ps-stage-btn" title="打开工程包" @click="triggerImport">
            <Icon name="upload" :size="15" />
          </button>
          <button
            type="button"
            class="ps-stage-btn"
            :class="{ 'is-active': isFullscreen }"
            title="全屏 (F)"
            @click="toggleFullscreen"
          >
            <Icon name="expand" :size="15" />
          </button>
          <button type="button" class="ps-stage-btn" title="隐藏界面 (H)" @click="uiHidden = true">
            <Icon name="eyeOff" :size="15" />
          </button>
          <button v-if="!isPlayerMode" type="button" class="ps-stage-btn" title="快捷键" @click="openDialog('help')">
            <Icon name="keyboard" :size="15" />
          </button>
        </div>

        <div v-if="uiHidden" class="ps-cinema-hint">
          <button type="button" class="ps-btn is-ghost" @click="uiHidden = false">显示界面 (H)</button>
        </div>
      </div>
    </div>

    <div
      v-if="!isPlayerMode && isCompact && !uiHidden && (railLeftOpen || railRightOpen)"
      class="ps-rail-backdrop"
      @click="closeRails"
    />

    <aside v-show="!isPlayerMode && !uiHidden && railLeftOpen" class="ps-rail ps-rail--left">
      <header class="ps-brand">
        <div class="ps-brand__mark"><Icon name="brand" :size="24" /></div>
        <div class="ps-brand__text">
          <div class="ps-brand__title">Presentation Studio</div>
          <div class="ps-brand__subtitle">CESIUM · CINEMATIC TOOLKIT</div>
        </div>
        <span class="ps-brand__version">1.0</span>
        <button v-if="isCompact" type="button" class="ps-rail__close" title="收起面板" @click="closeRails">
          <Icon name="close" :size="15" />
        </button>
      </header>

      <div class="ps-rail__scroll">
        <UiSection title="工程" icon="folder" :badge="`${store.projects.length}`">
          <div class="ps-project">
            <div class="ps-project__head">
              <div class="ps-project__name">{{ project.name }}</div>
              <span
                class="ps-project__state"
                :class="{ 'is-saved': !isDirty && saveStatus !== 'failed', 'is-failed': saveStatus === 'failed' }"
                :title="saveError || storageNotice"
                >{{ saveLabel }}</span
              >
            </div>
            <div class="ps-project__meta">
              {{ project.steps.length }} 幕 ·
              {{ project.steps.reduce((sum, step) => sum + step.actions.length, 0) }} 动作 ·
              {{ formatDate(project.updateTime) }}
            </div>
            <p v-if="project.note" class="ps-project__note">{{ project.note }}</p>
            <div class="ps-project__tools">
              <button type="button" class="ps-btn is-primary is-small" @click="saveProject">
                <Icon name="save" :size="14" />保存
              </button>
              <button type="button" class="ps-btn is-small" @click="exportProjectFile">
                <Icon name="download" :size="14" />导出
              </button>
              <button type="button" class="ps-icon-btn" title="导出只读播放器包" @click="exportPlayerPackage">
                <Icon name="play" :size="15" />
              </button>
              <button type="button" class="ps-icon-btn" :disabled="!canUndo" title="撤销 Ctrl+Z" @click="undo">
                <Icon name="undo" :size="15" />
              </button>
              <button type="button" class="ps-icon-btn" :disabled="!canRedo" title="重做 Ctrl+Shift+Z" @click="redo">
                <Icon name="redo" :size="15" />
              </button>
              <button type="button" class="ps-icon-btn" title="工程设置" @click="openProjectSettings">
                <Icon name="settings" :size="15" />
              </button>
            </div>
          </div>

          <div class="ps-project-list">
            <button
              v-for="item in store.projects"
              :key="item.id"
              type="button"
              class="ps-project-item"
              :class="{ 'is-active': item.id === project.id }"
              @click="switchProject(item.id)"
            >
              <span class="ps-project-item__dot" />
              <span class="ps-project-item__body">
                <span class="ps-project-item__name">{{ item.name }}</span>
                <span class="ps-project-item__meta"
                  >{{ item.steps.length }} 幕 · {{ formatDate(item.updateTime) }}</span
                >
              </span>
              <span
                class="ps-project-item__delete"
                role="button"
                tabindex="0"
                title="删除工程"
                @click.stop="requestDeleteProject(item.id)"
                @keydown.enter.stop="requestDeleteProject(item.id)"
              >
                <Icon name="trash" :size="13" />
              </span>
            </button>
          </div>

          <div class="ps-btn-row">
            <button type="button" class="ps-btn is-small" @click="createNewProject">
              <Icon name="plus" :size="14" />新建
            </button>
            <button type="button" class="ps-btn is-small" @click="triggerImport">
              <Icon name="upload" :size="14" />导入
            </button>
            <button type="button" class="ps-btn is-small" @click="openSaveAs">
              <Icon name="copy" :size="14" />另存
            </button>
          </div>
          <button type="button" class="ps-btn is-ghost is-small ps-full" @click="openRename">
            <Icon name="edit" :size="13" />重命名当前工程
          </button>
        </UiSection>

        <UiSection title="初始图层" icon="layers">
          <div class="ps-toggle-row" v-for="layer in LAYER_DEFINITIONS" :key="layer.id">
            <span class="ps-toggle-row__icon"><Icon :name="layer.icon" :size="15" /></span>
            <span class="ps-toggle-row__body">
              <span class="ps-toggle-row__name">{{ layer.name }}</span>
              <span class="ps-toggle-row__desc">{{ layer.description }}</span>
            </span>
            <UiSwitch
              v-model="project.initial.layers[layer.id]"
              :label="layer.name"
              @update:model-value="previewInitialState"
            />
          </div>
          <p class="ps-hint">修改初始状态后自动回到演示起点预览。</p>
          <div class="ps-btn-row">
            <button type="button" class="ps-btn is-small" @click="captureInitialCamera">
              <Icon name="camera" :size="13" />捕获初始机位
            </button>
            <button type="button" class="ps-btn is-small" @click="resetInitialState">
              <Icon name="reset" :size="13" />重置
            </button>
          </div>
        </UiSection>

        <UiSection title="场景图层" icon="layers" collapsible>
          <div v-if="!project.customLayers.length" class="ps-hint">
            添加 3D Tiles 或 GeoJSON 后可在场景中独立控制显隐与透明度。
          </div>
          <div v-for="(layer, index) in project.customLayers" :key="layer.id" class="ps-custom-layer">
            <div class="ps-custom-layer__head">
              <UiSwitch v-model="layer.visible" :label="layer.name" @update:model-value="onCustomLayerEdited(layer)" />
              <input
                v-model="layer.name"
                class="ps-text-input is-tiny"
                maxlength="60"
                :disabled="layer.locked"
                @change="scheduleDraft"
              />
              <span
                class="ps-custom-layer__state"
                :class="`is-${customLayerStates[layer.id]?.status ?? 'idle'}`"
                :title="customLayerStates[layer.id]?.message ?? ''"
                >{{ customLayerStatusLabel(customLayerStates[layer.id]?.status) }}</span
              >
              <span class="ps-custom-layer__actions">
                <button
                  v-if="customLayerStates[layer.id]?.status === 'error'"
                  type="button"
                  class="ps-icon-btn"
                  title="重试加载"
                  @click="retryCustomLayer(layer)"
                >
                  <Icon name="reset" :size="12" />
                </button>
                <button
                  type="button"
                  class="ps-icon-btn"
                  title="上移"
                  :disabled="index === 0"
                  @click="moveCustomLayer(layer.id, -1)"
                >
                  <Icon name="up" :size="12" />
                </button>
                <button
                  type="button"
                  class="ps-icon-btn"
                  title="下移"
                  :disabled="index === project.customLayers.length - 1"
                  @click="moveCustomLayer(layer.id, 1)"
                >
                  <Icon name="down" :size="12" />
                </button>
                <button
                  type="button"
                  class="ps-icon-btn"
                  :title="layer.locked ? '解锁' : '锁定'"
                  @click="toggleCustomLayerLock(layer)"
                >
                  <Icon :name="'lock'" :size="12" />
                </button>
                <button
                  type="button"
                  class="ps-icon-btn is-danger"
                  title="删除图层"
                  @click="removeCustomLayer(layer.id)"
                >
                  <Icon name="trash" :size="12" />
                </button>
              </span>
            </div>
            <div class="ps-custom-layer__row">
              <select
                v-model="layer.kind"
                class="ps-select is-tiny"
                :disabled="layer.locked"
                @change="onCustomLayerEdited(layer)"
              >
                <option value="3dtiles">3D Tiles</option>
                <option value="geojson">GeoJSON</option>
              </select>
              <input
                v-model="layer.uri"
                class="ps-text-input is-tiny"
                placeholder="相对路径，例如 dayanta/tileset.json"
                :disabled="layer.locked"
                @change="onCustomLayerEdited(layer)"
              />
            </div>
            <p v-if="customLayerUriIssue(layer)" class="ps-custom-layer__issue">{{ customLayerUriIssue(layer) }}</p>
            <p v-else-if="customLayerStates[layer.id]?.status === 'error'" class="ps-custom-layer__issue">
              {{ customLayerStates[layer.id]?.message }}
            </p>
            <div class="ps-custom-layer__row">
              <span class="ps-custom-layer__meta">透明度 {{ Math.round((layer.opacity ?? 1) * 100) }}%</span>
              <input
                v-model.number="layer.opacity"
                class="ps-range"
                type="range"
                min="0"
                max="1"
                step="0.01"
                :disabled="layer.locked"
                @change="onCustomLayerOpacityChanged"
              />
            </div>
          </div>
          <div class="ps-btn-row">
            <button type="button" class="ps-btn is-small" @click="addCustomLayer('3dtiles')">
              <Icon name="plus" :size="13" />3D Tiles
            </button>
            <button type="button" class="ps-btn is-small" @click="addCustomLayer('geojson')">
              <Icon name="plus" :size="13" />GeoJSON
            </button>
          </div>
        </UiSection>

        <UiSection title="初始效果" icon="sparkle">
          <div class="ps-toggle-row" v-for="effect in EFFECT_DEFINITIONS" :key="effect.id">
            <span class="ps-toggle-row__icon"><Icon :name="effect.icon" :size="15" /></span>
            <span class="ps-toggle-row__body">
              <span class="ps-toggle-row__name">{{ effect.name }}</span>
              <span class="ps-toggle-row__desc">{{ effect.description }}</span>
            </span>
            <UiSwitch
              v-model="project.initial.effects[effect.id]"
              :label="effect.name"
              @update:model-value="previewInitialState"
            />
          </div>
        </UiSection>

        <UiSection title="初始时序" icon="clock" collapsible>
          <div class="ps-slider-row">
            <span class="ps-slider-row__head"
              ><span>大雁塔生长</span><b>{{ Math.round(project.initial.time.dayanta * 100) }}%</b></span
            >
            <input
              v-model.number="project.initial.time.dayanta"
              class="ps-range"
              type="range"
              min="0"
              max="1"
              step="0.01"
              @input="previewInitialState"
            />
          </div>
          <div class="ps-slider-row">
            <span class="ps-slider-row__head"
              ><span>地标显现</span><b>{{ Math.round(project.initial.time.landmarks * 100) }}%</b></span
            >
            <input
              v-model.number="project.initial.time.landmarks"
              class="ps-range"
              type="range"
              min="0"
              max="1"
              step="0.01"
              @input="previewInitialState"
            />
          </div>
          <div class="ps-slider-row">
            <span class="ps-slider-row__head"
              ><span>光柱点亮</span><b>{{ Math.round(project.initial.time.beacons * 100) }}%</b></span
            >
            <input
              v-model.number="project.initial.time.beacons"
              class="ps-range"
              type="range"
              min="0"
              max="1"
              step="0.01"
              @input="previewInitialState"
            />
          </div>
        </UiSection>

        <UiSection title="地标导航" icon="pin" collapsible :open="false">
          <button
            v-for="landmark in LANDMARKS"
            :key="landmark.id"
            type="button"
            class="ps-landmark"
            @click="focusLandmark(landmark.id)"
          >
            <span class="ps-landmark__pin" :style="{ background: landmark.color }" />
            <span class="ps-landmark__body">
              <span class="ps-landmark__name">{{ landmark.name }}</span>
              <span class="ps-landmark__subtitle">{{ landmark.subtitle }}</span>
            </span>
            <Icon name="arrowRight" :size="13" />
          </button>
        </UiSection>
      </div>

      <footer class="ps-rail__footer">
        <span>H 隐藏界面</span>
        <span>Space 播放</span>
        <span>Ctrl+S 保存</span>
      </footer>
    </aside>

    <aside v-show="!isPlayerMode && !uiHidden && railRightOpen" class="ps-rail ps-rail--right">
      <header class="ps-rail__head">
        <div>
          <div class="ps-rail__eyebrow">STEP SEQUENCE</div>
          <div class="ps-rail__title">演示编排</div>
        </div>
        <div class="ps-rail__head-tools">
          <button type="button" class="ps-icon-btn" title="新增步骤" @click="addStep">
            <Icon name="plus" :size="16" />
          </button>
          <button v-if="isCompact" type="button" class="ps-rail__close" title="收起面板" @click="closeRails">
            <Icon name="close" :size="15" />
          </button>
        </div>
      </header>

      <div class="ps-rail__scroll">
        <div class="ps-rail-tabs">
          <button type="button" :class="{ 'is-active': railTab === 'steps' }" @click="railTab = 'steps'">步骤</button>
          <button type="button" :class="{ 'is-active': railTab === 'tracks' }" @click="railTab = 'tracks'">轨道</button>
        </div>
        <div v-show="railTab === 'steps'" class="ps-step-list">
          <div
            v-for="(step, index) in project.steps"
            :key="step.stepId"
            class="ps-step"
            :class="{ 'is-active': step.stepId === selectedStepId, 'is-current': runtime.step?.stepId === step.stepId }"
          >
            <button type="button" class="ps-step__main" @click="selectStep(step)">
              <span class="ps-step__index">{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="ps-step__body">
                <span class="ps-step__name">{{ step.stepName }}</span>
                <span class="ps-step__meta"
                  >{{ step.actions.length }} 动作 · {{ step.duration.toFixed(1) }}s · {{ step.speedRate }}x</span
                >
              </span>
              <span class="ps-step__type"
                ><Icon :name="step.transition.type === 'none' ? 'minus' : 'sparkle'" :size="12" />{{
                  step.transition.type === 'none' ? '无转场' : `${step.transition.duration.toFixed(1)}s`
                }}</span
              >
            </button>
            <div class="ps-step__tools">
              <button
                type="button"
                class="ps-icon-btn is-tiny"
                title="上移"
                :disabled="index === 0"
                @click="moveStep(index, -1)"
              >
                <Icon name="up" :size="12" />
              </button>
              <button
                type="button"
                class="ps-icon-btn is-tiny"
                title="下移"
                :disabled="index === project.steps.length - 1"
                @click="moveStep(index, 1)"
              >
                <Icon name="down" :size="12" />
              </button>
              <button type="button" class="ps-icon-btn is-tiny" title="复制步骤" @click="duplicateStep(index)">
                <Icon name="copy" :size="12" />
              </button>
              <button type="button" class="ps-icon-btn is-tiny is-danger" title="删除步骤" @click="deleteStep(index)">
                <Icon name="trash" :size="12" />
              </button>
            </div>
          </div>
          <button type="button" class="ps-step-add" @click="addStep"><Icon name="plus" :size="14" />新增步骤</button>
        </div>

        <template v-if="railTab === 'steps' && selectedStep">
          <div class="ps-block">
            <div class="ps-block__head">
              <span class="ps-block__title">步骤属性</span>
              <span class="ps-block__hint"
                >STEP
                {{
                  String(project.steps.findIndex((step) => step.stepId === selectedStep?.stepId) + 1).padStart(2, '0')
                }}</span
              >
            </div>
            <UiField label="名称">
              <input v-model="selectedStep.stepName" class="ps-text-input" maxlength="40" />
            </UiField>
            <div class="ps-grid-3">
              <UiField label="时长" stacked>
                <input
                  v-model.number="selectedStep.duration"
                  class="ps-number"
                  type="number"
                  min="0.5"
                  max="600"
                  step="0.5"
                />
              </UiField>
              <UiField label="停留" stacked>
                <input
                  v-model.number="selectedStep.stayTime"
                  class="ps-number"
                  type="number"
                  min="0"
                  max="60"
                  step="0.1"
                />
              </UiField>
              <UiField label="倍速" stacked>
                <select v-model.number="selectedStep.speedRate" class="ps-select">
                  <option :value="0.5">0.5x</option>
                  <option :value="1">1.0x</option>
                  <option :value="1.5">1.5x</option>
                  <option :value="2">2.0x</option>
                </select>
              </UiField>
            </div>
            <div class="ps-grid-2">
              <UiField label="转场" stacked>
                <select v-model="selectedStep.transition.type" class="ps-select">
                  <option value="none">无</option>
                  <option value="fade">淡入</option>
                  <option value="dip">黑场</option>
                  <option value="slide">侧滑</option>
                </select>
              </UiField>
              <UiField label="转场时长" stacked>
                <input
                  v-model.number="selectedStep.transition.duration"
                  class="ps-number"
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                />
              </UiField>
            </div>
          </div>

          <div class="ps-block">
            <div class="ps-block__head">
              <span class="ps-block__title">动作序列</span>
              <span class="ps-block__hint">{{ selectedStep.actions.length }} ACTIONS</span>
            </div>
            <div v-if="!selectedStep.actions.length" class="ps-empty">
              <Icon name="action" :size="18" />
              <span>该步骤还没有动作</span>
              <small>从下方动作库添加第一个镜头</small>
            </div>
            <div
              v-for="(action, index) in selectedStep.actions"
              :key="action.actionId"
              class="ps-action"
              :class="{
                'is-active': action.actionId === selectedActionId,
                'is-off': !action.enable,
                'is-locked': action.locked
              }"
            >
              <button type="button" class="ps-action__main" @click="selectAction(action)">
                <span
                  class="ps-action__icon"
                  :style="{ color: ACTION_DEFINITIONS.find((item) => item.type === action.actionType)?.color }"
                >
                  <Icon
                    :name="ACTION_DEFINITIONS.find((item) => item.type === action.actionType)?.icon ?? 'dot'"
                    :size="15"
                  />
                </span>
                <span class="ps-action__body">
                  <span class="ps-action__name">{{
                    ACTION_DEFINITIONS.find((item) => item.type === action.actionType)?.name
                  }}</span>
                  <span class="ps-action__meta"
                    >{{ action.duration.toFixed(1) }}s · {{ action.enable ? '启用' : '停用' }}</span
                  >
                </span>
                <span class="ps-action__dot" />
              </button>
              <div class="ps-action__tools">
                <button
                  type="button"
                  class="ps-icon-btn is-tiny"
                  :title="action.locked ? '解锁轨道位置' : '锁定轨道位置'"
                  @click="toggleActionLock(action)"
                >
                  <Icon name="lock" :size="11" />
                </button>
                <button
                  type="button"
                  class="ps-icon-btn is-tiny"
                  title="上移"
                  :disabled="index === 0 || action.locked"
                  @click="moveAction(index, -1)"
                >
                  <Icon name="up" :size="11" />
                </button>
                <button
                  type="button"
                  class="ps-icon-btn is-tiny"
                  title="下移"
                  :disabled="index === selectedStep.actions.length - 1 || action.locked"
                  @click="moveAction(index, 1)"
                >
                  <Icon name="down" :size="11" />
                </button>
                <button type="button" class="ps-icon-btn is-tiny" title="复制" @click="duplicateAction(index)">
                  <Icon name="copy" :size="11" />
                </button>
                <button
                  type="button"
                  class="ps-icon-btn is-tiny is-danger"
                  title="删除"
                  :disabled="action.locked"
                  @click="deleteAction(index)"
                >
                  <Icon name="trash" :size="11" />
                </button>
              </div>
            </div>
            <div class="ps-palette">
              <span class="ps-palette__label">添加动作</span>
              <button
                v-for="definition in ACTION_DEFINITIONS"
                :key="definition.type"
                type="button"
                class="ps-palette__item"
                :style="{ '--ps-action-color': definition.color }"
                :title="definition.description"
                @click="addAction(definition.type)"
              >
                <Icon :name="definition.icon" :size="16" />
                <span>{{ definition.short }}</span>
              </button>
            </div>
          </div>

          <div v-if="selectedAction" class="ps-block is-editor">
            <div class="ps-block__head">
              <span class="ps-block__title">动作参数</span>
              <UiSwitch v-model="selectedAction.enable" label="启用动作" />
            </div>

            <template v-if="flyAction">
              <div class="ps-camera-actions">
                <button type="button" class="ps-btn is-small is-primary" @click="captureFlyCamera">
                  <Icon name="camera" :size="13" />捕获当前视角
                </button>
                <select
                  class="ps-select"
                  :value="flyAction.targetId ?? ''"
                  @change="applyLandmarkToFly(($event.target as HTMLSelectElement).value)"
                >
                  <option value="">自由机位</option>
                  <option v-for="landmark in LANDMARKS" :key="landmark.id" :value="landmark.id">
                    {{ landmark.name }}
                  </option>
                </select>
              </div>
              <div class="ps-grid-3">
                <UiField label="经度" stacked
                  ><input v-model.number="flyAction.camera.longitude" class="ps-number" type="number" step="0.0001"
                /></UiField>
                <UiField label="纬度" stacked
                  ><input v-model.number="flyAction.camera.latitude" class="ps-number" type="number" step="0.0001"
                /></UiField>
                <UiField label="高度" stacked
                  ><input v-model.number="flyAction.camera.height" class="ps-number" type="number" step="1"
                /></UiField>
                <UiField label="方位" stacked
                  ><input v-model.number="flyAction.camera.heading" class="ps-number" type="number" step="1"
                /></UiField>
                <UiField label="俯仰" stacked
                  ><input v-model.number="flyAction.camera.pitch" class="ps-number" type="number" step="1"
                /></UiField>
                <UiField label="视场角" stacked
                  ><input v-model.number="flyAction.camera.fov" class="ps-number" type="number" step="1"
                /></UiField>
              </div>
              <div class="ps-grid-2">
                <UiField label="缓动" stacked>
                  <select v-model="flyAction.easing" class="ps-select" @change="resetCurve">
                    <option value="linear">线性</option>
                    <option value="smooth">平滑</option>
                    <option value="cinematic">电影</option>
                  </select>
                </UiField>
                <UiField label="弧线抬升">
                  <UiSwitch v-model="flyAction.arc" label="弧线飞行" />
                </UiField>
              </div>
              <p class="ps-hint">
                当前机位：{{ formatPoseValue(flyAction.camera.longitude) }},
                {{ formatPoseValue(flyAction.camera.latitude) }} · {{ Math.round(flyAction.camera.height) }}m
              </p>
            </template>

            <template v-else-if="routeAction">
              <div class="ps-stats">
                <div>
                  <b>{{ routeAction.route.samples.length }}</b
                  ><span>采样点</span>
                </div>
                <div>
                  <b>{{ routeAction.route.recordedDuration.toFixed(1) }}s</b><span>录制时长</span>
                </div>
                <div>
                  <b>{{ routeAction.route.interpolation === 'catmullrom' ? '样条' : '线性' }}</b
                  ><span>插值</span>
                </div>
              </div>
              <div class="ps-grid-2">
                <UiField label="缓动" stacked>
                  <select v-model="routeAction.easing" class="ps-select" @change="resetCurve">
                    <option value="linear">线性</option>
                    <option value="smooth">平滑</option>
                    <option value="cinematic">电影</option>
                  </select>
                </UiField>
                <UiField label="衔接混合" hint="秒">
                  <input
                    v-model.number="routeAction.entryBlend"
                    class="ps-number"
                    type="number"
                    min="0"
                    max="4"
                    step="0.1"
                  />
                </UiField>
              </div>
              <UiField label="平滑强度">
                <input
                  v-model.number="routeAction.route.smoothing"
                  class="ps-range"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                />
              </UiField>
              <UiField label="显示航线">
                <UiSwitch v-model="routeAction.showTrail" label="显示航线" />
              </UiField>
              <div class="ps-btn-row">
                <button type="button" class="ps-btn is-small" @click="smoothRoute">
                  <Icon name="reset" :size="13" />重新平滑
                </button>
                <button type="button" class="ps-btn is-small is-danger" @click="purgeRoute">
                  <Icon name="trash" :size="13" />清空航线
                </button>
              </div>
              <p class="ps-hint">在预览中点击「录制航线」，实时采样当前相机运动。</p>
            </template>

            <template v-else-if="layerAction">
              <div class="ps-mini-grid">
                <label v-for="layer in LAYER_DEFINITIONS" :key="layer.id" class="ps-mini-toggle">
                  <Icon :name="layer.icon" :size="13" />
                  <span>{{ layer.name }}</span>
                  <UiSwitch v-model="layerAction.layers[layer.id]" :label="layer.name" />
                </label>
              </div>
              <UiField label="过渡" stacked>
                <select v-model="layerAction.transition" class="ps-select">
                  <option value="fade">渐隐渐显</option>
                  <option value="instant">立即切换</option>
                </select>
              </UiField>
            </template>

            <template v-else-if="timeAction">
              <div class="ps-grid-2">
                <UiField label="对象" stacked>
                  <select v-model="timeAction.target" class="ps-select">
                    <option value="dayanta">大雁塔生长</option>
                    <option value="landmarks">地标显现</option>
                    <option value="beacons">光柱点亮</option>
                  </select>
                </UiField>
                <UiField label="缓动" stacked>
                  <select v-model="timeAction.easing" class="ps-select" @change="resetCurve">
                    <option value="linear">线性</option>
                    <option value="smooth">平滑</option>
                    <option value="cinematic">电影</option>
                  </select>
                </UiField>
              </div>
              <div class="ps-slider-row">
                <span class="ps-slider-row__head"
                  ><span>起始</span><b>{{ Math.round(timeAction.from * 100) }}%</b></span
                >
                <input v-model.number="timeAction.from" class="ps-range" type="range" min="0" max="1" step="0.01" />
              </div>
              <div class="ps-slider-row">
                <span class="ps-slider-row__head"
                  ><span>结束</span><b>{{ Math.round(timeAction.to * 100) }}%</b></span
                >
                <input v-model.number="timeAction.to" class="ps-range" type="range" min="0" max="1" step="0.01" />
              </div>
              <p class="ps-hint">
                {{ TIME_TARGET_LABELS[timeAction.target] }} · 时长 {{ timeAction.duration.toFixed(1) }}s
              </p>
            </template>

            <template v-else-if="subtitleAction">
              <UiField label="标题"
                ><input v-model="subtitleAction.subtitle.title" class="ps-text-input" maxlength="40"
              /></UiField>
              <UiField label="正文" stacked>
                <textarea v-model="subtitleAction.subtitle.text" class="ps-textarea" rows="3" maxlength="220" />
              </UiField>
              <div class="ps-grid-2">
                <UiField label="位置" stacked>
                  <select v-model="subtitleAction.subtitle.position" class="ps-select">
                    <option value="fullscreen">全屏</option>
                    <option value="top">顶部</option>
                    <option value="bottom">底部</option>
                    <option value="left">左侧</option>
                    <option value="right">右侧</option>
                    <option value="callout">场景标注</option>
                  </select>
                </UiField>
                <UiField label="背景" stacked>
                  <select v-model="subtitleAction.subtitle.background" class="ps-select">
                    <option value="none">无</option>
                    <option value="dark">深色</option>
                    <option value="glass">玻璃</option>
                    <option value="gradient">渐变</option>
                  </select>
                </UiField>
              </div>
              <div v-if="subtitleAction.subtitle.position === 'callout'" class="ps-grid-2">
                <UiField label="标注锚点" stacked>
                  <select
                    class="ps-select"
                    :value="''"
                    @change="applyLandmarkToCallout(($event.target as HTMLSelectElement).value)"
                  >
                    <option value="" disabled>选择地标</option>
                    <option v-for="landmark in LANDMARKS" :key="landmark.id" :value="landmark.id">
                      {{ landmark.name }}
                    </option>
                  </select>
                </UiField>
                <UiField label="字号">
                  <input
                    v-model.number="subtitleAction.subtitle.fontSize"
                    class="ps-range"
                    type="range"
                    min="16"
                    max="64"
                    step="1"
                  />
                </UiField>
              </div>
              <div v-else class="ps-grid-2">
                <UiField label="字号">
                  <input
                    v-model.number="subtitleAction.subtitle.fontSize"
                    class="ps-range"
                    type="range"
                    min="16"
                    max="64"
                    step="1"
                  />
                </UiField>
                <UiField label="对齐" stacked>
                  <select v-model="subtitleAction.subtitle.align" class="ps-select">
                    <option value="left">左对齐</option>
                    <option value="center">居中</option>
                    <option value="right">右对齐</option>
                  </select>
                </UiField>
              </div>
              <div class="ps-grid-2">
                <UiField label="文字颜色"
                  ><input v-model="subtitleAction.subtitle.color" class="ps-color" type="color"
                /></UiField>
                <UiField label="强调色"
                  ><input v-model="subtitleAction.subtitle.accent" class="ps-color" type="color"
                /></UiField>
              </div>
              <div class="ps-slider-row">
                <span class="ps-slider-row__head"
                  ><span>淡入淡出</span><b>{{ subtitleAction.subtitle.fade.toFixed(2) }}s</b></span
                >
                <input
                  v-model.number="subtitleAction.subtitle.fade"
                  class="ps-range"
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                />
              </div>
            </template>

            <template v-else-if="popupAction">
              <UiField label="标题"
                ><input v-model="popupAction.popup.title" class="ps-text-input" maxlength="40"
              /></UiField>
              <UiField label="内容" stacked>
                <textarea v-model="popupAction.popup.content" class="ps-textarea" rows="3" maxlength="220" />
              </UiField>
              <div class="ps-grid-2">
                <UiField label="锚定地标" stacked>
                  <select v-model="popupAction.popup.targetId" class="ps-select">
                    <option :value="null">屏幕中心</option>
                    <option v-for="landmark in LANDMARKS" :key="landmark.id" :value="landmark.id">
                      {{ landmark.name }}
                    </option>
                  </select>
                </UiField>
                <UiField label="方位" stacked>
                  <select v-model="popupAction.popup.placement" class="ps-select">
                    <option value="right">右侧</option>
                    <option value="left">左侧</option>
                    <option value="top">上方</option>
                    <option value="bottom">下方</option>
                    <option value="center">居中</option>
                  </select>
                </UiField>
              </div>
              <div class="ps-grid-2">
                <UiField label="强调色"
                  ><input v-model="popupAction.popup.accent" class="ps-color" type="color"
                /></UiField>
                <UiField label="卡片宽度" hint="px">
                  <input
                    v-model.number="popupAction.popup.width"
                    class="ps-number"
                    type="number"
                    min="200"
                    max="560"
                    step="10"
                  />
                </UiField>
              </div>
            </template>

            <template v-else-if="effectAction">
              <div class="ps-mini-grid">
                <label v-for="effect in EFFECT_DEFINITIONS" :key="effect.id" class="ps-mini-toggle">
                  <Icon :name="effect.icon" :size="13" />
                  <span>{{ effect.name }}</span>
                  <UiSwitch v-model="effectAction.effects[effect.id]" :label="effect.name" />
                </label>
              </div>
              <p class="ps-hint">效果在动作时长内平滑过渡到目标状态。</p>
            </template>

            <div v-if="easingAction && activeCurve" class="ps-curve">
              <div class="ps-curve__head">
                <span>缓动曲线</span>
                <small>{{ activeCurveCustom ? '自定义贝塞尔' : '跟随缓动预设' }}</small>
                <button v-if="activeCurveCustom" type="button" class="ps-btn is-tiny" @click="resetCurve">
                  恢复预设
                </button>
              </div>
              <svg
                class="ps-curve__canvas"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                role="img"
                aria-label="缓动曲线预览"
              >
                <line x1="0" y1="100" x2="100" y2="0" class="ps-curve__guide" />
                <line
                  :x1="activeCurve.x1 * 100"
                  :y1="100 - activeCurve.y1 * 100"
                  x2="0"
                  y2="100"
                  class="ps-curve__handle"
                />
                <line
                  :x1="activeCurve.x2 * 100"
                  :y1="100 - activeCurve.y2 * 100"
                  x2="100"
                  y2="0"
                  class="ps-curve__handle"
                />
                <path :d="activeCurvePath" class="ps-curve__line" />
                <circle :cx="activeCurve.x1 * 100" :cy="100 - activeCurve.y1 * 100" r="2.4" class="ps-curve__point" />
                <circle :cx="activeCurve.x2 * 100" :cy="100 - activeCurve.y2 * 100" r="2.4" class="ps-curve__point" />
              </svg>
              <div class="ps-curve__presets">
                <button
                  v-for="preset in CURVE_PRESETS"
                  :key="preset.id"
                  type="button"
                  class="ps-chip"
                  @click="applyCurvePreset(preset)"
                >
                  {{ preset.name }}
                </button>
              </div>
              <div class="ps-curve__inputs">
                <label
                  >X1<input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    :value="activeCurve.x1"
                    @change="setCurvePoint('x1', $event)"
                /></label>
                <label
                  >Y1<input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    :value="activeCurve.y1"
                    @change="setCurvePoint('y1', $event)"
                /></label>
                <label
                  >X2<input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    :value="activeCurve.x2"
                    @change="setCurvePoint('x2', $event)"
                /></label>
                <label
                  >Y2<input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    :value="activeCurve.y2"
                    @change="setCurvePoint('y2', $event)"
                /></label>
              </div>
            </div>

            <div class="ps-grid-3 ps-action-common">
              <UiField label="动作时长" stacked>
                <input
                  v-model.number="selectedAction.duration"
                  class="ps-number"
                  type="number"
                  min="0.2"
                  max="600"
                  step="0.1"
                />
              </UiField>
              <UiField label="起始" hint="秒，留空自动" stacked>
                <input
                  class="ps-number"
                  type="number"
                  min="0"
                  max="600"
                  step="0.1"
                  placeholder="自动"
                  :value="selectedAction.start ?? ''"
                  @change="setActionStart"
                />
              </UiField>
              <UiField label="备注" stacked>
                <input
                  v-model="selectedAction.note"
                  class="ps-text-input"
                  maxlength="60"
                  placeholder="镜头意图 / 审片备注"
                />
              </UiField>
            </div>
          </div>

          <div class="ps-block">
            <div class="ps-block__head">
              <span class="ps-block__title">镜头录制</span>
              <span class="ps-block__hint">LIVE CAPTURE</span>
            </div>
            <UiField label="平滑强度">
              <input v-model.number="recordingSmoothing" class="ps-range" type="range" min="0" max="1" step="0.01" />
            </UiField>
            <button v-if="!recording.active" type="button" class="ps-record-btn" @click="startRecording">
              <span class="ps-record-btn__dot" />
              开始录制当前视角
            </button>
            <div v-else class="ps-record-active">
              <span class="ps-record-active__clock">{{ formatClock(recording.elapsed / 1000) }}</span>
              <button type="button" class="ps-btn is-primary is-small" @click="finishRecording">停止并生成</button>
              <button type="button" class="ps-btn is-small" @click="cancelRecording">取消</button>
            </div>
            <p class="ps-hint">录制会实时采样相机位置与姿态，自动生成 recordRoute 动作；相机会自动保持离地至少 4m。</p>
          </div>
        </template>

        <template v-if="railTab === 'tracks'">
          <div class="ps-tracks">
            <div class="ps-tracks__head">
              <span>标准轨道</span>
              <b>{{ trackFrames }} 帧 · {{ TIMELINE_FPS }}fps</b>
            </div>
            <div v-for="lane in trackLanes" :key="lane.id" class="ps-track">
              <div class="ps-track__label">
                <span>{{ lane.label }}</span>
                <small>{{ lane.hint }}</small>
              </div>
              <div class="ps-track__lane" @click="seekTrack" @dragover.prevent @drop.prevent="onLaneDrop(lane, $event)">
                <span class="ps-track__playhead" :style="{ left: `${playheadPercent}%` }" />
                <button
                  v-for="clip in lane.clips"
                  :key="clip.id"
                  type="button"
                  class="ps-track__clip"
                  :class="{
                    'is-active': clip.actionId === selectedActionId,
                    'is-off': !clip.enabled,
                    'is-locked': clip.locked
                  }"
                  :style="{
                    left: `${(clip.startFrame / trackFrames) * 100}%`,
                    width: `${Math.max(1.2, (clip.durationFrames / trackFrames) * 100)}%`,
                    '--clip-color': clip.color
                  }"
                  :title="`${clip.label} · ${clip.durationFrames} 帧 · 第 ${clip.stepIndex + 1} 幕${clip.locked ? ' · 已锁定' : ''}`"
                  :draggable="!clip.locked"
                  @dragstart="onTrackClipDragStart(clip, $event)"
                  @dragover.prevent
                  @drop.prevent="onTrackClipDrop(clip)"
                  @click.stop="selectTrackClip(clip)"
                >
                  <Icon :name="clip.locked ? 'lock' : clip.icon" :size="10" />
                  <span>{{ clip.label }}</span>
                  <span
                    v-if="!clip.locked"
                    class="ps-track__trim"
                    title="拖动调整片段时长"
                    draggable="false"
                    @dragstart.stop.prevent
                    @pointerdown.stop="onTrimStart(clip, $event)"
                  />
                </button>
              </div>
            </div>
            <p class="ps-hint">
              拖动片段到轨道空白处调整起点，拖动尾部调整时长；两者都会吸附边界，点击片段跳转并选中动作。
            </p>
          </div>
        </template>
      </div>
    </aside>

    <div v-show="!uiHidden" class="ps-transport">
      <div class="ps-scrubber">
        <div class="ps-scrubber__ticks">
          <span
            v-for="marker in stepMarkers"
            :key="marker.id"
            class="ps-scrubber__tick"
            :style="{ left: `${marker.left}%`, width: `${Math.max(0.25, marker.width)}%` }"
          />
        </div>
        <input
          class="ps-scrubber__input"
          type="range"
          min="0"
          :max="Math.max(0.01, total)"
          :step="1 / TIMELINE_FPS"
          :value="currentTime"
          @input="seek(Number(($event.target as HTMLInputElement).value))"
        />
      </div>
      <div class="ps-transport__row">
        <div class="ps-transport__status">
          <span class="ps-mode" :class="`is-${mode}`"> <span class="ps-mode__dot" />{{ modeLabel }} </span>
          <span class="ps-transport__step">{{ activeStepName }}</span>
          <span v-if="isDirty && !isPlayerMode" class="ps-transport__dirty">未保存</span>
        </div>
        <div class="ps-transport__controls">
          <button type="button" class="ps-transport__btn" title="上一幕" @click="previousStep">
            <Icon name="prev" :size="16" />
          </button>
          <button
            type="button"
            class="ps-transport__btn is-main"
            :title="mode === 'playing' ? '暂停' : '播放'"
            @click="togglePlayback"
          >
            <Icon :name="mode === 'playing' ? 'pause' : 'play'" :size="18" />
          </button>
          <button type="button" class="ps-transport__btn" title="停止并回到开头" @click="stopPlayback">
            <Icon name="stop" :size="14" />
          </button>
          <button
            type="button"
            class="ps-transport__btn"
            :class="{ 'is-active': loopPlayback }"
            :title="loopPlayback ? '关闭循环播放' : '循环播放'"
            @click="loopPlayback = !loopPlayback"
          >
            <Icon name="replay" :size="14" />
          </button>
          <button type="button" class="ps-transport__btn" title="下一幕" @click="nextStep">
            <Icon name="next" :size="16" />
          </button>
        </div>
        <div class="ps-transport__right">
          <span class="ps-clock">{{ formatClock(currentTime) }}<i>/</i>{{ formatClock(total) }}</span>
          <span class="ps-frame">{{ Math.round(currentTime * TIMELINE_FPS) }}F</span>
          <div class="ps-speed">
            <button
              v-for="rate in [0.5, 1, 1.5, 2]"
              :key="rate"
              type="button"
              class="ps-speed__item"
              :class="{ 'is-active': playbackRate === rate }"
              @click="playbackRate = rate"
            >
              {{ rate }}x
            </button>
          </div>
          <button type="button" class="ps-transport__btn is-ghost" title="后退 0.2s" @click="stepFrame(-0.2)">
            <Icon name="prev" :size="14" />
          </button>
          <button type="button" class="ps-transport__btn is-ghost" title="前进 0.2s" @click="stepFrame(0.2)">
            <Icon name="next" :size="14" />
          </button>
          <button
            v-if="!isPlayerMode"
            type="button"
            class="ps-transport__btn is-ghost"
            title="视频导出 (Ctrl+E)"
            @click="openExportDialog"
          >
            <Icon name="film" :size="15" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="!uiHidden" class="ps-toasts">
      <div v-for="item in toasts" :key="item.id" class="ps-toast" :class="`is-${item.tone}`">
        <Icon
          :name="item.tone === 'success' ? 'check' : item.tone === 'error' || item.tone === 'warn' ? 'warning' : 'info'"
          :size="14"
        />
        <span>{{ item.text }}</span>
      </div>
    </div>

    <input
      ref="fileInputRef"
      type="file"
      accept=".json,.zip,.studio.json,.cesium.presentation,application/json,application/zip"
      class="ps-hidden-input"
      @change="onFilePicked"
    />

    <UiModal
      :open="dialog.kind === 'new'"
      title="新建演示"
      subtitle="以当前工程的初始状态作为起点"
      width="440px"
      @close="closeDialog"
      @confirm="confirmDialog"
    >
      <UiField label="工程名称" stacked>
        <input
          v-model="dialog.value"
          class="ps-text-input"
          maxlength="60"
          placeholder="例如：曲江夜色 · 飞行演示"
          @keydown.enter="confirmDialog"
        />
      </UiField>
    </UiModal>

    <UiModal
      :open="dialog.kind === 'rename'"
      title="重命名工程"
      width="440px"
      @close="closeDialog"
      @confirm="confirmDialog"
    >
      <UiField label="工程名称" stacked>
        <input v-model="dialog.value" class="ps-text-input" maxlength="60" @keydown.enter="confirmDialog" />
      </UiField>
    </UiModal>

    <UiModal
      :open="dialog.kind === 'saveAs'"
      title="另存为新工程"
      subtitle="复制当前工程的全部步骤与动作"
      width="440px"
      @close="closeDialog"
      @confirm="confirmDialog"
    >
      <UiField label="新工程名称" stacked>
        <input v-model="dialog.value" class="ps-text-input" maxlength="60" @keydown.enter="confirmDialog" />
      </UiField>
    </UiModal>

    <UiModal
      :open="dialog.kind === 'projectSettings'"
      title="工程设置"
      width="520px"
      @close="closeDialog"
      @confirm="confirmDialog"
    >
      <UiField label="工程名称" stacked>
        <input v-model="dialog.value" class="ps-text-input" maxlength="60" />
      </UiField>
      <UiField label="工程说明" stacked>
        <textarea
          v-model="dialog.note"
          class="ps-textarea"
          rows="4"
          maxlength="800"
          placeholder="记录演示主题、镜头语言或交付说明"
        />
      </UiField>
      <div class="ps-dialog-actions">
        <button type="button" class="ps-btn is-small" @click="exportProjectFile">
          <Icon name="download" :size="13" />导出工程文档
        </button>
        <button type="button" class="ps-btn is-small" @click="exportProjectPackage">
          <Icon name="download" :size="13" />导出工程包
        </button>
        <button type="button" class="ps-btn is-small" @click="triggerImport">
          <Icon name="upload" :size="13" />导入工程
        </button>
      </div>
    </UiModal>

    <UiModal
      :open="dialog.kind === 'deleteProject'"
      title="删除工程"
      width="440px"
      danger
      confirm-text="删除"
      @close="closeDialog"
      @confirm="confirmDialog"
    >
      <p class="ps-dialog-text">确认删除「{{ dialog.value }}」？该操作会从本地工程库移除，无法撤销。</p>
      <p class="ps-dialog-sub">建议先导出工程文件作为备份。</p>
    </UiModal>

    <UiModal
      :open="dialog.kind === 'unsaved'"
      title="有未保存的修改"
      subtitle="切换工程或新建前需要处理当前草稿"
      width="480px"
      @close="closeDialog"
    >
      <p class="ps-dialog-text">「{{ project.name }}」存在尚未保存的修改。草稿已自动写入浏览器，可安全保存后继续。</p>
      <template #footer>
        <button type="button" class="ps-btn" @click="closeDialog">取消</button>
        <button type="button" class="ps-btn" @click="discardAndContinue">放弃修改</button>
        <button type="button" class="ps-btn is-primary" @click="saveAndContinue">保存并继续</button>
      </template>
    </UiModal>

    <UiModal
      :open="dialog.kind === 'export'"
      title="导出演示"
      subtitle="实时录制或逐帧确定性渲染，合成字幕、弹窗与转场"
      width="560px"
      @close="closeDialog"
    >
      <div class="ps-export-section">
        <span class="ps-export-label">分辨率</span>
        <div class="ps-seg">
          <button
            v-for="option in [
              { id: '1080p', label: '1080P', meta: '1920×1080' },
              { id: '2k', label: '2K', meta: '2560×1440' },
              { id: '4k', label: '4K', meta: '3840×2160' }
            ]"
            :key="option.id"
            type="button"
            class="ps-seg__item"
            :class="{ 'is-active': exportSettings.resolution === option.id }"
            @click="exportSettings.resolution = option.id as ExportSettings['resolution']"
          >
            <b>{{ option.label }}</b
            ><small>{{ option.meta }}</small>
          </button>
        </div>
      </div>
      <div class="ps-export-section">
        <span class="ps-export-label">帧率</span>
        <div class="ps-seg">
          <button
            type="button"
            class="ps-seg__item"
            :class="{ 'is-active': exportSettings.fps === 30 }"
            @click="exportSettings.fps = 30"
          >
            <b>30 FPS</b><small>稳定输出</small>
          </button>
          <button
            type="button"
            class="ps-seg__item"
            :class="{ 'is-active': exportSettings.fps === 60 }"
            @click="exportSettings.fps = 60"
          >
            <b>60 FPS</b><small>顺滑运动</small>
          </button>
        </div>
      </div>
      <div class="ps-export-section">
        <span class="ps-export-label">导出方式</span>
        <div class="ps-seg">
          <button
            type="button"
            class="ps-seg__item"
            :class="{ 'is-active': (exportSettings.format ?? 'video') === 'video' }"
            @click="selectExportMode('video', 'realtime')"
          >
            <b>实时视频</b><small>快 · 受设备帧率影响</small>
          </button>
          <button
            type="button"
            class="ps-seg__item"
            :class="{ 'is-active': exportIsFrames }"
            @click="selectExportMode('frames', 'deterministic')"
          >
            <b>逐帧序列</b><small>慢 · 确定性 PNG + ZIP</small>
          </button>
        </div>
      </div>
      <div class="ps-export-section">
        <span class="ps-export-label">画面适配</span>
        <div class="ps-seg">
          <button
            v-for="fit in [
              { id: 'contain', label: '完整' },
              { id: 'cover', label: '铺满' },
              { id: 'stretch', label: '拉伸' }
            ]"
            :key="fit.id"
            type="button"
            class="ps-seg__item"
            :class="{ 'is-active': (exportSettings.fit ?? 'contain') === fit.id }"
            @click="exportSettings.fit = fit.id as 'contain' | 'cover' | 'stretch'"
          >
            <b>{{ fit.label }}</b
            ><small>{{ fit.id }}</small>
          </button>
        </div>
      </div>
      <div class="ps-export-info">
        <div>
          <span>输出</span
          ><b>{{
            exportIsFrames
              ? `PNG 序列 · ${exportProfile.width}×${exportProfile.height}`
              : (recorderFormat?.label ?? '不支持')
          }}</b>
        </div>
        <div>
          <span>时间轴</span><b>{{ formatClock(total) }}</b>
        </div>
        <div>
          <span>步骤动作</span
          ><b
            >{{ project.steps.length }} 幕 /
            {{
              project.steps.reduce((sum, step) => sum + step.actions.filter((action) => action.enable).length, 0)
            }}
            动作</b
          >
        </div>
      </div>
      <p class="ps-export-note">
        {{
          exportIsFrames
            ? '逐帧模式以整数帧求值，输出 PNG 序列、字幕 SRT 与 manifest，压缩为 ZIP 下载。'
            : '实时模式请保持页面处于前台，避免切换标签页导致丢帧；对确定性有要求时请使用逐帧模式。'
        }}
      </p>
      <template #footer>
        <button type="button" class="ps-btn" @click="closeDialog">取消</button>
        <button type="button" class="ps-btn is-primary" @click="startExport">
          <Icon name="film" :size="14" />{{ exportIsFrames ? '开始逐帧导出' : '开始实时导出' }}
        </button>
      </template>
    </UiModal>

    <UiModal
      :open="dialog.kind === 'help'"
      title="快捷键与操作"
      subtitle="在三维舞台内使用键盘完成快速编排"
      width="560px"
      hide-footer
      @close="closeDialog"
    >
      <div class="ps-shortcuts">
        <div><kbd>Space</kbd><span>播放 / 暂停</span></div>
        <div><kbd>←</kbd><kbd>→</kbd><span>后退 / 前进 1 帧</span></div>
        <div><kbd>Home</kbd><span>停止并回到开头</span></div>
        <div><kbd>H</kbd><span>隐藏 / 显示界面</span></div>
        <div><kbd>F</kbd><span>全屏预览</span></div>
        <div><kbd>Esc</kbd><span>退出播放 / 取消录制</span></div>
        <div><kbd>Ctrl</kbd><kbd>S</kbd><span>保存当前工程</span></div>
        <div><kbd>Ctrl</kbd><kbd>E</kbd><span>打开视频导出</span></div>
        <div><kbd>Ctrl</kbd><kbd>Z</kbd><span>撤销上一步编辑</span></div>
        <div><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>Z</kbd><span>重做已撤销的编辑</span></div>
        <div><kbd>L</kbd><span>循环播放开关</span></div>
      </div>
      <p class="ps-dialog-sub">{{ STAGE_HELP }}</p>
    </UiModal>

    <UiModal
      :open="dialog.kind === 'importError'"
      title="无法导入工程"
      width="460px"
      @close="closeDialog"
      @confirm="confirmDialog"
    >
      <p class="ps-dialog-text">{{ dialog.message }}</p>
      <p class="ps-dialog-sub">
        请确认文件为 Presentation Studio 导出的 .studio.zip / .studio.json / .cesium.presentation 或合法 JSON。
      </p>
    </UiModal>
  </div>
</template>

<style src="./studio.css"></style>
