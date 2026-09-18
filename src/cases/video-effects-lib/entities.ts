import {
  Cartesian3,
  Color,
  EllipsoidSurfaceAppearance,
  GeometryInstance,
  GroundPrimitive,
  Material,
  Math as CesiumMath,
  PolygonGeometry,
  type Viewer
} from 'cesium'
import { VIDEO_FEATHER_TYPE, VIDEO_FUSION_TYPE } from './materials'

export const VIDEO_PRIMITIVE_PREFIX = 'dc-video-primitive-'

export type VideoPrimitiveMaterialKind = 'Image' | 'VideoFusion' | 'VideoFeather'

export type VideoPrimitiveOptions = {
  id: string
  lon: number
  lat: number
  widthMeters: number
  heightMeters: number
  video: HTMLVideoElement
  materialKind: VideoPrimitiveMaterialKind
  opacity?: number
  featherWidth?: number
  color?: Color
  classificationType?: number
}

const EARTH_RADIUS_METERS = 6378137.0

function buildCorners(
  lon: number,
  lat: number,
  widthMeters: number,
  heightMeters: number
): Cartesian3[] {
  const halfWidth = widthMeters / 2
  const halfHeight = heightMeters / 2
  const latRad = CesiumMath.toRadians(lat)
  const metersPerDegreeLat = Math.PI * EARTH_RADIUS_METERS / 180
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos(latRad)
  const dLon = halfWidth / metersPerDegreeLon
  const dLat = halfHeight / metersPerDegreeLat
  return Cartesian3.fromDegreesArray([
    lon - dLon, lat - dLat,
    lon + dLon, lat - dLat,
    lon + dLon, lat + dLat,
    lon - dLon, lat + dLat
  ])
}

function buildMaterial(kind: VideoPrimitiveMaterialKind, options: VideoPrimitiveOptions): Material {
  const baseColor = options.color ?? new Color(1, 1, 1, 1)
  if (kind === 'Image') {
    return Material.fromType('Image', {
      image: options.video,
      color: baseColor.withAlpha(options.opacity ?? 1)
    })
  }
  if (kind === 'VideoFusion') {
    return Material.fromType(VIDEO_FUSION_TYPE, {
      image: options.video,
      color: baseColor,
      opacity: options.opacity ?? 0.6
    })
  }
  return Material.fromType(VIDEO_FEATHER_TYPE, {
    image: options.video,
    color: baseColor,
    featherWidth: options.featherWidth ?? 0.25
  })
}

function buildPrimitive(options: VideoPrimitiveOptions): GroundPrimitive {
  const corners = buildCorners(options.lon, options.lat, options.widthMeters, options.heightMeters)
  const geometry = PolygonGeometry.fromPositions({
    positions: corners,
    vertexFormat: EllipsoidSurfaceAppearance.VERTEX_FORMAT
  })
  const appearance = new EllipsoidSurfaceAppearance({
    material: buildMaterial(options.materialKind, options),
    translucent: true
  })
  return new GroundPrimitive({
    geometryInstances: new GeometryInstance({ geometry }),
    appearance,
    classificationType: options.classificationType
  })
}

export function createVideoPrimitive(viewer: Viewer, options: VideoPrimitiveOptions): GroundPrimitive {
  removeVideoPrimitive(viewer, options.id)
  const id = `${VIDEO_PRIMITIVE_PREFIX}${options.id}`
  const primitive = buildPrimitive(options)
  ;(primitive as unknown as { _dcVideoId?: string })._dcVideoId = id
  viewer.scene.groundPrimitives.add(primitive)
  return primitive
}

function findPrimitive(viewer: Viewer, id: string): GroundPrimitive | undefined {
  const fullId = `${VIDEO_PRIMITIVE_PREFIX}${id}`
  const primitives = viewer.scene.groundPrimitives
  for (let i = 0; i < primitives.length; i += 1) {
    const primitive = primitives.get(i) as GroundPrimitive
    if ((primitive as unknown as { _dcVideoId?: string })._dcVideoId === fullId) {
      return primitive
    }
  }
  return undefined
}

export function updateVideoPrimitive(
  viewer: Viewer,
  id: string,
  patch: Partial<VideoPrimitiveOptions>
): void {
  if (!viewer || viewer.isDestroyed()) return
  const existing = findPrimitive(viewer, id)
  if (!existing) return

  const material = existing.appearance.material
  if (material && material.uniforms) {
    if (patch.opacity !== undefined) {
      if (material.type === VIDEO_FUSION_TYPE) {
        material.uniforms.opacity = patch.opacity
      } else {
        const base = material.uniforms.color as Color
        material.uniforms.color = new Color(base.red, base.green, base.blue, patch.opacity)
      }
    }
    if (patch.featherWidth !== undefined && material.type === VIDEO_FEATHER_TYPE) {
      material.uniforms.featherWidth = patch.featherWidth
    }
    if (patch.color !== undefined) {
      material.uniforms.color = patch.color
    }
  }
}

export function moveVideoPrimitive(
  viewer: Viewer,
  id: string,
  options: VideoPrimitiveOptions
): void {
  if (!viewer || viewer.isDestroyed()) return
  removeVideoPrimitive(viewer, id)
  createVideoPrimitive(viewer, options)
}

export function removeVideoPrimitive(viewer: Viewer | undefined, id: string): void {
  if (!viewer || viewer.isDestroyed()) return
  const existing = findPrimitive(viewer, id)
  if (existing) viewer.scene.groundPrimitives.remove(existing)
}
