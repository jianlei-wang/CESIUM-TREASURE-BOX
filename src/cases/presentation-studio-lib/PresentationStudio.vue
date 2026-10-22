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
import { buildTimeline, clamp, evaluateTimeline, globalTimeForStep, previewTimeForSelection } from './core/timeline'
import { drawExportOverlay } from './core/export-overlay'
import { createBlankInitial, deepClone, formatClock, formatDate, hasPlayableActions, parseProjectFile, serializeProject } from './core/normalize'
import { finalizeRoute } from './core/recorder'
import { PresentationScene } from './core/scene'
import { downloadBlob, downloadText, readStore, writeStore, type StudioStore } from './core/storage'
import { CompositeExporter, detectRecorderFormat, resolutionOf } from './core/video'
import type {
  ActionType,
  CameraPose,
  DialogState,
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

const STAGE_HELP = '空格 播放/暂停 · ←/→ 单帧 · Home 回到开头 · H 隐藏界面 · F 全屏 · Ctrl+S 保存'

function loadInitialStore(): { store: StudioStore; signature: string; snapshot: PresentationProject; restored: boolean } {
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
    return { store: saved, signature, snapshot, restored }
  }
  const sample = createSampleProject()
  return {
    store: { version: 1, currentId: sample.id, projects: [sample], draft: null },
    signature: JSON.stringify(sample),
    snapshot: deepClone(sample),
    restored: false
  }
}

const bootState = loadInitialStore()
const store = ref<StudioStore>(bootState.store)
const savedSignature = ref(bootState.signature)
const savedSnapshot = ref<PresentationProject | null>(bootState.snapshot)

const project = computed<PresentationProject>(() => {
  return store.value.projects.find((item) => item.id === store.value.currentId) ?? store.value.projects[0]!
})
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

const stageRef = ref<HTMLElement | null>(null)
const viewportRef = ref<HTMLElement | null>(null)
let scene: PresentationScene | null = null

const sceneStatus = reactive<SceneStatus>({ ready: false, failed: false, message: '准备三维场景', detail: '正在创建 Cesium 视图' })
const loading = computed(() => !sceneStatus.ready && !sceneStatus.failed)

const mode = ref<PlaybackMode>('idle')
const currentTime = ref(0)
const playbackRate = ref(1)
const uiHidden = ref(false)
const isFullscreen = ref(false)
const isCompact = ref(false)
const railLeftOpen = ref(true)
const railRightOpen = ref(true)

const isDirty = computed(() => JSON.stringify(project.value) !== savedSignature.value)

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

const recorderFormat = detectRecorderFormat()
const exportSettings = reactive<ExportSettings>({ resolution: '1080p', fps: 30 })
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
let exportRaf = 0
let recordingTimer: number | undefined
let draftTimer: number | undefined
let recordingSamples: { pose: CameraPose; elapsed: number }[] = []
let exporter: CompositeExporter | null = null
let exportCancelled = false
let exportStartedAt = 0
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
  const next = evaluateTimeline(timeline.value, time, project.value.initial)
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

function stepFrame(delta: number): void {
  pausePlayback()
  mode.value = 'preview'
  const next = clamp(currentTime.value + delta, 0, total.value)
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
  if (suspendDraft) return
  if (draftTimer) window.clearTimeout(draftTimer)
  draftTimer = window.setTimeout(() => {
    persistDraft()
  }, 600)
}

function persistDraft(): void {
  store.value.draft = {
    projectId: project.value.id,
    project: deepClone(project.value),
    savedAt: nowIso()
  }
  writeStore(store.value)
}

function commitBaseline(): void {
  savedSignature.value = JSON.stringify(project.value)
  savedSnapshot.value = deepClone(project.value)
  store.value.draft = null
  writeStore(store.value)
  ensureSelection()
}

function saveProject(): void {
  project.value.updateTime = nowIso()
  const index = store.value.projects.findIndex((item) => item.id === project.value.id)
  const stored = deepClone(project.value)
  if (index >= 0) store.value.projects[index] = stored
  store.value.draft = null
  writeStore(store.value)
  savedSignature.value = JSON.stringify(stored)
  savedSnapshot.value = deepClone(stored)
  toast('已保存到本地工程库', 'success')
}

function discardChanges(): void {
  if (!savedSnapshot.value) return
  const index = store.value.projects.findIndex((item) => item.id === project.value.id)
  if (index >= 0) store.value.projects[index] = deepClone(savedSnapshot.value)
  initializeSelection()
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
  const filename = `${safeFileName(project.value.name)}.cesium.presentation`
  downloadText(serializeProject(project.value), filename)
  toast('工程文件已导出', 'success')
}

function triggerImport(): void {
  fileInputRef.value?.click()
}

