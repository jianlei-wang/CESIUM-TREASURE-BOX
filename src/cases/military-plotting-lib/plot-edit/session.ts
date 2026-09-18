import {
  Cartesian2,
  Cartesian3,
  Color,
  PolylineArrowMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer
} from 'cesium'
import {
  closestPointIndex,
  degAngle,
  pickSceneDeg,
  readEntityPositions,
  rotatePoints,
  scalePoints,
  toCartesian,
  translatePoints,
  writeEntityGeometry,
  type EntityLike
} from './geometry'
import type { PlottingKind } from '../index'
import type { EditTool, GPoint } from './types'
import { kindName, PLOT_ENTITY_PREFIX } from './types'

export type EditorTool = EditTool

export type EditableObject = {
  key: string
  kind: string
  name: string
  geoType: string
  shape: 'polygon' | 'polyline' | 'none'
  entity: EntityLike
}

export type EditSessionCallbacks = {
  onStatus?: (message: string) => void
  onSelectedChange?: (object: EditableObject | null) => void
  onObjectsChange?: () => void
  onUndoChanged?: () => void
}

export type UndoObject = {
  key: string
  kind: string
  geoType: string
  shape: 'polygon' | 'polyline'
  name: string
  points: GPoint[]
  materialCss?: string | null
  lineWidth?: number
  arrow?: boolean
}

export type UndoFrame = UndoObject[]

const UNDO_LIMIT = 40

const PLOT_OVERLAY_PREFIX = 'plot-edit-overlay-'
const PLOT_HANDLE_PREFIX = 'plot-edit-handle-'
const PLOT_MID_PREFIX = 'plot-edit-mid-'

const HIGHLIGHT_COLOR = Color.fromCssColorString('#35f1ff')
const VERTEX_COLOR = Color.fromCssColorString('#ffb13d')
const VERTEX_ACTIVE_COLOR = Color.fromCssColorString('#3dff7f')
const MID_COLOR = Color.fromCssColorString('#ffffff')
const MID_OUTLINE_COLOR = Color.fromCssColorString('#0b0f1a')

type VisualEntity = {
  id?: string
  position?: unknown
  point?: {
    pixelSize?: unknown
    color?: unknown
    outlineColor?: unknown
    outlineWidth?: unknown
    disableDepthTestDistance?: unknown
  }
  polyline?: {
    positions?: unknown
    width?: unknown
    material?: unknown
  }
}

function entityShape(entity: EntityLike): 'polygon' | 'polyline' | 'none' {
  if (entity.polygon) return 'polygon'
  if (entity.polyline) return 'polyline'
  return 'none'
}

function isPlotVisualId(id: string | undefined): boolean {
  if (!id) return false
  return (
    id.startsWith(PLOT_OVERLAY_PREFIX) ||
    id.startsWith(PLOT_HANDLE_PREFIX) ||
    id.startsWith(PLOT_MID_PREFIX)
  )
}

function colorAssign(entity: VisualEntity | undefined, color: Color): void {
  if (entity && entity.point) entity.point.color = color
}

function sizeAssign(entity: VisualEntity | undefined, pixelSize: number): void {
  if (entity && entity.point) entity.point.pixelSize = pixelSize
}

type RawGraphics = {
  polygon?: { material?: unknown }
  polyline?: { width?: unknown; material?: unknown }
}

function resolveColorValue(
  viewer: Viewer,
  value: unknown
): Color | null {
  if (value instanceof Color) return value
  if (value && typeof value === 'object') {
    const cast = value as {
      getValue?: (time: unknown) => unknown
      color?: Color
    }
    if (typeof cast.getValue === 'function') {
      try {
        const out = cast.getValue(viewer.clock.currentTime)
        if (out instanceof Color) return out
        if (out && typeof out === 'object') {
          const inner = out as { color?: Color }
          if (inner.color instanceof Color) return inner.color
        }
        return resolveColorValue(viewer, out)
      } catch {
        return null
      }
    }
    if (cast.color instanceof Color) return cast.color
  }
  return null
}

