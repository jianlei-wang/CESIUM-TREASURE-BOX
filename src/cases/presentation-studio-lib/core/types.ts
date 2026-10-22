export const PROJECT_FORMAT = 'cesium.presentation' as const
export const PROJECT_VERSION = 1 as const

export type LayerId = 'imagery' | 'terrain' | 'dayanta' | 'landmarks' | 'beacons' | 'route'
export type EffectId = 'shadows' | 'lighting' | 'fog' | 'atmosphere' | 'contour' | 'slope'
export type TimeTarget = 'dayanta' | 'landmarks' | 'beacons'
export type ActionType =
  | 'flyTo'
  | 'recordRoute'
  | 'layerToggle'
  | 'timeAnimation'
  | 'subtitle'
  | 'popup'
  | 'sceneEffect'

export type EasingType = 'linear' | 'smooth' | 'cinematic'
export type TransitionType = 'none' | 'fade' | 'dip' | 'slide'
export type SubtitlePosition = 'fullscreen' | 'top' | 'bottom' | 'left' | 'right' | 'callout'
export type SubtitleBackground = 'none' | 'dark' | 'glass' | 'gradient'
export type PopupPlacement = 'left' | 'right' | 'top' | 'bottom' | 'center'

export interface CameraPose {
  longitude: number
  latitude: number
  height: number
  heading: number
  pitch: number
  roll: number
  fov: number
}

export interface RouteSample extends CameraPose {
  t: number
}

export interface RouteData {
  samples: RouteSample[]
  recordedDuration: number
  smoothing: number
  altitudeOffset: number
  interpolation: 'catmullrom' | 'linear'
}

export interface LayerSnapshot {
  imagery: boolean
  terrain: boolean
  dayanta: boolean
  landmarks: boolean
  beacons: boolean
  route: boolean
}

export interface EffectSnapshot {
  shadows: boolean
  lighting: boolean
  fog: boolean
  atmosphere: boolean
  contour: boolean
  slope: boolean
}

export interface TimeSnapshot {
  dayanta: number
  landmarks: number
  beacons: number
}

export interface InitialState {
  camera: CameraPose
  layers: LayerSnapshot
  effects: EffectSnapshot
  time: TimeSnapshot
}

export interface SubtitleParam {
  title: string
  text: string
  position: SubtitlePosition
  fontSize: number
  color: string
  accent: string
  background: SubtitleBackground
  align: 'left' | 'center' | 'right'
  maxWidth: number
  callout: { longitude: number; latitude: number; height: number } | null
  fade: number
}

export interface PopupParam {
  title: string
  content: string
  targetId: string | null
  placement: PopupPlacement
  accent: string
  width: number
}

interface ActionBase {
  actionId: string
  enable: boolean
  duration: number
  note: string
}

export interface FlyToAction extends ActionBase {
  actionType: 'flyTo'
  camera: CameraPose
  targetId: string | null
  easing: EasingType
  arc: boolean
}

export interface RecordRouteAction extends ActionBase {
  actionType: 'recordRoute'
  route: RouteData
  easing: EasingType
  entryBlend: number
  showTrail: boolean
}

export interface LayerToggleAction extends ActionBase {
  actionType: 'layerToggle'
  layers: LayerSnapshot
  transition: 'instant' | 'fade'
}

export interface TimeAnimationAction extends ActionBase {
  actionType: 'timeAnimation'
  target: TimeTarget
  from: number
  to: number
  easing: EasingType
}

export interface SubtitleAction extends ActionBase {
  actionType: 'subtitle'
  subtitle: SubtitleParam
}

export interface PopupAction extends ActionBase {
  actionType: 'popup'
  popup: PopupParam
}

export interface SceneEffectAction extends ActionBase {
  actionType: 'sceneEffect'
  effects: EffectSnapshot
}

export type PresentationAction =
  | FlyToAction
  | RecordRouteAction
  | LayerToggleAction
  | TimeAnimationAction
  | SubtitleAction
  | PopupAction
  | SceneEffectAction

export interface StepTransition {
  type: TransitionType
  duration: number
}

export interface PresentationStep {
  stepId: string
  stepName: string
  duration: number
  speedRate: number
  stayTime: number
  transition: StepTransition
  actions: PresentationAction[]
}

export interface PresentationProject {
  format: typeof PROJECT_FORMAT
  version: typeof PROJECT_VERSION
  id: string
  name: string
  note: string
  createTime: string
  updateTime: string
  initial: InitialState
  steps: PresentationStep[]
}

export interface LandmarkDefinition {
  id: string
  name: string
  subtitle: string
  longitude: number
  latitude: number
  height: number
  beaconHeight: number
  color: string
  camera: CameraPose
}

export interface LayerDefinition {
  id: LayerId
  name: string
  description: string
  icon: string
  fade: boolean
}

export interface EffectDefinition {
  id: EffectId
  name: string
  description: string
  icon: string
}

export interface ActionDefinition {
  type: ActionType
  name: string
  short: string
  description: string
  icon: string
  color: string
}

export interface SubtitleView {
  param: SubtitleParam
  alpha: number
}

export interface PopupView {
  param: PopupParam
  alpha: number
}

export interface ChapterView {
  index: number
  total: number
  name: string
  type: TransitionType
  progress: number
  alpha: number
}

export interface RuntimeState {
  time: number
  stepIndex: number
  step: PresentationStep | null
  stepLocal: number
  stepDuration: number
  actionIndex: number
  action: PresentationAction | null
  actionProgress: number
  camera: CameraPose
  layers: Record<LayerId, number>
  effects: Record<EffectId, number>
  timeProgress: TimeSnapshot
  route: RouteData | null
  routeCursor: CameraPose | null
  subtitles: SubtitleView[]
  popups: PopupView[]
  chapter: ChapterView | null
}

export interface ActionTiming {
  action: PresentationAction
  index: number
  start: number
  duration: number
  end: number
}

export interface StepTiming {
  step: PresentationStep
  index: number
  start: number
  actionsTotal: number
  activeDuration: number
  stayTime: number
  total: number
  actions: ActionTiming[]
}

export interface Timeline {
  steps: StepTiming[]
  total: number
}

export type PlaybackMode = 'idle' | 'playing' | 'paused' | 'preview' | 'recording' | 'exporting'

export interface RecordingState {
  active: boolean
  startedAt: number
  elapsed: number
  sampleCount: number
}

export interface ExportSettings {
  resolution: '1080p' | '2k' | '4k'
  fps: 30 | 60
}

export interface ExportState {
  active: boolean
  progress: number
  phase: 'preparing' | 'recording' | 'finalizing' | 'done' | 'error'
  message: string
  mime: string
  extension: string
}

export interface SceneStatus {
  ready: boolean
  failed: boolean
  message: string
  detail: string
}

export interface ToastItem {
  id: number
  tone: 'info' | 'success' | 'warn' | 'error'
  text: string
}

export type DialogKind =
  | 'new'
  | 'rename'
  | 'saveAs'
  | 'projectSettings'
  | 'deleteProject'
  | 'unsaved'
  | 'export'
  | 'help'
  | 'importError'
  | null

export interface DialogState {
  kind: DialogKind
  value: string
  note: string
  projectId: string
  message: string
}
