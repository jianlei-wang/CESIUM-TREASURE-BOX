import type { Rectangle, Viewer } from 'cesium'

export type TerrainMethodId =
  | 'sample-most-detailed'
  | 'globe-get-height'
  | 'terrain-mesh'
  | 'derived-shader'
  | 'pick-depth'

export type TerrainExtractParams = {
  rectangle: Rectangle
  size: number
  /** 自定义绘制多边形（经纬度 [lon, lat] 数组），用于把矩形外格子置为 NaN */
  polygon?: Array<[number, number]> | null
  onProgress?: (message: string) => void
  /** 方案三：手动指定瓦片层级；不传则按 availability 自动推断 */
  tileLevel?: number
  /** 方案四/五：正交相机顶视渲染帧数 */
  renderFrames?: number
  /** 方案五：相机高出最高地形/建筑的余量（米） */
  cameraMargin?: number
  /** 方案五：建筑估计高度（米） */
  maxObjectHeight?: number
  signal?: AbortSignal
}

export type TerrainExtractExtra = Record<string, string | number>

export type TerrainExtractResult = {
  methodId: string
  size: number
  rectangle: Rectangle
  /** row0 = 北，col0 = 西；单位米；NaN = 无数据 */
  heights: Float32Array
  elapsedMs: number
  validCount: number
  holeCount: number
  maskedCount: number
  min: number
  max: number
  mean: number
  extra: TerrainExtractExtra
}

export type TerrainExtractor = {
  id: TerrainMethodId
  label: string
  run: (viewer: Viewer, params: TerrainExtractParams) => Promise<TerrainExtractResult>
}
