// 模拟区域与坐标变换（对应设计文档 §3.2）
//
// WGS84 经纬度 → ECEF → 局部 ENU → 模拟网格 (i, j)。
// ENU 原点取区域中心（椭球面高程 0），U 轴垂直向上。

import { Cartesian3, Cartographic, EllipsoidGeodesic, Matrix4, Rectangle, Transforms, Math as CesiumMath } from 'cesium'
import type { DomainOptions } from './types'

export class SimulationDomain {
  readonly centerLon: number
  readonly centerLat: number
  readonly widthMeters: number
  readonly heightMeters: number
  readonly gridResX: number
  readonly gridResY: number
  readonly cellSizeX: number
  readonly cellSizeY: number
  readonly cellArea: number
  readonly rectangle: Rectangle
  readonly enuMatrix: Matrix4
  readonly invEnuMatrix: Matrix4
  readonly center: Cartesian3

  constructor(options: DomainOptions) {
    this.centerLon = options.centerLon
    this.centerLat = options.centerLat
    this.widthMeters = options.widthMeters
    this.heightMeters = options.heightMeters
    this.gridResX = options.gridResX
    this.gridResY = options.gridResY
    this.cellSizeX = options.widthMeters / options.gridResX
    this.cellSizeY = options.heightMeters / options.gridResY
    this.cellArea = this.cellSizeX * this.cellSizeY

    const latRad = CesiumMath.toRadians(options.centerLat)
    const dLat = (options.heightMeters / 2) / 111320
    const dLon = (options.widthMeters / 2) / (111320 * Math.max(Math.cos(latRad), 1e-6))
    this.rectangle = Rectangle.fromDegrees(
      options.centerLon - dLon,
      options.centerLat - dLat,
      options.centerLon + dLon,
      options.centerLat + dLat
    )

    this.center = Cartesian3.fromDegrees(options.centerLon, options.centerLat, 0)
    this.enuMatrix = Transforms.eastNorthUpToFixedFrame(this.center)
    this.invEnuMatrix = Matrix4.inverse(this.enuMatrix, new Matrix4())
  }

  /** 网格单元中心 (i, j) → 局部 ENU (e, n)，单位 m（U 分量由调用方附加）。 */
  gridToENU(i: number, j: number): { e: number; n: number } {
    const e = ((i + 0.5) / this.gridResX) * this.widthMeters - this.widthMeters / 2
    const n = ((j + 0.5) / this.gridResY) * this.heightMeters - this.heightMeters / 2
    return { e, n }
  }

  /** 局部 ENU (e, n) → 连续网格坐标 (i, j)。 */
  enuToGrid(e: number, n: number): { i: number; j: number } {
    const i = ((e + this.widthMeters / 2) / this.widthMeters) * this.gridResX
    const j = ((n + this.heightMeters / 2) / this.heightMeters) * this.gridResY
    return { i, j }
  }

  /** ECEF → 局部 ENU。 */
  ecefToENU(cartesian: Cartesian3): { e: number; n: number; u: number } {
    const local = Matrix4.multiplyByPoint(this.invEnuMatrix, cartesian, new Cartesian3())
    return { e: local.x, n: local.y, u: local.z }
  }

  /** 局部 ENU → ECEF。 */
  enuToCartesian(e: number, n: number, u: number): Cartesian3 {
    return Matrix4.multiplyByPoint(this.enuMatrix, new Cartesian3(e, n, u), new Cartesian3())
  }

  /** 网格单元中心 (i, j) → 经纬度（用于 DEM 采样）。 */
  cellLonLat(i: number, j: number): { lon: number; lat: number } {
    const { e, n } = this.gridToENU(i, j)
    const carto = Cartographic.fromCartesian(this.enuToCartesian(e, n, 0))
    return { lon: CesiumMath.toDegrees(carto.longitude), lat: CesiumMath.toDegrees(carto.latitude) }
  }

  /** 由经纬度矩形与行列数推导网格步长（采样用）。 */
  static spacingFromRectangle(rectangle: Rectangle, nx: number, ny: number): { dx: number; dy: number } {
    const center = Rectangle.center(rectangle)
    const horizontal = new EllipsoidGeodesic(
      new Cartographic(rectangle.west, center.latitude),
      new Cartographic(rectangle.east, center.latitude)
    )
    const vertical = new EllipsoidGeodesic(
      new Cartographic(center.longitude, rectangle.south),
      new Cartographic(center.longitude, rectangle.north)
    )
    return { dx: horizontal.surfaceDistance / nx, dy: vertical.surfaceDistance / ny }
  }
}
