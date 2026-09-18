import {
  Cartesian3,
  HeadingPitchRoll,
  Math as CesiumMath,
  Matrix4,
  PerspectiveFrustum,
  Transforms
} from 'cesium'

export type ProjectionCameraConfig = {
  lon: number
  lat: number
  height: number
  heading: number
  pitch: number
  roll: number
  horizontalFov: number
  aspectRatio: number
  near: number
  far: number
  videoAlpha: number
  edgeFeather: number
  depthFeather: number
  tint: [number, number, number]
}

export type CameraMatrixResult = {
  viewMatrix: Matrix4
  projectionMatrix: Matrix4
  inverseViewProjection: Matrix4
  position: Cartesian3
}

const scratchFrustum = new PerspectiveFrustum()

export const DEFAULT_CAMERA_APPEARANCE = {
  aspectRatio: 16 / 9,
  near: 1,
  far: 3000,
  videoAlpha: 0.92,
  edgeFeather: 0.08,
  depthFeather: 60
} as const

/**
 * 由摄像头内外参数计算视频相机的视图矩阵、投影矩阵与视图投影逆矩阵。
 * 位置与朝向完全由经纬度、高程与 heading/pitch/roll 驱动。
 */
export function computeCameraMatrices(config: ProjectionCameraConfig): CameraMatrixResult {
  const position = Cartesian3.fromDegrees(config.lon, config.lat, config.height)
  const hpr = new HeadingPitchRoll(
    CesiumMath.toRadians(config.heading),
    CesiumMath.toRadians(config.pitch),
    CesiumMath.toRadians(config.roll)
  )
  const transform = Transforms.headingPitchRollToFixedFrame(position, hpr)

  const direction = Matrix4.multiplyByPointAsVector(
    transform,
    Cartesian3.negate(Cartesian3.UNIT_Z, new Cartesian3()),
    new Cartesian3()
  )
  Cartesian3.normalize(direction, direction)

  const up = Matrix4.multiplyByPointAsVector(transform, Cartesian3.UNIT_Y, new Cartesian3())
  Cartesian3.normalize(up, up)

  const right = Cartesian3.cross(direction, up, new Cartesian3())
  Cartesian3.normalize(right, right)
  Cartesian3.cross(right, direction, up)
  Cartesian3.normalize(up, up)

  const viewMatrix = Matrix4.computeView(position, direction, up, right, new Matrix4())

  const horizontalFov = CesiumMath.toRadians(config.horizontalFov)
  const verticalFov = 2 * Math.atan(Math.tan(horizontalFov / 2) / config.aspectRatio)
  scratchFrustum.fov = verticalFov
  scratchFrustum.aspectRatio = config.aspectRatio
  scratchFrustum.near = config.near
  scratchFrustum.far = config.far
  const projectionMatrix = Matrix4.clone(scratchFrustum.projectionMatrix, new Matrix4())

  const viewProjection = Matrix4.multiply(projectionMatrix, viewMatrix, new Matrix4())
  const inverseViewProjection = Matrix4.inverse(viewProjection, new Matrix4())

  return { viewMatrix, projectionMatrix, inverseViewProjection, position }
}
