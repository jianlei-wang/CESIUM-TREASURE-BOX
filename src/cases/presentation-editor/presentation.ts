export type ActionType =
  | 'flyTo'
  | 'recordRoute'
  | 'layerToggle'
  | 'timeAnimation'
  | 'subtitle'
  | 'sceneEffect'

export type SceneEffectType = 'shadows' | 'lighting' | 'fog' | 'atmosphere'
export type SubtitlePosition = 'fullscreen' | 'top' | 'bottom' | 'left' | 'right' | 'callout'

export interface CameraPose {
  longitude: number
  latitude: number
  height: number
  heading: number
  pitch: number
  roll: number
  fov?: number
}

export interface RouteSample extends CameraPose {
  t: number
}

export interface LayerDefinition {
  id: string
  name: string
  color: string
  description: string
}

export interface LayerToggleParam {
  layerId: string
  visible: boolean
}

export interface TimeAnimationParam {
  layerId: string
  from: number
  to: number
}

export interface SubtitleParam {
  mode: 'fullscreen' | 'callout'
  text: string
  subtext: string
  position: SubtitlePosition
  fontSize: number
  color: string
  background: boolean
  anchorId: string
}

export interface SceneEffectParam {
  effect: SceneEffectType
  enabled: boolean
  value: number
}

export interface PresentationAction {
  actionId: string
  actionType: ActionType
  enable: boolean
  duration: number
  cameraParam?: CameraPose
  routeSamples?: RouteSample[]
  layerToggle?: LayerToggleParam
  timeAnimation?: TimeAnimationParam
  subtitle?: SubtitleParam
  sceneEffect?: SceneEffectParam
}

export interface PresentationStep {
  stepId: string
  stepName: string
  duration: number
  speedRate: number
  stayTime: number
  transition: number
  actions: PresentationAction[]
}

export interface SceneEffectState {
  shadows: boolean
  lighting: boolean
  fog: boolean
  fogDensity: number
  atmosphere: boolean
}

export interface PresentationProject {
  type: 'cesium-presentation'
  schemaVersion: 1
  id: string
  name: string
  description: string
  createTime: string
  updateTime: string
  initialCamera: CameraPose
  layerStates: Record<string, boolean>
  sceneState: SceneEffectState
  steps: PresentationStep[]
}

export const PROJECT_FILE_SUFFIX = '.cesium.presentation'
export const PROJECT_STORAGE_KEY = 'cesium-presentation-projects-v1'
export const DRAFT_STORAGE_KEY = 'cesium-presentation-draft-v1'
export const SITE_CENTER = { longitude: 116.3915, latitude: 39.9075 }

export const LAYER_DEFINITIONS: LayerDefinition[] = [
  { id: 'poi', name: '地标标注', color: '#6fd6ff', description: '园区核心地标与名称标注' },
  { id: 'zones', name: '规划分区', color: '#ffc46b', description: '功能分区与用地边界' },
  { id: 'route', name: '巡检航线', color: '#6da8ff', description: '低空巡检与漫游航线' },
  { id: 'buildings', name: '建设进度', color: '#8fe0b4', description: '楼宇建设时序演进模型' },
  { id: 'rings', name: '监测范围', color: '#ff9d7a', description: '重点区域监测覆盖圈' }
]

export const ACTION_LABELS: Record<ActionType, string> = {
  flyTo: '定点飞行',
  recordRoute: '航线录制',
  layerToggle: '图层显隐',
  timeAnimation: '时序驱动',
  subtitle: '字幕弹窗',
  sceneEffect: '场景效果'
}

export const ACTION_ICONS: Record<ActionType, string> = {
  flyTo: '飞',
  recordRoute: '线',
  layerToggle: '层',
  timeAnimation: '时',
  subtitle: '字',
  sceneEffect: '效'
}

export const EFFECT_LABELS: Record<SceneEffectType, string> = {
  shadows: '阴影',
  lighting: '光照',
  fog: '雾效',
  atmosphere: '大气层'
}

export const POSITION_LABELS: Record<SubtitlePosition, string> = {
  fullscreen: '全屏遮罩',
  top: '顶部',
  bottom: '底部',
  left: '左下',
  right: '右下',
  callout: '点位弹窗'
}

export const SPEED_OPTIONS = [0.5, 1, 1.5, 2]
export const RESOLUTION_OPTIONS = [
  { id: '1080p', label: '1080P', width: 1920, height: 1080 },
  { id: '2k', label: '2K', width: 2560, height: 1440 },
  { id: '4k', label: '4K', width: 3840, height: 2160 }
] as const
export const FPS_OPTIONS = [30, 60]

