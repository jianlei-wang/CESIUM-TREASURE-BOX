import { Cartesian2, Cartesian3, Color, ScreenSpaceEventHandler, ScreenSpaceEventType, type Viewer } from 'cesium'
import {
  annotationKindLabel,
  annotationKey,
  isAnnotationEntityId,
  renderAnnotationEntity,
  renderAltitudeOf,
  updateAnnotationPosition,
  ANNOTATION_SELECT_MARKER_ID,
  type AnnotationFields,
  type AnnotationKind,
  type AnnotationObject
} from './annotation-types'
import {
  degAngle,
  pickSceneDeg
} from '../military-plotting-lib/plot-edit/geometry'
import type { GPoint } from '../military-plotting-lib/plot-edit/types'

export type AnnotationTool = 'select' | 'move' | 'rotate' | 'scale'

export type AnnotationCallbacks = {
  onStatus?: (message: string) => void
  onObjectsChange?: () => void
  onSelectedChange?: (object: AnnotationObject | null) => void
  onUndoChanged?: () => void
  getPlacementFields?: (kind: AnnotationKind) => AnnotationFields | null
}

export type AnnotationListItem = {
  key: string
  kind: AnnotationKind
  name: string
  kindLabel: string
  positionLabel: string
  entity: AnnotationObject['entity']
}

type SnapshotEntry = {
  key: string
  kind: AnnotationKind
  name: string
  position: GPoint
  fields: AnnotationFields
}

const TRANSFORM_TOOLS: AnnotationTool[] = ['move', 'rotate', 'scale']
const UNDO_LIMIT = 30

function cloneFields(fields: AnnotationFields): AnnotationFields {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(fields) as Array<keyof AnnotationFields>) {
    out[key as string] = fields[key]
  }
  return out as AnnotationFields
}

function clonePosition(position: GPoint): GPoint {
  return { lng: position.lng, lat: position.lat, alt: position.alt }
}

export class AnnotationSession {
  private viewer: Viewer
  private cb: AnnotationCallbacks
  private handler: ScreenSpaceEventHandler
  private placingKind: AnnotationKind | null = null
  private editEnabled = false
  private tool: AnnotationTool = 'select'
  private selectedKey: string | null = null
  objects: AnnotationObject[] = []
  private counter = 0

  private dragActive = false
  private dragTool: AnnotationTool | null = null
  private dragStart: GPoint | null = null
  private dragBasePosition: GPoint | null = null
  private dragBaseFields: AnnotationFields | null = null
  private undoStack: SnapshotEntry[][] = []
  private pendingFrame: SnapshotEntry[] | null = null

  constructor(viewer: Viewer, cb: AnnotationCallbacks = {}) {
    this.viewer = viewer
    this.cb = cb
    this.handler = new ScreenSpaceEventHandler(viewer.canvas)
    this.handler.setInputAction(
      (e: { position: Cartesian2 }) => this.onLeftClick(e.position),
      ScreenSpaceEventType.LEFT_CLICK
    )
    this.handler.setInputAction(
      (e: { position: Cartesian2 }) => this.onLeftDown(e.position),
      ScreenSpaceEventType.LEFT_DOWN
    )
    this.handler.setInputAction(
      (e: { endPosition: Cartesian2 }) => this.onMouseMove(e.endPosition),
      ScreenSpaceEventType.MOUSE_MOVE
    )
    this.handler.setInputAction(() => this.onLeftUp(), ScreenSpaceEventType.LEFT_UP)
  }

  get isPlacing(): boolean {
    return this.placingKind !== null
  }

  get placingKindNow(): AnnotationKind | null {
    return this.placingKind
  }

  get enabled(): boolean {
    return this.editEnabled
  }

  getTool(): AnnotationTool {
    return this.tool
  }

  setTool(tool: AnnotationTool): void {
    this.tool = tool
    this.dragActive = false
    this.dragTool = null
    if (!this.selectedKey) this.refreshMarker()
  }

  setPlacing(kind: AnnotationKind | null): void {
    this.placingKind = kind
    this.dragActive = false
    this.dragTool = null
    if (!kind) this.select(null)
  }

  setEditEnabled(enabled: boolean): void {
    this.editEnabled = enabled
    this.dragActive = false
    this.dragTool = null
    if (!enabled) {
      this.select(null)
    } else {
      this.refreshMarker()
    }
  }

  selected(): AnnotationObject | null {
    if (!this.selectedKey) return null
    return this.objects.find((o) => o.key === this.selectedKey) ?? null
  }

