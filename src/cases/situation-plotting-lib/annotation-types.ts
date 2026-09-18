import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  HeadingPitchRoll,
  LabelStyle,
  Math as CesiumMath,
  Transforms,
  type Viewer
} from 'cesium'
import type { GPoint } from '../military-plotting-lib/plot-edit/types'

export const ANNOTATION_TEXT_PREFIX = 'situation-annotation-text-'
export const ANNOTATION_IMAGE_PREFIX = 'situation-annotation-image-'
export const ANNOTATION_MODEL_PREFIX = 'situation-annotation-model-'
export const ANNOTATION_SELECT_MARKER_ID = 'situation-annotation-select-marker'

export type AnnotationKind = 'text' | 'image' | 'model'

const KIND_PREFIX: Record<AnnotationKind, string> = {
  text: ANNOTATION_TEXT_PREFIX,
  image: ANNOTATION_IMAGE_PREFIX,
  model: ANNOTATION_MODEL_PREFIX
}

const ID_CHARS = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678'

export function annotationKey(kind: AnnotationKind): string {
  let value = ''
  for (let i = 0; i < 8; i += 1) {
    value += ID_CHARS.charAt(Math.floor(Math.random() * ID_CHARS.length))
  }
  return `${KIND_PREFIX[kind]}${value}`
}

export function isAnnotationEntityId(id: string | undefined): boolean {
  if (!id) return false
  return (
    id.startsWith(ANNOTATION_TEXT_PREFIX) ||
    id.startsWith(ANNOTATION_IMAGE_PREFIX) ||
    id.startsWith(ANNOTATION_MODEL_PREFIX)
  )
}

export function annotationKindOfId(id: string | undefined): AnnotationKind | null {
  if (!id) return null
  if (id.startsWith(ANNOTATION_TEXT_PREFIX)) return 'text'
  if (id.startsWith(ANNOTATION_IMAGE_PREFIX)) return 'image'
  if (id.startsWith(ANNOTATION_MODEL_PREFIX)) return 'model'
  return null
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export type ImagePreset = { id: string; name: string; url: string }

export const IMAGE_PRESETS: ImagePreset[] = [
  {
    id: 'pin',
    name: '定位点',
    url: svgDataUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path d="M32 4 C20 4 12 12.5 12 23.5 C12 37 30 58 32 60 C34 58 52 37 52 23.5 C52 12.5 44 4 32 4 Z" fill="#e04040" stroke="#ffffff" stroke-width="4"/><circle cx="32" cy="24" r="8" fill="#ffffff"/></svg>'
    )
  },
  {
    id: 'dot',
    name: '圆点',
    url: svgDataUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="#2f8fff" stroke="#ffffff" stroke-width="4"/></svg>'
    )
  },
  {
    id: 'flag',
    name: '小旗',
    url: svgDataUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="8" y="6" width="5" height="52" rx="1" fill="#8a97ab"/><path d="M13 8 L58 8 L50 18 L58 28 L13 28 Z" fill="#3dd68c" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/></svg>'
    )
  },
  {
    id: 'star',
    name: '星标',
    url: svgDataUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path d="M32 4 L39.5 22.8 L59.6 24.2 L44.2 37.1 L48.8 56.7 L32 46 L15.2 56.7 L19.8 37.1 L4.4 24.2 L24.5 22.8 Z" fill="#ffd700" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/></svg>'
    )
  }
]

export type ModelPreset = { id: string; name: string; uri: string }

function resolveModelUrl(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/'
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'metro-station',
    name: '地铁站',
    uri: resolveModelUrl('/data/model/metro_station/scene.gltf')
  },
  {
    id: 'launch-vehicle',
    name: '运载火箭',
    uri: resolveModelUrl('/data/model/launchvehicle/launchvehicle.gltf')
  }
]

export type TextFields = {
  content: string
  fontSize: number
  color: string
  outlineColor: string
  outlineWidth: number
  showBackground: boolean
  backgroundColor: string
  pixelOffsetX: number
  pixelOffsetY: number
}

export type ImageFields = {
  source: string
  scale: number
  rotation: number
  opacity: number
}

export type ModelFields = {
  uri: string
  scale: number
  height: number
  heading: number
}

export type AnnotationFields = TextFields | ImageFields | ModelFields

export function defaultTextFields(): TextFields {
  return {
    content: '示例文本',
    fontSize: 18,
    color: '#ffffff',
    outlineColor: '#0b0f1a',
    outlineWidth: 1,
    showBackground: true,
    backgroundColor: '#1f3a5f',
    pixelOffsetX: 0,
    pixelOffsetY: 0
  }
}

export function defaultImageFields(): ImageFields {
  return {
    source: IMAGE_PRESETS[0].url,
    scale: 0.6,
    rotation: 0,
    opacity: 1
  }
}

export function defaultModelFields(): ModelFields {
  return {
    uri: MODEL_PRESETS[0].uri,
    scale: 1,
    height: 0,
    heading: 0
  }
}

