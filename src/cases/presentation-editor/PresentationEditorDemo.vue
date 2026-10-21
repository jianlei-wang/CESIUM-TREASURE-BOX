<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Camera, Cartesian3, Color, Ion, Viewer } from 'cesium'
import { DEFAULT_VIEW_RECTANGLE, destroyScene, loadBingImagery, type SceneCallbacks } from '../../lib/cesium-scene'
import {
  ACTION_ICONS,
  ACTION_LABELS,
  DRAFT_STORAGE_KEY,
  EFFECT_LABELS,
  FPS_OPTIONS,
  LAYER_DEFINITIONS,
  POSITION_LABELS,
  PROJECT_FILE_SUFFIX,
  PROJECT_STORAGE_KEY,
  RESOLUTION_OPTIONS,
  SPEED_OPTIONS,
  actionSummary,
  clamp,
  cloneProject,
  createAction,
  createId,
  createProject,
  createSampleProject,
  createStep,
  defaultCameraPose,
  defaultLayerStates,
  defaultSceneState,
  defaultSubtitle,
  formatDateTime,
  formatTime,
  normalizeProject,
  parseProjectFile,
  serializeProject,
  stepEffectiveSeconds,
  type ActionType,
  type CameraPose,
  type LayerToggleParam,
  type PresentationAction,
  type PresentationProject,
  type PresentationStep,
  type ResolutionId,
  type RouteSample,
  type SceneEffectParam,
  type SceneEffectState,
  type SceneEffectType,
  type SubtitleParam,
  type SubtitlePosition,
  type TimeAnimationParam
} from './presentation'
import { PresentationPlayer, routePoseAt, type PlayerState, type StepRun, type SubtitleView } from './player'
import { PresentationScene } from './scene'
import { exportPresentationVideo, type ExportResult } from './exporter'

const CESIUM_ION_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmNGI3MTJlZi1kNGFmLTQ1OWQtYmJiMC0yMDViNjM0ZDdjYzMiLCJpZCI6Mzg2MzU3LCJpYXQiOjE3NzAwODA5MDJ9.-ggs9Xfr6ptMLXTs0MS7xdieNVFr7TMV7yyd-yjxyHw'

type DialogMode = 'new' | 'saveAs' | 'rename' | 'deleteProject' | null
type ToastTone = 'info' | 'warn' | 'error'

const ACTIONS: ActionType[] = ['flyTo', 'recordRoute', 'layerToggle', 'timeAnimation', 'subtitle', 'sceneEffect']
const EFFECTS: SceneEffectType[] = ['shadows', 'lighting', 'fog', 'atmosphere']
const POSITIONS: SubtitlePosition[] = ['fullscreen', 'top', 'bottom', 'left', 'right', 'callout']

const container = ref<HTMLElement | null>(null)
const importInput = ref<HTMLInputElement | null>(null)

const ready = ref(false)
const statusMessage = ref('正在初始化三维演示场景…')
const project = ref<PresentationProject>(createSampleProject())
const storedProjects = ref<PresentationProject[]>([])
const selectedStepIndex = ref(0)
const selectedActionIndex = ref(-1)
const dirty = ref(false)
const loadingProject = ref(false)

const playerReady = ref(false)
const playing = ref(false)
const progressTime = ref(0)
const duration = ref(0)
const speed = ref(1)
const timelineSteps = ref<StepRun[]>([])
const playheadStep = ref(-1)
const liveSubtitle = ref<SubtitleView | null>(null)
const previewSubtitle = ref<SubtitleView | null>(null)
const calloutPoint = ref<{ x: number; y: number } | null>(null)

const recording = ref(false)
const recordedCount = ref(0)
const routePreviewing = ref(false)
const previewingActionId = ref('')

const dialogMode = ref<DialogMode>(null)
const dialogName = ref('')
const dialogDesc = ref('')

const toast = ref('')
const toastTone = ref<ToastTone>('info')
let toastTimer = 0

const exportOpen = ref(false)
const exporting = ref(false)
const exportProgress = ref(0)
const exportResolution = ref<ResolutionId>('1080p')
const exportFps = ref(30)
const exportError = ref('')
const exportResult = ref<(ExportResult & { url: string; fileName: string; size: string }) | null>(null)
const exportController = ref<AbortController | null>(null)

const poiOptions = ref<Array<{ id: string; name: string; longitude: number; latitude: number; height: number }>>([])

let viewer: Viewer | undefined
let scene: PresentationScene | undefined
let player: PresentationPlayer | undefined
let syncTimer = 0
let draftTimer = 0
let routeTimer = 0
let previewRaf = 0
let previewToken = 0
let previewSubTimer = 0
let routeStart = 0
let routeBuffer: RouteSample[] = []
let calloutRemove: (() => void) | undefined

const currentStep = computed(() => project.value.steps[selectedStepIndex.value])
const currentAction = computed<PresentationAction | null>(
  () => currentStep.value?.actions[selectedActionIndex.value] ?? null
)
const flyPose = computed<CameraPose>(() => currentAction.value?.cameraParam ?? defaultCameraPose())
const subtitleParam = computed<SubtitleParam>(() => currentAction.value?.subtitle ?? defaultSubtitle())
const layerParam = computed<LayerToggleParam>(
  () => currentAction.value?.layerToggle ?? { layerId: 'poi', visible: false }
)
const timeParam = computed<TimeAnimationParam>(
  () => currentAction.value?.timeAnimation ?? { layerId: 'buildings', from: 0, to: 1 }
)
const effectParam = computed<SceneEffectParam>(
  () => currentAction.value?.sceneEffect ?? { effect: 'shadows', enabled: true, value: 0.0002 }
)
const routeSamples = computed<RouteSample[]>(() => currentAction.value?.routeSamples ?? [])

const totalActions = computed(() => project.value.steps.reduce((sum, step) => sum + step.actions.length, 0))
const durationText = computed(() => formatTime(duration.value))
const currentStepName = computed(() => currentStep.value?.stepName ?? '未选择步骤')
const activeSubtitle = computed(() => previewSubtitle.value ?? liveSubtitle.value)
const subtitleIsCallout = computed(
  () => activeSubtitle.value?.param.position === 'callout' || activeSubtitle.value?.param.mode === 'callout'
)

const isBusy = computed(() => exporting.value || recording.value)
const editingLocked = computed(() => exporting.value || playing.value)

function notify(message: string, tone: ToastTone = 'info'): void {
  toast.value = message
  toastTone.value = tone
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = ''
  }, 2800)
}

function sanitizeName(name: string): string {
  return (name.trim() || 'presentation').replace(/[\\/:*?"<>|]/g, '_')
}

function readStore(): PresentationProject[] {
  try {
    const raw = localStorage.getItem(PROJECT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        try {
          return normalizeProject(item)
        } catch {
          return null
        }
      })
      .filter((item): item is PresentationProject => item !== null)
  } catch {
    return []
  }
}

function writeStore(list: PresentationProject[]): void {
  try {
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(list))
  } catch {
    notify('本地存储空间不足，保存失败', 'error')
  }
}

function refreshStoredList(): void {
  storedProjects.value = [...readStore()].sort((left, right) => right.updateTime.localeCompare(left.updateTime))
}

function ensureCurrentStored(): void {
  const list = readStore()
  if (list.some((item) => item.id === project.value.id)) {
    refreshStoredList()
    return
  }
  list.push(JSON.parse(JSON.stringify(project.value)) as PresentationProject)
  writeStore(list)
  refreshStoredList()
}

function saveCurrent(silent = false): void {
  project.value.updateTime = new Date().toISOString()
  const list = readStore()
  const index = list.findIndex((item) => item.id === project.value.id)
  if (index >= 0) list[index] = JSON.parse(JSON.stringify(project.value)) as PresentationProject
  else list.push(JSON.parse(JSON.stringify(project.value)) as PresentationProject)
  writeStore(list)
  localStorage.removeItem(DRAFT_STORAGE_KEY)
  refreshStoredList()
  dirty.value = false
  if (!silent) notify('演示工程已保存到本地')
}

function scheduleDraft(): void {
  window.clearTimeout(draftTimer)
  draftTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, serializeProject(project.value))
    } catch {
      /* ignore draft quota errors */
    }
  }, 500)
}

function scheduleSync(): void {
  window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => {
    syncPlayer()
  }, 180)
}

function syncRouteLine(): void {
  if (!scene) return
  for (const step of project.value.steps) {
    const action = step.actions.find((item) => item.actionType === 'recordRoute' && (item.routeSamples?.length ?? 0) > 1)
    if (action?.routeSamples?.length) {
      scene.setRoute(action.routeSamples)
      return
    }
  }
  scene.setRoute([])
}

function syncPlayer(): void {
  if (!player || !scene || !viewer) return
  const pose = scene.captureCamera()
  player.setProject(project.value)
  duration.value = player.duration
  timelineSteps.value = player.steps
  progressTime.value = Math.min(progressTime.value, player.duration)
  syncRouteLine()
  if (!player.playing) scene.setCamera(pose)
}

function loadProject(source: PresentationProject, silent = false): void {
  cancelPreview()
  stopRouteRecording(true)
  player?.pause()
  loadingProject.value = true
  project.value = normalizeProject(JSON.parse(JSON.stringify(source)))
  selectedStepIndex.value = 0
  selectedActionIndex.value = project.value.steps[0]?.actions.length ? 0 : -1
  dirty.value = false
  nextTick(() => {
    loadingProject.value = false
    if (player) {
      player.setProject(project.value)
      player.stop()
      duration.value = player.duration
      timelineSteps.value = player.steps
      progressTime.value = 0
      liveSubtitle.value = null
      playing.value = false
      syncRouteLine()
      if (viewer && !viewer.isDestroyed()) scene?.setCamera(project.value.initialCamera)
    }
    if (!silent) notify(`已载入「${project.value.name}」`)
  })
}

function openDialog(mode: Exclude<DialogMode, null>): void {
  dialogMode.value = mode
  if (mode === 'new') {
    dialogName.value = '新建三维演示'
    dialogDesc.value = ''
  } else if (mode === 'saveAs') {
    dialogName.value = `${project.value.name} 副本`
    dialogDesc.value = project.value.description
  } else if (mode === 'rename') {
    dialogName.value = project.value.name
    dialogDesc.value = project.value.description
  }
}

function closeDialog(): void {
  dialogMode.value = null
}

