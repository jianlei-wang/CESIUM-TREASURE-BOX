/**
 * cesium-helpers 上游基于 CesiumJS 1.146 的 `@cesium/core` / `@cesium/engine` 子包，
 * 本项目使用 CesiumJS 1.144 的 `cesium` 单包。此模块作为两者的统一入口：
 * - 重新导出 `cesium` 的全部命名导出；
 * - 补齐 1.144 尚未提供、但上游代码用到的 `FixedFrameTransforms`（1.144 对应 `Transforms`）。
 */
export * from 'cesium'

import { Transforms } from 'cesium'

type PointToWindow = (
  modelViewProjectionMatrix: import('cesium').Matrix4,
  viewportTransformation: import('cesium').Matrix4,
  point: import('cesium').Cartesian3,
  result?: import('cesium').Cartesian2
) => import('cesium').Cartesian2

export const FixedFrameTransforms = {
  eastNorthUpToFixedFrame: Transforms.eastNorthUpToFixedFrame,
  northEastDownToFixedFrame: Transforms.northEastDownToFixedFrame,
  northUpEastToFixedFrame: Transforms.northUpEastToFixedFrame,
  northWestUpToFixedFrame: Transforms.northWestUpToFixedFrame,
  headingPitchRollToFixedFrame: Transforms.headingPitchRollToFixedFrame,
  pointToWindowCoordinates: Transforms.pointToWindowCoordinates as unknown as PointToWindow,
  pointToGLWindowCoordinates: (Transforms as unknown as Record<string, unknown>).pointToGLWindowCoordinates
}