export function defaultFieldsFor(kind: AnnotationKind): AnnotationFields {
  if (kind === 'text') return defaultTextFields()
  if (kind === 'image') return defaultImageFields()
  return defaultModelFields()
}

export function annotationKindLabel(kind: AnnotationKind): string {
  if (kind === 'text') return '文本标注'
  if (kind === 'image') return '图片标注'
  return '模型标注'
}

export type AnnotationObject = {
  key: string
  kind: AnnotationKind
  name: string
  position: GPoint
  fields: AnnotationFields
  entity: AnnotationEntity
}

export type AnnotationEntity = {
  id: string
  position?: unknown
  orientation?: unknown
  label?: {
    text?: unknown
    font?: unknown
    fillColor?: unknown
    outlineColor?: unknown
    outlineWidth?: unknown
    showBackground?: unknown
    backgroundColor?: unknown
    backgroundPadding?: unknown
    pixelOffset?: unknown
    style?: unknown
    disableDepthTestDistance?: unknown
  }
  billboard?: {
    image?: unknown
    scale?: unknown
    rotation?: unknown
    color?: unknown
    disableDepthTestDistance?: unknown
    verticalOrigin?: unknown
    horizontalOrigin?: unknown
  }
  model?: {
    uri?: unknown
    scale?: unknown
  }
}

function fillColorFromCss(css: string): Color {
  const parsed = Color.fromCssColorString(css || '#ffffff')
  return parsed ?? Color.WHITE
}

function resolvedConstValue(value: unknown): unknown {
  if (!value) return value
  if (typeof (value as { getValue?: unknown }).getValue === 'function') {
    try {
      return (value as { getValue(time?: unknown): unknown }).getValue()
    } catch {
      return undefined
    }
  }
  return value
}

function assignIfChanged(target: Record<string, unknown>, key: string, next: unknown): void {
  if (resolvedConstValue(target[key]) === next) return
  target[key] = next
}

export function renderAltitudeOf(object: AnnotationObject): number {
  const model = object.fields as Partial<ModelFields>
  return object.position.alt + (object.kind === 'model' ? Math.max(0, Number(model.height ?? 0)) : 0)
}

function applyOrientation(
  entity: AnnotationEntity,
  kind: AnnotationKind,
  position: Cartesian3,
  fields: AnnotationFields
): void {
  if (kind !== 'model') return
  const model = fields as ModelFields
  const heading = CesiumMath.toRadians(model.heading)
  entity.orientation = Transforms.headingPitchRollQuaternion(
    position,
    new HeadingPitchRoll(heading, 0, 0)
  )
}

export function updateAnnotationPosition(viewer: Viewer, object: AnnotationObject): void {
  const exists = viewer.entities.getById(object.key)
  if (!exists) return
  const entity = exists as unknown as AnnotationEntity
  const altitude = renderAltitudeOf(object)
  const position = Cartesian3.fromDegrees(object.position.lng, object.position.lat, altitude)
  entity.position = position
  applyOrientation(entity, object.kind, position, object.fields)
}

export function renderAnnotationEntity(viewer: Viewer, object: AnnotationObject): AnnotationEntity {
  const entityId = object.key
  const exists = viewer.entities.getById(entityId)
  const entity = (exists ?? viewer.entities.add({ id: entityId })) as unknown as AnnotationEntity
  const fields = object.fields

  if (object.kind === 'text') {
    const text = fields as TextFields
    const altitude = renderAltitudeOf(object)
    const position = Cartesian3.fromDegrees(object.position.lng, object.position.lat, altitude)
    entity.position = position
    let label = entity.label as Record<string, unknown> | undefined
    if (!label) {
      entity.label = {}
      label = entity.label
    }
    assignIfChanged(label, 'text', text.content)
    assignIfChanged(label, 'font', `${Math.max(6, Math.round(text.fontSize))}px "Microsoft YaHei", sans-serif`)
    label.fillColor = fillColorFromCss(text.color)
    assignIfChanged(label, 'showBackground', !!text.showBackground)
    label.backgroundColor = fillColorFromCss(text.backgroundColor)
    label.backgroundPadding = new Cartesian2(6, 4)
    label.outlineColor = fillColorFromCss(text.outlineColor)
    assignIfChanged(label, 'outlineWidth', Math.max(0, Math.round(text.outlineWidth)))
    assignIfChanged(
      label,
      'style',
      text.outlineWidth > 0 ? LabelStyle.FILL_AND_OUTLINE : LabelStyle.FILL
    )
    label.pixelOffset = new Cartesian2(text.pixelOffsetX, text.pixelOffsetY)
    assignIfChanged(label, 'disableDepthTestDistance', Number.POSITIVE_INFINITY)
    return entity
  }

  if (object.kind === 'image') {
    const image = fields as ImageFields
    const altitude = renderAltitudeOf(object)
    const position = Cartesian3.fromDegrees(object.position.lng, object.position.lat, altitude)
    entity.position = position
    let billboard = entity.billboard as Record<string, unknown> | undefined
    if (!billboard) {
      entity.billboard = {}
      billboard = entity.billboard
    }
    assignIfChanged(billboard, 'image', image.source)
    assignIfChanged(billboard, 'scale', Math.max(0.05, image.scale))
    assignIfChanged(billboard, 'rotation', CesiumMath.toRadians(image.rotation))
    billboard.color = new Color(1, 1, 1, Math.max(0, Math.min(1, image.opacity)))
    assignIfChanged(billboard, 'disableDepthTestDistance', Number.POSITIVE_INFINITY)
    return entity
  }

  const model = fields as ModelFields
  const altitude = renderAltitudeOf(object)
  const position = Cartesian3.fromDegrees(object.position.lng, object.position.lat, altitude)
  entity.position = position
  applyOrientation(entity, object.kind, position, fields)
  let modelGraphics = entity.model as Record<string, unknown> | undefined
  if (!modelGraphics) {
    entity.model = {}
    modelGraphics = entity.model
  }
  assignIfChanged(modelGraphics, 'uri', model.uri)
  assignIfChanged(modelGraphics, 'scale', Math.max(0.01, model.scale))
  return entity
}