function captureObjectStyle(
  viewer: Viewer,
  entity: EntityLike
): { css: string | null; width: number; arrow: boolean } {
  const g = entity as unknown as RawGraphics
  const material = g.polygon?.material ?? g.polyline?.material
  const color = resolveColorValue(viewer, material)
  let width = 3
  const rawWidth = g.polyline?.width
  if (typeof rawWidth === 'number' && rawWidth > 0) width = rawWidth
  else if (rawWidth && typeof rawWidth === 'object') {
    const w = rawWidth as { getValue?: (time: unknown) => unknown }
    if (typeof w.getValue === 'function') {
      try {
        const v = w.getValue(viewer.clock.currentTime)
        if (typeof v === 'number' && v > 0) width = v
      } catch {
        /* ignore */
      }
    }
  }
  const arrow =
    !!g.polyline &&
    (g.polyline.material instanceof PolylineArrowMaterialProperty)
  return {
    css: color ? color.toCssColorString() : null,
    width,
    arrow
  }
}

export class PlotEditSession {
  private viewer: Viewer
  private cb: EditSessionCallbacks
  private handler: ScreenSpaceEventHandler
  objects: EditableObject[] = []
  private selectedKey: string | null = null
  private tool: EditorTool = 'select'
  private dragActive = false
  private dragStart: GPoint | null = null
  private dragModelPoints: GPoint[] = []
  private activeVertexIndex = -1
  private activeVisualIndex = -1
  private pickingVertex = false
  private lastPick: GPoint | null = null
  private enabled = false
  private closedShape = false
  private overlay: VisualEntity | null = null
  private handles: VisualEntity[] = []
  private midHandles: VisualEntity[] = []
  private undoStack: UndoFrame[] = []
  private pendingFrame: UndoFrame | null = null

