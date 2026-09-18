import {
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  WebMercatorProjection,
  WebMercatorTilingScheme
} from 'cesium'
import { GCJ02ToWGS84, WGS84ToGCJ02 } from './CoordTransform'

/**
 * GCJ02 火星坐标平铺方案。
 * 供高德/谷歌/腾讯地图在 crs='WGS84' 时使用：瓦片请求坐标先做 WGS84->GCJ02 偏移。
 */
class GCJ02TilingScheme extends WebMercatorTilingScheme {
  constructor(options?: ConstructorParameters<typeof WebMercatorTilingScheme>[0]) {
    super(options)
    const projection = new WebMercatorProjection()
    this.projection.project = function (
      cartographic: Cartographic,
      result?: Cartesian3
    ) {
      const gcj = WGS84ToGCJ02(
        CesiumMath.toDegrees(cartographic.longitude),
        CesiumMath.toDegrees(cartographic.latitude)
      )
      const projected = projection.project(
        new Cartographic(CesiumMath.toRadians(gcj[0]), CesiumMath.toRadians(gcj[1]))
      )
      return new Cartesian3(projected.x, projected.y, projected.z)
    }
    this.projection.unproject = function (
      cartesian: Cartesian3,
      result?: Cartographic
    ) {
      const cartographic = projection.unproject(cartesian)
      const wgs = GCJ02ToWGS84(
        CesiumMath.toDegrees(cartographic.longitude),
        CesiumMath.toDegrees(cartographic.latitude)
      )
      return new Cartographic(
        CesiumMath.toRadians(wgs[0]),
        CesiumMath.toRadians(wgs[1])
      )
    }
  }
}

export default GCJ02TilingScheme