async function onFilePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const text = await file.text()
    const imported = parseProjectFile(text)
    if (store.value.projects.some((item) => item.id === imported.id)) imported.id = createId('prj')
    imported.updateTime = nowIso()
    store.value.projects.push(imported)
    store.value.currentId = imported.id
    initializeSelection()
    commitBaseline()
    currentTime.value = 0
    applyRuntimeAt(0)
    toast(`已导入「${imported.name}」`, 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : '无法解析工程文件'
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

function toggleAction(action: PresentationAction): void {
  action.enable = !action.enable
  applyRuntimeAt(clamp(currentTime.value, 0, total.value))
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
    routeAction.value.route.samples.map((sample) => ({ pose: { ...sample }, elapsed: sample.t * routeAction.value!.route.recordedDuration * 1000 })),
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
  if (!recorderFormat) {
    toast('当前浏览器不支持 MediaRecorder 视频导出', 'error')
    return
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
  if (!recorderFormat) {
    toast('当前浏览器不支持视频导出', 'error')
    return
  }
  const playable = hasPlayableActions(project.value)
  if (!playable.ok) {
    toast(playable.message, 'warn')
    return
  }
  dialog.kind = null
  pausePlayback()
  exportState.active = true
  exportState.progress = 0
  exportState.phase = 'preparing'
  exportState.message = '准备导出环境'
  exportState.mime = recorderFormat.mime
  exportState.extension = recorderFormat.extension
  exportCancelled = false
  mode.value = 'exporting'
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  const viewportWidth = scene.canvas.clientWidth || 1280
  const { width, height } = resolutionOf(exportSettings)
  scene.setResolutionScale(clamp(width / viewportWidth, 1, 2.4))
  const first = evaluateTimeline(timeline.value, 0, project.value.initial)
  runtime.value = first
  scene.applyRuntime(first)
  scene.requestRender()
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  try {
    const source = scene.canvas
    exporter = new CompositeExporter({
      source,
      width,
      height,
      fps: exportSettings.fps,
      mime: recorderFormat.mime
    })
    exportStartedAt = performance.now()
    exportState.phase = 'recording'
    exportState.message = `正在实时渲染 ${width}×${height} · ${exportSettings.fps}fps`
    const projectPoint = projectScaledPoint(width, height)
    const loop = (timestamp: number): void => {
      if (!exporter || exportCancelled) return
      const elapsed = Math.min(total.value, (timestamp - exportStartedAt) / 1000)
      const next = evaluateTimeline(timeline.value, elapsed, project.value.initial)
      runtime.value = next
      scene?.applyRuntime(next)
      exporter.drawFrame((ctx, canvasWidth, canvasHeight) => {
        drawExportOverlay(ctx, canvasWidth, canvasHeight, next, projectPoint)
      })
      exportState.progress = total.value > 0 ? clamp(elapsed / total.value, 0, 1) : 1
      exportState.message = `正在实时渲染 ${formatClock(elapsed)} / ${formatClock(total.value)}`
      currentTime.value = elapsed
      if (elapsed >= total.value) {
        void finalizeExport()
        return
      }
      exportRaf = requestAnimationFrame(loop)
    }
    exportRaf = requestAnimationFrame(loop)
  } catch (error) {
    const message = error instanceof Error ? error.message : '无法启动视频导出'
    toast(message, 'error')
    cleanupExport()
  }
}

async function finalizeExport(): Promise<void> {
  if (!exporter) return
  exportState.phase = 'finalizing'
  exportState.message = '正在封装视频文件'
  exportState.progress = 1
  const active = exporter
  await new Promise<void>((resolve) => window.setTimeout(resolve, 400))
  try {
    const blob = await active.stop()
    if (!exportCancelled) {
      const extension = exportState.extension || 'webm'
      downloadBlob(blob, `${safeFileName(project.value.name)}.${extension}`)
      toast(`视频已导出：${(blob.size / 1024 / 1024).toFixed(1)} MB`, 'success')
    }
  } catch {
    toast('视频封装失败，请重试', 'error')
  } finally {
    cleanupExport()
  }
}

function cleanupExport(): void {
  if (exportRaf) cancelAnimationFrame(exportRaf)
  exportRaf = 0
  exporter = null
  exportState.active = false
  exportState.phase = 'done'
  exportState.progress = 0
  exportState.message = ''
  mode.value = 'idle'
  scene?.setResolutionScale(1)
  currentTime.value = 0
  applyRuntimeAt(0)
}

function cancelExport(): void {
  exportCancelled = true
  exporter?.cancel()
  cleanupExport()
  toast('已取消视频导出')
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
  const point = landmark && scene?.isReady
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
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
    return
  }
  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === 's') {
      event.preventDefault()
      saveProject()
    }
    if (event.key.toLowerCase() === 'e') {
      event.preventDefault()
      openExportDialog()
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
  if (!isDirty.value) return
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
  } catch (error) {
    sceneStatus.failed = true
    sceneStatus.message = '三维场景加载失败'
    sceneStatus.detail = error instanceof Error ? error.message : '请检查网络与 WebGL 支持'
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

onMounted(() => {
  compactQuery = window.matchMedia('(max-width: 760px)')
  syncCompactLayout(compactQuery.matches)
  compactQuery.addEventListener('change', onCompactChange)
  initializeSelection()
  applyRuntimeAt(0)
  void bootScene()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  if (restoredNotice) {
    restoredNotice = false
    toast('已恢复上次未保存的编辑草稿', 'info')
  }
})

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  if (exportRaf) cancelAnimationFrame(exportRaf)
  if (recordingTimer) window.clearInterval(recordingTimer)
  if (draftTimer) window.clearTimeout(draftTimer)
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
      return 'EDIT'
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
      'is-playing': mode === 'playing'
    }"
  >
    <div class="ps-stage">
      <div ref="viewportRef" class="ps-viewport" />
      <div class="ps-stage__grid" aria-hidden="true" />
      <div class="ps-stage__glow" aria-hidden="true" />

      <div class="ps-overlay">
        <div v-if="runtime.chapter" class="ps-chapter" :class="`is-${runtime.chapter.type}`" :style="{ opacity: runtime.chapter.alpha }">
          <div v-if="runtime.chapter.type === 'dip'" class="ps-chapter__dip" />
          <div v-if="runtime.chapter.type === 'slide'" class="ps-chapter__slide" />
          <div class="ps-chapter__content">
            <div class="ps-chapter__index">{{ String(runtime.chapter.index).padStart(2, '0') }}</div>
            <div class="ps-chapter__rule" />
            <div class="ps-chapter__name">{{ runtime.chapter.name }}</div>
            <div class="ps-chapter__meta">STEP {{ String(runtime.chapter.index).padStart(2, '0') }} / {{ String(runtime.chapter.total).padStart(2, '0') }}</div>
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
            <span>{{ exportState.phase === 'finalizing' ? '封装中' : '实时录制' }} · {{ exportSettings.resolution.toUpperCase() }} · {{ exportSettings.fps }}fps</span>
          </div>
        </div>

        <div v-if="loading" class="ps-loading">
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

        <div v-if="!uiHidden && mode !== 'playing' && mode !== 'exporting'" class="ps-stage-brand">
          <span class="ps-stage-brand__dot" />
          <span>PRESENTATION</span>
          <span class="ps-stage-brand__name">{{ project.name }}</span>
          <span v-if="isDirty" class="ps-stage-brand__dirty">未保存</span>
        </div>

        <div v-if="!uiHidden" class="ps-stage-actions">
          <button type="button" class="ps-stage-btn ps-stage-btn--compact" :class="{ 'is-active': railLeftOpen }" title="工程与图层" @click="openRail('left')">
            <Icon name="folder" :size="15" />
          </button>
          <button type="button" class="ps-stage-btn ps-stage-btn--compact" :class="{ 'is-active': railRightOpen }" title="演示编排" @click="openRail('right')">
            <Icon name="step" :size="15" />
          </button>
          <button type="button" class="ps-stage-btn" :class="{ 'is-active': isFullscreen }" title="全屏 (F)" @click="toggleFullscreen">
            <Icon name="expand" :size="15" />
          </button>
          <button type="button" class="ps-stage-btn" title="隐藏界面 (H)" @click="uiHidden = true">
            <Icon name="eyeOff" :size="15" />
          </button>
          <button type="button" class="ps-stage-btn" title="快捷键" @click="openDialog('help')">
            <Icon name="keyboard" :size="15" />
          </button>
        </div>

        <div v-if="uiHidden" class="ps-cinema-hint">
          <button type="button" class="ps-btn is-ghost" @click="uiHidden = false">显示界面 (H)</button>
        </div>
      </div>
    </div>

    <div v-if="isCompact && !uiHidden && (railLeftOpen || railRightOpen)" class="ps-rail-backdrop" @click="closeRails" />

    <aside v-show="!uiHidden && railLeftOpen" class="ps-rail ps-rail--left">
      <header class="ps-brand">
        <div class="ps-brand__mark"><Icon name="brand" :size="24" /></div>
        <div class="ps-brand__text">
          <div class="ps-brand__title">Presentation Studio</div>
          <div class="ps-brand__subtitle">CESIUM · CINEMATIC TOOLKIT</div>
        </div>
        <span class="ps-brand__version">1.0</span>
        <button v-if="isCompact" type="button" class="ps-rail__close" title="收起面板" @click="closeRails"><Icon name="close" :size="15" /></button>
      </header>

      <div class="ps-rail__scroll">
        <UiSection title="工程" icon="folder" :badge="`${store.projects.length}`">
          <div class="ps-project">
            <div class="ps-project__head">
              <div class="ps-project__name">{{ project.name }}</div>
              <span v-if="isDirty" class="ps-project__state">未保存</span>
              <span v-else class="ps-project__state is-saved">已保存</span>
            </div>
            <div class="ps-project__meta">{{ project.steps.length }} 幕 · {{ project.steps.reduce((sum, step) => sum + step.actions.length, 0) }} 动作 · {{ formatDate(project.updateTime) }}</div>
            <p v-if="project.note" class="ps-project__note">{{ project.note }}</p>
            <div class="ps-project__tools">
              <button type="button" class="ps-btn is-primary is-small" @click="saveProject">
                <Icon name="save" :size="14" />保存
              </button>
              <button type="button" class="ps-btn is-small" @click="exportProjectFile">
                <Icon name="download" :size="14" />导出
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
                <span class="ps-project-item__meta">{{ item.steps.length }} 幕 · {{ formatDate(item.updateTime) }}</span>
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
            <button type="button" class="ps-btn is-small" @click="createNewProject"><Icon name="plus" :size="14" />新建</button>
            <button type="button" class="ps-btn is-small" @click="triggerImport"><Icon name="upload" :size="14" />导入</button>
            <button type="button" class="ps-btn is-small" @click="openSaveAs"><Icon name="copy" :size="14" />另存</button>
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
            <UiSwitch v-model="project.initial.layers[layer.id]" :label="layer.name" />
          </div>
          <div class="ps-btn-row">
            <button type="button" class="ps-btn is-small" @click="captureInitialCamera"><Icon name="camera" :size="13" />捕获初始机位</button>
            <button type="button" class="ps-btn is-small" @click="resetInitialState"><Icon name="reset" :size="13" />重置</button>
          </div>
        </UiSection>

        <UiSection title="初始效果" icon="sparkle">
          <div class="ps-toggle-row" v-for="effect in EFFECT_DEFINITIONS" :key="effect.id">
            <span class="ps-toggle-row__icon"><Icon :name="effect.icon" :size="15" /></span>
            <span class="ps-toggle-row__body">
              <span class="ps-toggle-row__name">{{ effect.name }}</span>
              <span class="ps-toggle-row__desc">{{ effect.description }}</span>
            </span>
            <UiSwitch v-model="project.initial.effects[effect.id]" :label="effect.name" />
          </div>
        </UiSection>

        <UiSection title="初始时序" icon="clock" collapsible>
          <div class="ps-slider-row">
            <span class="ps-slider-row__head"><span>大雁塔生长</span><b>{{ Math.round(project.initial.time.dayanta * 100) }}%</b></span>
            <input v-model.number="project.initial.time.dayanta" class="ps-range" type="range" min="0" max="1" step="0.01" />
          </div>
          <div class="ps-slider-row">
            <span class="ps-slider-row__head"><span>地标显现</span><b>{{ Math.round(project.initial.time.landmarks * 100) }}%</b></span>
            <input v-model.number="project.initial.time.landmarks" class="ps-range" type="range" min="0" max="1" step="0.01" />
          </div>
          <div class="ps-slider-row">
            <span class="ps-slider-row__head"><span>光柱点亮</span><b>{{ Math.round(project.initial.time.beacons * 100) }}%</b></span>
            <input v-model.number="project.initial.time.beacons" class="ps-range" type="range" min="0" max="1" step="0.01" />
          </div>
        </UiSection>

        <UiSection title="地标导航" icon="pin" collapsible :open="false">
          <button v-for="landmark in LANDMARKS" :key="landmark.id" type="button" class="ps-landmark" @click="focusLandmark(landmark.id)">
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

    <aside v-show="!uiHidden && railRightOpen" class="ps-rail ps-rail--right">
      <header class="ps-rail__head">
        <div>
          <div class="ps-rail__eyebrow">STEP SEQUENCE</div>
          <div class="ps-rail__title">演示编排</div>
        </div>
        <div class="ps-rail__head-tools">
          <button type="button" class="ps-icon-btn" title="新增步骤" @click="addStep"><Icon name="plus" :size="16" /></button>
          <button v-if="isCompact" type="button" class="ps-rail__close" title="收起面板" @click="closeRails"><Icon name="close" :size="15" /></button>
        </div>
      </header>

      <div class="ps-rail__scroll">
        <div class="ps-step-list">
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
                <span class="ps-step__meta">{{ step.actions.length }} 动作 · {{ step.duration.toFixed(1) }}s · {{ step.speedRate }}x</span>
              </span>
              <span class="ps-step__type"><Icon :name="step.transition.type === 'none' ? 'minus' : 'sparkle'" :size="12" />{{ step.transition.type === 'none' ? '无转场' : `${step.transition.duration.toFixed(1)}s` }}</span>
            </button>
            <div class="ps-step__tools">
              <button type="button" class="ps-icon-btn is-tiny" title="上移" :disabled="index === 0" @click="moveStep(index, -1)"><Icon name="up" :size="12" /></button>
              <button type="button" class="ps-icon-btn is-tiny" title="下移" :disabled="index === project.steps.length - 1" @click="moveStep(index, 1)"><Icon name="down" :size="12" /></button>
              <button type="button" class="ps-icon-btn is-tiny" title="复制步骤" @click="duplicateStep(index)"><Icon name="copy" :size="12" /></button>
              <button type="button" class="ps-icon-btn is-tiny is-danger" title="删除步骤" @click="deleteStep(index)"><Icon name="trash" :size="12" /></button>
            </div>
          </div>
          <button type="button" class="ps-step-add" @click="addStep"><Icon name="plus" :size="14" />新增步骤</button>
        </div>

        <template v-if="selectedStep">
          <div class="ps-block">
            <div class="ps-block__head">
              <span class="ps-block__title">步骤属性</span>
              <span class="ps-block__hint">STEP {{ String(project.steps.findIndex((step) => step.stepId === selectedStep?.stepId) + 1).padStart(2, '0') }}</span>
            </div>
            <UiField label="名称">
              <input v-model="selectedStep.stepName" class="ps-text-input" maxlength="40" />
            </UiField>
            <div class="ps-grid-3">
              <UiField label="时长" stacked>
                <input v-model.number="selectedStep.duration" class="ps-number" type="number" min="0.5" max="600" step="0.5" />
              </UiField>
              <UiField label="停留" stacked>
                <input v-model.number="selectedStep.stayTime" class="ps-number" type="number" min="0" max="60" step="0.1" />
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
                <input v-model.number="selectedStep.transition.duration" class="ps-number" type="number" min="0" max="5" step="0.1" />
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
              :class="{ 'is-active': action.actionId === selectedActionId, 'is-off': !action.enable }"
            >
              <button type="button" class="ps-action__main" @click="selectAction(action)">
                <span class="ps-action__icon" :style="{ color: ACTION_DEFINITIONS.find((item) => item.type === action.actionType)?.color }">
                  <Icon :name="ACTION_DEFINITIONS.find((item) => item.type === action.actionType)?.icon ?? 'dot'" :size="15" />
                </span>
                <span class="ps-action__body">
                  <span class="ps-action__name">{{ ACTION_DEFINITIONS.find((item) => item.type === action.actionType)?.name }}</span>
                  <span class="ps-action__meta">{{ action.duration.toFixed(1) }}s · {{ action.enable ? '启用' : '停用' }}</span>
                </span>
                <span class="ps-action__dot" />
              </button>
              <div class="ps-action__tools">
                <button type="button" class="ps-icon-btn is-tiny" title="上移" :disabled="index === 0" @click="moveAction(index, -1)"><Icon name="up" :size="11" /></button>
                <button type="button" class="ps-icon-btn is-tiny" title="下移" :disabled="index === selectedStep.actions.length - 1" @click="moveAction(index, 1)"><Icon name="down" :size="11" /></button>
                <button type="button" class="ps-icon-btn is-tiny" title="复制" @click="duplicateAction(index)"><Icon name="copy" :size="11" /></button>
                <button type="button" class="ps-icon-btn is-tiny is-danger" title="删除" @click="deleteAction(index)"><Icon name="trash" :size="11" /></button>
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
                <button type="button" class="ps-btn is-small is-primary" @click="captureFlyCamera"><Icon name="camera" :size="13" />捕获当前视角</button>
                <select class="ps-select" :value="flyAction.targetId ?? ''" @change="applyLandmarkToFly(($event.target as HTMLSelectElement).value)">
                  <option value="">自由机位</option>
                  <option v-for="landmark in LANDMARKS" :key="landmark.id" :value="landmark.id">{{ landmark.name }}</option>
                </select>
              </div>
              <div class="ps-grid-3">
                <UiField label="经度" stacked><input v-model.number="flyAction.camera.longitude" class="ps-number" type="number" step="0.0001" /></UiField>
                <UiField label="纬度" stacked><input v-model.number="flyAction.camera.latitude" class="ps-number" type="number" step="0.0001" /></UiField>
                <UiField label="高度" stacked><input v-model.number="flyAction.camera.height" class="ps-number" type="number" step="1" /></UiField>
                <UiField label="方位" stacked><input v-model.number="flyAction.camera.heading" class="ps-number" type="number" step="1" /></UiField>
                <UiField label="俯仰" stacked><input v-model.number="flyAction.camera.pitch" class="ps-number" type="number" step="1" /></UiField>
                <UiField label="视场角" stacked><input v-model.number="flyAction.camera.fov" class="ps-number" type="number" step="1" /></UiField>
              </div>
              <div class="ps-grid-2">
                <UiField label="缓动" stacked>
                  <select v-model="flyAction.easing" class="ps-select">
                    <option value="linear">线性</option>
                    <option value="smooth">平滑</option>
                    <option value="cinematic">电影</option>
                  </select>
                </UiField>
                <UiField label="弧线抬升">
                  <UiSwitch v-model="flyAction.arc" label="弧线飞行" />
                </UiField>
              </div>
              <p class="ps-hint">当前机位：{{ formatPoseValue(flyAction.camera.longitude) }}, {{ formatPoseValue(flyAction.camera.latitude) }} · {{ Math.round(flyAction.camera.height) }}m</p>
            </template>

            <template v-else-if="routeAction">
              <div class="ps-stats">
                <div><b>{{ routeAction.route.samples.length }}</b><span>采样点</span></div>
                <div><b>{{ routeAction.route.recordedDuration.toFixed(1) }}s</b><span>录制时长</span></div>
                <div><b>{{ routeAction.route.interpolation === 'catmullrom' ? '样条' : '线性' }}</b><span>插值</span></div>
              </div>
              <UiField label="衔接混合" hint="秒">
                <input v-model.number="routeAction.entryBlend" class="ps-number" type="number" min="0" max="4" step="0.1" />
              </UiField>
              <UiField label="平滑强度">
                <input v-model.number="routeAction.route.smoothing" class="ps-range" type="range" min="0" max="1" step="0.01" />
              </UiField>
              <UiField label="显示航线">
                <UiSwitch v-model="routeAction.showTrail" label="显示航线" />
              </UiField>
              <div class="ps-btn-row">
                <button type="button" class="ps-btn is-small" @click="smoothRoute"><Icon name="reset" :size="13" />重新平滑</button>
                <button type="button" class="ps-btn is-small is-danger" @click="purgeRoute"><Icon name="trash" :size="13" />清空航线</button>
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
                  <select v-model="timeAction.easing" class="ps-select">
                    <option value="linear">线性</option>
                    <option value="smooth">平滑</option>
                    <option value="cinematic">电影</option>
                  </select>
                </UiField>
              </div>
              <div class="ps-slider-row">
                <span class="ps-slider-row__head"><span>起始</span><b>{{ Math.round(timeAction.from * 100) }}%</b></span>
                <input v-model.number="timeAction.from" class="ps-range" type="range" min="0" max="1" step="0.01" />
              </div>
              <div class="ps-slider-row">
                <span class="ps-slider-row__head"><span>结束</span><b>{{ Math.round(timeAction.to * 100) }}%</b></span>
                <input v-model.number="timeAction.to" class="ps-range" type="range" min="0" max="1" step="0.01" />
              </div>
              <p class="ps-hint">{{ TIME_TARGET_LABELS[timeAction.target] }} · 时长 {{ timeAction.duration.toFixed(1) }}s</p>
            </template>

            <template v-else-if="subtitleAction">
              <UiField label="标题"><input v-model="subtitleAction.subtitle.title" class="ps-text-input" maxlength="40" /></UiField>
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
                  <select class="ps-select" :value="''" @change="applyLandmarkToCallout(($event.target as HTMLSelectElement).value)">
                    <option value="" disabled>选择地标</option>
                    <option v-for="landmark in LANDMARKS" :key="landmark.id" :value="landmark.id">{{ landmark.name }}</option>
                  </select>
                </UiField>
                <UiField label="字号">
                  <input v-model.number="subtitleAction.subtitle.fontSize" class="ps-range" type="range" min="16" max="64" step="1" />
                </UiField>
              </div>
              <div v-else class="ps-grid-2">
                <UiField label="字号">
                  <input v-model.number="subtitleAction.subtitle.fontSize" class="ps-range" type="range" min="16" max="64" step="1" />
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
                <UiField label="文字颜色"><input v-model="subtitleAction.subtitle.color" class="ps-color" type="color" /></UiField>
                <UiField label="强调色"><input v-model="subtitleAction.subtitle.accent" class="ps-color" type="color" /></UiField>
              </div>
              <div class="ps-slider-row">
                <span class="ps-slider-row__head"><span>淡入淡出</span><b>{{ subtitleAction.subtitle.fade.toFixed(2) }}s</b></span>
                <input v-model.number="subtitleAction.subtitle.fade" class="ps-range" type="range" min="0" max="2" step="0.05" />
              </div>
            </template>

            <template v-else-if="popupAction">
              <UiField label="标题"><input v-model="popupAction.popup.title" class="ps-text-input" maxlength="40" /></UiField>
              <UiField label="内容" stacked>
                <textarea v-model="popupAction.popup.content" class="ps-textarea" rows="3" maxlength="220" />
              </UiField>
              <div class="ps-grid-2">
                <UiField label="锚定地标" stacked>
                  <select v-model="popupAction.popup.targetId" class="ps-select">
                    <option :value="null">屏幕中心</option>
                    <option v-for="landmark in LANDMARKS" :key="landmark.id" :value="landmark.id">{{ landmark.name }}</option>
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
                <UiField label="强调色"><input v-model="popupAction.popup.accent" class="ps-color" type="color" /></UiField>
                <UiField label="卡片宽度" hint="px">
                  <input v-model.number="popupAction.popup.width" class="ps-number" type="number" min="200" max="560" step="10" />
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

            <div class="ps-grid-2 ps-action-common">
              <UiField label="动作时长" stacked>
                <input v-model.number="selectedAction.duration" class="ps-number" type="number" min="0.2" max="600" step="0.1" />
              </UiField>
              <UiField label="备注" stacked>
                <input v-model="selectedAction.note" class="ps-text-input" maxlength="60" placeholder="镜头意图 / 审片备注" />
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
            <p class="ps-hint">录制会实时采样相机位置与姿态，自动生成 recordRoute 动作。</p>
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
          step="0.01"
          :value="currentTime"
          @input="seek(Number(($event.target as HTMLInputElement).value))"
        />
      </div>
      <div class="ps-transport__row">
        <div class="ps-transport__status">
          <span class="ps-mode" :class="`is-${mode}`">
            <span class="ps-mode__dot" />{{ modeLabel }}
          </span>
          <span class="ps-transport__step">{{ activeStepName }}</span>
          <span v-if="isDirty" class="ps-transport__dirty">未保存</span>
        </div>
        <div class="ps-transport__controls">
          <button type="button" class="ps-transport__btn" title="上一幕" @click="previousStep"><Icon name="prev" :size="16" /></button>
          <button type="button" class="ps-transport__btn is-main" :title="mode === 'playing' ? '暂停' : '播放'" @click="togglePlayback">
            <Icon :name="mode === 'playing' ? 'pause' : 'play'" :size="18" />
          </button>
          <button type="button" class="ps-transport__btn" title="停止并回到开头" @click="stopPlayback"><Icon name="stop" :size="14" /></button>
          <button type="button" class="ps-transport__btn" title="下一幕" @click="nextStep"><Icon name="next" :size="16" /></button>
        </div>
        <div class="ps-transport__right">
          <span class="ps-clock">{{ formatClock(currentTime) }}<i>/</i>{{ formatClock(total) }}</span>
          <div class="ps-speed">
            <button
              v-for="rate in [0.5, 1, 1.5, 2]"
              :key="rate"
              type="button"
              class="ps-speed__item"
              :class="{ 'is-active': playbackRate === rate }"
              @click="playbackRate = rate"
            >{{ rate }}x</button>
          </div>
          <button type="button" class="ps-transport__btn is-ghost" title="后退 0.2s" @click="stepFrame(-0.2)"><Icon name="prev" :size="14" /></button>
          <button type="button" class="ps-transport__btn is-ghost" title="前进 0.2s" @click="stepFrame(0.2)"><Icon name="next" :size="14" /></button>
          <button type="button" class="ps-transport__btn is-ghost" title="视频导出 (Ctrl+E)" @click="openExportDialog"><Icon name="film" :size="15" /></button>
        </div>
      </div>
    </div>

    <div v-if="!uiHidden" class="ps-toasts">
      <div v-for="item in toasts" :key="item.id" class="ps-toast" :class="`is-${item.tone}`">
        <Icon :name="item.tone === 'success' ? 'check' : item.tone === 'error' || item.tone === 'warn' ? 'warning' : 'info'" :size="14" />
        <span>{{ item.text }}</span>
      </div>
    </div>

    <input ref="fileInputRef" type="file" accept=".json,.cesium.presentation,application/json" class="ps-hidden-input" @change="onFilePicked" />

    <UiModal :open="dialog.kind === 'new'" title="新建演示" subtitle="以当前工程的初始状态作为起点" width="440px" @close="closeDialog" @confirm="confirmDialog">
      <UiField label="工程名称" stacked>
        <input v-model="dialog.value" class="ps-text-input" maxlength="60" placeholder="例如：曲江夜色 · 飞行演示" @keydown.enter="confirmDialog" />
      </UiField>
    </UiModal>

    <UiModal :open="dialog.kind === 'rename'" title="重命名工程" width="440px" @close="closeDialog" @confirm="confirmDialog">
      <UiField label="工程名称" stacked>
        <input v-model="dialog.value" class="ps-text-input" maxlength="60" @keydown.enter="confirmDialog" />
      </UiField>
    </UiModal>

    <UiModal :open="dialog.kind === 'saveAs'" title="另存为新工程" subtitle="复制当前工程的全部步骤与动作" width="440px" @close="closeDialog" @confirm="confirmDialog">
      <UiField label="新工程名称" stacked>
        <input v-model="dialog.value" class="ps-text-input" maxlength="60" @keydown.enter="confirmDialog" />
      </UiField>
    </UiModal>

    <UiModal :open="dialog.kind === 'projectSettings'" title="工程设置" width="520px" @close="closeDialog" @confirm="confirmDialog">
      <UiField label="工程名称" stacked>
        <input v-model="dialog.value" class="ps-text-input" maxlength="60" />
      </UiField>
      <UiField label="工程说明" stacked>
        <textarea v-model="dialog.note" class="ps-textarea" rows="4" maxlength="800" placeholder="记录演示主题、镜头语言或交付说明" />
      </UiField>
      <div class="ps-dialog-actions">
        <button type="button" class="ps-btn is-small" @click="exportProjectFile"><Icon name="download" :size="13" />导出工程文件</button>
        <button type="button" class="ps-btn is-small" @click="triggerImport"><Icon name="upload" :size="13" />导入工程</button>
      </div>
    </UiModal>

    <UiModal :open="dialog.kind === 'deleteProject'" title="删除工程" width="440px" danger confirm-text="删除" @close="closeDialog" @confirm="confirmDialog">
      <p class="ps-dialog-text">确认删除「{{ dialog.value }}」？该操作会从本地工程库移除，无法撤销。</p>
      <p class="ps-dialog-sub">建议先导出工程文件作为备份。</p>
    </UiModal>

    <UiModal :open="dialog.kind === 'unsaved'" title="有未保存的修改" subtitle="切换工程或新建前需要处理当前草稿" width="480px" @close="closeDialog">
      <p class="ps-dialog-text">「{{ project.name }}」存在尚未保存的修改。草稿已自动写入浏览器，可安全保存后继续。</p>
      <template #footer>
        <button type="button" class="ps-btn" @click="closeDialog">取消</button>
        <button type="button" class="ps-btn" @click="discardAndContinue">放弃修改</button>
        <button type="button" class="ps-btn is-primary" @click="saveAndContinue">保存并继续</button>
      </template>
    </UiModal>

    <UiModal :open="dialog.kind === 'export'" title="导出演示视频" subtitle="实时渲染三维场景并合成字幕、弹窗与转场" width="560px" @close="closeDialog">
      <div class="ps-export-section">
        <span class="ps-export-label">分辨率</span>
        <div class="ps-seg">
          <button v-for="option in [{ id: '1080p', label: '1080P', meta: '1920×1080' }, { id: '2k', label: '2K', meta: '2560×1440' }, { id: '4k', label: '4K', meta: '3840×2160' }]" :key="option.id" type="button" class="ps-seg__item" :class="{ 'is-active': exportSettings.resolution === option.id }" @click="exportSettings.resolution = option.id as ExportSettings['resolution']">
            <b>{{ option.label }}</b><small>{{ option.meta }}</small>
          </button>
        </div>
      </div>
      <div class="ps-export-section">
        <span class="ps-export-label">帧率</span>
        <div class="ps-seg">
          <button type="button" class="ps-seg__item" :class="{ 'is-active': exportSettings.fps === 30 }" @click="exportSettings.fps = 30"><b>30 FPS</b><small>稳定输出</small></button>
          <button type="button" class="ps-seg__item" :class="{ 'is-active': exportSettings.fps === 60 }" @click="exportSettings.fps = 60"><b>60 FPS</b><small>顺滑运动</small></button>
        </div>
      </div>
      <div class="ps-export-info">
        <div><span>编码格式</span><b>{{ recorderFormat?.label ?? '不支持' }}</b></div>
        <div><span>时间轴</span><b>{{ formatClock(total) }}</b></div>
        <div><span>步骤动作</span><b>{{ project.steps.length }} 幕 / {{ project.steps.reduce((sum, step) => sum + step.actions.filter((action) => action.enable).length, 0) }} 动作</b></div>
      </div>
      <p class="ps-export-note">导出为实时录制，请保持页面处于前台，避免切换标签页导致丢帧。视频将自动下载。</p>
      <template #footer>
        <button type="button" class="ps-btn" @click="closeDialog">取消</button>
        <button type="button" class="ps-btn is-primary" @click="startExport"><Icon name="film" :size="14" />开始导出</button>
      </template>
    </UiModal>

    <UiModal :open="dialog.kind === 'help'" title="快捷键与操作" subtitle="在三维舞台内使用键盘完成快速编排" width="560px" hide-footer @close="closeDialog">
      <div class="ps-shortcuts">
        <div><kbd>Space</kbd><span>播放 / 暂停</span></div>
        <div><kbd>←</kbd><kbd>→</kbd><span>后退 / 前进 0.2 秒</span></div>
        <div><kbd>Home</kbd><span>停止并回到开头</span></div>
        <div><kbd>H</kbd><span>隐藏 / 显示界面</span></div>
        <div><kbd>F</kbd><span>全屏预览</span></div>
        <div><kbd>Esc</kbd><span>退出播放 / 取消录制</span></div>
        <div><kbd>Ctrl</kbd><kbd>S</kbd><span>保存当前工程</span></div>
        <div><kbd>Ctrl</kbd><kbd>E</kbd><span>打开视频导出</span></div>
      </div>
      <p class="ps-dialog-sub">{{ STAGE_HELP }}</p>
    </UiModal>

    <UiModal :open="dialog.kind === 'importError'" title="无法导入工程" width="460px" @close="closeDialog" @confirm="confirmDialog">
      <p class="ps-dialog-text">{{ dialog.message }}</p>
      <p class="ps-dialog-sub">请确认文件为 Presentation Studio 导出的 .cesium.presentation 或合法 JSON。</p>
    </UiModal>
  </div>
</template>

<style src="./studio.css"></style>