function confirmDialog(): void {
  const mode = dialogMode.value
  if (!mode) return
  if (mode === 'deleteProject') {
    const list = readStore().filter((item) => item.id !== project.value.id)
    writeStore(list)
    localStorage.removeItem(DRAFT_STORAGE_KEY)
    refreshStoredList()
    if (storedProjects.value.length > 0) loadProject(storedProjects.value[0])
    else {
      loadProject(createSampleProject())
      ensureCurrentStored()
    }
    notify('演示工程已删除')
    closeDialog()
    return
  }
  const name = dialogName.value.trim()
  if (!name) {
    notify('请输入演示名称', 'warn')
    return
  }
  if (mode === 'new') {
    const created = createProject(name)
    created.description = dialogDesc.value.trim() || created.description
    project.value = created
    selectedStepIndex.value = 0
    selectedActionIndex.value = -1
    saveCurrent(true)
    nextTick(() => {
      player?.setProject(project.value)
      player?.stop()
      duration.value = player?.duration ?? 0
      timelineSteps.value = player?.steps ?? []
      progressTime.value = 0
      liveSubtitle.value = null
      playing.value = false
      syncRouteLine()
      scene?.setCamera(project.value.initialCamera)
      dirty.value = false
    })
    notify('已创建空白演示工程')
  } else if (mode === 'saveAs') {
    const copy = cloneProject(project.value, name)
    copy.description = dialogDesc.value.trim() || copy.description
    project.value = copy
    selectedStepIndex.value = 0
    selectedActionIndex.value = -1
    saveCurrent(true)
    nextTick(() => {
      player?.setProject(project.value)
      player?.stop()
      duration.value = player?.duration ?? 0
      timelineSteps.value = player?.steps ?? []
      progressTime.value = 0
      liveSubtitle.value = null
      playing.value = false
      syncRouteLine()
      scene?.setCamera(project.value.initialCamera)
      dirty.value = false
    })
    notify('已另存为新工程')
  } else if (mode === 'rename') {
    project.value.name = name
    project.value.description = dialogDesc.value
    saveCurrent(true)
    void nextTick(() => {
      dirty.value = false
    })
    notify('演示名称已更新')
  }
  closeDialog()
}

function requestDeleteProject(): void {
  openDialog('deleteProject')
}

function loadStored(item: PresentationProject): void {
  if (item.id === project.value.id) return
  loadProject(item)
}

