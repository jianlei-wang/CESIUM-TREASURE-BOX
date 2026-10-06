import {
  ArcType,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  CustomDataSource,
  DistanceDisplayCondition,
  Entity,
  HorizontalOrigin,
  LabelStyle,
  Math as CesiumMath,
  NearFarScalar,
  PointPrimitive,
  PointPrimitiveCollection,
  PolygonHierarchy,
  PolylineGlowMaterialProperty,
  VerticalOrigin,
  type Viewer
} from 'cesium'

export type LonLat = [number, number]

export type ColorLike = string | Color

export function toColor(value: ColorLike, alpha = 1): Color {
  const color = typeof value === 'string' ? Color.fromCssColorString(value) : value.clone()
  if (alpha !== 1) color.alpha = alpha
  return color
}

/** 十六进制颜色按比例调亮 / 调暗。 */
export function shade(hex: string, factor: number): string {
  const normalized = hex.replace('#', '')
  const full = normalized.length === 3 ? normalized.split('').map((c) => c + c).join('') : normalized
  const num = Number.parseInt(full, 16)
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  const r = clamp(((num >> 16) & 255) * factor)
  const g = clamp(((num >> 8) & 255) * factor)
  const b = clamp((num & 255) * factor)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

export type BoxOptions = {
  size: number
  height: number
  base?: number
  color: ColorLike
  alpha?: number
  outline?: boolean
  outlineColor?: ColorLike
}

/** 在地理位置添加一根方形截面立柱。 */
export function addBox(ds: CustomDataSource, lon: number, lat: number, options: BoxOptions): Entity {
  const base = options.base ?? 0
  return ds.entities.add({
    position: Cartesian3.fromDegrees(lon, lat, base + options.height / 2),
    box: {
      dimensions: new Cartesian3(options.size, options.size, options.height),
      material: toColor(options.color, options.alpha ?? 0.9),
      outline: options.outline ?? false,
      outlineColor: options.outlineColor ? toColor(options.outlineColor) : Color.BLACK
    }
  })
}

export type CylinderOptions = {
  radius: number
  height: number
  base?: number
  color: ColorLike
  alpha?: number
  outline?: boolean
  outlineColor?: ColorLike
}

/** 在地理位置添加一根圆柱。 */
export function addCylinder(ds: CustomDataSource, lon: number, lat: number, options: CylinderOptions): Entity {
  const base = options.base ?? 0
  return ds.entities.add({
    position: Cartesian3.fromDegrees(lon, lat, base + options.height / 2),
    cylinder: {
      length: options.height,
      topRadius: options.radius,
      bottomRadius: options.radius,
      material: toColor(options.color, options.alpha ?? 0.9),
      outline: options.outline ?? false,
      outlineColor: options.outlineColor ? toColor(options.outlineColor) : Color.BLACK
    }
  })
}

export type PolygonOptions = {
  height?: number
  extrudedHeight?: number
  perPositionHeight?: boolean
  color?: ColorLike
  alpha?: number
  outline?: boolean
  outlineColor?: ColorLike
  outlineWidth?: number
  clampToGround?: boolean
}

/** 添加贴地 / 拉伸多边形。points 为 [lon, lat] 或 [lon, lat, height] 序列。 */
export function addPolygon(
  ds: CustomDataSource,
  points: Array<LonLat | [number, number, number]>,
  options: PolygonOptions = {}
): Entity {
  const hierarchy = new PolygonHierarchy(points.map((p) => Cartesian3.fromDegrees(p[0], p[1], p[2] ?? 0)))
  return ds.entities.add({
    polygon: {
      hierarchy,
      height: options.height,
      extrudedHeight: options.extrudedHeight,
      perPositionHeight: options.perPositionHeight ?? points.some((p) => p.length > 2),
      material: toColor(options.color ?? '#38bdf8', options.alpha ?? 0.7),
      outline: options.outline ?? false,
      outlineColor: options.outlineColor ? toColor(options.outlineColor) : Color.WHITE,
      outlineWidth: options.outlineWidth ?? 1
    }
  })
}

export type PolylineOptions = {
  width?: number
  color?: ColorLike
  alpha?: number
  clampToGround?: boolean
  height?: number
  arcType?: ArcType
  glow?: boolean
  glowPower?: number
}

/** 添加折线；坐标可为 [lon, lat] 或 [lon, lat, height]。 */
export function addPolyline(
  ds: CustomDataSource,
  points: Array<LonLat | [number, number, number]>,
  options: PolylineOptions = {}
): Entity {
  const flatHeight = options.height ?? 0
  const positions = points.map((p) => Cartesian3.fromDegrees(p[0], p[1], p.length > 2 ? p[2] : flatHeight))
  const material = options.glow
    ? new PolylineGlowMaterialProperty({ glowPower: options.glowPower ?? 0.2, color: toColor(options.color ?? '#38bdf8', options.alpha ?? 1) })
    : toColor(options.color ?? '#38bdf8', options.alpha ?? 1)
  return ds.entities.add({
    polyline: {
      positions,
      width: options.width ?? 2,
      material,
      clampToGround: options.clampToGround ?? false,
      arcType: options.arcType ?? ArcType.NONE
    }
  })
}

/** 基于球面线性插值采样两点之间的路径点。 */
export function geodesicPoints(
  from: LonLat,
  to: LonLat,
  segments = 64,
  heightAt?: (t: number) => number
): Array<[number, number, number]> {
  const start = Cartesian3.fromDegrees(from[0], from[1])
  const end = Cartesian3.fromDegrees(to[0], to[1])
  const out: Array<[number, number, number]> = []
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments
    const cart = Cartesian3.lerp(start, end, t, new Cartesian3())
    const carto = Cartographic.fromCartesian(cart)
    const height = heightAt ? heightAt(t) : 0
    out.push([CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude), height])
  }
  return out
}

