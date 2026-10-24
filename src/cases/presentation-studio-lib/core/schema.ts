import {
  DEFAULT_EFFECTS,
  DEFAULT_LAYERS,
  DEFAULT_TIME,
  LANDMARK_MAP,
  createAction,
  createEmptyRoute,
  createStep,
  nowIso
} from './defaults'
import { normalizeProject } from './normalize'
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type CameraPose,
  type EffectSnapshot,
  type LayerSnapshot,
  type PresentationAction,
  type PresentationProject,
  type PresentationStep,
  type StepTransition,
  type TimeSnapshot
} from './types'

export const STUDIO_FORMAT = 'cesium.studio' as const
export const STUDIO_SCHEMA_VERSION = 2 as const
export const PRESENTATION_FPS = 30 as const

export type UUID = string

export interface ProjectMetadata {
  title: string
  note: string
  createdAt: string
  updatedAt: string
  author?: string
  tags?: string[]
}

export interface SceneLayerDocument {
  id: UUID
  name: string
  kind: '3dtiles' | 'geojson'
  uri: string
  visible: boolean
  locked?: boolean
  opacity?: number
  extensions?: Record<string, unknown>
}

export interface SceneDocument {
  id: UUID
  name: string
  crs: string
  camera: CameraPose
  layers: LayerSnapshot
  effects: EffectSnapshot
  time: TimeSnapshot
  layerIds: UUID[]
  entityIds: UUID[]
  customLayers?: SceneLayerDocument[]
  extensions?: Record<string, unknown>
}

export type AssetKind = '3dtiles' | 'gltf' | 'geojson' | 'imagery' | 'terrain' | 'media' | 'unknown'

export interface AssetManifestEntry {
  id: UUID
  name: string
  kind: AssetKind
  uri: string
  hash?: string
  bytes?: number
  crs?: string
  bbox?: [number, number, number, number]
  license?: string
  source?: string
  required: boolean
  extensions?: Record<string, unknown>
}

export type ClipKind = 'camera' | 'layer' | 'entity' | 'effect' | 'overlay' | 'audio' | 'event'

export interface TimelineClipDocument {
  id: UUID
  kind: ClipKind
  startFrame: number
  durationFrames: number
  payload: Record<string, unknown>
  extensions?: Record<string, unknown>
}

export interface PresentationStepDocument {
  id: UUID
  name: string
  startFrame: number
  durationFrames: number
  activeDurationFrames: number
  stayFrames: number
  speedRate: number
  transition: StepTransition
  clips: TimelineClipDocument[]
  extensions?: Record<string, unknown>
}

export interface FrameRate {
  num: number
  den: number
}

export interface PresentationDocument {
  id: UUID
  name: string
  sceneId: UUID
  frameRate: FrameRate
  durationFrames: number
  steps: PresentationStepDocument[]
  extensions?: Record<string, unknown>
}

export type OutputFit = 'contain' | 'cover' | 'stretch'
export type OutputFormat = 'video' | 'frames' | 'web' | 'project'

export interface OutputPreset {
  id: UUID
  name: string
  width: number
  height: number
  fps: number
  fit: OutputFit
  background: string
  format: OutputFormat
  extensions?: Record<string, unknown>
}

export interface StudioProject {
  format: typeof STUDIO_FORMAT
  schemaVersion: typeof STUDIO_SCHEMA_VERSION
  id: UUID
  metadata: ProjectMetadata
  scenes: SceneDocument[]
  assets: AssetManifestEntry[]
  presentations: PresentationDocument[]
  outputs: OutputPreset[]
  extensions?: Record<string, unknown>
}

const DAYANTA_TILESET_URI = 'dayanta/tileset.json'

const MAX_SECONDS = 600
const MIN_SECONDS = 0.05

export function toFrames(seconds: number, fps: number = PRESENTATION_FPS): number {
  if (!Number.isFinite(seconds)) return 1
  const raw = Math.round(seconds * fps)
  return Math.max(1, raw)
}

export function toSeconds(frames: number, fps: number = PRESENTATION_FPS): number {
  if (!Number.isFinite(frames)) return 0
  return Math.max(0, frames / Math.max(1, fps))
}

function actionKind(action: PresentationAction): ClipKind {
  switch (action.actionType) {
    case 'flyTo':
    case 'recordRoute':
      return 'camera'
    case 'layerToggle':
      return 'layer'
    case 'timeAnimation':
      return 'entity'
    case 'sceneEffect':
      return 'effect'
    case 'subtitle':
    case 'popup':
      return 'overlay'
    default:
      return 'event'
  }
}

