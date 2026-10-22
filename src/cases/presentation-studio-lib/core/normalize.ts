import {
  ACTION_MAP,
  ACTION_DEFINITIONS,
  DEFAULT_EFFECTS,
  DEFAULT_INITIAL_STATE,
  DEFAULT_LAYERS,
  DEFAULT_TIME,
  EFFECT_DEFINITIONS,
  LANDMARK_MAP,
  LAYER_DEFINITIONS,
  TIME_TARGET_LABELS,
  createAction,
  createEmptyRoute,
  createStep,
  createSubtitleParam,
  createPopupParam,
  nowIso
} from './defaults'
import { PROJECT_FORMAT, PROJECT_VERSION } from './types'
import {
  type ActionType,
  type CameraPose,
  type EffectId,
  type EasingType,
  type EffectSnapshot,
  type FlyToAction,
  type InitialState,
  type LayerId,
  type LayerSnapshot,
  type LayerToggleAction,
  type PopupAction,
  type PopupPlacement,
  type PresentationAction,
  type PresentationProject,
  type PresentationStep,
  type RecordRouteAction,
  type RouteData,
  type RouteSample,
  type SceneEffectAction,
  type StepTransition,
  type SubtitleAction,
  type SubtitleBackground,
  type SubtitleParam,
  type SubtitlePosition,
  type TimeAnimationAction,
  type TimeTarget,
  type TransitionType
} from './types'

type UnknownRecord = Record<string, unknown>

const ACTION_TYPES: ActionType[] = ACTION_DEFINITIONS.map((item) => item.type)
const LAYER_IDS: LayerId[] = LAYER_DEFINITIONS.map((item) => item.id)
const EFFECT_IDS: EffectId[] = EFFECT_DEFINITIONS.map((item) => item.id)
const TIME_TARGETS: TimeTarget[] = ['dayanta', 'landmarks', 'beacons']
const EASINGS: EasingType[] = ['linear', 'smooth', 'cinematic']
const TRANSITIONS: TransitionType[] = ['none', 'fade', 'dip', 'slide']
const SUBTITLE_POSITIONS: SubtitlePosition[] = ['fullscreen', 'top', 'bottom', 'left', 'right', 'callout']
const SUBTITLE_BACKGROUNDS: SubtitleBackground[] = ['none', 'dark', 'glass', 'gradient']
const POPUP_PLACEMENTS: PopupPlacement[] = ['left', 'right', 'top', 'bottom', 'center']
const ALIGNS: Array<'left' | 'center' | 'right'> = ['left', 'center', 'right']

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {}
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function num(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function pickList<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value) ? (value as T) : fallback
}

