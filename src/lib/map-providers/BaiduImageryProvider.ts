import {
  Cartesian2,
  ImageryProvider,
  ImageryTypes,
  UrlTemplateImageryProvider,
  WebMercatorTilingScheme
} from 'cesium'
import BD09TilingScheme from './BD09TilingScheme'

export type BaiduStyle = 'img' | 'vec' | 'custom' | 'traffic'

export type BaiduImageryProviderOptions = {
  protocol?: string
  url?: string
  style?: BaiduStyle
  crs?: 'BD09' | 'WGS84'
  subdomains?: string[]
}

const TILE_URL: Record<BaiduStyle, string> = {
  img: '//shangetu{s}.map.bdimg.com/it/u=x={x};y={y};z={z};v=009;type=sate&fm=46',
  vec: '//online{s}.map.bdimg.com/tile/?qt=tile&x={x}&y={y}&z={z}&styles=sl&v=020',
  custom:
    '//api{s}.map.bdimg.com/customimage/tile?&x={x}&y={y}&z={z}&scale=1&customid={style}',
  traffic:
    '//its.map.baidu.com:8002/traffic/TrafficTileService?time={time}&label={labelStyle}&v=016&level={z}&x={x}&y={y}&scaler=2'
}

/**
 * 百度地图 ImageryProvider。
 * 百度瓦片坐标原点在地图中心，需重写 requestImage 换算行列号；BD09/WGS84 两套 tilingScheme。
 */
class BaiduImageryProvider extends UrlTemplateImageryProvider {
  private readonly _url: string
  private readonly _crs: string
  private readonly _style: string

  constructor(options: BaiduImageryProviderOptions = {}) {
    const style = options.style || 'custom'
    const url =
      options.url || [options.protocol || '', TILE_URL[style] || TILE_URL.custom].join('')
    const crs = options.crs || 'BD09'

    let tilingScheme
    if (crs === 'WGS84') {
      const resolutions: number[] = []
      for (let i = 0; i < 19; i++) {
        resolutions[i] = 256 * Math.pow(2, 18 - i)
      }
      tilingScheme = new BD09TilingScheme({
        resolutions,
        rectangleSouthwestInMeters: new Cartesian2(-20037726.37, -12474104.17),
        rectangleNortheastInMeters: new Cartesian2(20037726.37, 12474104.17)
      })
    } else {
      tilingScheme = new WebMercatorTilingScheme({
        rectangleSouthwestInMeters: new Cartesian2(-33554054, -33746824),
        rectangleNortheastInMeters: new Cartesian2(33554054, 33746824)
      })
    }
    super({ url, tilingScheme, maximumLevel: 18 })

    const self = this as unknown as { _rectangle?: unknown; _tilingScheme?: { rectangle: unknown } }
    self._rectangle = self._tilingScheme!.rectangle

    this._url = url
    this._crs = crs
    this._style = style
  }

  requestImage(
    x: number,
    y: number,
    level: number
  ): Promise<ImageryTypes> | undefined {
    const xTiles = this.tilingScheme.getNumberOfXTilesAtLevel(level)
    const yTiles = this.tilingScheme.getNumberOfYTilesAtLevel(level)
    let url = this._url
      .replace('{z}', String(level))
      .replace('{s}', '1')
      .replace('{style}', this._style)
    if (this._crs === 'WGS84') {
      url = url.replace('{x}', String(x)).replace('{y}', String(-y))
    } else {
      url = url
        .replace('{x}', String(x - xTiles / 2))
        .replace('{y}', String(yTiles / 2 - y - 1))
    }
    return ImageryProvider.loadImage(this, url) as unknown as Promise<ImageryTypes>
  }
}

export default BaiduImageryProvider
