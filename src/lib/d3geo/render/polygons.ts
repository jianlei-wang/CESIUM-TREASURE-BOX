import {
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  type Cartesian3
} from 'cesium'
import { Cartesian3 as Cart3 } from 'cesium'
import type { AggregateCell, LonLat } from '../spatial/hexbin'
import type { ContourBand } from '../analysis/contour'
import { ramp } from '../palettes'
import { normalize } from '../core/geo'

export type CellPolygonOptions = {
  /** 每个单元的颜色（CSS 颜色串）。 */
  colorOf: (cell: AggregateCell, index: number) => string
  /** 基准高度（米）。 */
  base?: number
  /** 每个单元的高度（米），返回 0 表示贴地。 */
  heightOf?: (cell: AggregateCell, index: number) => number
  alpha?: number
  /** 是否显示轮廓线。 */
  outline?: boolean
}

/**
 * 用 Primitive + 批量 GeometryInstance 渲染聚合单元（中量级海量面）。
 * 相比逐条 Entity Polygon，合并为单次/少数 DrawCall。
 */
export function renderCellPolygons(cells: AggregateCell[], options: CellPolygonOptions): Primitive | undefined {
  if (cells.length === 0) return undefined
  const alpha = options.alpha ?? 0.85
  const instances: GeometryInstance[] = []
  cells.forEach((cell, index) => {
    const cartesians: Cartesian3[] = cell.polygon.map((point: LonLat) => Cart3.fromDegrees(point[0], point[1]))
    if (cartesians.length < 3) return
    const base = options.base ?? 0
    const height = options.heightOf ? options.heightOf(cell, index) : 0
    const color = Color.fromCssColorString(options.colorOf(cell, index))
    color.alpha = alpha
    const geometry = height > 0
      ? PolygonGeometry.fromPositions({
          positions: cartesians,
          height: base,
          extrudedHeight: base + height,
          vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT
        })
      : PolygonGeometry.fromPositions({
          positions: cartesians,
          height: base,
          vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT
        })
    instances.push(
      new GeometryInstance({
        geometry,
        attributes: { color: ColorGeometryInstanceAttribute.fromColor(color) },
        id: { kind: 'cell', key: cell.key, cell }
      })
    )
  })
  if (instances.length === 0) return undefined
  return new Primitive({
    geometryInstances: instances,
    appearance: new PerInstanceColorAppearance({
      flat: true,
      translucent: alpha < 1,
      closed: false
    }),
    asynchronous: false
  })
}

export type ContourRenderOptions = {
  palette?: string
  /** 最大抬升高度（米）。 */
  extrude?: number
  base?: number
  alpha?: number
  /** 按数值映射高度；否则各层等厚。 */
  heightByValue?: boolean
}

/** 用 Primitive 批量渲染 d3.contours 生成的等值面（支持多环与抬升成地形）。 */
export function renderContourBands(bands: ContourBand[], options: ContourRenderOptions = {}): Primitive | undefined {
  if (bands.length === 0) return undefined
  const palette = options.palette ?? 'viridis'
  const extrude = options.extrude ?? 0
  const base = options.base ?? 0
  const alpha = options.alpha ?? 0.85
  const heightByValue = options.heightByValue ?? true
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const band of bands) {
    if (band.value < min) min = band.value
    if (band.value > max) max = band.value
  }
  const instances: GeometryInstance[] = []
  bands.forEach((band, index) => {
    const t = bands.length > 1 ? index / (bands.length - 1) : 1
    const height = extrude > 0 ? (heightByValue ? normalize(band.value, min, max) : t) * extrude : 0
    const color = Color.fromCssColorString(ramp(palette, t))
    color.alpha = alpha
    for (const polygon of band.polygons) {
      const outer = polygon[0]?.map((point: LonLat) => Cart3.fromDegrees(point[0], point[1])) ?? []
      if (outer.length < 3) continue
      const holes = polygon
        .slice(1)
        .map((ring) => new PolygonHierarchy(ring.map((point: LonLat) => Cart3.fromDegrees(point[0], point[1]))))
        .filter((hierarchy) => hierarchy.positions.length >= 3)
      const geometry = new PolygonGeometry({
        polygonHierarchy: new PolygonHierarchy(outer, holes),
        height: base,
        extrudedHeight: base + height > base ? base + height : undefined,
        vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT
      })
      instances.push(
        new GeometryInstance({
          geometry,
          attributes: { color: ColorGeometryInstanceAttribute.fromColor(color) },
          id: { kind: 'contour', value: band.value }
        })
      )
    }
  })
  if (instances.length === 0) return undefined
  return new Primitive({
    geometryInstances: instances,
    appearance: new PerInstanceColorAppearance({ flat: true, translucent: alpha < 1, closed: false }),
    asynchronous: false
  })
}
