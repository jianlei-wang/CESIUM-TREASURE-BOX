import {
  Cartesian3,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  type Entity,
  type Viewer
} from 'cesium'
import { DcCircleMaterialProperty, RADAR_OUTER_TYPE } from './materials'

export const DC_EFFECT_ENTITY_PREFIX = 'dc-effect-'
export const DC_EFFECT_RING_PREFIX = 'dc-effect-ring-'

export type DcEffectEntityOptions = {
  type: string
  lon: number
  lat: number
  height?: number
  radius: number
  color: Color
  speed?: number
}

export function createDcEffectEntity(viewer: Viewer, options: DcEffectEntityOptions): Entity {
  const id = `${DC_EFFECT_ENTITY_PREFIX}${options.type}`
  const property = new DcCircleMaterialProperty(options.type, {
    color: options.color,
    speed: options.speed ?? 3
  })
  return viewer.entities.add({
    id,
    position: new ConstantPositionProperty(
      Cartesian3.fromDegrees(options.lon, options.lat, options.height ?? 0)
    ),
    ellipse: {
      semiMajorAxis: new ConstantProperty(options.radius),
      semiMinorAxis: new ConstantProperty(options.radius),
      height: new ConstantProperty(options.height ?? 0),
      material: property
    }
  })
}

export function updateDcEffectEntity(viewer: Viewer | undefined, type: string, options: Partial<DcEffectEntityOptions>): void {
  if (!viewer || viewer.isDestroyed()) return
  const entity = viewer.entities.getById(`${DC_EFFECT_ENTITY_PREFIX}${type}`)
  if (!entity) return
  const ellipse = (entity as Entity).ellipse
  if (!ellipse) return
  if (options.radius !== undefined) {
    ellipse.semiMajorAxis = new ConstantProperty(options.radius)
    ellipse.semiMinorAxis = new ConstantProperty(options.radius)
  }
  if (options.height !== undefined && options.height !== null) {
    ellipse.height = new ConstantProperty(options.height)
  }
  if (options.lon !== undefined && options.lat !== undefined) {
    entity.position = new ConstantPositionProperty(
      Cartesian3.fromDegrees(options.lon, options.lat, options.height ?? 0)
    )
  }
  const material = ellipse.material
  if (material instanceof DcCircleMaterialProperty) {
    if (options.color) material.color = options.color
    if (options.speed !== undefined) material.speed = options.speed
  }
}

export function removeDcEffectEntity(viewer: Viewer | undefined, type: string): void {
  if (!viewer || viewer.isDestroyed()) return
  const entity = viewer.entities.getById(`${DC_EFFECT_ENTITY_PREFIX}${type}`)
  if (entity) viewer.entities.remove(entity)
}

export type DcEffectRingOptions = {
  type: string
  lon: number
  lat: number
  height?: number
  radius: number
  color: Color
  speed?: number
  repeat?: number
  thickness?: number
}

export function createDcEffectRingEntity(viewer: Viewer, options: DcEffectRingOptions): Entity {
  const id = `${DC_EFFECT_RING_PREFIX}${options.type}`
  const property = new DcCircleMaterialProperty(RADAR_OUTER_TYPE, {
    color: options.color,
    speed: options.speed ?? 3,
    repeat: options.repeat ?? 30,
    thickness: options.thickness ?? 0.3
  })
  return viewer.entities.add({
    id,
    position: new ConstantPositionProperty(
      Cartesian3.fromDegrees(options.lon, options.lat, options.height ?? 0)
    ),
    ellipse: {
      semiMajorAxis: new ConstantProperty(options.radius),
      semiMinorAxis: new ConstantProperty(options.radius),
      height: new ConstantProperty(options.height ?? 0),
      material: property
    }
  })
}

export function updateDcEffectRingEntity(
  viewer: Viewer | undefined,
  type: string,
  options: Partial<DcEffectRingOptions>
): void {
  if (!viewer || viewer.isDestroyed()) return
  const entity = viewer.entities.getById(`${DC_EFFECT_RING_PREFIX}${type}`)
  if (!entity) return
  const ellipse = (entity as Entity).ellipse
  if (!ellipse) return
  if (options.radius !== undefined) {
    ellipse.semiMajorAxis = new ConstantProperty(options.radius)
    ellipse.semiMinorAxis = new ConstantProperty(options.radius)
  }
  if (options.height !== undefined && options.height !== null) {
    ellipse.height = new ConstantProperty(options.height)
  }
  if (options.lon !== undefined && options.lat !== undefined) {
    entity.position = new ConstantPositionProperty(
      Cartesian3.fromDegrees(options.lon, options.lat, options.height ?? 0)
    )
  }
  const material = ellipse.material
  if (material instanceof DcCircleMaterialProperty) {
    if (options.color) material.color = options.color
    if (options.speed !== undefined) material.speed = options.speed
  }
}

export function removeDcEffectRingEntity(viewer: Viewer | undefined, type: string): void {
  if (!viewer || viewer.isDestroyed()) return
  const entity = viewer.entities.getById(`${DC_EFFECT_RING_PREFIX}${type}`)
  if (entity) viewer.entities.remove(entity)
}