function actionPayload(action: PresentationAction): Record<string, unknown> {
  return JSON.parse(JSON.stringify(action)) as Record<string, unknown>
}

function clipFromAction(action: PresentationAction, startFrame: number, durationFrames: number): TimelineClipDocument {
  return {
    id: action.actionId,
    kind: actionKind(action),
    startFrame,
    durationFrames,
    payload: actionPayload(action)
  }
}

function assetEntriesFor(project: PresentationProject): AssetManifestEntry[] {
  const entries: AssetManifestEntry[] = [
    {
      id: 'asset_dayanta_tileset',
      name: '大雁塔 3D Tiles',
      kind: '3dtiles',
      uri: DAYANTA_TILESET_URI,
      crs: 'EPSG:4326',
      license: '项目内置示例资源',
      source: 'public/dayanta',
      required: false
    }
  ]
  if (
    project.steps.some((step) =>
      step.actions.some((action) => action.actionType === 'recordRoute' && action.route.samples.length > 0)
    )
  ) {
    entries.push({
      id: 'asset_route_samples',
      name: '内置航线采样',
      kind: 'geojson',
      uri: 'studio://presentations/current/routes',
      required: false,
      license: '工程内嵌'
    })
  }
  for (const layer of project.customLayers ?? []) {
    if (!layer.uri.trim() || layer.uri.startsWith('studio://')) continue
    entries.push({
      id: `asset_${layer.id}`,
      name: layer.name,
      kind: layer.kind,
      uri: layer.uri,
      required: true,
      source: 'scene-layer',
      license: '由工程维护者提供'
    })
  }
  return entries
}

export function runtimeToDocument(project: PresentationProject): StudioProject {
  const sceneId = `scene_${project.id}`
  const presentationId = `pres_${project.id}`
  const scene: SceneDocument = {
    id: sceneId,
    name: '主场景',
    crs: 'EPSG:4326',
    camera: { ...project.initial.camera },
    layers: { ...project.initial.layers },
    effects: { ...project.initial.effects },
    time: { ...project.initial.time },
    layerIds: Object.entries(project.initial.layers)
      .filter(([, visible]) => visible)
      .map(([id]) => `layer_${id}`),
    entityIds: project.steps
      .flatMap((step) => step.actions)
      .flatMap((action) => {
        if (action.actionType === 'flyTo') return action.targetId ? [`entity_${action.targetId}`] : []
        if (action.actionType === 'popup') return action.popup.targetId ? [`entity_${action.popup.targetId}`] : []
        return []
      }),
    customLayers: (project.customLayers ?? []).map((layer) => ({
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      uri: layer.uri,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity
    }))
  }
  let cursorFrame = 0
  const steps: PresentationStepDocument[] = project.steps.map((step) => {
    const startFrame = cursorFrame
    let clipCursor = 0
    const clips: TimelineClipDocument[] = []
    for (const action of step.actions) {
      if (!action.enable) continue
      const cameraAction = action.actionType === 'flyTo' || action.actionType === 'recordRoute'
      const speed = cameraAction ? Math.min(4, Math.max(0.25, step.speedRate)) : 1
      const durationFrames = toFrames(Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, action.duration / speed)))
      const explicitStart = typeof action.start === 'number' && Number.isFinite(action.start)
      const clipStart = explicitStart ? Math.max(0, Math.round(action.start! * PRESENTATION_FPS)) : clipCursor
      clips.push(clipFromAction(action, clipStart, durationFrames))
      clipCursor = Math.max(clipCursor, clipStart + durationFrames)
    }
    const activeDurationFrames = Math.max(toFrames(Math.min(MAX_SECONDS, Math.max(0.5, step.duration))), clipCursor)
    const stayFrames = toFrames(Math.min(60, Math.max(0, step.stayTime)))
    const document: PresentationStepDocument = {
      id: step.stepId,
      name: step.stepName,
      startFrame,
      durationFrames: activeDurationFrames,
      activeDurationFrames,
      stayFrames,
      speedRate: step.speedRate,
      transition: { ...step.transition },
      clips
    }
    cursorFrame += activeDurationFrames + stayFrames
    return document
  })
  return {
    format: STUDIO_FORMAT,
    schemaVersion: STUDIO_SCHEMA_VERSION,
    id: project.id,
    metadata: {
      title: project.name,
      note: project.note,
      createdAt: project.createTime,
      updatedAt: project.updateTime
    },
    scenes: [scene],
    assets: assetEntriesFor(project),
    presentations: [
      {
        id: presentationId,
        name: project.name,
        sceneId,
        frameRate: { num: PRESENTATION_FPS, den: 1 },
        durationFrames: cursorFrame,
        steps
      }
    ],
    outputs: [
      {
        id: 'output_1080p30_fast',
        name: '1080P 实时快速导出',
        width: 1920,
        height: 1080,
        fps: 30,
        fit: 'contain',
        background: '#040a12',
        format: 'video'
      },
      {
        id: 'output_1080p30_frames',
        name: '1080P 确定性逐帧序列',
        width: 1920,
        height: 1080,
        fps: 30,
        fit: 'contain',
        background: '#040a12',
        format: 'frames'
      }
    ],
    extensions: project.extensions ? { runtime: project.extensions } : undefined
  }
}

function pickRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function actionFromClip(
  clip: TimelineClipDocument,
  fallbackType: PresentationAction['actionType']
): PresentationAction {
  const payload = pickRecord(clip.payload)
  const type =
    typeof payload.actionType === 'string' ? (payload.actionType as PresentationAction['actionType']) : fallbackType
  const fallback = createAction(type)
  return {
    ...fallback,
    ...payload,
    actionId: typeof payload.actionId === 'string' ? payload.actionId : clip.id
  } as PresentationAction
}

function clipFallbackType(kind: ClipKind): PresentationAction['actionType'] {
  if (kind === 'camera') return 'flyTo'
  if (kind === 'layer') return 'layerToggle'
  if (kind === 'entity') return 'timeAnimation'
  if (kind === 'effect') return 'sceneEffect'
  if (kind === 'overlay') return 'subtitle'
  return 'flyTo'
}

export function documentToRuntime(document: StudioProject): PresentationProject {
  const scene = document.scenes[0]
  const presentation = document.presentations[0]
  if (!scene || !presentation) throw new Error('工程缺少场景或演示文档')
  const framesPerSecond = presentation.frameRate.num / Math.max(1, presentation.frameRate.den)
  const fps = framesPerSecond > 0 ? framesPerSecond : PRESENTATION_FPS
  const runtimeExtensions = pickRecord(document.extensions?.runtime)
  const steps: PresentationStep[] = presentation.steps.map((stepDocument) => {
    const duration = Math.min(MAX_SECONDS, Math.max(0.5, toSeconds(stepDocument.activeDurationFrames, fps)))
    let cursorFrame = 0
    const actions = [...stepDocument.clips]
      .sort((left, right) => left.startFrame - right.startFrame)
      .map((clip) => {
        const action = actionFromClip(clip, clipFallbackType(clip.kind))
        const clipStart = Math.max(0, Math.round(Number(clip.startFrame) || 0))
        if (clipStart !== cursorFrame) action.start = toSeconds(clipStart, fps)
        else delete action.start
        const durationFrames = Math.max(1, Math.round(Number(clip.durationFrames) || 1))
        cursorFrame = Math.max(cursorFrame, clipStart + durationFrames)
        return action
      })
    const step: PresentationStep = {
      stepId: stepDocument.id || createStep().stepId,
      stepName: stepDocument.name || '未命名步骤',
      duration,
      speedRate: Number.isFinite(stepDocument.speedRate) ? stepDocument.speedRate : 1,
      stayTime: toSeconds(stepDocument.stayFrames, fps),
      transition: { ...stepDocument.transition },
      actions
    }
    return step
  })
  if (!steps.length) steps.push(createStep(1))
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: document.id,
    name: document.metadata.title || '未命名演示',
    note: document.metadata.note ?? '',
    createTime: document.metadata.createdAt || nowIso(),
    updateTime: document.metadata.updatedAt || nowIso(),
    initial: {
      camera: { ...scene.camera },
      layers: { ...(scene.layers ?? DEFAULT_LAYERS) },
      effects: { ...(scene.effects ?? DEFAULT_EFFECTS) },
      time: { ...(scene.time ?? DEFAULT_TIME) }
    },
    steps,
    customLayers: (scene.customLayers ?? []).map((layer) => ({
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      uri: layer.uri,
      visible: layer.visible !== false,
      locked: layer.locked === true,
      opacity: Math.min(1, Math.max(0, Number(layer.opacity ?? 1)))
    })),
    extensions: Object.keys(runtimeExtensions).length ? runtimeExtensions : undefined
  }
}

