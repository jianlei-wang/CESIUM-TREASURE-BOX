import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  Rectangle,
  WebMercatorTilingScheme
} from 'cesium'
import BD09Projection from './BD09Projection'
import { BD09ToGCJ02, GCJ02ToBD09, GCJ02ToWGS84, WGS84ToGCJ02 } from './CoordTransform'

export type BD09TilingSchemeOptions = {
  resolutions?: number[]
  rectangleSouthwestInMeters?: Cartesian2
  rectangleNortheastInMeters?: Cartesian2
}

/**
 * 百度 BD09 坐标系平铺方案。
 * project：WGS84 -> GCJ02 -> BD09 -> 百度墨卡托(MC)；瓦片范围按 resolutions(米/瓦片)计算，y 取负。
 */
class BD09TilingScheme extends WebMercatorTilingScheme {
  private readonly _resolutions: number[]

  constructor(options: BD09TilingSchemeOptions = {}) {
    super({
      rectangleSouthwestInMeters: options.rectangleSouthwestInMeters,
      rectangleNortheastInMeters: options.rectangleNortheastInMeters
    })
    const projection = new BD09Projection()
    this.projection.project = function (
      cartographic: Cartographic,
      result?: Cartesian3
    ) {
      let gcj = WGS84ToGCJ02(
        CesiumMath.toDegrees(cartographic.longitude),
        CesiumMath.toDegrees(cartographic.latitude)
      )
      gcj = GCJ02ToBD09(gcj[0], gcj[1])
      gcj[0] = Math.min(gcj[0], 180)
      gcj[0] = Math.max(gcj[0], -180)
      gcj[1] = Math.min(gcj[1], 74.000022)
      gcj[1] = Math.max(gcj[1], -71.988531)
      const pt = projection.lngLatToPoint({ lng: gcj[0], lat: gcj[1] })
      return new Cartesian3(pt.x, pt.y, 0)
    }
    this.projection.unproject = function (
      cartesian: Cartesian3,
      result?: Cartographic
    ) {
      const lngLat = projection.mercatorToLngLat({ x: cartesian.x, y: cartesian.y })
      const gcj = BD09ToGCJ02(lngLat.lng, lngLat.lat)
      const wgs = GCJ02ToWGS84(gcj[0], gcj[1])
      return new Cartographic(
        CesiumMath.toRadians(wgs[0]),
        CesiumMath.toRadians(wgs[1])
      )
    }
    this._resolutions = options.resolutions || []
  }

  tileXYToNativeRectangle(x: number, y: number, level: number, result?: Rectangle): Rectangle {
    const tileWidth = this._resolutions[level]
    if (tileWidth === undefined) {
      return Rectangle.MAX_VALUE
    }
    const west = x * tileWidth
    const east = (x + 1) * tileWidth
    const north = (-y + 1) * tileWidth
    const south = -y * tileWidth
    if (!result) {
      return new Rectangle(west, south, east, north)
    }
    result.west = west
    result.south = south
    result.east = east
    result.north = north
    return result
  }

  positionToTileXY(
    position: Cartographic,
    level: number,
    result?: Cartesian2
  ): Cartesian2 {
    const rectangle = this.rectangle
    if (!Rectangle.contains(rectangle, position)) {
      return new Cartesian2()
    }
    const webMercatorPosition = this.projection.project(position)
    if (!webMercatorPosition) {
      return new Cartesian2()
    }
    const tileWidth = this._resolutions[level]
    if (tileWidth === undefined) {
      return new Cartesian2()
    }
    const xTileCoordinate = Math.floor(webMercatorPosition.x / tileWidth)
    const yTileCoordinate = -Math.floor(webMercatorPosition.y / tileWidth)
    if (!result) {
      return new Cartesian2(xTileCoordinate, yTileCoordinate)
    }
    result.x = xTileCoordinate
    result.y = yTileCoordinate
    return result
  }
}

export default BD09TilingScheme
