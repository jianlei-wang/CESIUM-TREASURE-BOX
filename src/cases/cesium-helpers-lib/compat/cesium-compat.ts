/**
 * cesium-helpers 上游基于 CesiumJS 1.146 的 `@cesium/core` / `@cesium/engine` 子包，
 * 本项目使用 CesiumJS 1.144 的 `cesium` 单包。此模块作为两者的统一入口。
 *
 * 注意：这里必须用「命名空间导入 + 逐个具名导出」，不能写 `export * from 'cesium'`。
 * 构建时 `vite-plugin-cesium` 通过 rollup-plugin-external-globals 把 `cesium` 指向全局
 * `window.Cesium`，该插件无法改写星号重导出，会在产物 chunk 中留下
 * `import { ... } from "cesium"`，浏览器 ESM 解析失败并导致案例白屏。
 */
import * as Cesium from 'cesium'

// 以下几个符号在 CesiumJS 1.144 的运行时有导出，但未出现在公开类型声明中。
const runtime = Cesium as unknown as Record<string, unknown>

export const Axis = Cesium.Axis
export const BoundingSphere = Cesium.BoundingSphere
export const CameraEventType = Cesium.CameraEventType
export const Cartesian2 = Cesium.Cartesian2
export const Cartesian3 = Cesium.Cartesian3
export const Cartesian4 = Cesium.Cartesian4
export const Cartographic = Cesium.Cartographic
export const CatmullRomSpline = Cesium.CatmullRomSpline
export const Color = Cesium.Color
export const ComponentDatatype = Cesium.ComponentDatatype
export const EasingFunction = Cesium.EasingFunction
export const Ellipsoid = Cesium.Ellipsoid
export const EllipsoidTerrainProvider = Cesium.EllipsoidTerrainProvider
export const Event = Cesium.Event
export const Framebuffer = Cesium.Framebuffer
export const GeometryInstance = Cesium.GeometryInstance
export const GroundPolylineGeometry = Cesium.GroundPolylineGeometry
export const GroundPolylinePrimitive = Cesium.GroundPolylinePrimitive
export const HeadingPitchRange = Cesium.HeadingPitchRange
export const IntersectionTests = Cesium.IntersectionTests
export const KeyboardEventModifier = Cesium.KeyboardEventModifier
export const Material = Cesium.Material
export const Math = Cesium.Math
export const Matrix3 = Cesium.Matrix3
export const Matrix4 = Cesium.Matrix4
export const PixelDatatype = Cesium.PixelDatatype
export const PixelFormat = Cesium.PixelFormat
export const Plane = Cesium.Plane
export const PointPrimitiveCollection = Cesium.PointPrimitiveCollection
export const PolylineMaterialAppearance = Cesium.PolylineMaterialAppearance
export const PostProcessStage = Cesium.PostProcessStage
export const PostProcessStageComposite = Cesium.PostProcessStageComposite
export const PostProcessStageLibrary = Cesium.PostProcessStageLibrary
export const PostProcessStageSampleMode = Cesium.PostProcessStageSampleMode
export const PrimitiveType = Cesium.PrimitiveType
export const Quaternion = Cesium.Quaternion
export const Ray = Cesium.Ray
export const Rectangle = Cesium.Rectangle
export const RenderState = Cesium.RenderState
export const Resource = Cesium.Resource
export const Sampler = Cesium.Sampler
export const SceneMode = Cesium.SceneMode
export const sampleTerrainMostDetailed = Cesium.sampleTerrainMostDetailed
export const SceneTransforms = Cesium.SceneTransforms
export const ScreenSpaceEventHandler = Cesium.ScreenSpaceEventHandler
export const ScreenSpaceEventType = Cesium.ScreenSpaceEventType
export const Texture = Cesium.Texture
export const Texture3D = Cesium.Texture3D
export const TextureMagnificationFilter = Cesium.TextureMagnificationFilter
export const TextureMinificationFilter = Cesium.TextureMinificationFilter
export const TextureWrap = Cesium.TextureWrap
export const Transforms = Cesium.Transforms

export const EllipsoidalOccluder = runtime.EllipsoidalOccluder
export const PolygonPipeline = runtime.PolygonPipeline
export const _shadersGaussianBlur1D = runtime._shadersGaussianBlur1D

type PointToWindow = (
  modelViewProjectionMatrix: import('cesium').Matrix4,
  viewportTransformation: import('cesium').Matrix4,
  point: import('cesium').Cartesian3,
  result?: import('cesium').Cartesian2
) => import('cesium').Cartesian2

export const FixedFrameTransforms = {
  eastNorthUpToFixedFrame: Cesium.Transforms.eastNorthUpToFixedFrame,
  northEastDownToFixedFrame: Cesium.Transforms.northEastDownToFixedFrame,
  northUpEastToFixedFrame: Cesium.Transforms.northUpEastToFixedFrame,
  northWestUpToFixedFrame: Cesium.Transforms.northWestUpToFixedFrame,
  headingPitchRollToFixedFrame: Cesium.Transforms.headingPitchRollToFixedFrame,
  pointToWindowCoordinates: Cesium.Transforms.pointToWindowCoordinates as unknown as PointToWindow,
  pointToGLWindowCoordinates: (Cesium.Transforms as unknown as Record<string, unknown>)
    .pointToGLWindowCoordinates
}
