/**
 * 场景坐标系 —— 统一“经纬度 + 真实深度”到渲染世界的映射
 *
 * 约定：渲染局部坐标 z 向上，z = -depth × 垂向夸张；深度恒为正、向下递增。
 * 体渲染用 ENU 模型矩阵 + 局部包围盒；叠加网格用绝对 ECEF 世界坐标。
 * 体域整体抬升 liftFactor × 体高，使数据块浮出地表便于观察（liftFactor=1 时块底贴地）。
 * 分析计算始终使用真实米制深度，夸大倍数与抬升只影响视觉。
 */

import {
  BoundingSphere,
  Cartesian3,
  Cartographic,
  EllipsoidGeodesic,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  Transforms,
  type Viewer
} from 'cesium'
import type { OceanCameraPreset } from '../ocean-tsd.config'
import type { OceanDatasetManifest } from '../ocean-tsd.types'

export class OceanSceneFrame {
  readonly centerLon: number
  readonly centerLat: number
  /** 体域东西向实际米数 */
  readonly widthM: number
  /** 体域南北向实际米数 */
  readonly depthM: number
  readonly maxDepthM: number
  readonly modelMatrix: Matrix4
  private exaggeration: number
  private liftFactor: number

  constructor(
    manifest: OceanDatasetManifest,
    maxDepthM: number,
    exaggeration: number,
    liftFactor = 1
  ) {
    const { extent } = manifest
    this.centerLon = (extent.west + extent.east) / 2
    this.centerLat = (extent.south + extent.north) / 2
    this.widthM = OceanSceneFrame.geodesicM(extent.west, this.centerLat, extent.east, this.centerLat)
    this.depthM = OceanSceneFrame.geodesicM(this.centerLon, extent.south, this.centerLon, extent.north)
    this.maxDepthM = maxDepthM
    this.exaggeration = exaggeration
    this.liftFactor = liftFactor
    this.modelMatrix = Transforms.eastNorthUpToFixedFrame(
      Cartesian3.fromDegrees(this.centerLon, this.centerLat, this.liftM)
    )
  }

  private static geodesicM(lon1: number, lat1: number, lon2: number, lat2: number): number {
    const geo = new EllipsoidGeodesic(
      Cartographic.fromDegrees(lon1, lat1),
      Cartographic.fromDegrees(lon2, lat2)
    )
    return geo.surfaceDistance
  }

  get verticalExaggeration(): number {
    return this.exaggeration
  }

  setVerticalExaggeration(value: number): void {
    this.exaggeration = value
  }

  /** 体域高度（米，已乘垂向夸张） */
  get heightM(): number {
    return this.maxDepthM * this.exaggeration
  }

  /** 体域整体抬升高度（米），使数据块浮出地表 */
  get liftM(): number {
    return this.heightM * this.liftFactor
  }

  get minBounds(): Cartesian3 {
    return new Cartesian3(-this.widthM / 2, -this.depthM / 2, -this.heightM)
  }

  get maxBounds(): Cartesian3 {
    return new Cartesian3(this.widthM / 2, this.depthM / 2, 0)
  }

  /** 经纬度 + 真实深度 → 绝对世界坐标（已应用垂向夸张与整体抬升） */
  worldPosition(lon: number, lat: number, depthM: number): Cartesian3 {
    return Cartesian3.fromDegrees(lon, lat, this.liftM - depthM * this.exaggeration)
  }

  /** 把世界坐标写入 Float64Array（供相对视点几何使用） */
  writePosition(lon: number, lat: number, depthM: number, out: Float64Array, offset: number): void {
    const p = this.worldPosition(lon, lat, depthM)
    out[offset] = p.x
    out[offset + 1] = p.y
    out[offset + 2] = p.z
  }

  /** 相机观察目标：抬升后体域中心 */
  get targetCartesian(): Cartesian3 {
    return Cartesian3.fromDegrees(this.centerLon, this.centerLat, this.liftM - this.heightM / 2)
  }

  /** 水平尺度基准（用于设定视距） */
  get horizontalScaleM(): number {
    return Math.max(this.widthM, this.depthM)
  }

  /** 体域包围球（世界坐标） */
  get boundingSphere(): BoundingSphere {
    const min = this.minBounds
    const max = this.maxBounds
    const corners: Cartesian3[] = []
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) {
          corners.push(Matrix4.multiplyByPoint(this.modelMatrix, new Cartesian3(x, y, z), new Cartesian3()))
        }
      }
    }
    return BoundingSphere.fromPoints(corners)
  }

  /** 依据相机预设飞向合适视点 */
  flyTo(viewer: Viewer, preset: OceanCameraPreset, duration = 1.2): void {
    const range = this.horizontalScaleM * preset.rangeFactor + this.heightM * 0.6
    const offset = new HeadingPitchRange(
      CesiumMath.toRadians(preset.heading),
      CesiumMath.toRadians(preset.pitch),
      range
    )
    viewer.camera.flyToBoundingSphere(this.boundingSphere, { offset, duration })
  }
}