function isLegacyEditorProject(raw: unknown): boolean {
  const record = pickRecord(raw)
  return record.type === 'cesium-presentation' && record.schemaVersion === 1
}

function isStudioDocument(raw: unknown): boolean {
  const record = pickRecord(raw)
  return record.format === STUDIO_FORMAT && record.schemaVersion === STUDIO_SCHEMA_VERSION
}

function isRuntimeProject(raw: unknown): boolean {
  const record = pickRecord(raw)
  return record.format === PROJECT_FORMAT && record.version === PROJECT_VERSION
}

function normalizeLegacyCamera(raw: unknown): CameraPose {
  const source = pickRecord(raw)
  return {
    longitude: Number(source.longitude ?? 116.3915),
    latitude: Number(source.latitude ?? 39.9075),
    height: Number(source.height ?? 1200),
    heading: Number(source.heading ?? 0),
    pitch: Number(source.pitch ?? -35),
    roll: Number(source.roll ?? 0),
    fov: Number(source.fov ?? 60)
  }
}

function normalizeLegacyTransition(raw: unknown): StepTransition {
  if (typeof raw === 'number') {
    return { type: raw > 0 ? 'fade' : 'none', duration: Math.max(0, raw) }
  }
  const source = pickRecord(raw)
  const type = source.type === 'dip' || source.type === 'slide' || source.type === 'none' ? source.type : 'fade'
  return { type, duration: Number(source.duration ?? 0) }
}