function normalizeAngle(value: number): number {
  const wrapped = value % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

export function normalizeCamera(raw: unknown, fallback: CameraPose): CameraPose {
  const source = asRecord(raw)
  return {
    longitude: clamp(num(source.longitude ?? source.lng, fallback.longitude), -180, 180),
    latitude: clamp(num(source.latitude ?? source.lat, fallback.latitude), -85, 85),
    height: clamp(num(source.height ?? source.altitude, fallback.height), -500, 3000000),
    heading: normalizeAngle(num(source.heading ?? source.yaw, fallback.heading)),
    pitch: clamp(num(source.pitch, fallback.pitch), -89.9, 89.9),
    roll: clamp(num(source.roll, fallback.roll), -180, 180),
    fov: clamp(num(source.fov, fallback.fov), 15, 110)
  }
}

function normalizeLayers(raw: unknown, fallback: LayerSnapshot): LayerSnapshot {
  const source = asRecord(raw)
  const result = { ...fallback }
  for (const id of LAYER_IDS) {
    if (typeof source[id] === 'boolean') result[id] = source[id] as boolean
  }
  return result
}

function normalizeEffects(raw: unknown, fallback: EffectSnapshot): EffectSnapshot {
  const source = asRecord(raw)
  const result = { ...fallback }
  for (const id of EFFECT_IDS) {
    if (typeof source[id] === 'boolean') result[id] = source[id] as boolean
  }
  return result
}

function normalizeCameraFromSources(source: UnknownRecord, fallback: CameraPose): CameraPose {
  return normalizeCamera(source.camera ?? source.cameraParam ?? source.view ?? source, fallback)
}

function normalizeRoute(raw: unknown, fallback: RouteData): RouteData {
  const source = asRecord(raw)
  const rawSamples = Array.isArray(source.samples)
    ? source.samples
    : Array.isArray(source.routeSamples)
      ? source.routeSamples
      : Array.isArray(source.points)
        ? source.points
        : []
  const base = normalizeCamera({}, { longitude: 108.9642, latitude: 34.2186, height: 300, heading: 0, pitch: -20, roll: 0, fov: 50 })
  const samples: RouteSample[] = []
  const limit = Math.min(rawSamples.length, 400)
  for (let index = 0; index < limit; index += 1) {
    const item = asRecord(rawSamples[index])
    const pose = normalizeCamera(item, base)
    const t = clamp(num(item.t, limit <= 1 ? 0 : index / (limit - 1)), 0, 1)
    samples.push({ ...pose, t })
  }
  samples.sort((left, right) => left.t - right.t)
  if (samples.length) {
    const span = samples[samples.length - 1].t - samples[0].t
    if (span <= 0.0001) {
      samples.forEach((sample, index) => {
        sample.t = samples.length <= 1 ? 0 : index / (samples.length - 1)
      })
    } else {
      samples.forEach((sample) => {
        sample.t = clamp((sample.t - samples[0].t) / span, 0, 1)
      })
    }
  }
  return {
    samples,
    recordedDuration: clamp(num(source.recordedDuration ?? source.duration, fallback.recordedDuration), 0.5, 600),
    smoothing: clamp(num(source.smoothing, fallback.smoothing), 0, 1),
    altitudeOffset: clamp(num(source.altitudeOffset, fallback.altitudeOffset), -500, 1200),
    interpolation: source.interpolation === 'linear' ? 'linear' : 'catmullrom'
  }
}

function normalizeSubtitle(raw: unknown): SubtitleParam {
  const fallback = createSubtitleParam()
  const source = asRecord(raw)
  const calloutSource = asRecord(source.callout)
  const callout =
    typeof source.callout === 'object' && source.callout !== null && calloutSource.longitude !== undefined
      ? {
          longitude: clamp(num(calloutSource.longitude, fallback.callout!.longitude), -180, 180),
          latitude: clamp(num(calloutSource.latitude, fallback.callout!.latitude), -85, 85),
          height: clamp(num(calloutSource.height, fallback.callout!.height), 0, 100000)
        }
      : source.callout === null
        ? null
        : fallback.callout
  return {
    title: text(source.title, fallback.title).slice(0, 80),
    text: text(source.text ?? source.content, fallback.text).slice(0, 400),
    position: pickList(source.position, SUBTITLE_POSITIONS, fallback.position),
    fontSize: clamp(num(source.fontSize, fallback.fontSize), 12, 96),
    color: text(source.color, fallback.color),
    accent: text(source.accent, fallback.accent),
    background: pickList(source.background, SUBTITLE_BACKGROUNDS, fallback.background),
    align: pickList(source.align, ALIGNS, fallback.align),
    maxWidth: clamp(num(source.maxWidth, fallback.maxWidth), 240, 1400),
    callout,
    fade: clamp(num(source.fade, fallback.fade), 0, 2)
  }
}

function normalizePopup(raw: unknown): PopupAction['popup'] {
  const fallback = createPopupParam()
  const source = asRecord(raw)
  const targetId = text(source.targetId, fallback.targetId ?? '')
  return {
    title: text(source.title, fallback.title).slice(0, 80),
    content: text(source.content, fallback.content).slice(0, 600),
    targetId: source.targetId === null ? null : LANDMARK_MAP[targetId] ? targetId : null,
    placement: pickList(source.placement, POPUP_PLACEMENTS, fallback.placement),
    accent: text(source.accent, fallback.accent),
    width: clamp(num(source.width, fallback.width), 220, 520)
  }
}

function normalizeAction(raw: unknown, index: number): PresentationAction | null {
  if (!isRecord(raw)) return null
  const type = pickList(raw.actionType, ACTION_TYPES, 'flyTo')
  const fallback = createAction(type)
  const base = {
    actionId: text(raw.actionId, `act_${index}_${Math.random().toString(36).slice(2, 7)}`),
    enable: bool(raw.enable, true),
    duration: clamp(num(raw.duration, fallback.duration), 0.2, 600),
    note: text(raw.note, '').slice(0, 200)
  }

  switch (type) {
    case 'flyTo': {
      const source = asRecord(raw)
      return {
        ...(fallback as FlyToAction),
        ...base,
        actionType: 'flyTo',
        camera: normalizeCameraFromSources(source, (fallback as FlyToAction).camera),
        targetId: typeof raw.targetId === 'string' && LANDMARK_MAP[raw.targetId] ? raw.targetId : null,
        easing: pickList(raw.easing, EASINGS, (fallback as FlyToAction).easing),
        arc: bool(raw.arc, (fallback as FlyToAction).arc)
      }
    }
    case 'recordRoute': {
      const fallbackAction = fallback as RecordRouteAction
      return {
        ...fallbackAction,
        ...base,
        actionType: 'recordRoute',
        route: normalizeRoute(raw.route ?? raw, fallbackAction.route),
        easing: pickList(raw.easing, EASINGS, fallbackAction.easing),
        entryBlend: clamp(num(raw.entryBlend, fallbackAction.entryBlend), 0, 6),
        showTrail: bool(raw.showTrail, fallbackAction.showTrail)
      }
    }
    case 'layerToggle': {
      const fallbackAction = fallback as LayerToggleAction
      const source = asRecord(raw.layerStates ?? raw.layers)
      return {
        ...fallbackAction,
        ...base,
        actionType: 'layerToggle',
        layers: normalizeLayers(source, fallbackAction.layers),
        transition: raw.transition === 'instant' ? 'instant' : 'fade'
      }
    }
    case 'timeAnimation': {
      const fallbackAction = fallback as TimeAnimationAction
      return {
        ...fallbackAction,
        ...base,
        actionType: 'timeAnimation',
        target: pickList(raw.target ?? raw.layerId, TIME_TARGETS, fallbackAction.target),
        from: clamp(num(raw.from, fallbackAction.from), 0, 1),
        to: clamp(num(raw.to, fallbackAction.to), 0, 1),
        easing: pickList(raw.easing, EASINGS, fallbackAction.easing)
      }
    }
    case 'subtitle': {
      const fallbackAction = fallback as SubtitleAction
      return {
        ...fallbackAction,
        ...base,
        actionType: 'subtitle',
        subtitle: normalizeSubtitle(raw.subtitle ?? raw.subtitleParam ?? raw)
      }
    }
    case 'popup': {
      const fallbackAction = fallback as PopupAction
      return {
        ...fallbackAction,
        ...base,
        actionType: 'popup',
        popup: normalizePopup(raw.popup ?? raw.popupParam ?? raw)
      }
    }
    case 'sceneEffect': {
      const fallbackAction = fallback as SceneEffectAction
      const source = asRecord(raw.effects ?? raw.effect ?? raw.sceneState)
      return {
        ...fallbackAction,
        ...base,
        actionType: 'sceneEffect',
        effects: normalizeEffects(source, fallbackAction.effects)
      }
    }
    default:
      return null
  }
}

function normalizeTransition(raw: unknown): StepTransition {
  const source = asRecord(raw)
  return {
    type: pickList(source.type, TRANSITIONS, 'fade'),
    duration: clamp(num(source.duration, 1.1), 0, 4)
  }
}

function normalizeStep(raw: unknown, index: number): PresentationStep {
  const source = asRecord(raw)
  const actionsRaw = Array.isArray(source.actions) ? source.actions : []
  const actions = actionsRaw
    .map((item, actionIndex) => normalizeAction(item, actionIndex))
    .filter((item): item is PresentationAction => item !== null)
    .slice(0, 200)
  const seen = new Set<string>()
  for (const action of actions) {
    if (seen.has(action.actionId)) action.actionId = `${action.actionId}_${Math.random().toString(36).slice(2, 6)}`
    seen.add(action.actionId)
  }
  return {
    stepId: text(source.stepId, `step_${index}_${Math.random().toString(36).slice(2, 7)}`),
    stepName: text(source.stepName ?? source.name, `步骤 ${String(index + 1).padStart(2, '0')}`).slice(0, 40),
    duration: clamp(num(source.duration, 8), 0.5, 600),
    speedRate: clamp(num(source.speedRate ?? source.speed, 1), 0.25, 4),
    stayTime: clamp(num(source.stayTime ?? source.stay, 0.4), 0, 60),
    transition: normalizeTransition(source.transition),
    actions
  }
}

export function normalizeProject(raw: unknown): PresentationProject {
  const source = asRecord(raw)
  const fallback = DEFAULT_INITIAL_STATE
  const initialSource = asRecord(source.initial ?? source.initialState ?? source.scene)
  const initial: InitialState = {
    camera: normalizeCamera(initialSource.camera ?? initialSource.cameraParam, fallback.camera),
    layers: normalizeLayers(initialSource.layers ?? initialSource.layerStates, fallback.layers),
    effects: normalizeEffects(initialSource.effects ?? initialSource.sceneEffects, fallback.effects),
    time: {
      dayanta: clamp(num(asRecord(initialSource.time).dayanta, fallback.time.dayanta), 0, 1),
      landmarks: clamp(num(asRecord(initialSource.time).landmarks, fallback.time.landmarks), 0, 1),
      beacons: clamp(num(asRecord(initialSource.time).beacons, fallback.time.beacons), 0, 1)
    }
  }
  const rawSteps = Array.isArray(source.steps) ? source.steps : []
  const steps = rawSteps.map((item, index) => normalizeStep(item, index)).slice(0, 100)
  if (!steps.length) steps.push(createStep(1))
  const seenSteps = new Set<string>()
  for (const step of steps) {
    if (seenSteps.has(step.stepId)) step.stepId = `${step.stepId}_${Math.random().toString(36).slice(2, 6)}`
    seenSteps.add(step.stepId)
  }
  const now = nowIso()
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: text(source.id, `prj_${Math.random().toString(36).slice(2, 10)}`),
    name: text(source.name, '未命名演示').trim().slice(0, 60) || '未命名演示',
    note: text(source.note, '').slice(0, 800),
    createTime: text(source.createTime, now),
    updateTime: text(source.updateTime, now),
    initial,
    steps
  }
}

