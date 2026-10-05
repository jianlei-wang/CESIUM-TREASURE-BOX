import * as Cesium from 'cesium'
import * as THREE from 'three'
import type { StudyArea } from '@rt/types/model'

export class SpatialTransform {
  readonly studyArea: StudyArea
  readonly originCartesian: Cesium.Cartesian3
  readonly localToWorld: Cesium.Matrix4
  readonly worldToLocal: Cesium.Matrix4

  private readonly scratchPosition = new Cesium.Cartesian3()
  private readonly scratchDirection = new Cesium.Cartesian3()
  private readonly scratchUp = new Cesium.Cartesian3()
  private readonly scratchRight = new Cesium.Cartesian3()
  private readonly scratchLocal = new Cesium.Cartesian3()
  private readonly scratchLocalDir = new Cesium.Cartesian3()
  private readonly scratchLocalUp = new Cesium.Cartesian3()

  constructor(studyArea: StudyArea) {
    this.studyArea = studyArea
    this.originCartesian = Cesium.Cartesian3.fromDegrees(
      studyArea.center.longitude,
      studyArea.center.latitude,
      studyArea.center.height,
    )
    this.localToWorld = Cesium.Transforms.eastNorthUpToFixedFrame(this.originCartesian)
    this.worldToLocal = Cesium.Matrix4.inverse(this.localToWorld, new Cesium.Matrix4())
  }

  localToCartesian(local: { x: number; y: number; z: number }, result = new Cesium.Cartesian3()): Cesium.Cartesian3 {
    return Cesium.Matrix4.multiplyByPoint(
      this.localToWorld,
      new Cesium.Cartesian3(local.x, local.y, local.z),
      result,
    )
  }

  cartesianToLocal(cartesian: Cesium.Cartesian3, result = new Cesium.Cartesian3()): Cesium.Cartesian3 {
    return Cesium.Matrix4.multiplyByPoint(this.worldToLocal, cartesian, result)
  }

  // Cesium 世界坐标 → Three 局部 ENU 坐标。这里直接采用 E/N/U 右手系：X=East, Y=North, Z=Up。
  cameraToThree(camera: Cesium.Camera, threeCamera: THREE.PerspectiveCamera): void {
    const position = this.cartesianToLocal(camera.positionWC, this.scratchLocal)
    const direction = Cesium.Cartesian3.clone(camera.directionWC, this.scratchDirection)
    const up = Cesium.Cartesian3.clone(camera.upWC, this.scratchUp)
    const right = Cesium.Cartesian3.cross(direction, up, this.scratchRight)

    const localDirection = this.transformVectorWorldToLocal(direction, this.scratchLocalDir)
    const localUp = this.transformVectorWorldToLocal(up, this.scratchLocalUp)
    const localRight = this.transformVectorWorldToLocal(right, new Cesium.Cartesian3())

    threeCamera.position.set(position.x, position.y, position.z)
    threeCamera.up.set(localUp.x, localUp.y, localUp.z).normalize()

    const basis = new THREE.Matrix4()
    basis.makeBasis(
      new THREE.Vector3(localRight.x, localRight.y, localRight.z).normalize(),
      threeCamera.up.clone().normalize(),
      new THREE.Vector3(-localDirection.x, -localDirection.y, -localDirection.z).normalize(),
    )
    threeCamera.quaternion.setFromRotationMatrix(basis)

    const frustum = camera.frustum
    if ('fovy' in frustum) {
      threeCamera.fov = Cesium.Math.toDegrees(frustum.fovy ?? Math.PI / 3)
    }
    threeCamera.near = Math.max(frustum.near, 1)
    threeCamera.far = Math.min(Math.max(frustum.far, 500_000), 10_000_000)
  }

  cameraLocalPosition(camera: Cesium.Camera, target = new THREE.Vector3()): THREE.Vector3 {
    const p = this.cartesianToLocal(camera.positionWC, this.scratchPosition)
    return target.set(p.x, p.y, p.z)
  }

  private transformVectorWorldToLocal(vector: Cesium.Cartesian3, result: Cesium.Cartesian3): Cesium.Cartesian3 {
    return Cesium.Matrix4.multiplyByPointAsVector(this.worldToLocal, vector, result)
  }
}