export function migrateLegacyEditorProject(raw: unknown): PresentationProject {
  const source = pickRecord(raw)
  const initialCamera = normalizeLegacyCamera(source.initialCamera)
  const layerStates = pickRecord(source.layerStates)
  const sceneState = pickRecord(source.sceneState)
  const layers: LayerSnapshot = {
    imagery: true,
    terrain: Boolean(sceneState.terrain ?? true),
    dayanta: Boolean(layerStates.buildings ?? true),
    landmarks: Boolean(layerStates.poi ?? true),
    beacons: Boolean(layerStates.rings ?? false),
    route: Boolean(layerStates.route ?? false)
  }
  const effects: EffectSnapshot = {
    shadows: Boolean(sceneState.shadows ?? true),
    lighting: Boolean(sceneState.lighting ?? true),
    fog: Boolean(sceneState.fog ?? false),
    atmosphere: Boolean(sceneState.atmosphere ?? true),
    contour: false,
    slope: false
  }
  const rawSteps = Array.isArray(source.steps) ? source.steps : []
  const steps: PresentationStep[] = rawSteps.map((rawStep, stepIndex) => {
    const stepSource = pickRecord(rawStep)
    const rawActions = Array.isArray(stepSource.actions) ? stepSource.actions : []
    const actions: PresentationAction[] = []
    for (const rawAction of rawActions) {
      const actionSource = pickRecord(rawAction)
      const legacyType = String(actionSource.actionType ?? '')
      const base = createAction(legacyType === 'recordRoute' ? 'recordRoute' : 'flyTo')
      base.actionId =
        typeof actionSource.actionId === 'string' ? actionSource.actionId : `act_${stepIndex}_${actions.length}`
      base.enable = actionSource.enable !== false
      base.duration = Number(actionSource.duration ?? base.duration)
      if (legacyType === 'flyTo') {
        base.actionType = 'flyTo'
        if (base.actionType === 'flyTo') {
          base.camera = normalizeLegacyCamera(actionSource.cameraParam)
          base.targetId = null
        }
      } else if (legacyType === 'recordRoute') {
        base.actionType = 'recordRoute'
        if (base.actionType === 'recordRoute') {
          const samplesRaw = Array.isArray(actionSource.routeSamples) ? actionSource.routeSamples : []
          const route = createEmptyRoute()
          route.samples = samplesRaw.map((sample, sampleIndex) => {
            const pose = normalizeLegacyCamera(sample)
            const sampleSource = pickRecord(sample)
            return {
              ...pose,
              t: Number(sampleSource.t ?? (samplesRaw.length <= 1 ? 0 : sampleIndex / (samplesRaw.length - 1)))
            }
          })
          route.recordedDuration = Math.max(1, Number(actionSource.duration ?? 4))
          base.route = route
        }
      } else if (legacyType === 'layerToggle') {
        base.actionType = 'layerToggle'
        if (base.actionType === 'layerToggle') {
          const toggle = pickRecord(actionSource.layerToggle)
          const visible = Boolean(toggle.visible)
          base.layers = { ...DEFAULT_LAYERS }
          const layerId = String(toggle.layerId ?? '')
          if (layerId === 'poi') base.layers.landmarks = visible
          else if (layerId === 'route') base.layers.route = visible
          else if (layerId === 'rings') base.layers.beacons = visible
          else if (layerId === 'buildings') base.layers.dayanta = visible
        }
      } else if (legacyType === 'timeAnimation') {
        base.actionType = 'timeAnimation'
        if (base.actionType === 'timeAnimation') {
          const param = pickRecord(actionSource.timeAnimation)
          base.target = 'dayanta'
          base.from = Number(param.from ?? 0)
          base.to = Number(param.to ?? 1)
        }
      } else if (legacyType === 'subtitle') {
        base.actionType = 'subtitle'
        if (base.actionType === 'subtitle') {
          const param = pickRecord(actionSource.subtitle)
          base.subtitle.title = typeof param.text === 'string' ? param.text.slice(0, 32) : base.subtitle.title
          base.subtitle.text = typeof param.subtext === 'string' ? param.subtext : base.subtitle.text
          base.subtitle.position = param.position === 'callout' ? 'callout' : base.subtitle.position
          base.subtitle.fontSize = Number(param.fontSize ?? base.subtitle.fontSize)
          base.subtitle.color = typeof param.color === 'string' ? param.color : base.subtitle.color
          base.subtitle.background = param.background ? 'dark' : 'none'
        }
      } else if (legacyType === 'sceneEffect') {
        base.actionType = 'sceneEffect'
        if (base.actionType === 'sceneEffect') {
          const param = pickRecord(actionSource.sceneEffect)
          base.effects = { ...DEFAULT_EFFECTS }
          const effect = String(param.effect ?? '')
          const enabled = Boolean(param.enabled)
          if (effect === 'shadows') base.effects.shadows = enabled
          else if (effect === 'lighting') base.effects.lighting = enabled
          else if (effect === 'fog') base.effects.fog = enabled
          else if (effect === 'atmosphere') base.effects.atmosphere = enabled
        }
      } else {
        continue
      }
      actions.push(base)
    }
    return {
      stepId: typeof stepSource.stepId === 'string' ? stepSource.stepId : `step_${stepIndex}`,
      stepName: typeof stepSource.stepName === 'string' ? stepSource.stepName : `步骤 ${stepIndex + 1}`,
      duration: Number(stepSource.duration ?? 8),
      speedRate: Number(stepSource.speedRate ?? 1),
      stayTime: Number(stepSource.stayTime ?? 0.4),
      transition: normalizeLegacyTransition(stepSource.transition),
      actions
    }
  })
  const now = nowIso()
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: typeof source.id === 'string' ? source.id : `prj_${Date.now()}`,
    name: typeof source.name === 'string' ? source.name : '未命名演示',
    note: typeof source.description === 'string' ? source.description : '',
    createTime: typeof source.createTime === 'string' ? source.createTime : now,
    updateTime: typeof source.updateTime === 'string' ? source.updateTime : now,
    initial: {
      camera: initialCamera,
      layers,
      effects,
      time: { ...DEFAULT_TIME }
    },
    steps: steps.length ? steps : [createStep(1)],
    customLayers: []
  }
}

export type ParsedProject = {
  project: PresentationProject
  document: StudioProject
  source: 'studio-v2' | 'studio-v1' | 'legacy-editor'
}

const ASSET_KINDS = new Set(['3dtiles', 'gltf', 'geojson', 'imagery', 'terrain', 'media', 'unknown'])
const CLIP_KINDS = new Set(['camera', 'layer', 'entity', 'effect', 'overlay', 'audio', 'event'])
const OUTPUT_FITS = new Set(['contain', 'cover', 'stretch'])
const OUTPUT_FORMATS = new Set(['video', 'frames', 'web', 'project'])

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validateCamera(raw: unknown, path: string, errors: string[]): void {
  const camera = pickRecord(raw)
  for (const key of ['longitude', 'latitude', 'height', 'heading', 'pitch', 'roll', 'fov']) {
    if (!isFiniteNumber(camera[key])) errors.push(`${path}.${key} 必须是有限数值`)
  }
  if (isFiniteNumber(camera.latitude) && (camera.latitude < -90 || camera.latitude > 90))
    errors.push(`${path}.latitude 超出 [-90, 90]`)
  if (isFiniteNumber(camera.height) && camera.height < -1000) errors.push(`${path}.height 不能低于 -1000`)
  if (isFiniteNumber(camera.fov) && (camera.fov <= 0 || camera.fov >= 180))
    errors.push(`${path}.fov 必须在 (0, 180) 内`)
}

