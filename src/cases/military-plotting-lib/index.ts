import { Color, PolylineArrowMaterialProperty, type Viewer } from 'cesium'
import CreateAttackArrow from './legacy/CreateAttackArrow'
import CreateBow from './legacy/CreateBow'
import CreateCurve from './legacy/CreateCurve'
import CreateFlag from './legacy/CreateFlag'
import CreateFreeLine from './legacy/CreateFreeLine'
import CreateFreePolygon from './legacy/CreateFreePolygon'
import CreateLineArrow from './legacy/CreateLineArrow'
import CreatePincerArrow from './legacy/CreatePincerArrow'
import CreatePolygon from './legacy/CreatePolygon'
import CreatePolyline from './legacy/CreatePolyline'
import CreateRegularPolygon from './legacy/CreateRegularPolygon'
import CreateRightAngleArrow from './legacy/CreateRightAngleArrow'
import CreateRoundRectangle from './legacy/CreateRoundRectangle'
import CreateSector from './legacy/CreateSector'
import CreateStagingArea from './legacy/CreateStagingArea'
import CreateSwallowtailArrow from './legacy/CreateSwallowtailArrow'

export type PlottingKind =
  | 'free-line'
  | 'polyline'
  | 'curve'
  | 'free-polygon'
  | 'polygon'
  | 'regular-polygon'
  | 'straight-line-arrow'
  | 'curve-line-arrow'
  | 'right-angle-arrow'
  | 'swallowtail-arrow'
  | 'pincer-arrow'
  | 'attack-arrow'
  | 'round-rectangle'
  | 'sector'
  | 'bow'
  | 'staging-area'
  | 'flag-curve'
  | 'flag-rectangle'
  | 'flag-regular-triangle'
  | 'flag-inverted-triangle'
  | 'flag-triangle'

export type DrawOptions = {
  color: Color
  width?: number
  num?: number
  straight?: boolean
  flagType?: number
}

export type KindMeta = {
  kind: PlottingKind
  title: string
  name: string
  hasWidth?: boolean
  hasNum?: boolean
}

export const PLOTTING_KIND_META: KindMeta[] = [
  { kind: 'free-line', title: '自由线绘制', name: '自由线' },
  { kind: 'polyline', title: '折线绘制', name: '折线' },
  { kind: 'curve', title: '曲线绘制', name: '曲线' },
  { kind: 'free-polygon', title: '自由面绘制', name: '自由面' },
  { kind: 'polygon', title: '多边形绘制', name: '多边形' },
  { kind: 'regular-polygon', title: '正多边形绘制', name: '正多边形', hasNum: true },
  { kind: 'straight-line-arrow', title: '直线箭头绘制', name: '直线箭头', hasWidth: true },
  { kind: 'curve-line-arrow', title: '曲线箭头绘制', name: '曲线箭头', hasWidth: true },
  { kind: 'right-angle-arrow', title: '直角箭头绘制', name: '直角箭头' },
  { kind: 'swallowtail-arrow', title: '燕尾箭头绘制', name: '燕尾箭头' },
  { kind: 'pincer-arrow', title: '钳击箭头绘制', name: '钳击箭头' },
  { kind: 'attack-arrow', title: '进攻箭头绘制', name: '进攻箭头' },
  { kind: 'round-rectangle', title: '圆角矩形绘制', name: '圆角矩形' },
  { kind: 'sector', title: '扇形绘制', name: '扇形' },
  { kind: 'bow', title: '弓形绘制', name: '弓形' },
  { kind: 'staging-area', title: '集结地绘制', name: '集结地' },
  { kind: 'flag-curve', title: '曲线旗标绘制', name: '曲线旗标' },
  { kind: 'flag-rectangle', title: '矩形旗标绘制', name: '矩形旗标' },
  { kind: 'flag-regular-triangle', title: '正三角旗标绘制', name: '正三角旗标' },
  { kind: 'flag-inverted-triangle', title: '倒三角旗标绘制', name: '倒三角旗标' },
  { kind: 'flag-triangle', title: '对三角旗标绘制', name: '对三角旗标' }
]

const FLAG_TYPE: Partial<Record<PlottingKind, number>> = {
  'flag-curve': 0,
  'flag-rectangle': 1,
  'flag-regular-triangle': 2,
  'flag-inverted-triangle': 3,
  'flag-triangle': 4
}

type CreateFunction = (
  viewer: Viewer,
  resultList: unknown[],
  options: Record<string, unknown>,
  callback?: (entity: unknown) => void
) => void