export function parseProjectFile(content: string): PresentationProject {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  const record = asRecord(parsed)
  if (Array.isArray(record.projects) && record.projects.length) {
    return normalizeProject(record.projects[0])
  }
  if (!isRecord(parsed) || (!Array.isArray(record.steps) && !isRecord(record.project))) {
    throw new Error('文件中未找到演示工程数据')
  }
  return normalizeProject(isRecord(record.project) ? record.project : parsed)
}

export function serializeProject(project: PresentationProject): string {
  return JSON.stringify(project, null, 2)
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const minutes = Math.floor(safe / 60)
  const rest = safe - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

export function formatNumber(value: number, digits = 4): string {
  return Number(value).toFixed(digits)
}

export function layerSummary(layers: LayerSnapshot): string {
  const visible = LAYER_IDS.filter((id) => layers[id])
  return `${visible.length} 个图层可见`
}

export function effectSummary(effects: EffectSnapshot): string {
  const enabled = EFFECT_IDS.filter((id) => effects[id])
  return enabled.length ? enabled.map((id) => EFFECT_DEFINITIONS.find((item) => item.id === id)?.name ?? id).join(' / ') : '关闭全部效果'
}

export function actionSummary(action: PresentationAction): string {
  switch (action.actionType) {
    case 'flyTo': {
      const landmark = action.targetId ? LANDMARK_MAP[action.targetId] : null
      return landmark ? `飞向 ${landmark.name}` : `${formatNumber(action.camera.longitude, 3)}, ${formatNumber(action.camera.latitude, 3)} · ${Math.round(action.camera.height)}m`
    }
    case 'recordRoute':
      return action.route.samples.length ? `${action.route.samples.length} 个采样点 · ${action.route.recordedDuration.toFixed(1)}s` : '尚未录制航线'
    case 'layerToggle':
      return layerSummary(action.layers)
    case 'timeAnimation':
      return `${TIME_TARGET_LABELS[action.target]} ${Math.round(action.from * 100)}% → ${Math.round(action.to * 100)}%`
    case 'subtitle':
      return action.subtitle.text || '空字幕'
    case 'popup': {
      const landmark = action.popup.targetId ? LANDMARK_MAP[action.popup.targetId] : null
      return landmark ? `${action.popup.title} · ${landmark.name}` : action.popup.title || '信息弹窗'
    }
    case 'sceneEffect':
      return effectSummary(action.effects)
    default:
      return ''
  }
}

export function actionLabel(action: PresentationAction): string {
  return ACTION_MAP[action.actionType]?.name ?? action.actionType
}

export function hasPlayableActions(project: PresentationProject): { ok: boolean; message: string } {
  if (!project.steps.length) return { ok: false, message: '演示至少需要一个步骤' }
  const emptyIndex = project.steps.findIndex((step) => !step.actions.some((action) => action.enable))
  if (emptyIndex >= 0) {
    return { ok: false, message: `步骤「${project.steps[emptyIndex].stepName}」没有启用中的动作` }
  }
  return { ok: true, message: '' }
}

export function routeFromSamples(samples: RouteSample[], duration: number): RouteData {
  const route = createEmptyRoute()
  route.samples = samples
  route.recordedDuration = duration
  return route
}

export function createBlankInitial(): InitialState {
  return {
    camera: { ...DEFAULT_INITIAL_STATE.camera },
    layers: { ...DEFAULT_LAYERS },
    effects: { ...DEFAULT_EFFECTS },
    time: { ...DEFAULT_TIME }
  }
}