/** 返回带字段路径的校验错误；空数组表示文档可安全进入运行时。 */
export function validateStudioDocument(raw: unknown): string[] {
  const errors: string[] = []
  const document = pickRecord(raw)
  if (document.format !== STUDIO_FORMAT) errors.push('format 必须为 cesium.studio')
  if (document.schemaVersion !== STUDIO_SCHEMA_VERSION) errors.push(`schemaVersion 必须为 ${STUDIO_SCHEMA_VERSION}`)
  if (typeof document.id !== 'string' || !document.id.trim()) errors.push('id 必须是非空字符串')
  const metadata = pickRecord(document.metadata)
  if (typeof metadata.title !== 'string' || !metadata.title.trim()) errors.push('metadata.title 必须是非空字符串')
  if (typeof metadata.createdAt !== 'string') errors.push('metadata.createdAt 必须是字符串')
  if (typeof metadata.updatedAt !== 'string') errors.push('metadata.updatedAt 必须是字符串')

  const sceneIds = new Set<string>()
  const scenes = Array.isArray(document.scenes) ? document.scenes : []
  if (!scenes.length) errors.push('scenes 至少需要一个场景')
  scenes.forEach((rawScene, index) => {
    const path = `scenes[${index}]`
    const scene = pickRecord(rawScene)
    if (typeof scene.id !== 'string' || !scene.id.trim()) errors.push(`${path}.id 必须是非空字符串`)
    else if (sceneIds.has(scene.id)) errors.push(`${path}.id 重复：${scene.id}`)
    else sceneIds.add(scene.id)
    if (typeof scene.name !== 'string') errors.push(`${path}.name 必须是字符串`)
    if (typeof scene.crs !== 'string' || !scene.crs.trim()) errors.push(`${path}.crs 必须是非空字符串`)
    validateCamera(scene.camera, `${path}.camera`, errors)
    const layers = pickRecord(scene.layers)
    for (const key of ['imagery', 'terrain', 'dayanta', 'landmarks', 'beacons', 'route']) {
      if (typeof layers[key] !== 'boolean') errors.push(`${path}.layers.${key} 必须是布尔值`)
    }
    const effects = pickRecord(scene.effects)
    for (const key of ['shadows', 'lighting', 'fog', 'atmosphere', 'contour', 'slope']) {
      if (typeof effects[key] !== 'boolean') errors.push(`${path}.effects.${key} 必须是布尔值`)
    }
    if (!Array.isArray(scene.layerIds) || scene.layerIds.some((id: unknown) => typeof id !== 'string')) {
      errors.push(`${path}.layerIds 必须是字符串数组`)
    }
    if (!Array.isArray(scene.entityIds) || scene.entityIds.some((id: unknown) => typeof id !== 'string')) {
      errors.push(`${path}.entityIds 必须是字符串数组`)
    }
    if (scene.customLayers !== undefined && !Array.isArray(scene.customLayers))
      errors.push(`${path}.customLayers 必须是数组`)
    const customLayers = Array.isArray(scene.customLayers) ? scene.customLayers : []
    const customIds = new Set<string>()
    customLayers.forEach((rawLayer: unknown, layerIndex: number) => {
      const layerPath = `${path}.customLayers[${layerIndex}]`
      const layer = pickRecord(rawLayer)
      if (typeof layer.id !== 'string' || !layer.id.trim()) errors.push(`${layerPath}.id 必须是非空字符串`)
      else if (customIds.has(layer.id)) errors.push(`${layerPath}.id 重复：${layer.id}`)
      else customIds.add(layer.id)
      if (typeof layer.name !== 'string' || !layer.name.trim()) errors.push(`${layerPath}.name 必须是非空字符串`)
      if (layer.kind !== '3dtiles' && layer.kind !== 'geojson')
        errors.push(`${layerPath}.kind 必须为 3dtiles 或 geojson`)
      if (typeof layer.uri !== 'string' || !layer.uri.trim()) errors.push(`${layerPath}.uri 必须是非空字符串`)
      if (typeof layer.visible !== 'boolean') errors.push(`${layerPath}.visible 必须是布尔值`)
      if (layer.opacity !== undefined && (!isFiniteNumber(layer.opacity) || layer.opacity < 0 || layer.opacity > 1)) {
        errors.push(`${layerPath}.opacity 必须在 [0, 1] 内`)
      }
    })
  })

  const assetIds = new Set<string>()
  const assets = Array.isArray(document.assets) ? document.assets : []
  if (!Array.isArray(document.assets)) errors.push('assets 必须是数组')
  assets.forEach((rawAsset, index) => {
    const path = `assets[${index}]`
    const asset = pickRecord(rawAsset)
    if (typeof asset.id !== 'string' || !asset.id.trim()) errors.push(`${path}.id 必须是非空字符串`)
    else if (assetIds.has(asset.id)) errors.push(`${path}.id 重复：${asset.id}`)
    else assetIds.add(asset.id)
    if (typeof asset.name !== 'string' || !asset.name.trim()) errors.push(`${path}.name 必须是非空字符串`)
    if (typeof asset.kind !== 'string' || !ASSET_KINDS.has(asset.kind)) errors.push(`${path}.kind 不合法`)
    if (typeof asset.uri !== 'string' || !asset.uri.trim()) errors.push(`${path}.uri 必须是非空字符串`)
    if (typeof asset.required !== 'boolean') errors.push(`${path}.required 必须是布尔值`)
    if (asset.bytes !== undefined && (!isFiniteNumber(asset.bytes) || asset.bytes < 0))
      errors.push(`${path}.bytes 必须是非负数值`)
  })

  const presentations = Array.isArray(document.presentations) ? document.presentations : []
  if (!presentations.length) errors.push('presentations 至少需要一个演示')
  const presentationIds = new Set<string>()
  const stepIds = new Set<string>()
  presentations.forEach((rawPresentation, presentationIndex) => {
    const path = `presentations[${presentationIndex}]`
    const presentation = pickRecord(rawPresentation)
    if (typeof presentation.id !== 'string' || !presentation.id.trim()) errors.push(`${path}.id 必须是非空字符串`)
    else if (presentationIds.has(presentation.id)) errors.push(`${path}.id 重复：${presentation.id}`)
    else presentationIds.add(presentation.id)
    if (typeof presentation.name !== 'string') errors.push(`${path}.name 必须是字符串`)
    if (typeof presentation.sceneId !== 'string' || !sceneIds.has(presentation.sceneId))
      errors.push(`${path}.sceneId 未指向已声明场景`)
    const frameRate = pickRecord(presentation.frameRate)
    if (!isFiniteNumber(frameRate.num) || frameRate.num <= 0) errors.push(`${path}.frameRate.num 必须大于 0`)
    if (!isFiniteNumber(frameRate.den) || frameRate.den <= 0) errors.push(`${path}.frameRate.den 必须大于 0`)
    if (!isFiniteNumber(presentation.durationFrames) || presentation.durationFrames < 0)
      errors.push(`${path}.durationFrames 必须是非负数值`)
    if (!Array.isArray(presentation.steps) || !presentation.steps.length) errors.push(`${path}.steps 至少需要一个步骤`)
    const steps = Array.isArray(presentation.steps) ? presentation.steps : []
    steps.forEach((rawStep, stepIndex) => {
      const stepPath = `${path}.steps[${stepIndex}]`
      const step = pickRecord(rawStep)
      if (typeof step.id !== 'string' || !step.id.trim()) errors.push(`${stepPath}.id 必须是非空字符串`)
      else if (stepIds.has(step.id)) errors.push(`${stepPath}.id 重复：${step.id}`)
      else stepIds.add(step.id)
      if (typeof step.name !== 'string') errors.push(`${stepPath}.name 必须是字符串`)
      for (const key of ['startFrame', 'durationFrames', 'activeDurationFrames', 'stayFrames']) {
        if (!isFiniteNumber(step[key]) || step[key] < 0) errors.push(`${stepPath}.${key} 必须是非负数值`)
      }
      if (!isFiniteNumber(step.speedRate) || step.speedRate <= 0) errors.push(`${stepPath}.speedRate 必须大于 0`)
      const clips = Array.isArray(step.clips) ? step.clips : []
      if (!Array.isArray(step.clips)) errors.push(`${stepPath}.clips 必须是数组`)
      const clipIds = new Set<string>()
      clips.forEach((rawClip, clipIndex) => {
        const clipPath = `${stepPath}.clips[${clipIndex}]`
        const clip = pickRecord(rawClip)
        if (typeof clip.id !== 'string' || !clip.id.trim()) errors.push(`${clipPath}.id 必须是非空字符串`)
        else if (clipIds.has(clip.id)) errors.push(`${clipPath}.id 重复：${clip.id}`)
        else clipIds.add(clip.id)
        if (typeof clip.kind !== 'string' || !CLIP_KINDS.has(clip.kind)) errors.push(`${clipPath}.kind 不合法`)
        if (!isFiniteNumber(clip.startFrame) || clip.startFrame < 0)
          errors.push(`${clipPath}.startFrame 必须是非负数值`)
        if (!isFiniteNumber(clip.durationFrames) || clip.durationFrames <= 0)
          errors.push(`${clipPath}.durationFrames 必须大于 0`)
        if (!clip.payload || typeof clip.payload !== 'object' || Array.isArray(clip.payload))
          errors.push(`${clipPath}.payload 必须是对象`)
      })
    })
  })

  const outputs = Array.isArray(document.outputs) ? document.outputs : []
  if (!Array.isArray(document.outputs)) errors.push('outputs 必须是数组')
  outputs.forEach((rawOutput, index) => {
    const path = `outputs[${index}]`
    const output = pickRecord(rawOutput)
    if (!isFiniteNumber(output.width) || output.width <= 0) errors.push(`${path}.width 必须大于 0`)
    if (!isFiniteNumber(output.height) || output.height <= 0) errors.push(`${path}.height 必须大于 0`)
    if (!isFiniteNumber(output.fps) || output.fps <= 0) errors.push(`${path}.fps 必须大于 0`)
    if (typeof output.fit !== 'string' || !OUTPUT_FITS.has(output.fit)) errors.push(`${path}.fit 不合法`)
    if (typeof output.format !== 'string' || !OUTPUT_FORMATS.has(output.format)) errors.push(`${path}.format 不合法`)
  })
  return errors
}