  select(key: string | null): void {
    this.selectedKey = key
    this.dragActive = false
    this.dragTool = null
    this.cb.onSelectedChange?.(this.selected())
    this.refreshMarker()
  }

  private findById(key: string): AnnotationObject | null {
    return this.objects.find((o) => o.key === key) ?? null
  }

  private pickAnnotation(px: Cartesian2): AnnotationObject | null {
    let picks: Array<{ id?: { id?: string } }> = []
    try {
      picks = this.viewer.scene.drillPick(px) as unknown as Array<{ id?: { id?: string } }>
    } catch {
      picks = []
    }
    for (const pick of picks) {
      const id = pick?.id?.id
      if (!id || !isAnnotationEntityId(id)) continue
      const found = this.findById(id)
      if (found) return found
    }
    return null
  }

  private refreshMarker(): void {
    const markerId = ANNOTATION_SELECT_MARKER_ID
    const existing = this.viewer.entities.getById(markerId)
    const shouldShow = this.editEnabled && !!this.selectedKey
    if (!shouldShow) {
      if (existing) this.viewer.entities.remove(existing)
      return
    }
    const selected = this.selected()
    if (!selected) {
      if (existing) this.viewer.entities.remove(existing)
      return
    }
    const position = Cartesian3.fromDegrees(
      selected.position.lng,
      selected.position.lat,
      renderAltitudeOf(selected)
    )
    if (existing) {
      const marker = existing as unknown as AnnotationEntityMarker
      marker.position = position
      return
    }
    this.viewer.entities.add({
      id: markerId,
      position,
      point: {
        pixelSize: 10,
        color: Color.fromCssColorString('#35f1ff')?.withAlpha(0.45) ?? Color.CYAN.withAlpha(0.45),
        outlineColor: Color.fromCssColorString('#eafcff') ?? Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    })
  }

  private onLeftClick(px: Cartesian2): void {
    if (this.placingKind) {
      this.placeAtPointer(this.placingKind, px)
      return
    }
    if (!this.editEnabled || this.tool !== 'select') return
    const hit = this.pickAnnotation(px)
    if (hit) {
      this.select(hit.key)
      this.cb.onStatus?.(`已选中 ${hit.name}，可切换工具拖拽编辑，或在下方面板调整属性`)
    } else {
      this.select(null)
    }
  }

  private placeAtPointer(kind: AnnotationKind, px: Cartesian2): void {
    const ground = pickSceneDeg(this.viewer, px)
    if (!ground) {
      this.cb.onStatus?.('未拾取到地图位置，请点击地图表面')
      return
    }
    const fields = this.cb.getPlacementFields?.(kind)
    if (!fields) {
      this.cb.onStatus?.(`请先配置${annotationKindLabel(kind)}内容后再在地图点击放置`)
      return
    }
    this.addObject(kind, { lng: ground.lng, lat: ground.lat, alt: 0 }, cloneFields(fields))
  }

  addObject(kind: AnnotationKind, position: GPoint, fields: AnnotationFields): AnnotationObject {
    this.counter += 1
    const key = annotationKey(kind)
    const label = annotationKindLabel(kind)
    const name = `${label}·${String(this.counter).padStart(2, '0')}`
    const object: AnnotationObject = {
      key,
      kind,
      name,
      position: clonePosition(position),
      fields: cloneFields(fields),
      entity: undefined as unknown as AnnotationObject['entity']
    }
    object.entity = renderAnnotationEntity(this.viewer, object)
    this.objects.push(object)
    this.cb.onObjectsChange?.()
    this.cb.onStatus?.(`已添加第 ${this.counter} 个${label}「${name}」，可继续点击地图添加`)
    return object
  }

  listItems(): AnnotationListItem[] {
    return this.objects.map((o) => ({
      key: o.key,
      kind: o.kind,
      name: o.name,
      kindLabel: annotationKindLabel(o.kind),
      positionLabel: `${o.position.lng.toFixed(4)}, ${o.position.lat.toFixed(4)}`,
      entity: o.entity
    }))
  }

  removeObject(key: string): void {
    const index = this.objects.findIndex((o) => o.key === key)
    if (index < 0) return
    this.pushUndoFrame()
    const object = this.objects[index]
    const entity = this.viewer.entities.getById(object.key)
    if (entity) this.viewer.entities.remove(entity)
    this.objects.splice(index, 1)
    if (this.selectedKey === key) {
      this.selectedKey = null
      this.refreshMarker()
      this.cb.onSelectedChange?.(null)
    }
    this.cb.onObjectsChange?.()
    this.cb.onUndoChanged?.()
    this.cb.onStatus?.(`已删除${annotationKindLabel(object.kind)}「${object.name}」`)
  }

  clearAll(): void {
    if (this.objects.length === 0) {
      this.cb.onStatus?.('当前没有标注对象')
      return
    }
    this.pushUndoFrame()
    for (const object of this.objects) {
      const entity = this.viewer.entities.getById(object.key)
      if (entity) this.viewer.entities.remove(entity)
    }
    this.objects = []
    this.selectedKey = null
    this.refreshMarker()
    this.cb.onSelectedChange?.(null)
    this.cb.onObjectsChange?.()
    this.cb.onUndoChanged?.()
    this.cb.onStatus?.(`已清除全部标注（${this.counter} 个中的全部），可撤销恢复`)
  }

  updateSelectedFields(patch: Record<string, unknown>): void {
    const selected = this.selected()
    if (!selected) return
    const current = selected.fields as Record<string, unknown>
    let changed = false
    for (const key of Object.keys(patch)) {
      const value = patch[key]
      if (value === undefined) continue
      if (String(current[key] ?? '') !== String(value)) changed = true
      current[key] = value
    }
    if (!changed) return
    renderAnnotationEntity(this.viewer, selected)
    this.refreshMarker()
    this.cb.onObjectsChange?.()
  }

  private pushUndoFrame(): void {
    if (!this.viewer || this.viewer.isDestroyed()) return
    this.undoStack.push(this.capture())
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
    this.cb.onUndoChanged?.()
  }

  private capture(): SnapshotEntry[] {
    return this.objects.map((o) => ({
      key: o.key,
      kind: o.kind,
      name: o.name,
      position: clonePosition(o.position),
      fields: cloneFields(o.fields)
    }))
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  clearUndo(): void {
    this.undoStack = []
    this.pendingFrame = null
    this.cb.onUndoChanged?.()
  }

  undo(): boolean {
    if (this.undoStack.length === 0) return false
    const frame = this.undoStack.pop()
    if (!frame) return false
    this.dragActive = false
    this.dragTool = null
    this.pendingFrame = null
    this.restore(frame)
    this.cb.onObjectsChange?.()
    this.cb.onUndoChanged?.()
    this.cb.onSelectedChange?.(this.selected())
    this.cb.onStatus?.('已撤销最近一次标注操作（删除/移动/缩放/旋转）')
    return true
  }

  private restore(frame: SnapshotEntry[]): void {
    for (const object of this.objects) {
      const entity = this.viewer.entities.getById(object.key)
      if (entity) this.viewer.entities.remove(entity)
    }
    this.objects = []
    for (const entry of frame) {
      const object: AnnotationObject = {
        key: entry.key,
        kind: entry.kind,
        name: entry.name,
        position: clonePosition(entry.position),
        fields: cloneFields(entry.fields),
        entity: undefined as unknown as AnnotationObject['entity']
      }
      object.entity = renderAnnotationEntity(this.viewer, object)
      this.objects.push(object)
    }
    if (this.selectedKey && !this.objects.some((o) => o.key === this.selectedKey)) {
      this.selectedKey = null
    }
    this.refreshMarker()
  }

  private onLeftDown(px: Cartesian2): void {
    if (this.placingKind || !this.editEnabled) return
    if (!TRANSFORM_TOOLS.includes(this.tool)) return
    let object = this.selected()
    if (!object) {
      const hit = this.pickAnnotation(px)
      if (!hit) return
      this.select(hit.key)
      object = hit
    }
    const ground = pickSceneDeg(this.viewer, px)
    if (!ground) return
    this.pendingFrame = this.capture()
    this.dragStart = ground
    this.dragBasePosition = clonePosition(object.position)
    this.dragBaseFields = cloneFields(object.fields)
    this.dragTool = this.tool
    this.dragActive = true
  }

  private onMouseMove(px: Cartesian2): void {
    if (!this.dragActive || !this.dragStart || !this.dragTool) return
    const object = this.selected()
    if (!object) return
    const ground = pickSceneDeg(this.viewer, px)
    if (!ground) return
    const tool = this.dragTool
    if (tool === 'move') {
      if (!this.dragBasePosition) return
      const dlng = ground.lng - this.dragStart.lng
      const dlat = ground.lat - this.dragStart.lat
      object.position.lng = this.dragBasePosition.lng + dlng
      object.position.lat = this.dragBasePosition.lat + dlat
      updateAnnotationPosition(this.viewer, object)
      this.refreshMarker()
      return
    }
    const basePosition = this.dragBasePosition ?? object.position
    if (tool === 'rotate') {
      if (object.kind === 'text') return
      const anchor: GPoint = { lng: basePosition.lng, lat: basePosition.lat, alt: 0 }
      const startAngle = degAngle(anchor, this.dragStart)
      const currentAngle = degAngle(anchor, ground)
      const deltaDeg = ((currentAngle - startAngle) * 180) / Math.PI
      const base = this.dragBaseFields as Record<string, unknown>
      if (object.kind === 'image') {
        const current = (base.rotation as number) ?? 0
        object.fields = { ...(object.fields as object), rotation: Number(((current + deltaDeg) % 360).toFixed(2)) } as AnnotationFields
      } else if (object.kind === 'model') {
        const current = (base.heading as number) ?? 0
        object.fields = { ...(object.fields as object), heading: Number(((current + deltaDeg) % 360).toFixed(2)) } as AnnotationFields
      }
      renderAnnotationEntity(this.viewer, object)
      return
    }
    if (tool === 'scale') {
      const anchor: GPoint = { lng: basePosition.lng, lat: basePosition.lat, alt: 0 }
      const d0 = Math.hypot(this.dragStart.lng - anchor.lng, this.dragStart.lat - anchor.lat)
      const d1 = Math.hypot(ground.lng - anchor.lng, ground.lat - anchor.lat)
      const factor = d0 > 0.000001 ? d1 / d0 : 1
      const base = this.dragBaseFields as Record<string, unknown>
      if (object.kind === 'text') {
        const current = (base.fontSize as number) ?? 18
        const next = Math.max(8, Math.min(96, current * factor))
        object.fields = { ...(object.fields as object), fontSize: Number(next.toFixed(1)) } as AnnotationFields
      } else if (object.kind === 'image') {
        const current = (base.scale as number) ?? 1
        const next = Math.max(0.05, Math.min(30, current * factor))
        object.fields = { ...(object.fields as object), scale: Number(next.toFixed(3)) } as AnnotationFields
      } else if (object.kind === 'model') {
        const current = (base.scale as number) ?? 1
        const next = Math.max(0.01, Math.min(1000, current * factor))
        object.fields = { ...(object.fields as object), scale: Number(next.toFixed(3)) } as AnnotationFields
      }
      renderAnnotationEntity(this.viewer, object)
      return
    }
  }

  private onLeftUp(): void {
    if (!this.dragActive) return
    this.dragActive = false
    const tool = this.dragTool
    this.dragTool = null
    this.dragStart = null
    this.dragBasePosition = null
    this.dragBaseFields = null
    const before = this.pendingFrame
    this.pendingFrame = null
    if (!before) return
    const after = this.capture()
    if (!this.framesEqual(before, after)) {
      this.undoStack.push(before)
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
      this.cb.onUndoChanged?.()
      const label = tool === 'move' ? '移动' : tool === 'rotate' ? '旋转' : '缩放'
      this.cb.onStatus?.(`已${label}标注，属性已更新，可继续拖拽`)
    }
    this.cb.onObjectsChange?.()
  }

  private framesEqual(a: SnapshotEntry[], b: SnapshotEntry[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      const x = a[i]
      const y = b[i]
      if (x.key !== y.key || x.kind !== y.kind) return false
      if (
        Math.abs(x.position.lng - y.position.lng) > 1e-9 ||
        Math.abs(x.position.lat - y.position.lat) > 1e-9
      ) {
        return false
      }
      const xf = x.fields as Record<string, unknown>
      const yf = y.fields as Record<string, unknown>
      for (const key of Object.keys(xf)) {
        const xv = xf[key]
        const yv = yf[key]
        if (typeof xv === 'number' && typeof yv === 'number') {
          if (Math.abs(xv - yv) > 1e-6) return false
        } else if (String(xv ?? '') !== String(yv ?? '')) {
          return false
        }
      }
    }
    return true
  }

  destroy(): void {
    this.handler.destroy()
    const marker = this.viewer.entities.getById(ANNOTATION_SELECT_MARKER_ID)
    if (marker) this.viewer.entities.remove(marker)
  }
}

type AnnotationEntityMarker = {
  position?: unknown
  point?: {
    pixelSize?: number
    color?: Color
    outlineColor?: Color
    outlineWidth?: number
    disableDepthTestDistance?: number
  }
}