function exportProjectFile(): void {
  const content = serializeProject(project.value)
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${sanitizeName(project.value.name)}${PROJECT_FILE_SUFFIX}`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  notify('工程文件已导出')
}

function openImport(): void {
  importInput.value?.click()
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const text = await file.text()
    const imported = parseProjectFile(text)
    if (readStore().some((item) => item.id === imported.id)) imported.id = createId('presentation')
    const list = readStore()
    list.push(imported)
    writeStore(list)
    refreshStoredList()
    loadProject(imported)
    notify(`已导入「${imported.name}」`)
  } catch (error) {
    notify(error instanceof Error ? error.message : '工程文件导入失败', 'error')
  }
}

function setStepNumber(field: 'duration' | 'speedRate' | 'stayTime' | 'transition', event: Event): void {
  const step = currentStep.value
  if (!step) return
  const value = Number((event.target as HTMLInputElement).value)
  const limits: Record<typeof field, [number, number]> = {
    duration: [0.5, 3600],
    speedRate: [0.1, 8],
    stayTime: [0, 600],
    transition: [0, 10]
  }
  step[field] = clamp(value, limits[field][0], limits[field][1])
}

function stepActualSeconds(step: PresentationStep): number {
  return stepEffectiveSeconds(step)
}

function selectStep(index: number): void {
  if (isBusy.value) return
  stopRouteRecording(true)
  cancelPreview()
  selectedStepIndex.value = index
  selectedActionIndex.value = -1
  player?.pause()
  player?.seekStep(index)
}

function addStep(): void {
  if (isBusy.value) return
  const step = createStep(project.value.steps.length + 1)
  project.value.steps.push(step)
  selectedStepIndex.value = project.value.steps.length - 1
  selectedActionIndex.value = -1
  scheduleSync()
}

function duplicateStep(index: number): void {
  if (isBusy.value) return
  const source = project.value.steps[index]
  if (!source) return
  const copy = JSON.parse(JSON.stringify(source)) as typeof source
  copy.stepId = createId('step')
  copy.stepName = `${source.stepName} 副本`
  copy.actions = copy.actions.map((action) => ({ ...action, actionId: createId('act') }))
  project.value.steps.splice(index + 1, 0, copy)
  selectedStepIndex.value = index + 1
  selectedActionIndex.value = -1
  scheduleSync()
}

function moveStep(index: number, delta: number): void {
  if (isBusy.value) return
  const target = index + delta
  if (target < 0 || target >= project.value.steps.length) return
  const list = project.value.steps
  ;[list[index], list[target]] = [list[target], list[index]]
  selectedStepIndex.value = target
  scheduleSync()
}

function deleteStep(index: number): void {
  if (isBusy.value) return
  if (project.value.steps.length <= 1) {
    notify('演示至少需要保留一个步骤', 'warn')
    return
  }
  project.value.steps.splice(index, 1)
  selectedStepIndex.value = clamp(selectedStepIndex.value, 0, project.value.steps.length - 1)
  selectedActionIndex.value = -1
  scheduleSync()
}

function addAction(type: ActionType): void {
  if (isBusy.value) return
  const step = currentStep.value
  if (!step) return
  const pose = scene?.captureCamera()
  const action = createAction(type, pose)
  if (type === 'recordRoute') {
    action.routeSamples = []
    action.duration = 6
  }
  step.actions.push(action)
  selectedActionIndex.value = step.actions.length - 1
  notify(`已添加「${ACTION_LABELS[type]}」动作`)
  scheduleSync()
}

function selectAction(index: number): void {
  if (isBusy.value) return
  stopRouteRecording(true)
  selectedActionIndex.value = index
}

function duplicateAction(index: number): void {
  if (isBusy.value) return
  const step = currentStep.value
  const source = step?.actions[index]
  if (!step || !source) return
  const copy = JSON.parse(JSON.stringify(source)) as PresentationAction
  copy.actionId = createId('act')
  step.actions.splice(index + 1, 0, copy)
  selectedActionIndex.value = index + 1
  scheduleSync()
}

function deleteAction(index: number): void {
  if (isBusy.value) return
  const step = currentStep.value
  if (!step) return
  stopRouteRecording(true)
  step.actions.splice(index, 1)
  selectedActionIndex.value = clamp(selectedActionIndex.value, -1, step.actions.length - 1)
  scheduleSync()
}

function moveAction(index: number, delta: number): void {
  if (isBusy.value) return
  const step = currentStep.value
  if (!step) return
  const target = index + delta
  if (target < 0 || target >= step.actions.length) return
  ;[step.actions[index], step.actions[target]] = [step.actions[target], step.actions[index]]
  selectedActionIndex.value = target
  scheduleSync()
}

const dragIndex = ref(-1)

function onDragStart(index: number, event: DragEvent): void {
  dragIndex.value = index
  event.dataTransfer?.setData('text/plain', String(index))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDropAction(index: number): void {
  const step = currentStep.value
  const from = dragIndex.value
  dragIndex.value = -1
  if (!step || from < 0 || from === index) return
  const [item] = step.actions.splice(from, 1)
  step.actions.splice(index, 0, item)
  selectedActionIndex.value = index
  scheduleSync()
}

function toggleActionEnable(index: number): void {
  const action = currentStep.value?.actions[index]
  if (!action) return
  action.enable = !action.enable
  scheduleSync()
}

function setActionDuration(event: Event): void {
  if (!currentAction.value) return
  currentAction.value.duration = clamp(Number((event.target as HTMLInputElement).value), 0.1, 3600)
  scheduleSync()
}

function setPoseField(field: keyof CameraPose, event: Event): void {
  if (!currentAction.value) return
  if (!currentAction.value.cameraParam) currentAction.value.cameraParam = defaultCameraPose()
  const limits: Record<string, [number, number]> = {
    longitude: [-180, 180],
    latitude: [-85, 85],
    height: [1, 30_000_000],
    heading: [-360, 360],
    pitch: [-89, 89],
    roll: [-180, 180],
    fov: [20, 110]
  }
  const raw = Number((event.target as HTMLInputElement).value)
  const [min, max] = limits[field] ?? [-1e9, 1e9]
  currentAction.value.cameraParam[field] = clamp(raw, min, max)
}

function captureView(): void {
  if (!currentAction.value || !scene) return
  currentAction.value.cameraParam = scene.captureCamera()
  notify('已保存当前相机姿态')
}

function applyPoi(event: Event): void {
  if (!currentAction.value || !scene) return
  const poiId = (event.target as HTMLSelectElement).value
  const poi = poiOptions.value.find((item) => item.id === poiId)
  if (!poi) return
  currentAction.value.cameraParam = {
    longitude: poi.longitude,
    latitude: poi.latitude,
    height: Math.max(420, poi.height + 380),
    heading: 0,
    pitch: -52,
    roll: 0,
    fov: 58
  }
  notify(`已定位到「${poi.name}」`)
}

function setLayerToggleField(field: 'layerId' | 'visible', event: Event): void {
  if (!currentAction.value?.layerToggle) return
  if (field === 'visible') currentAction.value.layerToggle.visible = (event.target as HTMLInputElement).checked
  else currentAction.value.layerToggle.layerId = (event.target as HTMLSelectElement).value
}

function setTimeField(field: 'from' | 'to', event: Event): void {
  if (!currentAction.value?.timeAnimation) return
  currentAction.value.timeAnimation[field] = clamp(Number((event.target as HTMLInputElement).value), 0, 1)
}

function setSubtitleField<K extends keyof SubtitleParam>(field: K, value: SubtitleParam[K]): void {
  if (!currentAction.value?.subtitle) return
  currentAction.value.subtitle[field] = value
}

function onSubtitleText(event: Event): void {
  setSubtitleField('text', (event.target as HTMLTextAreaElement).value)
}

function onSubtitleSubtext(event: Event): void {
  setSubtitleField('subtext', (event.target as HTMLInputElement).value)
}

function onSubtitlePosition(event: Event): void {
  const position = (event.target as HTMLSelectElement).value as SubtitlePosition
  setSubtitleField('position', position)
  setSubtitleField('mode', position === 'callout' ? 'callout' : 'fullscreen')
}

function onSubtitleFont(event: Event): void {
  setSubtitleField('fontSize', clamp(Number((event.target as HTMLInputElement).value), 12, 96))
}

function onSubtitleColor(event: Event): void {
  setSubtitleField('color', (event.target as HTMLInputElement).value)
}

function onSubtitleBackground(event: Event): void {
  setSubtitleField('background', (event.target as HTMLInputElement).checked)
}

function onSubtitleAnchor(event: Event): void {
  setSubtitleField('anchorId', (event.target as HTMLSelectElement).value)
}

function setEffectField(field: 'effect' | 'enabled', event: Event): void {
  if (!currentAction.value?.sceneEffect) return
  if (field === 'enabled') currentAction.value.sceneEffect.enabled = (event.target as HTMLInputElement).checked
  else currentAction.value.sceneEffect.effect = (event.target as HTMLSelectElement).value as SceneEffectType
}

function setEffectValue(event: Event): void {
  if (!currentAction.value?.sceneEffect) return
  currentAction.value.sceneEffect.value = clamp(Number((event.target as HTMLInputElement).value), 0, 0.02)
}

function toggleLayerState(layerId: string): void {
  project.value.layerStates[layerId] = !project.value.layerStates[layerId]
  scene?.setLayerVisibility(project.value.layerStates)
}

function toggleSceneDefault(field: 'shadows' | 'lighting' | 'fog' | 'atmosphere'): void {
  project.value.sceneState[field] = !project.value.sceneState[field]
  scene?.applySceneEffects(project.value.sceneState)
}

function setDefaultFogDensity(event: Event): void {
  project.value.sceneState.fogDensity = clamp(Number((event.target as HTMLInputElement).value), 0, 0.02)
  scene?.applySceneEffects(project.value.sceneState)
}

function captureInitialCamera(): void {
  if (!scene) return
  project.value.initialCamera = scene.captureCamera()
  notify('已更新演示初始视角')
}

function resetView(): void {
  cancelPreview()
  player?.pause()
  scene?.setCamera(project.value.initialCamera)
  notify('已回到初始视角')
}

function cancelPreview(): void {
  previewToken += 1
  if (previewRaf) cancelAnimationFrame(previewRaf)
  previewRaf = 0
  routePreviewing.value = false
  previewingActionId.value = ''
  window.clearTimeout(previewSubTimer)
  previewSubtitle.value = null
}

function beginPreview(action: PresentationAction): void {
  cancelPreview()
  player?.pause()
  previewingActionId.value = action.actionId
}

function previewAction(): void {
  const action = currentAction.value
  if (!action || !scene || !player) return
  beginPreview(action)
  if (action.actionType === 'flyTo') {
    scene.setCamera(action.cameraParam ?? defaultCameraPose())
    notify('已定位到该飞行视角')
  } else if (action.actionType === 'recordRoute') {
    const samples = action.routeSamples ?? []
    if (samples.length < 2) {
      notify('航线样本不足，请先录制航线', 'warn')
      return
    }
    routePreviewing.value = true
    const total = Math.max(2.5, Math.min(9, samples.length * 0.16))
    const started = performance.now()
    const tick = (): void => {
      const progress = Math.min(1, (performance.now() - started) / 1000 / total)
      scene?.setCamera(routePoseAt(samples, progress))
      if (progress < 1 && routePreviewing.value) previewRaf = requestAnimationFrame(tick)
      else {
        routePreviewing.value = false
        previewingActionId.value = ''
      }
    }
    tick()
  } else if (action.actionType === 'layerToggle') {
    const states = { ...project.value.layerStates }
    if (action.layerToggle) states[action.layerToggle.layerId] = action.layerToggle.visible
    scene.setLayerVisibility(states)
    scene.applySceneEffects(project.value.sceneState)
    notify('图层状态已临时应用')
  } else if (action.actionType === 'timeAnimation') {
    const from = action.timeAnimation?.from ?? 0
    const to = action.timeAnimation?.to ?? 1
    const started = performance.now()
    const tick = (): void => {
      const progress = Math.min(1, (performance.now() - started) / 1000 / 1.2)
      scene?.setBuildProgress(from + (to - from) * progress)
      if (progress < 1 && previewingActionId.value === action.actionId) previewRaf = requestAnimationFrame(tick)
      else previewingActionId.value = ''
    }
    tick()
    notify('时序动画预览中')
  } else if (action.actionType === 'subtitle') {
    const subtitle = action.subtitle ?? defaultSubtitle()
    previewSubtitle.value = { param: subtitle, stepName: currentStepName.value, actionId: action.actionId }
    previewSubTimer = window.setTimeout(() => {
      previewSubtitle.value = null
    }, 3200)
  } else if (action.actionType === 'sceneEffect') {
    const next: SceneEffectState = { ...project.value.sceneState }
    const param = action.sceneEffect
    if (param) {
      if (param.effect === 'fog') {
        next.fog = param.enabled
        next.fogDensity = param.value
      } else {
        next[param.effect] = param.enabled
      }
    }
    scene.applySceneEffects(next)
    notify('场景效果已临时应用')
  }
}

function applyActionDurationFromSamples(): void {
  const action = currentAction.value
  if (!action) return
  action.duration = clamp(Math.max(2, (action.routeSamples?.length ?? 0) * 0.1), 2, 120)
  scheduleSync()
}

function startRouteRecording(): void {
  const action = currentAction.value
  if (!action || action.actionType !== 'recordRoute' || !scene) return
  cancelPreview()
  player?.pause()
  stopRouteRecording(true)
  action.routeSamples = []
  scene.setRoute([])
  routeBuffer = []
  recordedCount.value = 0
  routeStart = performance.now()
  recording.value = true
  const capture = (): void => {
    if (!scene) return
    const pose = scene.captureCamera()
    const elapsed = (performance.now() - routeStart) / 1000
    routeBuffer.push({ ...pose, t: elapsed })
    recordedCount.value = routeBuffer.length
    if (routeBuffer.length >= 1200) stopRouteRecording()
  }
  capture()
  routeTimer = window.setInterval(capture, 100)
  notify('开始录制航线，请拖动三维场景漫游')
}

function stopRouteRecording(silent = false): void {
  if (!recording.value) return
  window.clearInterval(routeTimer)
  routeTimer = 0
  recording.value = false
  const action = currentAction.value
  if (!action) return
  const count = routeBuffer.length
  const samples = routeBuffer.map((sample, index) => ({
    ...sample,
    t: count > 1 ? index / (count - 1) : 0
  }))
  action.routeSamples = samples
  action.duration = clamp(Math.max(2, count * 0.08), 2, 120)
  scene?.setRoute(samples)
  scheduleSync()
  if (!silent) notify(`航线录制完成，共 ${count} 个采样点`)
}

function deleteRouteSamples(): void {
  if (!currentAction.value) return
  stopRouteRecording(true)
  currentAction.value.routeSamples = []
  scene?.setRoute([])
  notify('航线已清空')
}

function beginScrub(): void {
  if (player?.playing) player.pause()
}

function onSeekInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  player?.seek(value)
  progressTime.value = value
}

function togglePlay(): void {
  if (!player) return
  cancelPreview()
  stopRouteRecording(true)
  if (player.playing) player.pause()
  else player.play()
}

function stopPlayback(): void {
  cancelPreview()
  player?.stop()
  scene?.setCamera(project.value.initialCamera)
  liveSubtitle.value = null
  playing.value = false
  progressTime.value = 0
}

function playCurrentStep(): void {
  const step = currentStep.value
  if (!step || !step.actions.some((action) => action.enable)) {
    notify('当前步骤没有可播放的动作', 'warn')
    return
  }
  cancelPreview()
  stopRouteRecording(true)
  player?.playStep(selectedStepIndex.value)
}

function setPlaybackSpeed(value: number): void {
  speed.value = value
  player?.setSpeed(value)
}

function onPlayerState(state: PlayerState, time: number, total: number, isPlaying: boolean): void {
  progressTime.value = time
  duration.value = total
  playing.value = isPlaying
  playheadStep.value = state.stepIndex
  liveSubtitle.value = state.subtitle
}

function openExport(): void {
  cancelPreview()
  stopRouteRecording(true)
  player?.pause()
  exportOpen.value = true
  exportError.value = ''
  exportProgress.value = 0
  exportResolution.value = '1080p'
  exportFps.value = 30
}

function closeExport(): void {
  if (exporting.value) return
  exportOpen.value = false
}

function revokeExportResult(): void {
  if (exportResult.value) URL.revokeObjectURL(exportResult.value.url)
  exportResult.value = null
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 6000)
}

function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

async function startExport(): Promise<void> {
  if (!viewer || !player) return
  exportError.value = ''
  revokeExportResult()
  exporting.value = true
  exportProgress.value = 0
  const controller = new AbortController()
  exportController.value = controller
  const option = RESOLUTION_OPTIONS.find((item) => item.id === exportResolution.value) ?? RESOLUTION_OPTIONS[0]
  try {
    const result = await exportPresentationVideo({
      viewer,
      player,
      width: option.width,
      height: option.height,
      fps: exportFps.value,
      signal: controller.signal,
      onProgress: (fraction) => {
        exportProgress.value = Math.round(fraction * 100)
      }
    })
    const fileName = `${sanitizeName(project.value.name)}-${option.label}.${result.extension}`
    exportResult.value = {
      ...result,
      url: URL.createObjectURL(result.blob),
      fileName,
      size: formatSize(result.blob.size)
    }
    triggerDownload(result.blob, fileName)
    notify('视频导出完成，已开始下载')
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      exportError.value = error instanceof Error ? error.message : '视频导出失败'
    }
  } finally {
    exporting.value = false
    exportController.value = null
    progressTime.value = 0
  }
}

function cancelExport(): void {
  exportController.value?.abort()
}

function downloadExportAgain(): void {
  if (!exportResult.value) return
  const link = document.createElement('a')
  link.href = exportResult.value.url
  link.download = exportResult.value.fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function onKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
  if (event.code === 'Space') {
    event.preventDefault()
    togglePlay()
  } else if (event.code === 'Escape') {
    cancelPreview()
    if (dialogMode.value) closeDialog()
  }
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

watch(
  project,
  () => {
    if (loadingProject.value) return
    dirty.value = true
    scheduleDraft()
    scheduleSync()
  },
  { deep: true }
)

onMounted(() => {
  refreshStoredList()
  let initial = storedProjects.value[0] ?? createSampleProject()
  const draft = localStorage.getItem(DRAFT_STORAGE_KEY)
  if (draft) {
    try {
      initial = normalizeProject(JSON.parse(draft) as unknown)
    } catch {
      /* ignore corrupt draft */
    }
  }
  loadingProject.value = true
  project.value = initial
  selectedStepIndex.value = 0
  selectedActionIndex.value = initial.steps[0]?.actions.length ? 0 : -1
  dirty.value = false
  ensureCurrentStored()
  void nextTick(() => {
    loadingProject.value = false
  })

  const el = container.value
  if (!el) return
  Camera.DEFAULT_VIEW_RECTANGLE = DEFAULT_VIEW_RECTANGLE
  Ion.defaultAccessToken = CESIUM_ION_ACCESS_TOKEN
  try {
    const v = new Viewer(el, {
      animation: false,
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      skyBox: false,
      shadows: false,
      scene3DOnly: true,
      contextOptions: { webgl: { preserveDrawingBuffer: true, alpha: false } }
    })
    v.scene.globe.baseColor = Color.fromCssColorString('#0b1c33')
    viewer = v
    scene = new PresentationScene(v)
    if (import.meta.env.DEV) (window as Window & { __peDebug?: unknown }).__peDebug = { viewer: v, scene }
    poiOptions.value = scene.getPoiList()
    scene.setCamera(project.value.initialCamera)
    scene.setLayerVisibility(project.value.layerStates)
    scene.applySceneEffects(project.value.sceneState)
    syncRouteLine()

    const callbacks: SceneCallbacks = {
      onStatus: (message) => {
        statusMessage.value = message
      },
      onBasemapReady: () => {
        statusMessage.value = ''
      }
    }
    loadBingImagery(v, callbacks)

    player = new PresentationPlayer(v, scene, project.value)
    player.setListener(onPlayerState)
    player.setEndListener(() => {
      liveSubtitle.value = null
      progressTime.value = 0
      notify('演示播放完成，已回到初始场景状态')
    })
    player.setSpeed(speed.value)
    duration.value = player.duration
    timelineSteps.value = player.steps
    player.seek(0)
    scene.setCamera(project.value.initialCamera)
    scene.setBuildProgress(0)
    playerReady.value = true
    ready.value = true

    calloutRemove = v.scene.postRender.addEventListener(() => {
      const subtitle = activeSubtitle.value
      if (!subtitle || !scene) return
      if (subtitle.param.position !== 'callout' && subtitle.param.mode !== 'callout') return
      const point = scene.projectPoi(subtitle.param.anchorId)
      if (!point) return
      const rect = v.scene.canvas.getBoundingClientRect()
      calloutPoint.value = { x: point.x - rect.left, y: point.y - rect.top }
    })
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : '三维场景初始化失败'
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('beforeunload', onBeforeUnload)
})

onBeforeUnmount(() => {
  window.clearTimeout(syncTimer)
  window.clearTimeout(draftTimer)
  window.clearTimeout(toastTimer)
  window.clearTimeout(previewSubTimer)
  window.clearInterval(routeTimer)
  cancelPreview()
  calloutRemove?.()
  player?.dispose()
  revokeExportResult()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('beforeunload', onBeforeUnload)
  destroyScene(viewer)
  viewer = undefined
  scene = undefined
  player = undefined
})
</script>

<template>
  <div class="pe-root">
    <header class="pe-topbar">
      <div class="pe-brand">
        <div class="pe-logo"><span>P</span></div>
        <div>
          <p class="pe-brand-title">PRESENTATION STUDIO</p>
          <p class="pe-brand-sub">Cesium 三维场景演示漫游制作系统</p>
        </div>
      </div>

      <div class="pe-project-head">
        <input v-model="project.name" class="pe-project-name" maxlength="60" aria-label="演示名称" />
        <span class="pe-state" :class="{ dirty }">{{ dirty ? '未保存' : '已保存' }}</span>
        <span class="pe-project-meta">{{ project.steps.length }} 步骤 · {{ totalActions }} 动作 · {{ durationText }}</span>
      </div>

      <div class="pe-top-actions">
        <button class="pe-btn" @click="openDialog('new')">新建</button>
        <button class="pe-btn primary" @click="saveCurrent()">保存</button>
        <button class="pe-btn" @click="openDialog('saveAs')">另存</button>
        <button class="pe-btn" @click="openDialog('rename')">重命名</button>
        <button class="pe-btn danger" @click="requestDeleteProject">删除</button>
        <button class="pe-btn" @click="openImport">导入</button>
        <button class="pe-btn" @click="exportProjectFile">导出工程</button>
        <input ref="importInput" class="pe-hidden" type="file" accept=".presentation,.cesium.presentation,application/json" @change="onImportFile" />
      </div>
    </header>

    <div class="pe-body">
      <aside class="pe-left">
        <div class="pe-panel-head">
          <span>演示工程</span>
          <em>{{ storedProjects.length }}</em>
        </div>
        <div class="pe-project-list">
          <button
            v-for="item in storedProjects"
            :key="item.id"
            class="pe-project-item"
            :class="{ active: item.id === project.id }"
            @click="loadStored(item)"
          >
            <span class="pe-project-dot" :class="{ active: item.id === project.id }"></span>
            <span class="pe-project-copy">
              <b>{{ item.name }}</b>
              <small>{{ item.steps.length }} 步骤 · {{ formatDateTime(item.updateTime) }}</small>
            </span>
          </button>
          <p v-if="storedProjects.length === 0" class="pe-empty">暂无已保存工程，点击「保存」建立工程库</p>
        </div>

        <div class="pe-panel-head steps">
          <span>步骤编排</span>
          <em>{{ project.steps.length }}</em>
        </div>
        <div class="pe-step-list">
          <div
            v-for="(step, index) in project.steps"
            :key="step.stepId"
            class="pe-step"
            :class="{ active: index === selectedStepIndex, playing: index === playheadStep && playing }"
          >
            <div class="pe-step-row" @click="selectStep(index)">
              <span class="pe-step-index">{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="pe-step-main">
                <b>{{ step.stepName }}</b>
                <small>{{ step.actions.length }} 动作 · 实际 {{ Math.round(stepActualSeconds(step)) }}s · {{ step.speedRate }}x</small>
              </span>
              <span class="pe-step-state" v-if="index === playheadStep && playing">RUN</span>
            </div>
            <div v-if="index === selectedStepIndex" class="pe-step-tools">
              <button @click.stop="moveStep(index, -1)" :disabled="index === 0">上移</button>
              <button @click.stop="moveStep(index, 1)" :disabled="index === project.steps.length - 1">下移</button>
              <button @click.stop="duplicateStep(index)">复制</button>
              <button class="danger" @click.stop="deleteStep(index)">删除</button>
            </div>

            <div v-if="index === selectedStepIndex" class="pe-action-list">
              <div
                v-for="(action, actionIndex) in step.actions"
                :key="action.actionId"
                class="pe-action-row"
                :class="{ active: actionIndex === selectedActionIndex, disabled: !action.enable }"
                draggable="true"
                @click="selectAction(actionIndex)"
                @dragstart="onDragStart(actionIndex, $event)"
                @dragover.prevent
                @drop.prevent="onDropAction(actionIndex)"
              >
                <span class="pe-drag">⋮⋮</span>
                <span class="pe-action-icon">{{ ACTION_ICONS[action.actionType] }}</span>
                <span class="pe-action-main">
                  <b>{{ ACTION_LABELS[action.actionType] }}</b>
                  <small>{{ actionSummary(action) }}</small>
                </span>
                <span class="pe-action-duration">{{ action.duration.toFixed(1) }}s</span>
                <span class="pe-action-ops">
                  <button :title="action.enable ? '禁用动作' : '启用动作'" @click.stop="toggleActionEnable(actionIndex)">{{ action.enable ? '◉' : '○' }}</button>
                  <button title="上移" @click.stop="moveAction(actionIndex, -1)">↑</button>
                  <button title="下移" @click.stop="moveAction(actionIndex, 1)">↓</button>
                  <button title="复制" @click.stop="duplicateAction(actionIndex)">⧉</button>
                  <button title="删除" class="danger" @click.stop="deleteAction(actionIndex)">✕</button>
                </span>
              </div>
              <p v-if="step.actions.length === 0" class="pe-empty actions">该步骤还没有动作，从右侧动作库添加</p>
            </div>
          </div>
        </div>
        <button class="pe-add-step" @click="addStep">+ 新增步骤</button>
      </aside>

      <main class="pe-viewport">
        <div ref="container" class="pe-canvas"></div>

        <div class="pe-hud">
          <div class="pe-hud-left">
            <span class="pe-live-dot"></span>
            <span>{{ playing ? 'PLAYING' : recording ? 'RECORDING' : 'EDIT MODE' }}</span>
            <span class="pe-hud-sep"></span>
            <span>STEP {{ Math.max(0, (playing ? playheadStep : selectedStepIndex) + 1) }} / {{ project.steps.length }}</span>
          </div>
          <div v-if="!playing && !exporting" class="pe-layer-chips">
            <button
              v-for="layer in LAYER_DEFINITIONS"
              :key="layer.id"
              class="pe-layer-chip"
              :class="{ off: project.layerStates[layer.id] === false }"
              @click="toggleLayerState(layer.id)"
            >
              <i :style="{ background: layer.color }"></i>{{ layer.name }}
            </button>
          </div>
        </div>

        <div v-if="recording" class="pe-record-badge">
          <span class="pe-rec-dot"></span>
          正在录制航线 · {{ recordedCount }} 点
          <button @click="stopRouteRecording()">停止录制</button>
        </div>

        <div
          v-if="activeSubtitle"
          class="pe-subtitle"
          :class="[
            `pos-${activeSubtitle.param.position}`,
            { boxed: activeSubtitle.param.background, callout: subtitleIsCallout }
          ]"
          :style="
            subtitleIsCallout && calloutPoint
              ? { left: `${calloutPoint.x}px`, top: `${calloutPoint.y}px`, color: activeSubtitle.param.color }
              : { color: activeSubtitle.param.color }
          "
        >
          <p class="pe-subtitle-text" :style="{ fontSize: `${Math.min(activeSubtitle.param.fontSize, 46)}px` }">
            {{ activeSubtitle.param.text }}
          </p>
          <p v-if="activeSubtitle.param.subtext" class="pe-subtitle-sub">{{ activeSubtitle.param.subtext }}</p>
        </div>

        <div class="pe-playbar">
          <button class="pe-play-btn" @click="togglePlay">{{ playing ? '❚❚' : '▶' }}</button>
          <button class="pe-control-btn" title="停止并回到初始状态" @click="stopPlayback">■</button>
          <button class="pe-control-btn" title="单步播放当前步骤" @click="playCurrentStep">⇥</button>
          <span class="pe-time">{{ formatTime(progressTime) }}<i>/</i>{{ durationText }}</span>
          <input
            class="pe-progress"
            type="range"
            min="0"
            :max="duration || 1"
            step="0.01"
            :value="progressTime"
            @pointerdown="beginScrub"
            @input="onSeekInput"
          />
          <div class="pe-speed">
            <button
              v-for="option in SPEED_OPTIONS"
              :key="option"
              :class="{ active: speed === option }"
              @click="setPlaybackSpeed(option)"
            >{{ option }}x</button>
          </div>
          <button class="pe-export-btn" @click="openExport">视频导出</button>
        </div>

        <div v-if="statusMessage" class="pe-status-mask">{{ statusMessage }}</div>
        <div v-else-if="!ready" class="pe-status-mask">正在准备编辑器…</div>
      </main>

      <aside class="pe-right">
        <div v-if="currentAction" class="pe-editor">
          <div class="pe-editor-head">
            <span class="pe-editor-icon">{{ ACTION_ICONS[currentAction.actionType] }}</span>
            <div>
              <b>{{ ACTION_LABELS[currentAction.actionType] }}</b>
              <small>动作参数 · STEP {{ selectedStepIndex + 1 }}</small>
            </div>
            <label class="pe-switch">
              <input type="checkbox" :checked="currentAction.enable" @change="toggleActionEnable(selectedActionIndex)" />
              <span></span>
            </label>
          </div>

          <div class="pe-field-row">
            <label>动作时长（秒）</label>
            <input type="number" min="0.1" max="3600" step="0.1" :value="currentAction.duration" @change="setActionDuration" />
          </div>

          <template v-if="currentAction.actionType === 'flyTo'">
            <p class="pe-section-label">相机姿态</p>
            <div class="pe-grid-2">
              <label class="pe-field"><span>经度</span><input type="number" step="0.0001" :value="flyPose.longitude" @change="setPoseField('longitude', $event)" /></label>
              <label class="pe-field"><span>纬度</span><input type="number" step="0.0001" :value="flyPose.latitude" @change="setPoseField('latitude', $event)" /></label>
              <label class="pe-field"><span>高度 m</span><input type="number" step="10" :value="flyPose.height" @change="setPoseField('height', $event)" /></label>
              <label class="pe-field"><span>视场角</span><input type="number" step="1" :value="flyPose.fov ?? 60" @change="setPoseField('fov', $event)" /></label>
              <label class="pe-field"><span>航向 °</span><input type="number" step="1" :value="flyPose.heading" @change="setPoseField('heading', $event)" /></label>
              <label class="pe-field"><span>俯仰 °</span><input type="number" step="1" :value="flyPose.pitch" @change="setPoseField('pitch', $event)" /></label>
              <label class="pe-field"><span>翻滚 °</span><input type="number" step="1" :value="flyPose.roll" @change="setPoseField('roll', $event)" /></label>
              <label class="pe-field"><span>地标定位</span>
                <select :value="''" @change="applyPoi">
                  <option value="" disabled>选择地标</option>
                  <option v-for="poi in poiOptions" :key="poi.id" :value="poi.id">{{ poi.name }}</option>
                </select>
              </label>
            </div>
            <div class="pe-inline-actions">
              <button class="pe-btn" @click="captureView">捕获当前视角</button>
              <button class="pe-btn ghost" @click="previewAction">预览飞行</button>
            </div>
          </template>

          <template v-else-if="currentAction.actionType === 'recordRoute'">
            <p class="pe-section-label">航线录制</p>
            <div class="pe-route-stats">
              <div><b>{{ routeSamples.length }}</b><span>采样点</span></div>
              <div><b>{{ currentAction.duration.toFixed(1) }}s</b><span>回放时长</span></div>
              <div><b>{{ routeSamples.length ? formatTime(routeSamples.length * 0.1) : '--' }}</b><span>录制时长</span></div>
            </div>
            <p class="pe-hint">点击开始录制后，用鼠标拖动、旋转、缩放三维场景，系统按 10Hz 记录相机轨迹，停止后自动生成平滑航线。</p>
            <button v-if="!recording" class="pe-record-btn" @click="startRouteRecording">● 开始录制航线</button>
            <button v-else class="pe-record-btn stop" @click="stopRouteRecording()">■ 停止录制（{{ recordedCount }} 点）</button>
            <div class="pe-inline-actions">
              <button class="pe-btn ghost" :disabled="routeSamples.length < 2" @click="previewAction">预览航线</button>
              <button class="pe-btn ghost" :disabled="routeSamples.length === 0" @click="deleteRouteSamples">清空航线</button>
            </div>
          </template>

          <template v-else-if="currentAction.actionType === 'layerToggle'">
            <p class="pe-section-label">图层显隐</p>
            <label class="pe-field"><span>目标图层</span>
              <select :value="layerParam.layerId" @change="setLayerToggleField('layerId', $event)">
                <option v-for="layer in LAYER_DEFINITIONS" :key="layer.id" :value="layer.id">{{ layer.name }}</option>
              </select>
            </label>
            <label class="pe-switch-row">
              <span>执行后图层可见</span>
              <span class="pe-switch"><input type="checkbox" :checked="layerParam.visible" @change="setLayerToggleField('visible', $event)" /><span></span></span>
            </label>
            <p class="pe-hint">演示执行到该动作时，会自动切换目标图层、模型或标注的可见状态，并从该时刻起持续生效。</p>
            <button class="pe-btn ghost" @click="previewAction">立即应用预览</button>
          </template>

          <template v-else-if="currentAction.actionType === 'timeAnimation'">
            <p class="pe-section-label">时序驱动</p>
            <label class="pe-field"><span>驱动对象</span>
              <select :value="timeParam.layerId" disabled>
                <option value="buildings">建设进度模型</option>
              </select>
            </label>
            <div class="pe-range-row">
              <span>起始进度 <b>{{ Math.round(timeParam.from * 100) }}%</b></span>
              <input type="range" min="0" max="1" step="0.01" :value="timeParam.from" @input="setTimeField('from', $event)" />
            </div>
            <div class="pe-range-row">
              <span>结束进度 <b>{{ Math.round(timeParam.to * 100) }}%</b></span>
              <input type="range" min="0" max="1" step="0.01" :value="timeParam.to" @input="setTimeField('to', $event)" />
            </div>
            <p class="pe-hint">在动作时长内平滑推进建设进度，可用于工程建设、灾害演进、设备状态等时序成果展示。</p>
            <button class="pe-btn ghost" @click="previewAction">预览时序动画</button>
          </template>

          <template v-else-if="currentAction.actionType === 'subtitle'">
            <p class="pe-section-label">字幕与弹窗</p>
            <label class="pe-field"><span>主字幕</span>
              <textarea rows="3" :value="subtitleParam.text" @input="onSubtitleText" placeholder="输入演示字幕内容"></textarea>
            </label>
            <label class="pe-field"><span>副字幕</span>
              <input type="text" :value="subtitleParam.subtext" @input="onSubtitleSubtext" placeholder="可选说明文字" />
            </label>
            <div class="pe-grid-2">
              <label class="pe-field"><span>展示位置</span>
                <select :value="subtitleParam.position" @change="onSubtitlePosition">
                  <option v-for="position in POSITIONS" :key="position" :value="position">{{ POSITION_LABELS[position] }}</option>
                </select>
              </label>
              <label class="pe-field"><span>字号</span>
                <input type="number" min="12" max="96" step="1" :value="subtitleParam.fontSize" @change="onSubtitleFont" />
              </label>
              <label class="pe-field"><span>文字颜色</span>
                <input class="pe-color" type="color" :value="subtitleParam.color" @input="onSubtitleColor" />
              </label>
              <label class="pe-field"><span>点位锚点</span>
                <select :value="subtitleParam.anchorId" @change="onSubtitleAnchor" :disabled="subtitleParam.position !== 'callout'">
                  <option v-for="poi in poiOptions" :key="poi.id" :value="poi.id">{{ poi.name }}</option>
                </select>
              </label>
            </div>
            <label class="pe-switch-row">
              <span>启用背景板</span>
              <span class="pe-switch"><input type="checkbox" :checked="subtitleParam.background" @change="onSubtitleBackground" /><span></span></span>
            </label>
            <p class="pe-hint">选择「点位弹窗」时，字幕会跟随指定地标在屏幕上的位置浮动，适合分项讲解。</p>
            <button class="pe-btn ghost" @click="previewAction">预览字幕</button>
          </template>

          <template v-else-if="currentAction.actionType === 'sceneEffect'">
            <p class="pe-section-label">场景效果</p>
            <label class="pe-field"><span>效果类型</span>
              <select :value="effectParam.effect" @change="setEffectField('effect', $event)">
                <option v-for="effect in EFFECTS" :key="effect" :value="effect">{{ EFFECT_LABELS[effect] }}</option>
              </select>
            </label>
            <label class="pe-switch-row">
              <span>开启效果</span>
              <span class="pe-switch"><input type="checkbox" :checked="effectParam.enabled" @change="setEffectField('enabled', $event)" /><span></span></span>
            </label>
            <div class="pe-range-row" v-if="effectParam.effect === 'fog'">
              <span>雾效浓度 <b>{{ (effectParam.value * 10000).toFixed(1) }}</b></span>
              <input type="range" min="0" max="0.02" step="0.0001" :value="effectParam.value" @input="setEffectValue" />
            </div>
            <p class="pe-hint">演示过程中自动开启或关闭阴影、光照、雾效与大气层，可组合多个场景效果动作。</p>
            <button class="pe-btn ghost" @click="previewAction">立即应用预览</button>
          </template>

          <div class="pe-editor-footer">
            <button class="pe-btn danger ghost" @click="deleteAction(selectedActionIndex)">删除动作</button>
          </div>
        </div>

        <div v-else class="pe-editor pe-project-panel">
          <div class="pe-editor-head">
            <span class="pe-editor-icon">⚙</span>
            <div>
              <b>工程与场景设置</b>
              <small>{{ project.description || '未填写演示备注' }}</small>
            </div>
          </div>
          <template v-if="currentStep">
            <p class="pe-section-label">当前步骤参数</p>
            <label class="pe-field"><span>步骤名称</span>
              <input type="text" maxlength="40" v-model="currentStep.stepName" />
            </label>
            <div class="pe-grid-2">
              <label class="pe-field"><span>播放时长（秒）</span>
                <input type="number" min="0.5" max="3600" step="0.5" :value="currentStep.duration" @change="setStepNumber('duration', $event)" />
              </label>
              <label class="pe-field"><span>速度倍率</span>
                <input type="number" min="0.1" max="8" step="0.1" :value="currentStep.speedRate" @change="setStepNumber('speedRate', $event)" />
              </label>
              <label class="pe-field"><span>停留时长（秒）</span>
                <input type="number" min="0" max="600" step="0.5" :value="currentStep.stayTime" @change="setStepNumber('stayTime', $event)" />
              </label>
              <label class="pe-field"><span>过渡时长（秒）</span>
                <input type="number" min="0" max="10" step="0.1" :value="currentStep.transition" @change="setStepNumber('transition', $event)" />
              </label>
            </div>
            <p class="pe-hint">实际时长 {{ stepActualSeconds(currentStep).toFixed(1) }} 秒。动作按顺序串行执行，播放时长不足时自动顺延，动作结束后按停留时长收尾。</p>
          </template>

          <p class="pe-section-label">演示备注</p>
          <textarea class="pe-textarea" rows="3" v-model="project.description" placeholder="填写演示目标、适用场景或汇报备注"></textarea>

          <p class="pe-section-label">初始场景</p>
          <div class="pe-inline-actions">
            <button class="pe-btn" @click="captureInitialCamera">捕获当前视角为初始视角</button>
            <button class="pe-btn ghost" @click="resetView">回到初始视角</button>
          </div>

          <p class="pe-section-label">图层初始状态</p>
          <div class="pe-default-layers">
            <button
              v-for="layer in LAYER_DEFINITIONS"
              :key="layer.id"
              class="pe-layer-default"
              :class="{ off: project.layerStates[layer.id] === false }"
              @click="toggleLayerState(layer.id)"
            >
              <i :style="{ background: layer.color }"></i>
              <span>{{ layer.name }}</span>
              <em>{{ project.layerStates[layer.id] === false ? '隐藏' : '显示' }}</em>
            </button>
          </div>

          <p class="pe-section-label">场景默认效果</p>
          <div class="pe-default-effects">
            <label v-for="effect in EFFECTS" :key="effect" class="pe-switch-row compact">
              <span>{{ EFFECT_LABELS[effect] }}</span>
              <span class="pe-switch"><input type="checkbox" :checked="project.sceneState[effect]" @change="toggleSceneDefault(effect)" /><span></span></span>
            </label>
          </div>
          <div class="pe-range-row" v-if="project.sceneState.fog">
            <span>默认雾效浓度 <b>{{ (project.sceneState.fogDensity * 10000).toFixed(1) }}</b></span>
            <input type="range" min="0" max="0.02" step="0.0001" :value="project.sceneState.fogDensity" @input="setDefaultFogDensity" />
          </div>

          <div class="pe-stats">
            <div><b>{{ project.steps.length }}</b><span>步骤</span></div>
            <div><b>{{ totalActions }}</b><span>动作</span></div>
            <div><b>{{ durationText }}</b><span>演示时长</span></div>
          </div>
          <p class="pe-hint">选中左侧步骤的某个动作后，右侧会切换为该动作的参数编辑面板。支持拖动动作行调整串行顺序。</p>
        </div>

        <div class="pe-action-library">
          <p class="pe-section-label">添加动作 · {{ currentStepName }}</p>
          <div class="pe-action-buttons">
            <button v-for="type in ACTIONS" :key="type" class="pe-action-btn" @click="addAction(type)">
              <span>{{ ACTION_ICONS[type] }}</span>
              <em>{{ ACTION_LABELS[type] }}</em>
            </button>
          </div>
        </div>
      </aside>
    </div>

    <div v-if="dialogMode" class="pe-modal-mask" @click.self="closeDialog">
      <div class="pe-modal">
        <div class="pe-modal-head">
          <b>{{
            dialogMode === 'new' ? '新建演示工程'
              : dialogMode === 'saveAs' ? '另存为新工程'
              : dialogMode === 'rename' ? '重命名演示工程'
              : '删除演示工程'
          }}</b>
          <button @click="closeDialog">✕</button>
        </div>
        <template v-if="dialogMode === 'deleteProject'">
          <p class="pe-confirm-text">确认删除「{{ project.name }}」？该操作会从本地工程库移除该演示，且无法撤销。</p>
        </template>
        <template v-else>
          <label class="pe-field"><span>演示名称</span>
            <input type="text" v-model="dialogName" maxlength="60" @keydown.enter="confirmDialog" />
          </label>
          <label class="pe-field"><span>备注信息</span>
            <textarea rows="3" v-model="dialogDesc" placeholder="可选：填写演示目标或适用场景"></textarea>
          </label>
        </template>
        <div class="pe-modal-actions">
          <button class="pe-btn ghost" @click="closeDialog">取消</button>
          <button class="pe-btn" :class="{ danger: dialogMode === 'deleteProject' }" @click="confirmDialog">
            {{ dialogMode === 'deleteProject' ? '确认删除' : '确定' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="exportOpen" class="pe-modal-mask" @click.self="closeExport">
      <div class="pe-modal pe-export-modal">
        <div class="pe-modal-head">
          <b>视频导出 · Make Movie</b>
          <button v-if="!exporting" @click="closeExport">✕</button>
        </div>

        <div v-if="!exportResult" class="pe-export-body">
          <p class="pe-section-label">导出分辨率</p>
          <div class="pe-option-row">
            <button
              v-for="option in RESOLUTION_OPTIONS"
              :key="option.id"
              :class="{ active: exportResolution === option.id }"
              :disabled="exporting"
              @click="exportResolution = option.id"
            >
              <b>{{ option.label }}</b>
              <small>{{ option.width }} × {{ option.height }}</small>
            </button>
          </div>
          <p class="pe-section-label">帧率</p>
          <div class="pe-option-row compact">
            <button
              v-for="option in FPS_OPTIONS"
              :key="option"
              :class="{ active: exportFps === option }"
              :disabled="exporting"
              @click="exportFps = option"
            >{{ option }} FPS</button>
          </div>
          <div class="pe-export-summary">
            <span>预计时长</span><b>{{ durationText }}</b>
            <span>输出编码</span><b>MP4 / WebM 自适应</b>
          </div>
          <p class="pe-hint">导出时会从演示起点开始实时渲染，字幕、图层状态、时序动画和场景效果都会写入视频。请保持页面在前台，导出过程中可随时取消。</p>
          <div v-if="exporting" class="pe-export-progress">
            <div class="pe-progress-track"><span :style="{ width: `${exportProgress}%` }"></span></div>
            <p>正在渲染并录制 {{ exportProgress }}%</p>
          </div>
          <p v-if="exportError" class="pe-error">{{ exportError }}</p>
          <div class="pe-modal-actions">
            <button v-if="exporting" class="pe-btn danger" @click="cancelExport">取消导出</button>
            <button v-else class="pe-btn primary" @click="startExport">开始导出</button>
          </div>
        </div>

        <div v-else class="pe-export-body">
          <div class="pe-export-success">
            <span>✓</span>
            <div>
              <b>{{ exportResult.fileName }}</b>
              <small>{{ exportResult.size }} · {{ exportResolution.toUpperCase() }} · {{ exportFps }} FPS</small>
            </div>
          </div>
          <p class="pe-hint">视频已开始下载。若浏览器拦截了自动下载，可点击下方按钮重新保存。</p>
          <div class="pe-modal-actions">
            <button class="pe-btn" @click="downloadExportAgain">重新下载</button>
            <button class="pe-btn ghost" @click="revokeExportResult">继续编辑</button>
          </div>
        </div>
      </div>
    </div>

    <transition name="pe-toast">
      <div v-if="toast" class="pe-toast" :class="toastTone">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.pe-root {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 520px;
  overflow: hidden;
  color: #dbe9f8;
  background: #07111f;
  font-family: "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
}
.pe-root * { box-sizing: border-box; }
.pe-root button, .pe-root input, .pe-root select, .pe-root textarea { font-family: inherit; }
.pe-root button { cursor: pointer; }
.pe-hidden { display: none; }

.pe-topbar {
  flex: 0 0 62px;
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 0 18px;
  border-bottom: 1px solid rgba(87, 143, 204, 0.22);
  background: linear-gradient(180deg, #0b1a2d, #081524);
}
.pe-brand { display: flex; align-items: center; gap: 11px; flex: 0 0 auto; }
.pe-logo { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid rgba(94, 234, 212, 0.45); border-radius: 9px; background: linear-gradient(145deg, rgba(56, 189, 248, 0.22), rgba(94, 234, 212, 0.08)); color: #5eead4; font: 700 18px "DM Mono", monospace; box-shadow: 0 0 22px rgba(56, 189, 248, 0.18); }
.pe-brand-title { margin: 0; color: #e8f4ff; font: 700 12px "DM Mono", monospace; letter-spacing: 0.14em; white-space: nowrap; }
.pe-brand-sub { margin: 3px 0 0; color: #6f8ba8; font-size: 10px; white-space: nowrap; }
.pe-project-head { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; }
.pe-project-name { width: min(300px, 34vw); height: 32px; padding: 0 10px; border: 1px solid transparent; border-radius: 7px; color: #eaf5ff; background: transparent; font-size: 16px; font-weight: 700; }
.pe-project-name:hover { border-color: rgba(110, 168, 230, 0.28); }
.pe-project-name:focus { outline: none; border-color: rgba(56, 189, 248, 0.55); background: rgba(9, 23, 40, 0.8); }
.pe-state { flex: 0 0 auto; padding: 3px 8px; border: 1px solid rgba(74, 222, 128, 0.3); border-radius: 20px; color: #7ee2a8; background: rgba(34, 197, 94, 0.1); font-size: 10px; }
.pe-state.dirty { border-color: rgba(251, 191, 36, 0.36); color: #fcd34d; background: rgba(251, 191, 36, 0.09); }
.pe-project-meta { flex: 1; min-width: 0; overflow: hidden; color: #6b86a4; font: 10px "DM Mono", monospace; white-space: nowrap; text-overflow: ellipsis; }
.pe-top-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; }

.pe-btn { height: 28px; padding: 0 10px; border: 1px solid rgba(112, 163, 219, 0.3); border-radius: 6px; color: #cfe2f6; background: rgba(112, 163, 219, 0.1); font-size: 11px; transition: 0.18s; white-space: nowrap; }
.pe-btn:hover { border-color: rgba(94, 204, 255, 0.6); background: rgba(56, 189, 248, 0.18); color: #f1f9ff; }
.pe-btn.primary { border-color: transparent; background: linear-gradient(100deg, #2f80ed, #2ea8d8); color: #f4fbff; font-weight: 700; }
.pe-btn.danger { border-color: rgba(248, 113, 113, 0.4); color: #fda4a4; background: rgba(239, 68, 68, 0.08); }
.pe-btn.danger:hover { background: rgba(239, 68, 68, 0.18); }
.pe-btn.ghost { background: transparent; }
.pe-btn:disabled { cursor: not-allowed; opacity: 0.4; }

.pe-body { flex: 1; min-height: 0; display: flex; }
.pe-left { flex: 0 0 272px; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid rgba(87, 143, 204, 0.18); background: #081727; }
.pe-right { flex: 0 0 338px; min-height: 0; display: flex; flex-direction: column; border-left: 1px solid rgba(87, 143, 204, 0.18); background: #081727; }
.pe-panel-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; padding: 14px 14px 9px; color: #7f9cba; font: 700 10px "DM Mono", monospace; letter-spacing: 0.13em; }
.pe-panel-head.steps { border-top: 1px solid rgba(87, 143, 204, 0.14); margin-top: 4px; }
.pe-panel-head em { padding: 1px 7px; border-radius: 10px; color: #5eead4; background: rgba(94, 234, 212, 0.1); font-style: normal; }
.pe-project-list { flex: 0 1 auto; max-height: 148px; overflow-y: auto; padding: 0 10px 8px; }
.pe-project-item { display: flex; align-items: flex-start; gap: 8px; width: 100%; margin-bottom: 5px; padding: 8px 9px; border: 1px solid transparent; border-radius: 7px; background: rgba(18, 40, 66, 0.5); text-align: left; }
.pe-project-item:hover { border-color: rgba(94, 204, 255, 0.28); background: rgba(25, 54, 88, 0.65); }
.pe-project-item.active { border-color: rgba(56, 189, 248, 0.4); background: rgba(28, 65, 104, 0.7); }
.pe-project-dot { flex: 0 0 auto; width: 6px; height: 6px; margin-top: 5px; border-radius: 50%; background: #3d5875; }
.pe-project-dot.active { background: #5eead4; box-shadow: 0 0 8px #5eead4; }
.pe-project-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pe-project-copy b { overflow: hidden; color: #d7e8fa; font-size: 11px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
.pe-project-copy small { color: #6583a3; font-size: 9px; }
.pe-step-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 10px; }
.pe-step { margin-bottom: 5px; border: 1px solid transparent; border-radius: 8px; background: rgba(15, 34, 56, 0.62); overflow: hidden; }
.pe-step.active { border-color: rgba(56, 189, 248, 0.34); background: rgba(19, 43, 72, 0.78); }
.pe-step.playing { box-shadow: inset 3px 0 0 #5eead4; }
.pe-step-row { display: flex; align-items: center; gap: 9px; padding: 9px 9px; cursor: pointer; }
.pe-step-index { flex: 0 0 auto; width: 23px; height: 23px; display: grid; place-items: center; border: 1px solid rgba(94, 234, 212, 0.28); border-radius: 6px; color: #5eead4; background: rgba(94, 234, 212, 0.06); font: 700 10px "DM Mono", monospace; }
.pe-step-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pe-step-main b { overflow: hidden; color: #dcecff; font-size: 11.5px; white-space: nowrap; text-overflow: ellipsis; }
.pe-step-main small { color: #6a88a8; font-size: 9px; }
.pe-step-state { color: #5eead4; font: 700 8px "DM Mono", monospace; letter-spacing: 0.1em; }
.pe-step-tools { display: flex; gap: 4px; padding: 0 9px 8px 40px; }
.pe-step-tools button { height: 20px; padding: 0 6px; border: 1px solid rgba(112, 163, 219, 0.26); border-radius: 4px; color: #9ab4cf; background: transparent; font-size: 9px; }
.pe-step-tools button:hover { color: #dff3ff; border-color: rgba(94, 204, 255, 0.5); }
.pe-step-tools button.danger { color: #ef9a9a; }
.pe-action-list { padding: 0 8px 8px; }
.pe-action-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; padding: 6px 6px; border: 1px solid rgba(112, 163, 219, 0.16); border-radius: 6px; background: rgba(8, 20, 36, 0.7); cursor: pointer; }
.pe-action-row:hover { border-color: rgba(94, 204, 255, 0.32); }
.pe-action-row.active { border-color: rgba(94, 234, 212, 0.5); background: rgba(17, 49, 64, 0.75); }
.pe-action-row.disabled { opacity: 0.45; }
.pe-drag { flex: 0 0 auto; color: #486480; font-size: 10px; cursor: grab; letter-spacing: -2px; }
.pe-action-icon { flex: 0 0 auto; width: 19px; height: 19px; display: grid; place-items: center; border-radius: 4px; color: #69c9ff; background: rgba(56, 189, 248, 0.12); font-size: 11px; }
.pe-action-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.pe-action-main b { color: #c8ddf2; font-size: 10px; font-weight: 600; }
.pe-action-main small { overflow: hidden; color: #5f7d9c; font-size: 8.5px; white-space: nowrap; text-overflow: ellipsis; }
.pe-action-duration { color: #7f9cba; font: 9px "DM Mono", monospace; }
.pe-action-ops { display: none; gap: 1px; }
.pe-action-row:hover .pe-action-ops, .pe-action-row.active .pe-action-ops { display: flex; }
.pe-action-ops button { width: 16px; height: 16px; padding: 0; border: 0; border-radius: 3px; color: #87a4c2; background: transparent; font-size: 9px; line-height: 1; }
.pe-action-ops button:hover { color: #fff; background: rgba(94, 204, 255, 0.24); }
.pe-action-ops button.danger { color: #e78c8c; }
.pe-empty { padding: 10px 12px; color: #5c7692; font-size: 10px; line-height: 1.65; text-align: center; }
.pe-empty.actions { margin: 2px 0 0; }
.pe-add-step { flex: 0 0 auto; height: 34px; margin: 7px 10px 12px; border: 1px dashed rgba(94, 204, 255, 0.38); border-radius: 7px; color: #79b6e6; background: rgba(56, 189, 248, 0.06); font-size: 11px; }
.pe-add-step:hover { border-style: solid; color: #c9ecff; background: rgba(56, 189, 248, 0.13); }

.pe-viewport { position: relative; flex: 1; min-width: 0; min-height: 0; background: #0b1c33; overflow: hidden; }
.pe-canvas { position: absolute; inset: 0; }
.pe-hud { position: absolute; top: 0; left: 0; right: 0; z-index: 4; display: flex; align-items: flex-start; justify-content: space-between; padding: 12px 14px; pointer-events: none; background: linear-gradient(180deg, rgba(5, 13, 24, 0.6), transparent); }
.pe-hud-left { display: flex; align-items: center; gap: 8px; height: 24px; padding: 0 10px; border: 1px solid rgba(94, 204, 255, 0.24); border-radius: 20px; color: #a9c6e3; background: rgba(5, 17, 31, 0.62); font: 9px "DM Mono", monospace; letter-spacing: 0.08em; backdrop-filter: blur(8px); }
.pe-live-dot { width: 5px; height: 5px; border-radius: 50%; background: #5eead4; box-shadow: 0 0 8px #5eead4; }
.pe-hud-sep { width: 1px; height: 10px; background: rgba(120, 170, 220, 0.35); }
.pe-layer-chips { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; max-width: 62%; pointer-events: auto; }
.pe-layer-chip { display: flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border: 1px solid rgba(112, 163, 219, 0.28); border-radius: 6px; color: #c0d8ef; background: rgba(5, 17, 31, 0.62); font-size: 9px; backdrop-filter: blur(8px); }
.pe-layer-chip i { width: 6px; height: 6px; border-radius: 50%; }
.pe-layer-chip.off { opacity: 0.45; text-decoration: line-through; }
.pe-layer-chip:hover { border-color: rgba(94, 234, 212, 0.5); }

.pe-record-badge { position: absolute; top: 54px; left: 50%; z-index: 6; transform: translateX(-50%); display: flex; align-items: center; gap: 9px; padding: 8px 12px; border: 1px solid rgba(248, 113, 113, 0.55); border-radius: 8px; color: #ffe1e1; background: rgba(56, 12, 18, 0.82); font-size: 11px; box-shadow: 0 6px 22px rgba(0, 0, 0, 0.35); backdrop-filter: blur(8px); }
.pe-rec-dot { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; animation: pe-blink 1s infinite; }
.pe-record-badge button { height: 22px; padding: 0 8px; border: 1px solid rgba(255, 180, 180, 0.5); border-radius: 4px; color: #ffe4e4; background: rgba(239, 68, 68, 0.24); font-size: 9px; }
@keyframes pe-blink { 50% { opacity: 0.25; } }

.pe-subtitle { position: absolute; z-index: 5; max-width: 78%; pointer-events: none; text-align: center; text-shadow: 0 3px 18px rgba(0, 8, 20, 0.85); }
.pe-subtitle.boxed { padding: 14px 24px; border: 1px solid rgba(122, 203, 255, 0.3); border-radius: 10px; background: rgba(6, 17, 32, 0.66); backdrop-filter: blur(7px); }
.pe-subtitle.pos-bottom { left: 50%; bottom: 88px; transform: translateX(-50%); }
.pe-subtitle.pos-top { left: 50%; top: 70px; transform: translateX(-50%); }
.pe-subtitle.pos-left { left: 5%; bottom: 100px; text-align: left; }
.pe-subtitle.pos-right { right: 5%; bottom: 100px; text-align: right; }
.pe-subtitle.pos-fullscreen { left: 50%; top: 50%; transform: translate(-50%, -50%); }
.pe-subtitle.pos-fullscreen.boxed { padding: 26px 42px; }
.pe-subtitle.callout { left: 0; top: 0; transform: translate(-50%, calc(-100% - 16px)); min-width: 180px; max-width: 320px; text-align: left; }
.pe-subtitle.callout::after { content: ''; position: absolute; left: 50%; bottom: -7px; width: 12px; height: 12px; border-right: 1px solid rgba(94, 234, 212, 0.5); border-bottom: 1px solid rgba(94, 234, 212, 0.5); background: rgba(6, 17, 32, 0.72); transform: translateX(-50%) rotate(45deg); }
.pe-subtitle-text { margin: 0; font-weight: 700; line-height: 1.35; letter-spacing: 0.02em; }
.pe-subtitle-sub { margin: 7px 0 0; color: rgba(190, 220, 245, 0.92); font-size: 13px; line-height: 1.5; }

.pe-playbar { position: absolute; left: 50%; bottom: 14px; z-index: 6; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; width: min(760px, calc(100% - 28px)); height: 46px; padding: 0 12px; border: 1px solid rgba(112, 163, 219, 0.3); border-radius: 12px; background: rgba(5, 16, 29, 0.82); box-shadow: 0 10px 32px rgba(0, 0, 0, 0.38); backdrop-filter: blur(14px); }
.pe-play-btn { flex: 0 0 auto; width: 30px; height: 30px; border: 0; border-radius: 8px; color: #04121f; background: linear-gradient(135deg, #5eead4, #38bdf8); font-size: 11px; font-weight: 700; }
.pe-play-btn:hover { filter: brightness(1.12); }
.pe-control-btn { flex: 0 0 auto; width: 24px; height: 24px; border: 1px solid rgba(112, 163, 219, 0.28); border-radius: 5px; color: #96b6d4; background: transparent; font-size: 9px; }
.pe-control-btn:hover { color: #e8f6ff; border-color: rgba(94, 204, 255, 0.55); }
.pe-time { flex: 0 0 auto; color: #7d9bb9; font: 10px "DM Mono", monospace; }
.pe-time i { margin: 0 2px; color: #3f5d7b; font-style: normal; }
.pe-progress { flex: 1; min-width: 80px; height: 4px; accent-color: #5eead4; background: rgba(112, 163, 219, 0.18); border-radius: 999px; }
.pe-speed { flex: 0 0 auto; display: flex; gap: 2px; }
.pe-speed button { height: 21px; padding: 0 5px; border: 1px solid transparent; border-radius: 4px; color: #7d9bb9; background: transparent; font: 9px "DM Mono", monospace; }
.pe-speed button.active { border-color: rgba(94, 234, 212, 0.35); color: #5eead4; background: rgba(94, 234, 212, 0.09); }
.pe-export-btn { flex: 0 0 auto; height: 28px; padding: 0 12px; border: 1px solid transparent; border-radius: 6px; color: #effcff; background: linear-gradient(100deg, #2563eb, #0891b2); font-size: 10px; font-weight: 700; }
.pe-export-btn:hover { filter: brightness(1.15); }

.pe-status-mask { position: absolute; top: 14px; left: 50%; z-index: 7; transform: translateX(-50%); max-width: 420px; padding: 8px 14px; border: 1px solid rgba(94, 204, 255, 0.4); border-radius: 7px; color: #dff4ff; background: rgba(5, 17, 31, 0.9); font-size: 11px; text-align: center; line-height: 1.5; pointer-events: none; }

.pe-editor { flex: 1; min-height: 0; overflow-y: auto; padding: 13px 14px; }
.pe-editor-head { display: flex; align-items: center; gap: 9px; padding-bottom: 11px; border-bottom: 1px solid rgba(87, 143, 204, 0.16); }
.pe-editor-icon { flex: 0 0 auto; width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid rgba(94, 234, 212, 0.3); border-radius: 7px; color: #5eead4; background: rgba(94, 234, 212, 0.08); font-size: 14px; }
.pe-editor-head > div { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pe-editor-head b { color: #e7f4ff; font-size: 12px; }
.pe-editor-head small { overflow: hidden; color: #6986a4; font-size: 9.5px; white-space: nowrap; text-overflow: ellipsis; }
.pe-section-label { margin: 14px 0 7px; color: #7491af; font: 700 9px "DM Mono", monospace; letter-spacing: 0.12em; text-transform: uppercase; }
.pe-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.pe-field > span { color: #7f9cba; font-size: 9.5px; }
.pe-field input, .pe-field select, .pe-field textarea, .pe-textarea {
  width: 100%; padding: 6px 8px; border: 1px solid rgba(112, 163, 219, 0.26); border-radius: 5px; color: #d6e9fb; background: rgba(8, 21, 37, 0.85); font-size: 10.5px;
}
.pe-field input:focus, .pe-field select:focus, .pe-field textarea:focus, .pe-textarea:focus { outline: none; border-color: rgba(94, 234, 212, 0.55); }
.pe-field textarea, .pe-textarea { resize: vertical; line-height: 1.55; }
.pe-textarea { margin-bottom: 4px; }
.pe-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; }
.pe-color { height: 30px; padding: 2px !important; }
.pe-field-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; }
.pe-field-row label { color: #7f9cba; font-size: 9.5px; }
.pe-field-row input { width: 88px; padding: 6px 8px; border: 1px solid rgba(112, 163, 219, 0.26); border-radius: 5px; color: #d6e9fb; background: rgba(8, 21, 37, 0.85); font-size: 10.5px; }
.pe-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; color: #a9c2da; font-size: 10px; }
.pe-switch { position: relative; display: inline-flex; flex: 0 0 auto; width: 34px; height: 18px; }
.pe-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; z-index: 2; }
.pe-switch > span { position: absolute; inset: 0; border-radius: 20px; background: rgba(112, 163, 219, 0.24); transition: 0.2s; }
.pe-switch > span::after { content: ''; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 50%; background: #8ba8c5; transition: 0.2s; }
.pe-switch input:checked + span { background: rgba(94, 234, 212, 0.35); }
.pe-switch input:checked + span::after { left: 19px; background: #5eead4; box-shadow: 0 0 8px rgba(94, 234, 212, 0.6); }
.pe-inline-actions { display: flex; gap: 6px; margin: 8px 0; }
.pe-inline-actions .pe-btn { flex: 1; }
.pe-hint { margin: 9px 0; color: #647f9b; font-size: 9.5px; line-height: 1.6; }
.pe-range-row { margin: 8px 0; }
.pe-range-row > span { display: flex; justify-content: space-between; color: #7f9cba; font-size: 9.5px; }
.pe-range-row b { color: #5eead4; font-weight: 600; }
.pe-range-row input { width: 100%; margin-top: 4px; accent-color: #5eead4; }

.pe-route-stats, .pe-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 8px 0; }
.pe-route-stats > div, .pe-stats > div { display: flex; flex-direction: column; gap: 2px; padding: 8px 6px; border: 1px solid rgba(112, 163, 219, 0.18); border-radius: 6px; background: rgba(17, 38, 62, 0.55); text-align: center; }
.pe-route-stats b, .pe-stats b { color: #d9efff; font: 700 12px "DM Mono", monospace; }
.pe-route-stats span, .pe-stats span { color: #6784a2; font-size: 8.5px; }
.pe-record-btn { width: 100%; height: 32px; margin-top: 4px; border: 1px solid rgba(248, 113, 113, 0.42); border-radius: 6px; color: #ffd6d6; background: rgba(239, 68, 68, 0.14); font-size: 11px; }
.pe-record-btn:hover { background: rgba(239, 68, 68, 0.24); }
.pe-record-btn.stop { border-color: rgba(248, 113, 113, 0.65); background: rgba(239, 68, 68, 0.3); }
.pe-editor-footer { margin-top: 16px; padding-top: 10px; border-top: 1px solid rgba(87, 143, 204, 0.14); }
.pe-editor-footer .pe-btn { width: 100%; }
.pe-default-layers { display: flex; flex-direction: column; gap: 4px; }
.pe-layer-default { display: flex; align-items: center; gap: 7px; height: 27px; padding: 0 8px; border: 1px solid rgba(112, 163, 219, 0.18); border-radius: 5px; color: #a9c2da; background: rgba(13, 31, 51, 0.6); font-size: 10px; }
.pe-layer-default i { width: 7px; height: 7px; border-radius: 50%; }
.pe-layer-default span { flex: 1; text-align: left; }
.pe-layer-default em { color: #5eead4; font-style: normal; font-size: 8.5px; }
.pe-layer-default.off em { color: #6d88a5; }
.pe-layer-default.off { opacity: 0.55; }
.pe-default-effects { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
.pe-switch-row.compact { padding: 4px 0; }

.pe-action-library { flex: 0 0 auto; padding: 10px 14px 12px; border-top: 1px solid rgba(87, 143, 204, 0.18); background: rgba(7, 19, 33, 0.7); }
.pe-action-library .pe-section-label { margin: 0 0 7px; }
.pe-action-buttons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
.pe-action-btn { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 7px 3px; border: 1px solid rgba(112, 163, 219, 0.2); border-radius: 6px; color: #8fb2d3; background: rgba(16, 36, 60, 0.55); }
.pe-action-btn span { color: #5eead4; font-size: 13px; line-height: 1; }
.pe-action-btn em { font-style: normal; font-size: 8.5px; }
.pe-action-btn:hover { border-color: rgba(94, 234, 212, 0.5); color: #dffbff; background: rgba(30, 70, 92, 0.6); }

.pe-modal-mask { position: fixed; z-index: 80; inset: 0; display: grid; place-items: center; padding: 20px; background: rgba(3, 9, 17, 0.66); backdrop-filter: blur(4px); }
.pe-modal { width: min(430px, 94vw); max-height: 88vh; overflow-y: auto; padding: 16px 18px; border: 1px solid rgba(94, 204, 255, 0.28); border-radius: 12px; background: #0b1a2d; box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5); }
.pe-export-modal { width: min(540px, 94vw); }
.pe-modal-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 11px; border-bottom: 1px solid rgba(87, 143, 204, 0.2); }
.pe-modal-head b { color: #e8f5ff; font-size: 13px; }
.pe-modal-head button { width: 24px; height: 24px; border: 1px solid rgba(112, 163, 219, 0.25); border-radius: 5px; color: #8ba8c5; background: transparent; font-size: 10px; }
.pe-modal .pe-field { margin-top: 12px; }
.pe-confirm-text { margin: 16px 0 8px; color: #b9cee2; font-size: 11px; line-height: 1.7; }
.pe-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.pe-export-body { padding-top: 4px; }
.pe-option-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
.pe-option-row.compact { grid-template-columns: repeat(2, 1fr); }
.pe-option-row button { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 9px 6px; border: 1px solid rgba(112, 163, 219, 0.22); border-radius: 7px; color: #94b2d0; background: rgba(15, 33, 54, 0.6); font-size: 10px; }
.pe-option-row button small { color: #607e9c; font-size: 8.5px; }
.pe-option-row button.active { border-color: rgba(94, 234, 212, 0.6); color: #e6fffb; background: rgba(34, 94, 96, 0.38); box-shadow: 0 0 16px rgba(94, 234, 212, 0.1); }
.pe-option-row button.active small { color: #8fd8ce; }
.pe-export-summary { display: grid; grid-template-columns: 1fr auto; gap: 5px 12px; margin-top: 12px; padding: 10px 12px; border: 1px solid rgba(112, 163, 219, 0.18); border-radius: 7px; background: rgba(13, 31, 51, 0.6); }
.pe-export-summary span { color: #7f9cba; font-size: 9.5px; }
.pe-export-summary b { color: #cfe8fb; font-size: 10px; text-align: right; }
.pe-export-progress { margin-top: 10px; }
.pe-progress-track { height: 6px; overflow: hidden; border-radius: 999px; background: rgba(112, 163, 219, 0.2); }
.pe-progress-track span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #2f80ed, #5eead4); transition: width 0.2s linear; }
.pe-export-progress p { margin: 7px 0 0; color: #8fb2d3; font-size: 10px; text-align: center; }
.pe-error { margin: 9px 0 0; color: #fca5a5; font-size: 10px; line-height: 1.5; }
.pe-export-success { display: flex; align-items: center; gap: 12px; margin-top: 14px; padding: 14px; border: 1px solid rgba(74, 222, 128, 0.32); border-radius: 8px; background: rgba(34, 197, 94, 0.08); }
.pe-export-success > span { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; color: #7ee2a8; background: rgba(74, 222, 128, 0.15); font-size: 14px; }
.pe-export-success div { display: flex; flex-direction: column; gap: 3px; }
.pe-export-success b { color: #d9ffe8; font-size: 11px; }
.pe-export-success small { color: #7da892; font-size: 9px; }

.pe-toast { position: fixed; left: 50%; bottom: 42px; z-index: 90; transform: translateX(-50%); padding: 9px 16px; border: 1px solid rgba(94, 204, 255, 0.4); border-radius: 7px; color: #e0f4ff; background: rgba(7, 24, 42, 0.94); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35); font-size: 11px; pointer-events: none; }
.pe-toast.warn { border-color: rgba(251, 191, 36, 0.48); color: #fde8b0; }
.pe-toast.error { border-color: rgba(248, 113, 113, 0.5); color: #ffd1d1; }
.pe-toast-enter-active, .pe-toast-leave-active { transition: opacity 0.2s, transform 0.2s; }
.pe-toast-enter-from, .pe-toast-leave-to { opacity: 0; transform: translate(-50%, 8px); }

@media (max-width: 1180px) {
  .pe-left { flex-basis: 238px; }
  .pe-right { flex-basis: 306px; }
  .pe-brand-sub, .pe-project-meta { display: none; }
  .pe-project-name { width: 190px; }
  .pe-action-chips { max-width: 55%; }
}
</style>