export function parseProjectDocument(raw: unknown): ParsedProject {
  if (isStudioDocument(raw)) {
    const document = raw as StudioProject
    const errors = validateStudioDocument(document)
    if (errors.length) {
      throw new Error(
        `工程文档校验失败：${errors.slice(0, 5).join('；')}${errors.length > 5 ? `；另有 ${errors.length - 5} 处` : ''}`
      )
    }
    const project = documentToRuntime(document)
    return { project, document: runtimeToDocument(project), source: 'studio-v2' }
  }
  if (isLegacyEditorProject(raw)) {
    const project = migrateLegacyEditorProject(raw)
    return { project, document: runtimeToDocument(project), source: 'legacy-editor' }
  }
  if (isRuntimeProject(raw)) {
    const record = pickRecord(raw)
    if (Number(record.version) > PROJECT_VERSION) {
      throw new Error(`工程版本 ${String(record.version)} 高于当前支持的 v${PROJECT_VERSION}，已拒绝破坏性覆盖`)
    }
    const project = normalizeProject(raw)
    return { project, document: runtimeToDocument(project), source: 'studio-v1' }
  }
  const record = pickRecord(raw)
  if (typeof record.schemaVersion === 'number' && record.schemaVersion > STUDIO_SCHEMA_VERSION) {
    throw new Error(`工程 schemaVersion ${record.schemaVersion} 高于当前支持的 v${STUDIO_SCHEMA_VERSION}`)
  }
  const project = normalizeProject(raw)
  return { project, document: runtimeToDocument(project), source: 'studio-v1' }
}

export function serializeDocument(document: StudioProject): string {
  return JSON.stringify(document, null, 2)
}

export function projectMatchesDocument(project: PresentationProject, document: StudioProject): boolean {
  return JSON.stringify(runtimeToDocument(project)) === JSON.stringify(document)
}

export function targetFromId(targetId: string | null): CameraPose | null {
  if (!targetId) return null
  const landmark = LANDMARK_MAP[targetId]
  return landmark ? { ...landmark.camera } : null
}