/** 添加两点之间的弧线（可抬升高度）。 */
export function addArc(
  ds: CustomDataSource,
  from: LonLat,
  to: LonLat,
  options: PolylineOptions & { segments?: number; arcHeight?: number } = {}
): Entity {
  const segments = options.segments ?? 64
  const arcHeight = options.arcHeight ?? 0
  const points = geodesicPoints(from, to, segments, (t) => Math.sin(Math.PI * t) * arcHeight)
  return addPolyline(ds, points, options)
}

export type PointOptions = {
  pixelSize?: number
  color?: ColorLike
  alpha?: number
  outlineColor?: ColorLike
  outlineWidth?: number
  disableDepthTest?: boolean
  scaleByDistance?: [number, number, number, number]
}

export function addPoint(ds: CustomDataSource, lon: number, lat: number, options: PointOptions = {}): Entity {
  const point: Record<string, unknown> = {
    pixelSize: options.pixelSize ?? 8,
    color: toColor(options.color ?? '#38bdf8', options.alpha ?? 1),
    outlineColor: options.outlineColor ? toColor(options.outlineColor) : Color.WHITE,
    outlineWidth: options.outlineWidth ?? 1,
    disableDepthTestDistance: options.disableDepthTest ? Number.POSITIVE_INFINITY : 0
  }
  if (options.scaleByDistance) point.scaleByDistance = new NearFarScalar(...options.scaleByDistance)
  return ds.entities.add({ position: Cartesian3.fromDegrees(lon, lat), point })
}

export type LabelOptions = {
  color?: ColorLike
  alpha?: number
  font?: string
  outlineColor?: ColorLike
  outlineWidth?: number
  disableDepthTest?: boolean
  scaleByDistance?: [number, number, number, number]
  /** 屏幕像素偏移 [x, y]，y 为负表示上移。 */
  pixelOffset?: [number, number]
  /** 仅垂直像素偏移（上移为负）。 */
  pixelOffsetY?: number
}

export function addLabel(ds: CustomDataSource, lon: number, lat: number, text: string, options: LabelOptions = {}): Entity {
  const label: Record<string, unknown> = {
    text,
    font: options.font ?? '13px sans-serif',
    fillColor: toColor(options.color ?? '#e2e8f0', options.alpha ?? 1),
    outlineColor: toColor(options.outlineColor ?? '#0f172a', 0.9),
    outlineWidth: options.outlineWidth ?? 3,
    style: LabelStyle.FILL_AND_OUTLINE,
    verticalOrigin: VerticalOrigin.BOTTOM,
    horizontalOrigin: HorizontalOrigin.CENTER,
    disableDepthTestDistance: options.disableDepthTest ? Number.POSITIVE_INFINITY : 0
  }
  if (options.scaleByDistance) label.scaleByDistance = new NearFarScalar(...options.scaleByDistance)
  if (options.pixelOffset) label.pixelOffset = new Cartesian2(...options.pixelOffset)
  else if (options.pixelOffsetY !== undefined) label.pixelOffset = new Cartesian2(0, options.pixelOffsetY)
  return ds.entities.add({ position: Cartesian3.fromDegrees(lon, lat), label })
}