const CREATORS: Record<PlottingKind, CreateFunction> = {
  'free-line': (viewer, list, options, callback) => CreateFreeLine(viewer, list, options, callback),
  polyline: (viewer, list, options, callback) => CreatePolyline(viewer, list, options, callback),
  curve: (viewer, list, options, callback) => CreateCurve(viewer, list, options, callback),
  'free-polygon': (viewer, list, options, callback) => CreateFreePolygon(viewer, list, options, callback),
  polygon: (viewer, list, options, callback) => CreatePolygon(viewer, list, options, callback),
  'regular-polygon': (viewer, list, options, callback) => CreateRegularPolygon(viewer, list, options, callback),
  'straight-line-arrow': (viewer, list, options, callback) => CreateLineArrow(viewer, list, options, callback),
  'curve-line-arrow': (viewer, list, options, callback) => CreateLineArrow(viewer, list, options, callback),
  'right-angle-arrow': (viewer, list, options, callback) => CreateRightAngleArrow(viewer, list, options, callback),
  'swallowtail-arrow': (viewer, list, options, callback) => CreateSwallowtailArrow(viewer, list, options, callback),
  'pincer-arrow': (viewer, list, options, callback) => CreatePincerArrow(viewer, list, options, callback),
  'attack-arrow': (viewer, list, options, callback) => CreateAttackArrow(viewer, list, options, callback),
  'round-rectangle': (viewer, list, options, callback) => CreateRoundRectangle(viewer, list, options, callback),
  sector: (viewer, list, options, callback) => CreateSector(viewer, list, options, callback),
  bow: (viewer, list, options, callback) => CreateBow(viewer, list, options, callback),
  'staging-area': (viewer, list, options, callback) => CreateStagingArea(viewer, list, options, callback),
  'flag-curve': (viewer, list, options, callback) => CreateFlag(viewer, list, options, callback),
  'flag-rectangle': (viewer, list, options, callback) => CreateFlag(viewer, list, options, callback),
  'flag-regular-triangle': (viewer, list, options, callback) => CreateFlag(viewer, list, options, callback),
  'flag-inverted-triangle': (viewer, list, options, callback) => CreateFlag(viewer, list, options, callback),
  'flag-triangle': (viewer, list, options, callback) => CreateFlag(viewer, list, options, callback)
}

type AnyEntity = {
  polygon?: {
    material: unknown
    outlineColor?: unknown
  }
  polyline?: {
    width?: unknown
    material?: unknown
  }
}

const ID_CHARS = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678'

function generateId(length = 16): string {
  let value = ''
  for (let i = 0; i < length; i += 1) {
    value += ID_CHARS.charAt(Math.floor(Math.random() * ID_CHARS.length))
  }
  return value
}

export class MilitaryPlottingSession {
  private viewer: Viewer
  private drawing: PlottingKind | null = null
  private activeId: string | null = null
  private entities: AnyEntity[] = []
  private finishedCount = 0

  constructor(viewer: Viewer) {
    this.viewer = viewer
  }

  get isDrawing(): boolean {
    return this.drawing !== null
  }

  get count(): number {
    return this.finishedCount
  }

  startDraw(kind: PlottingKind, options: DrawOptions, onFinish?: () => void): boolean {
    if (!this.viewer || this.viewer.isDestroyed() || this.drawing) return false
    const id = `military-plotting-${generateId()}`
    this.drawing = kind
    this.activeId = id
    const createOptions: Record<string, unknown> = {
      id,
      color: options.color
    }
    if (typeof options.width === 'number' && options.width > 0) createOptions.width = options.width
    if (typeof options.num === 'number' && options.num > 2) createOptions.num = options.num
    if (kind === 'straight-line-arrow' || kind === 'curve-line-arrow') {
      createOptions.straight = kind === 'straight-line-arrow'
    }
    if (FLAG_TYPE[kind] !== undefined) createOptions.type = FLAG_TYPE[kind]
    const resultList: unknown[] = []
    CREATORS[kind](
      this.viewer,
      resultList,
      createOptions,
      (entity) => {
        this.drawing = null
        this.activeId = null
        if (entity) {
          this.entities.push(entity as AnyEntity)
          this.finishedCount += 1
        }
        onFinish?.()
      }
    )
    return true
  }

  private currentEntity(): AnyEntity | null {
    if (!this.activeId) return null
    return (this.viewer.entities.getById(this.activeId) as AnyEntity | undefined) ?? null
  }

  restyle(color: Color, width?: number): void {
    if (!this.viewer || this.viewer.isDestroyed()) return
    const targets: AnyEntity[] = [...this.entities]
    const active = this.currentEntity()
    if (active) targets.push(active)
    for (const entity of targets) {
      if (!entity) continue
      const polygon = entity.polygon
      if (polygon) {
        polygon.material = color
        polygon.outlineColor = color.withAlpha(1)
      }
      const polyline = entity.polyline
      if (polyline) {
        if (typeof width === 'number' && width > 0) polyline.width = width
        const material = polyline.material
        if (material instanceof PolylineArrowMaterialProperty) {
          polyline.material = new PolylineArrowMaterialProperty(color)
        } else {
          polyline.material = color
        }
      }
    }
  }

  resyncFromViewer(): void {
    if (!this.viewer || this.viewer.isDestroyed()) return
    const rebuilt: AnyEntity[] = []
    const collection = this.viewer.entities
    for (let i = 0; i < collection.values.length; i++) {
      const entity = collection.values[i]
      if (!entity) continue
      const id = (entity as { id?: string }).id
      if (!id || !id.startsWith('military-plotting-')) continue
      const anyEntity = entity as unknown as AnyEntity
      if (!anyEntity.polygon && !anyEntity.polyline) continue
      rebuilt.push(anyEntity)
    }
    this.entities = rebuilt
    this.finishedCount = rebuilt.length
  }

  clear(): void {
    if (!this.viewer || this.viewer.isDestroyed() || this.drawing) return
    this.viewer.entities.removeAll()
    this.entities = []
    this.finishedCount = 0
    this.activeId = null
  }
}

export function buildDrawColor(color: string, alpha: number): Color {
  const parsed = Color.fromCssColorString(color)
  parsed.alpha = alpha
  return parsed
}

export function kindMeta(kind: PlottingKind): KindMeta {
  return PLOTTING_KIND_META.find((item) => item.kind === kind) ?? { kind, title: kind, name: kind }
}