export type ResolutionId = (typeof RESOLUTION_OPTIONS)[number]['id']

let idSeed = 0

export function createId(prefix: string): string {
  idSeed += 1
  return `${prefix}_${Date.now().toString(36)}_${idSeed}`
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function defaultCameraPose(): CameraPose {
  return {
    longitude: SITE_CENTER.longitude,
    latitude: SITE_CENTER.latitude - 0.006,
    height: 2400,
    heading: 0,
    pitch: -48,
    roll: 0,
    fov: 60
  }
}

export function defaultSceneState(): SceneEffectState {
  return {
    shadows: false,
    lighting: false,
    fog: false,
    fogDensity: 0.0002,
    atmosphere: true
  }
}

export function defaultLayerStates(): Record<string, boolean> {
  return Object.fromEntries(LAYER_DEFINITIONS.map((layer) => [layer.id, true]))
}

export function defaultSubtitle(): SubtitleParam {
  return {
    mode: 'fullscreen',
    text: '三维场景演示漫游',
    subtext: '基于 Cesium 的步骤化演示编排',
    position: 'bottom',
    fontSize: 30,
    color: '#ffffff',
    background: true,
    anchorId: 'poi'
  }
}

export function createAction(type: ActionType, pose?: CameraPose): PresentationAction {
  const base: PresentationAction = {
    actionId: createId('act'),
    actionType: type,
    enable: true,
    duration: 4
  }
  switch (type) {
    case 'flyTo':
      return { ...base, duration: 5, cameraParam: pose ? { ...pose } : defaultCameraPose() }
    case 'recordRoute':
      return { ...base, duration: 6, routeSamples: [] }
    case 'layerToggle':
      return { ...base, duration: 0.6, layerToggle: { layerId: 'poi', visible: false } }
    case 'timeAnimation':
      return { ...base, duration: 6, timeAnimation: { layerId: 'buildings', from: 0, to: 1 } }
    case 'subtitle':
      return { ...base, duration: 4, subtitle: defaultSubtitle() }
    case 'sceneEffect':
      return { ...base, duration: 0.6, sceneEffect: { effect: 'shadows', enabled: true, value: 0.0002 } }
    default:
      return base
  }
}

export function createStep(index: number): PresentationStep {
  return {
    stepId: createId('step'),
    stepName: `步骤 ${index}`,
    duration: 6,
    speedRate: 1,
    stayTime: 1,
    transition: 1,
    actions: []
  }
}

export function createProject(name = '园区三维演示汇报'): PresentationProject {
  const now = new Date().toISOString()
  return {
    type: 'cesium-presentation',
    schemaVersion: 1,
    id: createId('presentation'),
    name,
    description: '基于 Step + Action 结构的三维场景演示漫游方案',
    createTime: now,
    updateTime: now,
    initialCamera: defaultCameraPose(),
    layerStates: defaultLayerStates(),
    sceneState: defaultSceneState(),
    steps: [createStep(1)]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizePose(raw: unknown, fallback: CameraPose): CameraPose {
  if (!isRecord(raw)) return { ...fallback }
  return {
    longitude: numberOr(raw.longitude, fallback.longitude),
    latitude: clamp(numberOr(raw.latitude, fallback.latitude), -85, 85),
    height: clamp(numberOr(raw.height, fallback.height), 1, 30_000_000),
    heading: numberOr(raw.heading, fallback.heading),
    pitch: clamp(numberOr(raw.pitch, fallback.pitch), -89, 89),
    roll: numberOr(raw.roll, fallback.roll),
    fov: clamp(numberOr(raw.fov, fallback.fov ?? 60), 20, 110)
  }
}

function normalizeRoute(raw: unknown): RouteSample[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 1200).map((item, index) => {
    const pose = normalizePose(item, defaultCameraPose())
    return { ...pose, t: numberOr(isRecord(item) ? item.t : undefined, index) }
  })
}

function normalizeAction(raw: unknown): PresentationAction | null {
  if (!isRecord(raw)) return null
  const actionType = stringOr(raw.actionType, 'flyTo') as ActionType
  if (!(actionType in ACTION_LABELS)) return null
  const action: PresentationAction = {
    actionId: stringOr(raw.actionId, createId('act')),
    actionType,
    enable: booleanOr(raw.enable, true),
    duration: clamp(numberOr(raw.duration, 3), 0.1, 3600)
  }
  if (actionType === 'flyTo') {
    action.cameraParam = normalizePose(raw.cameraParam, defaultCameraPose())
  } else if (actionType === 'recordRoute') {
    action.routeSamples = normalizeRoute(raw.routeSamples)
  } else if (actionType === 'layerToggle') {
    const source = isRecord(raw.layerToggle) ? raw.layerToggle : {}
    action.layerToggle = {
      layerId: stringOr(source.layerId, 'poi'),
      visible: booleanOr(source.visible, false)
    }
  } else if (actionType === 'timeAnimation') {
    const source = isRecord(raw.timeAnimation) ? raw.timeAnimation : {}
    action.timeAnimation = {
      layerId: stringOr(source.layerId, 'buildings'),
      from: clamp(numberOr(source.from, 0), 0, 1),
      to: clamp(numberOr(source.to, 1), 0, 1)
    }
  } else if (actionType === 'subtitle') {
    const source = isRecord(raw.subtitle) ? raw.subtitle : {}
    const position = stringOr(source.position, 'bottom') as SubtitlePosition
    action.subtitle = {
      mode: stringOr(source.mode, 'fullscreen') === 'callout' ? 'callout' : 'fullscreen',
      text: stringOr(source.text, ''),
      subtext: stringOr(source.subtext, ''),
      position: position in POSITION_LABELS ? position : 'bottom',
      fontSize: clamp(numberOr(source.fontSize, 30), 12, 96),
      color: stringOr(source.color, '#ffffff'),
      background: booleanOr(source.background, true),
      anchorId: stringOr(source.anchorId, 'poi')
    }
  } else if (actionType === 'sceneEffect') {
    const source = isRecord(raw.sceneEffect) ? raw.sceneEffect : {}
    const effect = stringOr(source.effect, 'shadows') as SceneEffectType
    action.sceneEffect = {
      effect: effect in EFFECT_LABELS ? effect : 'shadows',
      enabled: booleanOr(source.enabled, true),
      value: clamp(numberOr(source.value, 0.0002), 0, 0.02)
    }
  }
  return action
}

function normalizeStep(raw: unknown, index: number): PresentationStep {
  const source = isRecord(raw) ? raw : {}
  const actions = Array.isArray(source.actions)
    ? source.actions.map(normalizeAction).filter((item): item is PresentationAction => item !== null)
    : []
  return {
    stepId: stringOr(source.stepId, createId('step')),
    stepName: stringOr(source.stepName, `步骤 ${index + 1}`),
    duration: clamp(numberOr(source.duration, 6), 0.5, 3600),
    speedRate: clamp(numberOr(source.speedRate, 1), 0.1, 8),
    stayTime: clamp(numberOr(source.stayTime, 1), 0, 600),
    transition: clamp(numberOr(source.transition, 1), 0, 10),
    actions
  }
}

export function normalizeProject(raw: unknown): PresentationProject {
  if (!isRecord(raw)) throw new Error('演示工程文件格式不正确')
  if (raw.type !== 'cesium-presentation') throw new Error('该文件不是有效的演示工程')
  const fallback = createProject()
  const layerStates = defaultLayerStates()
  if (isRecord(raw.layerStates)) {
    for (const layer of LAYER_DEFINITIONS) {
      layerStates[layer.id] = booleanOr(raw.layerStates[layer.id], layerStates[layer.id])
    }
  }
  const sceneSource = isRecord(raw.sceneState) ? raw.sceneState : {}
  const steps = Array.isArray(raw.steps) && raw.steps.length > 0
    ? raw.steps.slice(0, 200).map((step, index) => normalizeStep(step, index))
    : [createStep(1)]
  return {
    type: 'cesium-presentation',
    schemaVersion: 1,
    id: stringOr(raw.id, createId('presentation')),
    name: stringOr(raw.name, fallback.name),
    description: stringOr(raw.description, ''),
    createTime: stringOr(raw.createTime, fallback.createTime),
    updateTime: stringOr(raw.updateTime, new Date().toISOString()),
    initialCamera: normalizePose(raw.initialCamera, defaultCameraPose()),
    layerStates,
    sceneState: {
      shadows: booleanOr(sceneSource.shadows, false),
      lighting: booleanOr(sceneSource.lighting, false),
      fog: booleanOr(sceneSource.fog, false),
      fogDensity: clamp(numberOr(sceneSource.fogDensity, 0.0002), 0, 0.02),
      atmosphere: booleanOr(sceneSource.atmosphere, true)
    },
    steps
  }
}

export function cloneProject(project: PresentationProject, name?: string): PresentationProject {
  const now = new Date().toISOString()
  const copy = JSON.parse(JSON.stringify(project)) as PresentationProject
  copy.id = createId('presentation')
  copy.name = name ?? `${project.name} 副本`
  copy.createTime = now
  copy.updateTime = now
  copy.steps = copy.steps.map((step) => ({
    ...step,
    stepId: createId('step'),
    actions: step.actions.map((action) => ({ ...action, actionId: createId('act') }))
  }))
  return normalizeProject(copy)
}

export function serializeProject(project: PresentationProject): string {
  return `${JSON.stringify({ ...project, updateTime: new Date().toISOString() }, null, 2)}\n`
}

export function parseProjectFile(text: string): PresentationProject {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('工程文件不是合法 JSON')
  }
  return normalizeProject(raw)
}

export function actionSummary(action: PresentationAction): string {
  switch (action.actionType) {
    case 'flyTo': {
      const pose = action.cameraParam
      if (!pose) return '未设置视角'
      return `${pose.longitude.toFixed(4)}, ${pose.latitude.toFixed(4)} · ${Math.round(pose.height)} m`
    }
    case 'recordRoute':
      return action.routeSamples?.length ? `${action.routeSamples.length} 个航线采样点` : '尚未录制航线'
    case 'layerToggle': {
      const param = action.layerToggle
      const layer = LAYER_DEFINITIONS.find((item) => item.id === param?.layerId)
      return `${layer?.name ?? param?.layerId ?? '图层'} ${param?.visible ? '显示' : '隐藏'}`
    }
    case 'timeAnimation': {
      const param = action.timeAnimation
      return `进度 ${Math.round((param?.from ?? 0) * 100)}% → ${Math.round((param?.to ?? 1) * 100)}%`
    }
    case 'subtitle':
      return action.subtitle?.text?.slice(0, 24) || '空字幕'
    case 'sceneEffect': {
      const param = action.sceneEffect
      return `${param ? EFFECT_LABELS[param.effect] : '效果'} ${param?.enabled ? '开启' : '关闭'}`
    }
    default:
      return ''
  }
}

export function stepActionSeconds(step: PresentationStep): number {
  return step.actions.reduce((sum, action) => sum + (action.enable ? action.duration : 0), 0) / step.speedRate
}

export function stepEffectiveSeconds(step: PresentationStep): number {
  return Math.max(step.duration / step.speedRate, stepActionSeconds(step) + step.stayTime / step.speedRate)
}

export function projectDuration(project: PresentationProject): number {
  return project.steps.reduce((sum, step) => sum + stepEffectiveSeconds(step), 0)
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const METERS_PER_DEG_LAT = 111_320

function offsetFromSite(east: number, north: number): { longitude: number; latitude: number } {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((SITE_CENTER.latitude * Math.PI) / 180)
  return {
    longitude: SITE_CENTER.longitude + east / metersPerDegLon,
    latitude: SITE_CENTER.latitude + north / METERS_PER_DEG_LAT
  }
}

function sitePose(east: number, north: number, height: number, headingOffset = 0, fov = 60): CameraPose {
  const { longitude, latitude } = offsetFromSite(east, north)
  const horizontal = Math.max(1, Math.hypot(east, north))
  const heading = (Math.atan2(east, north) * 180) / Math.PI + 180 + headingOffset
  const pitch = (-Math.atan2(height, horizontal) * 180) / Math.PI
  return { longitude, latitude, height, heading, pitch: Math.max(-85, pitch), roll: 0, fov }
}

export function createSampleProject(): PresentationProject {
  const base = createProject('园区三维演示汇报')

  const routeSamples: RouteSample[] = Array.from({ length: 28 }, (_, index) => {
    const t = index / 27
    const angle = (-55 + t * 115) * (Math.PI / 180)
    const radius = 460 - t * 190
    const height = 360 - t * 130
    const { longitude, latitude } = offsetFromSite(Math.cos(angle) * radius, Math.sin(angle) * radius)
    return {
      longitude,
      latitude,
      height,
      heading: 270 - (angle * 180) / Math.PI,
      pitch: (-Math.atan2(height, radius) * 180) / Math.PI,
      roll: 0,
      fov: 58,
      t
    }
  })

  base.description = '覆盖全局概览、分区解读、建设时序、低空巡检与成果总结的完整演示脚本'
  base.initialCamera = sitePose(-900, -1000, 1500, 8, 60)

  const overview = createStep(1)
  overview.stepName = '全局概览'
  overview.duration = 10
  overview.stayTime = 2
  overview.transition = 1.6
  overview.actions = [
    {
      ...createAction('sceneEffect'),
      duration: 0.6,
      sceneEffect: { effect: 'lighting', enabled: true, value: 0.0002 }
    },
    {
      ...createAction('subtitle'),
      duration: 7,
      subtitle: {
        ...defaultSubtitle(),
        text: '园区三维演示汇报',
        subtext: 'Cesium Presentation · Step + Action 编排',
        position: 'bottom',
        fontSize: 34
      }
    },
    {
      ...createAction('flyTo', sitePose(0, -620, 900, 0, 62)),
      duration: 7
    }
  ]

  const zoning = createStep(2)
  zoning.stepName = '规划分区解读'
  zoning.duration = 9
  zoning.stayTime = 1.5
  zoning.transition = 1.2
  zoning.actions = [
    {
      ...createAction('layerToggle'),
      duration: 0.6,
      layerToggle: { layerId: 'rings', visible: false }
    },
    {
      ...createAction('flyTo', sitePose(-520, -430, 560, 0, 60)),
      duration: 6
    },
    {
      ...createAction('subtitle'),
      duration: 6,
      subtitle: {
        ...defaultSubtitle(),
        text: '三区联动 · 功能分区',
        subtext: '中央商务区 / 科创研发区 / 生态休闲区',
        position: 'left',
        fontSize: 28
      }
    }
  ]

  const construction = createStep(3)
  construction.stepName = '建设进度时序'
  construction.duration = 10
  construction.stayTime = 2
  construction.transition = 1.2
  construction.actions = [
    {
      ...createAction('layerToggle'),
      duration: 0.6,
      layerToggle: { layerId: 'zones', visible: false }
    },
    {
      ...createAction('layerToggle'),
      duration: 0.6,
      layerToggle: { layerId: 'buildings', visible: true }
    },
    {
      ...createAction('flyTo', sitePose(-280, -240, 235, 0, 62)),
      duration: 5
    },
    {
      ...createAction('timeAnimation'),
      duration: 8,
      timeAnimation: { layerId: 'buildings', from: 0, to: 1 }
    },
    {
      ...createAction('subtitle'),
      duration: 8,
      subtitle: {
        ...defaultSubtitle(),
        text: '建设进度演进',
        subtext: '时序驱动 0% → 100%',
        position: 'right',
        fontSize: 26
      }
    }
  ]

  const patrol = createStep(4)
  patrol.stepName = '低空巡检航线'
  patrol.duration = 12
  patrol.stayTime = 2
  patrol.transition = 1.4
  patrol.actions = [
    {
      ...createAction('layerToggle'),
      duration: 0.6,
      layerToggle: { layerId: 'route', visible: true }
    },
    {
      ...createAction('sceneEffect'),
      duration: 0.6,
      sceneEffect: { effect: 'fog', enabled: true, value: 0.00012 }
    },
    {
      ...createAction('recordRoute'),
      duration: 10,
      routeSamples
    },
    {
      ...createAction('subtitle'),
      duration: 10,
      subtitle: {
        ...defaultSubtitle(),
        text: '低空巡检漫游',
        subtext: '录制相机轨迹并平滑回放',
        position: 'top',
        fontSize: 26
      }
    }
  ]

  const summary = createStep(5)
  summary.stepName = '成果总结'
  summary.duration = 9
  summary.stayTime = 2.5
  summary.transition = 1.6
  summary.actions = [
    {
      ...createAction('sceneEffect'),
      duration: 0.6,
      sceneEffect: { effect: 'fog', enabled: false, value: 0.00012 }
    },
    {
      ...createAction('layerToggle'),
      duration: 0.6,
      layerToggle: { layerId: 'rings', visible: true }
    },
    {
      ...createAction('flyTo', sitePose(-880, -920, 1150, 6, 60)),
      duration: 6
    },
    {
      ...createAction('subtitle'),
      duration: 7,
      subtitle: {
        ...defaultSubtitle(),
        text: '演示完成 · 一键视频导出',
        subtext: '支持 1080P / 2K / 4K，30 / 60 FPS',
        position: 'bottom',
        fontSize: 30
      }
    }
  ]

  base.steps = [overview, zoning, construction, patrol, summary]
  return base
}