export type BillboardOptions = {
  scale?: number
  color?: ColorLike
  alpha?: number
  disableDepthTest?: boolean
  scaleByDistance?: [number, number, number, number]
}

export function addBillboard(ds: CustomDataSource, lon: number, lat: number, image: string, options: BillboardOptions = {}): Entity {
  const billboard: Record<string, unknown> = {
    image,
    scale: options.scale ?? 1,
    color: toColor(options.color ?? '#ffffff', options.alpha ?? 1),
    disableDepthTestDistance: options.disableDepthTest ? Number.POSITIVE_INFINITY : 0,
    verticalOrigin: VerticalOrigin.CENTER,
    horizontalOrigin: HorizontalOrigin.CENTER
  }
  if (options.scaleByDistance) billboard.scaleByDistance = new NearFarScalar(...options.scaleByDistance)
  return ds.entities.add({ position: Cartesian3.fromDegrees(lon, lat), billboard })
}

/** 使用 PointPrimitiveCollection 批量绘制海量点（性能远高于逐条 Entity）。 */
export function createPointCollection(viewer: Viewer): PointPrimitiveCollection {
  const collection = new PointPrimitiveCollection()
  viewer.scene.primitives.add(collection)
  return collection
}

export function addToPointCollection(
  collection: PointPrimitiveCollection,
  lon: number,
  lat: number,
  height: number,
  color: ColorLike,
  pixelSize = 6
): PointPrimitive {
  return collection.add({
    position: Cartesian3.fromDegrees(lon, lat, height),
    color: toColor(color),
    pixelSize
  })
}

/** 每帧变化的扩散圆环。 */
export function addPulseRing(
  ds: CustomDataSource,
  lon: number,
  lat: number,
  options: { color?: ColorLike; maxRadius?: number; period?: number; height?: number; width?: number } = {}
): Entity {
  const maxRadius = options.maxRadius ?? 60000
  const period = options.period ?? 2000
  const color = toColor(options.color ?? '#38bdf8')
  const positions = new CallbackProperty((time) => {
    const seconds = time?.secondsOfDay ?? 0
    const phase = ((((seconds * 1000) % period) + period) % period) / period
    return circlePositions(lon, lat, maxRadius * phase, options.height ?? 0)
  }, false)
  return ds.entities.add({
    polyline: {
      positions,
      width: options.width ?? 3,
      material: new PolylineGlowMaterialProperty({ glowPower: 0.25, color }),
      clampToGround: false
    }
  })
}

/** 生成以 (lon,lat) 为圆心、指定半径（米）的圆周采样点。 */
export function circlePositions(lon: number, lat: number, radiusMeters: number, height = 0, segments = 96): Cartesian3[] {
  const positions: Cartesian3[] = []
  const latRad = CesiumMath.toRadians(lat)
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    const dLon = (Math.cos(angle) * radiusMeters) / (111320 * (Math.cos(latRad) || 0.01))
    const dLat = (Math.sin(angle) * radiusMeters) / 110540
    positions.push(Cartesian3.fromDegrees(lon + dLon, lat + dLat, height))
  }
  return positions
}

/** 生成以 (lon,lat) 为圆心、指定半径（米）的圆面多边形。 */
export function circlePolygon(lon: number, lat: number, radiusMeters: number, segments = 64): LonLat[] {
  const points: LonLat[] = []
  const latRad = CesiumMath.toRadians(lat)
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    const dLon = (Math.cos(angle) * radiusMeters) / (111320 * (Math.cos(latRad) || 0.01))
    const dLat = (Math.sin(angle) * radiusMeters) / 110540
    points.push([lon + dLon, lat + dLat])
  }
  return points
}

export function distanceCondition(min: number, max: number): DistanceDisplayCondition {
  return new DistanceDisplayCondition(min, max)
}

export { Cartesian2 }