export function positionOfEntity(entity: AnnotationEntity): GPoint | null {
  const raw = entity?.position as unknown
  if (!raw) return null
  let cartesian: Cartesian3 | undefined
  if (typeof (raw as { getValue?: unknown }).getValue === 'function') {
    cartesian = (raw as { getValue(t?: unknown): Cartesian3 | undefined }).getValue()
  } else {
    cartesian = raw as Cartesian3
  }
  if (!cartesian) return null
  const carto = Cartographic.fromCartesian(cartesian)
  return {
    lng: CesiumMath.toDegrees(carto.longitude),
    lat: CesiumMath.toDegrees(carto.latitude),
    alt: carto.height
  }
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

export type LocalModelResult = { uri: string; revokeUrls: string[] }

type ModelEntryFile = { file: File; path: string }

function normalizeModelPath(value: string): string {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')
}

function findModelFile(uri: string, fileMap: Map<string, File>): File | null {
  if (!uri) return null
  const rel = normalizeModelPath(uri)
  const baseName = rel.split('/').pop() ?? rel
  if (fileMap.has(rel)) return fileMap.get(rel) ?? null
  if (fileMap.has(baseName)) return fileMap.get(baseName) ?? null
  for (const key of fileMap.keys()) {
    const normalized = normalizeModelPath(key)
    if (normalized === rel || normalized.endsWith('/' + rel) || rel.endsWith('/' + normalized)) {
      return fileMap.get(key) ?? null
    }
  }
  return null
}

function rewriteModelUris(
  node: unknown,
  fileMap: Map<string, File>,
  cache: Map<string, string>,
  revokeUrls: string[]
): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) rewriteModelUris(item, fileMap, cache, revokeUrls)
    return
  }
  for (const key of Object.keys(node as Record<string, unknown>)) {
    const value = (node as Record<string, unknown>)[key]
    const isUri =
      (key === 'uri' || key === 'url') &&
      typeof value === 'string' &&
      !value.startsWith('data:') &&
      !value.startsWith('blob:')
    if (isUri) {
      const target = value as string
      if (!cache.has(target)) {
        const file = findModelFile(target, fileMap)
        if (file) {
          const blobUrl = URL.createObjectURL(file)
          revokeUrls.push(blobUrl)
          cache.set(target, blobUrl)
        }
      }
      const rewritten = cache.get(target)
      if (rewritten) (node as Record<string, unknown>)[key] = rewritten
    }
    if (typeof value === 'object') rewriteModelUris(value, fileMap, cache, revokeUrls)
  }
}

export async function localModelToBlobUri(files: File[]): Promise<LocalModelResult | null> {
  if (!files || files.length === 0) return null
  const entries: ModelEntryFile[] = files.map((file) => ({
    file,
    path: file.webkitRelativePath || file.name
  }))
  const main = entries.find((entry) => /\.(glb|gltf)$/i.test(entry.path))
  if (!main) return null
  const file = main.file
  const fileMap = new Map<string, File>()
  for (const entry of entries) {
    const normalized = normalizeModelPath(entry.path)
    if (!fileMap.has(normalized)) fileMap.set(normalized, entry.file)
    if (!fileMap.has(entry.file.name)) fileMap.set(entry.file.name, entry.file)
  }
  const revokeUrls: string[] = []
  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'gltf'
  try {
    if (extension === 'glb') {
      const buffer = await file.arrayBuffer()
      const blobUrl = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }))
      revokeUrls.push(blobUrl)
      return { uri: blobUrl, revokeUrls }
    }
    const text = await file.text()
    const gltf = JSON.parse(text) as Record<string, unknown>
    rewriteModelUris(gltf, fileMap, new Map<string, string>(), revokeUrls)
    const jsonBlob = new Blob([JSON.stringify(gltf)], { type: 'application/json' })
    const blobUrl = URL.createObjectURL(jsonBlob)
    revokeUrls.push(blobUrl)
    return { uri: blobUrl, revokeUrls }
  } catch (error) {
    for (const url of revokeUrls) URL.revokeObjectURL(url)
    throw error
  }
}
