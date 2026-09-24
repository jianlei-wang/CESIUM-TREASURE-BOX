import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  GroundPolylineGeometry,
  GroundPolylinePrimitive,
  GroundPrimitive,
  HeightReference,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  Material,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  PolylineCollection,
  PolylineColorAppearance,
  PolylineMaterialAppearance,
  Primitive,
  VerticalOrigin,
  type Viewer
} from 'cesium'
import { GRID_LIFT_METERS, type GridBuild, type GridPolygon, type GridRenderMode, type GridStyle, type GridType, type LonLat } from './types'

type LayerBundle = {
  lines?: PolylineCollection
  fill?: Primitive
  labels?: LabelCollection
}

const LABEL_LIMIT = 220
const FILL_LIMIT = 1500
/** 三维网格体逐层剖分时的立体单元总数上限，避免几何量失控。 */
const SOLID_INSTANCE_LIMIT = 24000

/** 多边形/贴地折线顶点使用经纬度二元组（高度由几何体或地面钳制统一决定）。 */
function flattenPairs(points: LonLat[]): number[] {
  const out: number[] = []
  for (const point of points) {
    out.push(point.lon, point.lat)
  }
  return out
}

function flattenDegrees(points: LonLat[], height: number): number[] {
  const out: number[] = []
  for (const point of points) {
    out.push(point.lon, point.lat, height)
  }
  return out
}

function closedPoints(points: LonLat[]): LonLat[] {
  if (points.length < 3) return points
  const first = points[0]
  const last = points[points.length - 1]
  if (Math.abs(first.lon - last.lon) < 1e-9 && Math.abs(first.lat - last.lat) < 1e-9) return points
  return [...points, { ...first }]
}

/**
 * 公共渲染内核：四类网格引擎共享同一套批量渲染器。
 *   ground 模式（二维贴地）→ GroundPolylinePrimitive 真实贴地线 + GroundPrimitive 贴地面 + 贴地标注
 *   solid  模式（三维网格体）→ 自地面拉伸的 PolygonGeometry + 顶部 PolylineCollection
 *
 * ground 模式把四类网格合并为「线 / 面」各 1 个地面图元（每实例独立配色），
 * 每帧仅 2 次地面分类；当相机高度超过贴地阈值时降级为抬升椭球面渲染，保证全球视角流畅。
 */
export class GridRenderer {
  private readonly viewer: Viewer
  private readonly bundles: Record<GridType, LayerBundle> = {
    graticule: {},
    beidou: {},
    hydro: {},
    dggs: {}
  }
  private highlight?: PolylineCollection | GroundPolylinePrimitive
  private groundClamp = true
  private frameActive = false
  private readonly frameLines: GeometryInstance[] = []
  private readonly frameFills: GeometryInstance[] = []
  private groundLines?: GroundPolylinePrimitive
  private groundFills?: GroundPrimitive

  constructor(viewer: Viewer) {
    this.viewer = viewer
  }

  private groundLinesSupported(): boolean {
    if (this.viewer.isDestroyed()) return false
    try {
      return GroundPolylinePrimitive.isSupported(this.viewer.scene)
    } catch {
      return false
    }
  }

  private groundFillSupported(): boolean {
    if (this.viewer.isDestroyed()) return false
    try {
      return GroundPrimitive.isSupported(this.viewer.scene)
    } catch {
      return false
    }
  }

  /** 是否启用真实贴地渲染（相机超出阈值时由调用方置为 false）。 */
  setGroundClamp(enabled: boolean): void {
    this.groundClamp = enabled
  }

  /** 开始一个渲染帧：清空跨图层的地面缓存并移除上一帧的地面图元。 */
  beginFrame(): void {
    this.frameActive = true
    this.frameLines.length = 0
    this.frameFills.length = 0
    this.removeGroundPrimitives()
  }

  /** 结束渲染帧：把四类网格的地面线 / 面各自合并为 1 个图元提交。 */
  endFrame(): void {
    this.frameActive = false
    if (this.viewer.isDestroyed()) {
      this.frameLines.length = 0
      this.frameFills.length = 0
      return
    }
    if (this.frameLines.length && this.groundLinesSupported()) {
      const primitive = new GroundPolylinePrimitive({
        geometryInstances: this.frameLines.slice(),
        appearance: new PolylineColorAppearance({ translucent: true }),
        asynchronous: false
      })
      this.viewer.scene.primitives.add(primitive)
      this.groundLines = primitive
    }
    if (this.frameFills.length && this.groundFillSupported()) {
      const primitive = new GroundPrimitive({
        geometryInstances: this.frameFills.slice(),
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
        asynchronous: false
      })
      this.viewer.scene.primitives.add(primitive)
      this.groundFills = primitive
    }
    this.frameLines.length = 0
    this.frameFills.length = 0
  }

