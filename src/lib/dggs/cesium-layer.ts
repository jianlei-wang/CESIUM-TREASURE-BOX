import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  HeightReference,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  Material,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  PolylineCollection,
  Primitive,
  VerticalOrigin,
  type Viewer
} from 'cesium'
import type { Feature, Polygon } from 'geojson'

export type DggsPolygonStyle = {
  fillColor?: string | null
  fillAlpha?: number
  lineColor?: string | null
  lineWidth?: number
  /** 网格相对椭球面的抬升高度（米），用于避免与底图 Z-fighting。 */
  lift?: number
}

export type DggsLabelItem = {
  lon: number
  lat: number
  text: string
}

type Disposable = { destroy(): void }

const LIFTED_FILL_LIMIT = 24000
const LABEL_LIMIT = 260
const DEFAULT_LIFT = 20

/** 展开多边形外环 / 内环的经纬度顶点（二元组），高度由 PolygonGeometry 的 height 统一决定。 */
function ringToFlat(ring: number[][]): number[] {
  const out: number[] = []
  for (const point of ring) {
    out.push(point[0], point[1])
  }
  return out
}

function hierarchyOf(feature: Feature<Polygon>): PolygonHierarchy | undefined {
  const rings = feature.geometry.coordinates
  if (!rings.length) return undefined
  const usable = rings.filter((ring) => ring.length >= 3)
  if (!usable.length) return undefined
  const outer = Cartesian3.fromDegreesArray(ringToFlat(usable[0]))
  const holes = usable
    .slice(1)
    .map((ring) => new PolygonHierarchy(Cartesian3.fromDegreesArray(ringToFlat(ring))))
  return new PolygonHierarchy(outer, holes)
}

function featureId(feature: Feature<Polygon>, index: number): string {
  return feature.id === undefined || feature.id === null ? `cell-${index}` : String(feature.id)
}

/**
 * DGGS 单元的 Cesium 渲染层。
 * 每个渲染帧先 clear() 再按需调用 renderPolygons()/renderLabels()。
 *
 * 采用抬升的普通 Primitive / PolylineCollection 而非贴地图元：贴地分类（GroundPrimitive /
 * GroundPolylinePrimitive）与 CLAMP_TO_GROUND 标注会在每帧重复分类，单元数较多时帧率急剧下降。
 * 由于本场景底图为无地形椭球，抬升数米即可视觉贴合且不影响性能。
 *
 * 每个几何实例 / 折线都写入单元 ID，配合 pickCellId() 可直接拾取渲染实例，避免坐标反算偏差。
 */
export class DggsCesiumLayer {
  private readonly viewer: Viewer
  private readonly resources: Disposable[] = []

  constructor(viewer: Viewer) {
    this.viewer = viewer
  }

  private add(resource: Disposable): void {
    this.viewer.scene.primitives.add(resource as never)
    this.resources.push(resource)
  }

  clear(): void {
    if (!this.viewer.isDestroyed()) {
      for (const resource of this.resources) {
        try {
          this.viewer.scene.primitives.remove(resource as never)
        } catch {
          /* 图元可能已随场景销毁，忽略 */
        }
      }
    }
    this.resources.length = 0
  }

  renderPolygons(features: Feature<Polygon>[], style: DggsPolygonStyle): void {
    if (this.viewer.isDestroyed() || features.length === 0) return
    const lift = style.lift ?? DEFAULT_LIFT
    this.renderFills(features, style, lift)
    this.renderLines(features, style, lift)
  }

  private renderFills(features: Feature<Polygon>[], style: DggsPolygonStyle, lift: number): void {
    if (!style.fillColor) return
    const alpha = style.fillAlpha ?? 0.1
    if (alpha <= 0) return
    const color = Color.fromCssColorString(style.fillColor).withAlpha(alpha)
    const attribute = ColorGeometryInstanceAttribute.fromColor(color)

    const instances: GeometryInstance[] = []
    for (let index = 0; index < features.length; index += 1) {
      if (instances.length >= LIFTED_FILL_LIMIT) break
      const feature = features[index]
      const hierarchy = hierarchyOf(feature)
      if (!hierarchy) continue
      instances.push(
        new GeometryInstance({
          id: featureId(feature, index),
          geometry: new PolygonGeometry({
            polygonHierarchy: hierarchy,
            height: lift,
            vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT
          }),
          attributes: { color: attribute }
        })
      )
    }
    if (instances.length) {
      this.add(
        new Primitive({
          geometryInstances: instances,
          appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
          asynchronous: false
        })
      )
    }
  }

  private renderLines(features: Feature<Polygon>[], style: DggsPolygonStyle, lift: number): void {
    if (!style.lineColor) return
    const width = style.lineWidth ?? 1
    if (width <= 0) return
    const color = Color.fromCssColorString(style.lineColor)
    const lineHeight = lift + 6

    const collection = new PolylineCollection()
    for (let index = 0; index < features.length; index += 1) {
      const feature = features[index]
      const id = featureId(feature, index)
      for (const ring of feature.geometry.coordinates) {
        if (ring.length < 2) continue
        const flat: number[] = []
        for (const point of ring) {
          flat.push(point[0], point[1], lineHeight)
        }
        collection.add({
          id,
          positions: Cartesian3.fromDegreesArrayHeights(flat),
          width,
          material: Material.fromType('Color', { color }),
          arcType: ArcType.GEODESIC
        })
      }
    }
    if (collection.length) {
      this.add(collection)
    } else {
      collection.destroy()
    }
  }

  renderLabels(items: DggsLabelItem[], style: DggsPolygonStyle): void {
    if (this.viewer.isDestroyed() || items.length === 0) return
    const lift = (style.lift ?? DEFAULT_LIFT) + 40
    const fill = Color.fromCssColorString(style.lineColor ?? '#e2e8f0').withAlpha(0.92)
    const labels = new LabelCollection({ scene: this.viewer.scene })
    for (const item of items.slice(0, LABEL_LIMIT)) {
      labels.add({
        position: Cartesian3.fromDegrees(item.lon, item.lat, lift),
        heightReference: HeightReference.NONE,
        text: item.text,
        font: '11px ui-monospace, SFMono-Regular, Menlo, monospace',
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
      this.add(labels)
    } else {
      labels.destroy()
    }
  }

  /** 直接拾取光标下已渲染的 DGGS 实例 ID；未命中返回 null。 */
  pickCellId(position: Cartesian2): string | null {
    if (this.viewer.isDestroyed()) return null
    let picked: unknown
    try {
      picked = this.viewer.scene.pick(position)
    } catch {
      return null
    }
    if (!picked || typeof picked !== 'object') return null
    const id = (picked as { id?: unknown }).id
    return typeof id === 'string' ? id : null
  }

  dispose(): void {
    this.clear()
  }
}