  constructor(viewer: Viewer, cb: EditSessionCallbacks = {}) {
    this.viewer = viewer
    this.cb = cb
    this.handler = new ScreenSpaceEventHandler(viewer.canvas)
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

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      this.dragActive = false
      this.pickingVertex = false
      this.pendingFrame = null
      this.clearVisuals()
    } else {
      this.refreshVisuals()
    }
  }

  getTool(): EditorTool {
    return this.tool
  }

  setTool(tool: EditorTool): void {
    this.tool = tool
    this.dragActive = false
    this.pickingVertex = false
    this.activeVertexIndex = -1
    this.activeVisualIndex = -1
    this.refreshVisuals()
  }

  sync(): void {
    const collection = this.viewer.entities
    const present = new Set<string>()
    for (let i = 0; i < collection.values.length; i++) {
      const entity = collection.values[i] as unknown as EntityLike
      const id = entity.id
      if (id && id.startsWith(PLOT_ENTITY_PREFIX)) present.add(id)
    }
    const before = this.objects.length
    this.objects = this.objects.filter((o) => present.has(o.key))
    if (this.selectedKey && !present.has(this.selectedKey)) {
      this.selectedKey = null
      this.refreshVisuals()
    }
    if (this.objects.length !== before) {
      this.cb.onObjectsChange?.()
      this.cb.onSelectedChange?.(this.selected())
    }
    const existing = new Set(this.objects.map((o) => o.key))
    const fresh: EditableObject[] = []
    for (let i = 0; i < collection.values.length; i++) {
      const entity = collection.values[i] as unknown as EntityLike
      const id = entity.id
      if (!id || !id.startsWith(PLOT_ENTITY_PREFIX)) continue
      const shape = entityShape(entity)
      if (shape === 'none') continue
      const key = id
      if (existing.has(key)) continue
      const geoType = entity.GeoType ?? ''
      const kind = (entity as { kind?: string }).kind ?? this.kindFromGeo(geoType)
      fresh.push({
        key,
        kind,
        name:
          kindName(kind as PlottingKind) +
          '·' +
          id.slice(PLOT_ENTITY_PREFIX.length, PLOT_ENTITY_PREFIX.length + 6),
        geoType,
        shape,
        entity
      })
    }
    if (fresh.length > 0) {
      this.objects.push(...fresh)
      this.cb.onObjectsChange?.()
    }
  }

  private kindFromGeo(geoType?: string): string {
    const map: Record<string, string> = {
      FreeLine: 'free-line',
      Polyline: 'polyline',
      Curve: 'curve',
      FreePolygon: 'free-polygon',
      Polygon: 'polygon',
      RegularPolygon: 'regular-polygon',
      StraightLineArrow: 'straight-line-arrow',
      CurveLineArrow: 'curve-line-arrow',
      RightAngleArrow: 'right-angle-arrow',
      SwallowtailArrow: 'swallowtail-arrow',
      PincerArrow: 'pincer-arrow',
      AttackArrow: 'attack-arrow',
      RoundedRectangle: 'round-rectangle',
      Sector: 'sector',
      Bow: 'bow',
      StagingArea: 'staging-area',
      CurveFlag: 'flag-curve',
      RectangleFlag: 'flag-rectangle',
      RegularTriangleFlag: 'flag-regular-triangle',
      InvertedTriangleFlag: 'flag-inverted-triangle',
      TriangleFlag: 'flag-triangle'
    }
    return map[geoType ?? ''] ?? geoType ?? 'unknown'
  }

  selected(): EditableObject | null {
    if (!this.selectedKey) return null
    return this.objects.find((o) => o.key === this.selectedKey) ?? null
  }

  select(key: string | null): void {
    this.selectedKey = key
    this.dragActive = false
    this.pickingVertex = false
    this.activeVertexIndex = -1
    this.activeVisualIndex = -1
    this.cb.onSelectedChange?.(this.selected())
    this.refreshVisuals()
  }
  readPoints(object: EditableObject): GPoint[] {
    return readEntityPositions(this.viewer, object.entity)
  }

  writePoints(object: EditableObject, points: GPoint[]): void {
    writeEntityGeometry(this.viewer, object.entity, points)
  }

  private pickList(px: Cartesian2): Array<{ id?: EntityLike }> {
    try {
      return this.viewer.scene.drillPick(px) as unknown as Array<{ id?: EntityLike }>
    } catch {
      return []
    }
  }

  private pickObject(px: Cartesian2): EditableObject | null {
    for (const pick of this.pickList(px)) {
      const id = pick?.id?.id
      if (!id || isPlotVisualId(id)) continue
      if (!id.startsWith(PLOT_ENTITY_PREFIX)) continue
      const found = this.objects.find((o) => o.key === id)
      if (found) return found
    }
    return null
  }

  private pickMidSegment(object: EditableObject, px: Cartesian2): number {
    const prefix = `${PLOT_MID_PREFIX}${object.key}-`
    for (const pick of this.pickList(px)) {
      const id = pick?.id?.id
      if (!id || !id.startsWith(prefix)) continue
      const seg = Number(id.slice(prefix.length))
      if (Number.isFinite(seg) && seg >= 0 && seg < this.midHandles.length) return seg
    }
    return -1
  }

  private onLeftDown(px: Cartesian2): void {
    if (!this.enabled) return
    if (this.tool === 'select') {
      const object = this.pickObject(px)
      this.select(object ? object.key : null)
      if (object) {
        const n = this.readPoints(object).length
        this.cb.onStatus?.(`已选中 ${object.name}（${n} 个节点），可切换工具继续编辑`)
      }
      return
    }
    if (this.tool === 'vertex') {
      let object = this.selected()
      if (!object) {
        const hit = this.pickObject(px)
        if (!hit) return
        this.select(hit.key)
        object = this.selected()
      }
      if (!object) return
      const midSeg = this.pickMidSegment(object, px)
      if (midSeg >= 0) {
        this.insertAtMidpoint(object, midSeg)
        return
      }
      const ground = pickSceneDeg(this.viewer, px)
      if (!ground) return
      const points = this.readPoints(object)
      const idx = closestPointIndex(points, ground)
      this.markPending()
      this.activeVertexIndex = idx
      this.pickingVertex = true
      this.dragModelPoints = points
      this.lastPick = ground
      this.setActiveVisual(idx)
      this.cb.onStatus?.(
        `正在拖拽第 ${idx + 1}/${points.length} 个节点，左键拖拽调整位置`
      )
      return
    }
    const object = this.selected()
    if (!object) return
    const ground = pickSceneDeg(this.viewer, px)
    if (!ground) return
    this.markPending()
    this.dragStart = ground
    this.dragModelPoints = this.readPoints(object)
    this.dragActive = true
  }

  private onMouseMove(px: Cartesian2): void {
    if (!this.enabled) return
    if (this.pickingVertex && this.tool === 'vertex') {
      const object = this.selected()
      if (!object || this.activeVertexIndex < 0) return
      const ground = pickSceneDeg(this.viewer, px)
      if (!ground) return
      this.lastPick = ground
      const points = this.dragModelPoints
      if (!points[this.activeVertexIndex]) return
      points[this.activeVertexIndex] = { ...ground, alt: points[this.activeVertexIndex].alt }
      this.writePoints(object, points)
      this.syncVertexVisual(object, this.activeVertexIndex)
      return
    }
    if (!this.dragActive || !this.dragStart || this.tool === 'select' || this.tool === 'vertex') {
      return
    }
    const object = this.selected()
    if (!object) return
    const ground = pickSceneDeg(this.viewer, px)
    if (!ground) return
    const base = this.dragModelPoints
    const center = this.centerOf(base)
    let next: GPoint[] = base
    if (this.tool === 'move') {
      next = translatePoints(base, ground.lng - this.dragStart.lng, ground.lat - this.dragStart.lat)
    } else if (this.tool === 'rotate') {
      const a0 = degAngle(center, this.dragStart)
      const a1 = degAngle(center, ground)
      next = rotatePoints(base, center, a1 - a0)
    } else if (this.tool === 'scale') {
      const d0 = Math.hypot(this.dragStart.lng - center.lng, this.dragStart.lat - center.lat)
      const d1 = Math.hypot(ground.lng - center.lng, ground.lat - center.lat)
      const factor = d0 > 0 ? d1 / d0 : 1
      next = scalePoints(base, center, factor)
    }
    this.writePoints(object, next)
    this.refreshOverlayFrom(object)
  }

  private centerOf(points: GPoint[]): GPoint {
    if (points.length === 0) return { lng: 0, lat: 0, alt: 0 }
    const n = points.length
    const lng = points.reduce((s, p) => s + p.lng, 0) / n
    const lat = points.reduce((s, p) => s + p.lat, 0) / n
    const alt = points.reduce((s, p) => s + (Number.isFinite(p.alt) ? p.alt : 0), 0) / n
    return { lng, lat, alt }
  }

  private onLeftUp(): void {
    if (!this.enabled) return
    const wasVertexDrag = this.pickingVertex
    const wasTransform = this.dragActive
    this.dragActive = false
    this.pickingVertex = false
    this.dragStart = null
    if (wasVertexDrag || wasTransform) {
      this.commitPending()
      const object = this.selected()
      if (object) {
        const n = this.readPoints(object).length
        this.cb.onStatus?.(`${object.name} 已更新，当前 ${n} 个节点`)
        this.cb.onObjectsChange?.()
      }
    }
  }

  get activeIndex(): number {
    return this.activeVertexIndex
  }

  get lastPickPoint(): GPoint | null {
    return this.lastPick
  }

  insertVertex(object: EditableObject, index: number, point?: GPoint): void {
    const points = this.readPoints(object)
    if (points.length === 0) return
    const idx = index >= 0 && index < points.length ? index : points.length - 1
    const insert = point ?? this.midOf(points, idx, object.shape === 'polygon')
    if (!insert) return
    this.markPending()
    points.splice(idx + 1, 0, insert)
    this.writePoints(object, points)
    this.cb.onStatus?.(`已在 ${idx + 1} 处后插入节点，当前 ${points.length} 个点`)
    this.refreshVisuals()
    this.commitPending()
  }

  private insertAtMidpoint(object: EditableObject, segIndex: number): void {
    const points = this.readPoints(object)
    if (points.length < 2 || segIndex >= points.length) return
    const mid = this.midOf(points, segIndex, object.shape === 'polygon')
    if (!mid) return
    this.markPending()
    points.splice(segIndex + 1, 0, mid)
    this.writePoints(object, points)
    const newIndex = segIndex + 1
    this.activeVertexIndex = newIndex
    this.activeVisualIndex = newIndex
    this.refreshVisuals()
    this.cb.onStatus?.(`已在中点插入节点（第 ${newIndex + 1} 个），可直接拖拽微调`)
    this.commitPending()
  }

  removeVertex(object: EditableObject, index: number): void {
    const points = this.readPoints(object)
    const min = this.minFor(object)
    if (points.length <= min) {
      this.cb.onStatus?.(`该对象至少保留 ${min} 个顶点，不能再删除`)
      return
    }
    const idx = index >= 0 && index < points.length ? index : points.length - 1
    this.markPending()
    points.splice(idx, 1)
    this.writePoints(object, points)
    this.activeVertexIndex = -1
    this.activeVisualIndex = -1
    this.cb.onStatus?.(`已删除第 ${idx + 1} 个节点，当前 ${points.length} 个点`)
    this.refreshVisuals()
    this.commitPending()
  }

  private minFor(object: EditableObject): number {
    return object.shape === 'polyline' ? 2 : 3
  }

  removeObject(key: string): void {
    const idx = this.objects.findIndex((o) => o.key === key)
    if (idx < 0) return
    const object = this.objects[idx]
    this.markPending()
    if (this.viewer.entities.getById(key)) this.viewer.entities.removeById(key)
    this.objects.splice(idx, 1)
    if (this.selectedKey === key) {
      this.selectedKey = null
      this.activeVertexIndex = -1
      this.activeVisualIndex = -1
      this.clearVisuals()
    }
    this.cb.onSelectedChange?.(this.selected())
    this.cb.onObjectsChange?.()
    this.cb.onStatus?.(`已删除 ${object.name}`)
    this.commitPending()
  }

  clearSelection(): void {
    this.select(null)
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
    if (!this.enabled || this.undoStack.length === 0) return false
    const frame = this.undoStack.pop()
    if (!frame) return false
    this.pendingFrame = null
    this.dragActive = false
    this.pickingVertex = false
    this.activeVertexIndex = -1
    this.activeVisualIndex = -1
    this.applyFrame(frame)
    this.cb.onObjectsChange?.()
    this.cb.onUndoChanged?.()
    this.cb.onSelectedChange?.(this.selected())
    return true
  }

  private captureFrame(): UndoFrame {
    return this.objects.map((o) => {
      const style = captureObjectStyle(this.viewer, o.entity)
      return {
        key: o.key,
        kind: o.kind,
        geoType: o.geoType,
        shape: o.shape === 'polygon' ? 'polygon' : 'polyline',
        name: o.name,
        points: this.readPoints(o),
        materialCss: style.css,
        lineWidth: style.width,
        arrow: style.arrow
      }
    })
  }

  private markPending(): void {
    if (!this.enabled) return
    this.pendingFrame = this.captureFrame()
  }

  private commitPending(): void {
    const before = this.pendingFrame
    if (!before) return
    this.pendingFrame = null
    const after = this.captureFrame()
    if (!this.framesEqual(before, after)) {
      this.undoStack.push(before)
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
      this.cb.onUndoChanged?.()
    }
  }

  private framesEqual(a: UndoFrame, b: UndoFrame): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      const x = a[i]
      const y = b[i]
      if (x.key !== y.key || x.shape !== y.shape) return false
      if (x.points.length !== y.points.length) return false
      for (let j = 0; j < x.points.length; j++) {
        const pa = x.points[j]
        const pb = y.points[j]
        if (
          Math.abs(pa.lng - pb.lng) > 1e-7 ||
          Math.abs(pa.lat - pb.lat) > 1e-7
        ) {
          return false
        }
      }
    }
    return true
  }

  private applyFrame(frame: UndoFrame): void {
    const want = new Set(frame.map((u) => u.key))
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i]
      if (want.has(o.key)) continue
      const entity = this.viewer.entities.getById(o.key)
      if (entity) this.viewer.entities.removeById(o.key)
      this.objects.splice(i, 1)
    }
    const ordered: EditableObject[] = []
    for (const uo of frame) {
      let entity = this.viewer.entities.getById(uo.key) as unknown as EntityLike | null
      if (!entity) {
        entity = this.recreateEntity(uo)
      }
      if (!entity) continue
      this.writePoints({ key: uo.key, kind: uo.kind, name: uo.name, geoType: uo.geoType, shape: uo.shape, entity }, uo.points)
      ordered.push({
        key: uo.key,
        kind: uo.kind,
        name: uo.name,
        geoType: uo.geoType,
        shape: entityShape(entity),
        entity
      })
    }
    this.objects = ordered
    if (this.selectedKey && !want.has(this.selectedKey)) this.selectedKey = null
    this.refreshVisuals()
  }

  private recreateEntity(uo: UndoObject): EntityLike | null {
    if (uo.points.length === 0) return null
    const positions = toCartesian(uo.points)
    const color = uo.materialCss
      ? Color.fromCssColorString(uo.materialCss)
      : Color.fromCssColorString('#ff4d4f')
    const safeColor = color ?? Color.fromCssColorString('#ff4d4f')
    const id = uo.key
    const name = uo.name
    const created =
      uo.shape === 'polygon'
        ? this.viewer.entities.add({
            id,
            name,
            polygon: {
              hierarchy: positions,
              material: safeColor
            }
          })
        : this.viewer.entities.add({
            id,
            name,
            polyline: {
              positions,
              width: uo.lineWidth && uo.lineWidth > 0 ? uo.lineWidth : 3,
              material: uo.arrow
                ? new PolylineArrowMaterialProperty(safeColor)
                : safeColor
            }
          })
    if (created) {
      ;(created as unknown as { GeoType?: string }).GeoType = uo.geoType
      ;(created as unknown as { kind?: string }).kind = uo.kind
    }
    return (created as unknown as EntityLike) ?? null
  }

  refreshVisuals(): void {
    if (!this.enabled) {
      this.clearVisuals()
      return
    }
    const object = this.selected()
    if (!object) {
      this.clearVisuals()
      return
    }
    const points = this.readPoints(object)
    if (points.length === 0) {
      this.clearVisuals()
      return
    }
    this.clearVisuals()
    this.closedShape = object.shape === 'polygon'
    this.buildOverlay(object, points)
    if (this.tool === 'vertex') {
      this.buildVertexHandles(object, points)
      this.buildMidHandles(object, points)
    }
  }

  private clearVisuals(): void {
    const toRemove: VisualEntity[] = []
    if (this.overlay) toRemove.push(this.overlay)
    toRemove.push(...this.handles, ...this.midHandles)
    for (const entity of toRemove) {
      const id = entity.id
      if (id && this.viewer.entities.getById(id)) this.viewer.entities.removeById(id)
    }
    this.overlay = null
    this.handles = []
    this.midHandles = []
    this.closedShape = false
  }

  private styleWidth(object: EditableObject): number {
    const closed = object.shape === 'polygon'
    const raw = (object.entity as unknown as {
      polyline?: { width?: { getValue?(time?: unknown): number } | number }
    }).polyline?.width
    let original = 0
    if (typeof raw === 'number') original = raw
    else if (raw && typeof raw.getValue === 'function') {
      try {
        original = raw.getValue(this.viewer.clock.currentTime) ?? 0
      } catch {
        original = 0
      }
    }
    const base = original > 0 ? original : closed ? 3 : 6
    return closed ? Math.max(2.5, base + 1) : Math.max(4, base + 2)
  }

  private buildOverlay(object: EditableObject, points: GPoint[]): void {
    const closed = object.shape === 'polygon'
    const list = closed && points.length > 0 ? [...points, points[0]] : points
    const cart3 = toCartesian(list)
    if (cart3.length === 0) return
    const width = this.styleWidth(object)
    const material = closed
      ? HIGHLIGHT_COLOR
      : new PolylineArrowMaterialProperty(HIGHLIGHT_COLOR)
    this.overlay = this.viewer.entities.add({
      id: PLOT_OVERLAY_PREFIX + object.key,
      name: '选中高亮',
      polyline: {
        positions: cart3,
        width,
        material
      }
    }) as unknown as VisualEntity
  }

  private buildVertexHandles(_object: EditableObject, points: GPoint[]): void {
    this.handles = points.map((p, index) => {
      const isActive = index === this.activeVisualIndex
      return this.viewer.entities.add({
        id: `${PLOT_HANDLE_PREFIX}${_object.key}-${index}`,
        name: `节点 ${index + 1}`,
        position: Cartesian3.fromDegrees(p.lng, p.lat, Number.isFinite(p.alt) ? p.alt : 0),
        point: {
          pixelSize: isActive ? 12 : 9,
          color: isActive ? VERTEX_ACTIVE_COLOR : VERTEX_COLOR,
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      }) as unknown as VisualEntity
    })
  }

  private buildMidHandles(object: EditableObject, points: GPoint[]): void {
    const closed = object.shape === 'polygon'
    const count = closed ? points.length : Math.max(0, points.length - 1)
    this.midHandles = []
    for (let i = 0; i < count; i++) {
      const mid = this.midOf(points, i, closed)
      if (!mid) continue
      this.midHandles.push(
        this.viewer.entities.add({
          id: `${PLOT_MID_PREFIX}${object.key}-${i}`,
          name: `中点 ${i + 1}`,
          position: Cartesian3.fromDegrees(mid.lng, mid.lat, Number.isFinite(mid.alt) ? mid.alt : 0),
          point: {
            pixelSize: 6,
            color: MID_COLOR,
            outlineColor: MID_OUTLINE_COLOR,
            outlineWidth: 1.5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        }) as unknown as VisualEntity
      )
    }
  }

  private midOf(points: GPoint[], segIndex: number, closed: boolean): GPoint | null {
    const n = points.length
    if (n < 2 || segIndex < 0 || segIndex >= n) return null
    if (!closed && segIndex >= n - 1) return null
    const a = points[segIndex]
    const b = closed ? points[(segIndex + 1) % n] : points[segIndex + 1]
    if (!a || !b) return null
    return {
      lng: (a.lng + b.lng) / 2,
      lat: (a.lat + b.lat) / 2,
      alt: Number.isFinite(a.alt) ? a.alt : 0
    }
  }

  private setActiveVisual(index: number): void {
    if (index === this.activeVisualIndex) return
    const prev = this.handles[this.activeVisualIndex]
    const next = this.handles[index]
    sizeAssign(prev, 9)
    colorAssign(prev, VERTEX_COLOR)
    sizeAssign(next, 12)
    colorAssign(next, VERTEX_ACTIVE_COLOR)
    this.activeVisualIndex = index
  }

  private refreshOverlayFrom(object: EditableObject): void {
    if (!this.overlay) return
    const points = this.readPoints(object)
    const closed = object.shape === 'polygon'
    const list = closed && points.length > 0 ? [...points, points[0]] : points
    const cart3 = toCartesian(list)
    if (this.overlay.polyline) this.overlay.polyline.positions = cart3
  }

  private syncVertexVisual(object: EditableObject, index: number): void {
    const handle = this.handles[index]
    if (handle) {
      const p = this.dragModelPoints[index]
      if (p) handle.position = Cartesian3.fromDegrees(p.lng, p.lat, Number.isFinite(p.alt) ? p.alt : 0)
    }
    this.refreshOverlayFrom(object)
    const n = this.dragModelPoints.length
    const closed = this.closedShape
    const affected: number[] = []
    if (index > 0) affected.push(index - 1)
    if (index < n - 1) affected.push(index)
    if (closed) {
      if (!affected.includes(n - 1)) affected.push(n - 1)
      if (index === 0) affected.push(n - 1)
    }
    for (const seg of affected) this.syncMidHandle(seg)
  }

  private syncMidHandle(segIndex: number): void {
    const handle = this.midHandles[segIndex]
    if (!handle) return
    const mid = this.midOf(this.dragModelPoints, segIndex, this.closedShape)
    if (!mid) return
    handle.position = Cartesian3.fromDegrees(mid.lng, mid.lat, Number.isFinite(mid.alt) ? mid.alt : 0)
  }

  destroy(): void {
    this.enabled = false
    this.clearVisuals()
    this.handler.destroy()
  }
}