  update(type: GridType, build: GridBuild, style: GridStyle): void {
    this.disposeBundle(type)
    if (this.viewer.isDestroyed() || !style.enabled) return

    const bundle: LayerBundle = {}
    const solid = style.renderMode === 'solid'
    const stroke = Color.fromCssColorString(style.strokeColor).withAlpha(style.strokeAlpha)
    const lineHeight = solid ? style.solidHeight : GRID_LIFT_METERS
    const clampMode = this.frameActive && !solid && this.groundClamp
    // 三维网格体：以多边形单元构建完整线框（底环 / 各层顶环 / 竖直棱），
    // 使填充透明为 0 时仍能看清网格体的立体边界与高度分层。
    const solidWire = solid && build.polygons.length > 0

    if (solidWire) {
      const wire = this.createSolidWire(build.polygons, style, stroke)
      if (wire) {
        this.viewer.scene.primitives.add(wire)
        bundle.lines = wire
      }
    } else if (build.lines.length) {
      if (clampMode && this.groundLinesSupported()) {
        for (const line of build.lines) {
          if (line.points.length < 2) continue
          this.frameLines.push(
            new GeometryInstance({
              geometry: new GroundPolylineGeometry({
                positions: Cartesian3.fromDegreesArray(flattenPairs(line.points)),
                width: style.strokeWidth
              }),
              attributes: { color: ColorGeometryInstanceAttribute.fromColor(stroke) }
            })
          )
        }
      } else {
        const collection = new PolylineCollection()
        for (const line of build.lines) {
          if (line.points.length < 2) continue
          collection.add({
            positions: Cartesian3.fromDegreesArrayHeights(flattenDegrees(line.points, lineHeight)),
            width: style.strokeWidth,
            material: Material.fromType('Color', { color: stroke }),
            arcType: solid ? ArcType.NONE : ArcType.GEODESIC
          })
        }
        if (collection.length > 0) {
          this.viewer.scene.primitives.add(collection)
          bundle.lines = collection
        } else {
          collection.destroy()
        }
      }
    }

    // 贴地填充受 FILL_LIMIT 约束（逐单元地面分类代价高）；抬升/立体填充走单一批量 Primitive，放宽至立体实例上限。
    const maxFillPolygons = clampMode ? FILL_LIMIT : SOLID_INSTANCE_LIMIT
    if (style.fillAlpha > 0 && build.polygons.length && build.polygons.length <= maxFillPolygons) {
      const fillColor = Color.fromCssColorString(style.fillColor).withAlpha(solid ? Math.max(style.fillAlpha, 0.25) : style.fillAlpha)
      const fillAttribute = ColorGeometryInstanceAttribute.fromColor(fillColor)
      if (clampMode && this.groundFillSupported()) {
        for (const polygon of build.polygons) {
          if (polygon.ring.length < 3) continue
          this.frameFills.push(
            new GeometryInstance({
              geometry: new PolygonGeometry({
                polygonHierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(flattenPairs(polygon.ring))),
                vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT
              }),
              attributes: { color: fillAttribute }
            })
          )
        }
      } else {
        const instances: GeometryInstance[] = []
        const solidAlpha = Math.max(style.fillAlpha, 0.25)
        const baseColor = Color.fromCssColorString(style.fillColor)
        for (const polygon of build.polygons) {
          if (polygon.ring.length < 3) continue
          if (instances.length >= SOLID_INSTANCE_LIMIT) break
          if (solid && polygon.solidLayers && polygon.solidLayers.length) {
            const positions = Cartesian3.fromDegreesArray(flattenPairs(polygon.ring))
            polygon.solidLayers.forEach((layer, layerIndex) => {
              if (instances.length >= SOLID_INSTANCE_LIMIT) return
              const factor = layerIndex % 2 === 0 ? 1 : 0.62
              const layerColor = Color.multiplyByScalar(baseColor, factor, new Color()).withAlpha(solidAlpha)
              instances.push(
                new GeometryInstance({
                  geometry: new PolygonGeometry({
                    polygonHierarchy: new PolygonHierarchy(positions),
                    height: layer.base,
                    extrudedHeight: layer.top,
                    vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT
                  }),
                  attributes: { color: ColorGeometryInstanceAttribute.fromColor(layerColor) }
                })
              )
            })
            continue
          }
          const geometry = solid
            ? new PolygonGeometry({
                polygonHierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(flattenPairs(polygon.ring))),
                height: 0,
                extrudedHeight: style.solidHeight,
                vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT
              })
            : new PolygonGeometry({
                polygonHierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(flattenPairs(polygon.ring))),
                height: GRID_LIFT_METERS,
                vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT
              })
          instances.push(new GeometryInstance({ geometry, attributes: { color: fillAttribute } }))
        }
        if (instances.length) {
          const primitive = new Primitive({
            geometryInstances: instances,
            appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
            asynchronous: false
          })
          this.viewer.scene.primitives.add(primitive)
          bundle.fill = primitive
        }
      }
    }

    if (style.labelVisible && build.labels.length) {
      const ground = clampMode && this.groundLinesSupported()
      const labels = new LabelCollection({ scene: this.viewer.scene })
      const fill = Color.fromCssColorString(style.strokeColor).withAlpha(Math.min(1, style.strokeAlpha + 0.15))
      for (const item of build.labels.slice(0, LABEL_LIMIT)) {
        labels.add({
          position: ground
            ? Cartesian3.fromDegrees(item.position.lon, item.position.lat)
            : Cartesian3.fromDegrees(item.position.lon, item.position.lat, lineHeight + 40),
          heightReference: ground ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
          text: item.text,
          font: '11px "DM Mono", monospace',
          fillColor: fill,
          outlineColor: Color.fromCssColorString('#04101c').withAlpha(0.85),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          scale: 0.92,
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(0, 0)
        })
      }
      if (labels.length) {
        this.viewer.scene.primitives.add(labels)
        bundle.labels = labels
      } else {
        labels.destroy()
      }
    }

    this.bundles[type] = bundle
  }

  /**
   * 构建三维网格体线框：每个单元绘制底环、各高度层顶环（或整体顶环）与竖直棱。
   * 线段总数受上限约束，超出时按单元顺序截断，避免几何量失控。
   */
  private createSolidWire(polygons: GridPolygon[], style: GridStyle, stroke: Color): PolylineCollection | undefined {
    const collection = new PolylineCollection()
    const bottom = GRID_LIFT_METERS
    const top = style.solidHeight
    const limit = 200000
    let segments = 0
    for (const polygon of polygons) {
      const ring = polygon.ring
      if (ring.length < 3) continue
      const addRing = (height: number): void => {
        collection.add({
          positions: Cartesian3.fromDegreesArrayHeights(flattenDegrees(ring, height)),
          width: style.strokeWidth,
          material: Material.fromType('Color', { color: stroke }),
          arcType: ArcType.NONE
        })
        segments += ring.length
      }
      addRing(bottom)
      if (polygon.solidLayers && polygon.solidLayers.length) {
        for (const layer of polygon.solidLayers) addRing(layer.top)
      } else {
        addRing(top)
      }
      for (const point of ring) {
        collection.add({
          positions: Cartesian3.fromDegreesArrayHeights([point.lon, point.lat, bottom, point.lon, point.lat, top]),
          width: style.strokeWidth,
          material: Material.fromType('Color', { color: stroke }),
          arcType: ArcType.NONE
        })
        segments += 1
      }
      if (segments > limit) break
    }
    if (collection.length === 0) {
      collection.destroy()
      return undefined
    }
    return collection
  }

  /** 高亮指定单元：独立几何，贴地模式下真实贴合地面。 */
  setHighlight(ring: LonLat[] | null, mode: GridRenderMode = 'ground', solidHeight = 0): void {
    if (this.highlight) {
      if (!this.viewer.isDestroyed()) this.viewer.scene.primitives.remove(this.highlight)
      this.highlight = undefined
    }
    if (!ring || ring.length < 3 || this.viewer.isDestroyed()) return
    const closed = closedPoints(ring)
    const color = Color.fromCssColorString('#ffd166').withAlpha(0.95)
    if (mode === 'ground' && this.groundClamp && this.groundLinesSupported()) {
      const primitive = new GroundPolylinePrimitive({
        geometryInstances: new GeometryInstance({
          geometry: new GroundPolylineGeometry({ positions: Cartesian3.fromDegreesArray(flattenPairs(closed)), width: 2.4 })
        }),
        appearance: new PolylineMaterialAppearance({ material: Material.fromType('Color', { color }) }),
        asynchronous: false
      })
      this.viewer.scene.primitives.add(primitive)
      this.highlight = primitive
      return
    }
    const collection = new PolylineCollection()
    collection.add({
      positions: Cartesian3.fromDegreesArrayHeights(flattenDegrees(closed, mode === 'solid' ? solidHeight + 30 : GRID_LIFT_METERS + 30)),
      width: 2.4,
      material: Material.fromType('Color', { color }),
      arcType: mode === 'solid' ? ArcType.NONE : ArcType.GEODESIC
    })
    this.viewer.scene.primitives.add(collection)
    this.highlight = collection
  }

  private removeGroundPrimitives(): void {
    if (this.viewer.isDestroyed()) {
      this.groundLines = undefined
      this.groundFills = undefined
      return
    }
    if (this.groundLines) this.viewer.scene.primitives.remove(this.groundLines)
    if (this.groundFills) this.viewer.scene.primitives.remove(this.groundFills)
    this.groundLines = undefined
    this.groundFills = undefined
  }

  private disposeBundle(type: GridType): void {
    const bundle = this.bundles[type]
    if (this.viewer.isDestroyed()) {
      this.bundles[type] = {}
      return
    }
    if (bundle.lines) this.viewer.scene.primitives.remove(bundle.lines)
    if (bundle.fill) this.viewer.scene.primitives.remove(bundle.fill)
    if (bundle.labels) this.viewer.scene.primitives.remove(bundle.labels)
    this.bundles[type] = {}
  }

  dispose(): void {
    if (this.viewer.isDestroyed()) return
    ;(['graticule', 'beidou', 'hydro', 'dggs'] as GridType[]).forEach((type) => this.disposeBundle(type))
    this.removeGroundPrimitives()
    if (this.highlight) {
      this.viewer.scene.primitives.remove(this.highlight)
      this.highlight = undefined
    }
  }
}
