import { Cartesian3, Color, ConstantProperty, type Entity, type Viewer } from 'cesium'
import { PolylineMaterialProperty, type PolylineMaterialKind, type PolylineMaterialOptions } from './materials'

export const POLYLINE_ENTITY_PREFIX = 'dc-polyline-'

export type PolylineEntityOptions = {
  id: string
  positions: Array<[number, number, number]>
  kind: PolylineMaterialKind
  width?: number
  material?: PolylineMaterialOptions
}

export function segmentId(baseId: string, index: number): string {
  return `${baseId}-seg-${index}`
}

export const DEFAULT_LINE_POSITIONS: Array<[number, number, number]> = [
  [116.391, 39.907, 1000],
  [117.191, 39.125, 1000],
  [117.121, 36.651, 1000],
  [113.623, 34.747, 1000],
  [114.305, 30.593, 1000]
]

function toCartesianArray(positions: Array<[number, number, number]>): Cartesian3[] {
  return positions.map(([lon, lat, height]) => Cartesian3.fromDegrees(lon, lat, height))
}

export function createPolylineEntity(viewer: Viewer, options: PolylineEntityOptions): Entity {
  removePolylineEntity(viewer, options.id)
  const id = `${POLYLINE_ENTITY_PREFIX}${options.id}`
  const material = new PolylineMaterialProperty(options.kind, options.material)
  return viewer.entities.add({
    id,
    polyline: {
      positions: new ConstantProperty(toCartesianArray(options.positions)),
      width: new ConstantProperty(options.width ?? 8),
      material
    }
  })
}

export function updatePolylineEntity(
  viewer: Viewer | undefined,
  id: string,
  patch: {
    positions?: Array<[number, number, number]>
    width?: number
    material?: PolylineMaterialOptions
  }
): void {
  if (!viewer || viewer.isDestroyed()) return
  const entity = viewer.entities.getById(`${POLYLINE_ENTITY_PREFIX}${id}`)
  if (!entity) return
  const polyline = (entity as Entity).polyline
  if (!polyline) return
  if (patch.positions) {
    polyline.positions = new ConstantProperty(toCartesianArray(patch.positions))
  }
  if (patch.width !== undefined) {
    polyline.width = new ConstantProperty(patch.width)
  }
  if (patch.material) {
    const material = polyline.material
    if (material instanceof PolylineMaterialProperty) {
      if (patch.material.color) material.color = patch.material.color
      if (patch.material.speed !== undefined) material.speed = patch.material.speed
      if (patch.material.percent !== undefined) material.percent = patch.material.percent
      if (patch.material.gradient !== undefined) material.gradient = patch.material.gradient
      if (patch.material.repeatX !== undefined) material.repeatX = patch.material.repeatX
      if (patch.material.repeatY !== undefined) material.repeatY = patch.material.repeatY
      if (patch.material.image !== undefined) material.image = patch.material.image
      if (patch.material.dashLength !== undefined) material.dashLength = patch.material.dashLength
      if (patch.material.dashPattern !== undefined) material.dashPattern = patch.material.dashPattern
      if (patch.material.maskLength !== undefined) material.maskLength = patch.material.maskLength
      if (patch.material.outlineWidth !== undefined) material.outlineWidth = patch.material.outlineWidth
      if (patch.material.outlineColor) material.outlineColor = patch.material.outlineColor
      if (patch.material.directionColor) material.directionColor = patch.material.directionColor
      if (patch.material.repeatFactor !== undefined) material.repeatFactor = patch.material.repeatFactor
      if (patch.material.antiClockWise !== undefined) material.antiClockWise = patch.material.antiClockWise
    }
  }
}

export function removePolylineEntity(viewer: Viewer | undefined, id: string): void {
  if (!viewer || viewer.isDestroyed()) return
  const entity = viewer.entities.getById(`${POLYLINE_ENTITY_PREFIX}${id}`)
  if (entity) viewer.entities.remove(entity)
}

export function createColoredLineSegments(
  viewer: Viewer,
  baseId: string,
  positions: Array<[number, number, number]>,
  options: {
    kind: PolylineMaterialKind
    width: number
    colors: Color[]
    material?: Omit<PolylineMaterialOptions, 'color'>
  }
): number {
  removeColoredLineSegments(viewer, baseId)
  const colors = options.colors
  const segments: Array<Array<[number, number, number]>> = []
  for (let i = 0; i < positions.length - 1; i++) {
    segments.push([positions[i], positions[i + 1]])
  }
  for (let i = 0; i < segments.length; i++) {
    const id = segmentId(baseId, i)
    const color = colors[i % colors.length]
    const material = new PolylineMaterialProperty(options.kind, { ...(options.material ?? {}), color })
    viewer.entities.add({
      id: `${POLYLINE_ENTITY_PREFIX}${id}`,
      polyline: {
        positions: new ConstantProperty(toCartesianArray(segments[i])),
        width: new ConstantProperty(options.width),
        material
      }
    })
  }
  return segments.length
}

export function updateColoredLineSegments(
  viewer: Viewer | undefined,
  baseId: string,
  patch: {
    positions?: Array<[number, number, number]>
    width?: number
    colors?: Color[]
    material?: Omit<PolylineMaterialOptions, 'color'>
  }
): void {
  if (!viewer || viewer.isDestroyed()) return
  const colors = patch.colors
  const positions = patch.positions
  let i = 0
  while (true) {
    const entity = viewer.entities.getById(`${POLYLINE_ENTITY_PREFIX}${segmentId(baseId, i)}`)
    if (!entity) break
    const polyline = (entity as Entity).polyline
    if (polyline) {
      if (positions && i < positions.length - 1) {
        polyline.positions = new ConstantProperty(toCartesianArray([positions[i], positions[i + 1]]))
      }
      if (patch.width !== undefined) {
        polyline.width = new ConstantProperty(patch.width)
      }
      const material = polyline.material
      if (material instanceof PolylineMaterialProperty) {
        if (colors && colors[i % colors.length]) material.color = colors[i % colors.length]
        if (patch.material?.speed !== undefined) material.speed = patch.material.speed
        if (patch.material?.percent !== undefined) material.percent = patch.material.percent
        if (patch.material?.gradient !== undefined) material.gradient = patch.material.gradient
      }
    }
    i++
  }
}

export function removeColoredLineSegments(viewer: Viewer | undefined, baseId: string): void {
  if (!viewer || viewer.isDestroyed()) return
  let i = 0
  while (true) {
    const entity = viewer.entities.getById(`${POLYLINE_ENTITY_PREFIX}${segmentId(baseId, i)}`)
    if (!entity) break
    viewer.entities.remove(entity)
    i++
  }
}
