/** Worker 与主线程之间的消息协议。 */
import type { MvtGeometryInput } from '../data/parsers/mvt'

export type AggregateMode = 'hexbin' | 'grid' | 'h3'

export type AggregateRequest = {
  id: number
  mode: AggregateMode
  positions: Float32Array
  values: Float32Array
  /** hexbin: 半径（度）；grid: 单元边长（度）；h3: 分辨率。 */
  param: number
  lat0?: number
}

export type AggregateResponse = {
  id: number
  count: number
  lon: Float32Array
  lat: Float32Array
  sum: Float32Array
  min: Float32Array
  max: Float32Array
  /** 每个单元的采样点数。 */
  cellCounts: Uint32Array
  /** 压缩率 = 1 - cells / input。 */
  compression: number
  elapsed: number
}

export type SpatialClusterRequest = {
  id: number
  positions: Float32Array
  cellSize: number
}

export type SpatialClusterResponse = {
  id: number
  clusterCount: number
  assignments: Int32Array
  clusterLon: Float32Array
  clusterLat: Float32Array
  elapsed: number
}

export type ContourRequest = {
  id: number
  width: number
  height: number
  values: Float32Array
  thresholds: number[]
}

export type ContourResponse = {
  id: number
  bands: Array<{ value: number; polygons: number[][][][] }>
  elapsed: number
}

export type TileRequest = {
  id: number
  /** 若提供 bytes 则解码；若提供 geometries 则编码后再解码，验证真实 PBF 生命周期。 */
  bytes?: ArrayBuffer
  tileName?: string
  extent?: number
  geometries?: MvtGeometryInput[]
}

export type TileResponse = {
  id: number
  layers: Array<{ name: string; extent: number; featureCount: number; encodedBytes?: number }>
  /** 解码后的真实 MVT 几何（相对瓦片原点的整数坐标）。 */
  decoded: Array<{ type: 'Point' | 'LineString' | 'Polygon'; coordinates: number[][]; properties: Record<string, string | number | boolean> }>
  encodedBytes: number
  elapsed: number
}
