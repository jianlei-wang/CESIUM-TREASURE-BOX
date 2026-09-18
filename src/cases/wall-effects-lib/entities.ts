import {
  Cartesian3,
  Color,
  ConstantProperty,
  Math as CesiumMath,
  type Entity,
  type Viewer
} from 'cesium'
import { WallMaterialProperty, type WallMaterialKind, type WallMaterialOptions } from './materials'

export const WALL_ENTITY_PREFIX = 'dc-wall-'

export type WallEntityOptions = {
  id: string
  positions: Array<[number, number, number]>
  kind: WallMaterialKind
  material?: WallMaterialOptions
  outline?: boolean
  outlineColor?: Color
}

const EARTH_RADIUS_METERS = 6378137.0

function toCartesianArray(positions: Array<[number, number, number]>): Cartesian3[] {
  return positions.map(([lon, lat, height]) => Cartesian3.fromDegrees(lon, lat, height))
}

export function createWallEntity(viewer: Viewer, options: WallEntityOptions): Entity {
  removeWallEntity(viewer, options.id)
  const id = `${WALL_ENTITY_PREFIX}${options.id}`
  const material = new WallMaterialProperty(options.kind, options.material)
  return viewer.entities.add({
    id,
    wall: {
      positions: new ConstantProperty(toCartesianArray(options.positions)),
      material,
      outline: new ConstantProperty(options.outline ?? true),
      outlineColor: new ConstantProperty(options.outlineColor ?? new Color(1, 1, 1, 1))
    }
  })
}

export function updateWallEntity(
  viewer: Viewer | undefined,
  id: string,
  patch: {
    positions?: Array<[number, number, number]>
    material?: WallMaterialOptions
    outline?: boolean
  }
): void {
  if (!viewer || viewer.isDestroyed()) return
  const entity = viewer.entities.getById(`${WALL_ENTITY_PREFIX}${id}`)
  if (!entity) return
  const wall = (entity as Entity).wall
  if (!wall) return
  if (patch.positions) {
    wall.positions = new ConstantProperty(toCartesianArray(patch.positions))
  }
  if (patch.outline !== undefined) {
    wall.outline = new ConstantProperty(patch.outline)
  }
  if (patch.material) {
    const material = wall.material
    if (material instanceof WallMaterialProperty) {
      if (patch.material.color) material.color = patch.material.color
      if (patch.material.speed !== undefined) material.speed = patch.material.speed
      if (patch.material.repeatX !== undefined) material.repeatX = patch.material.repeatX
      if (patch.material.repeatY !== undefined) material.repeatY = patch.material.repeatY
      if (patch.material.image !== undefined) material.image = patch.material.image
    }
  }
}

export function removeWallEntity(viewer: Viewer | undefined, id: string): void {
  if (!viewer || viewer.isDestroyed()) return
  const entity = viewer.entities.getById(`${WALL_ENTITY_PREFIX}${id}`)
  if (entity) viewer.entities.remove(entity)
}

export function rectPositions(
  lon: number,
  lat: number,
  widthMeters: number,
  depthMeters: number,
  height: number
): Array<[number, number, number]> {
  const latRad = CesiumMath.toRadians(lat)
  const metersPerDegreeLat = (Math.PI * EARTH_RADIUS_METERS) / 180
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos(latRad)
  const dLon = widthMeters / 2 / metersPerDegreeLon
  const dLat = depthMeters / 2 / metersPerDegreeLat
  return [
    [lon - dLon, lat - dLat, height],
    [lon + dLon, lat - dLat, height],
    [lon + dLon, lat + dLat, height],
    [lon - dLon, lat + dLat, height],
    [lon - dLon, lat - dLat, height]
  ]
}
