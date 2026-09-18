import { UrlTemplateImageryProvider } from 'cesium'
import GCJ02TilingScheme from './GCJ02TilingScheme'

export type AMapStyle = 'img' | 'elec' | 'cva'

export type AMapImageryProviderOptions = {
  protocol?: string
  url?: string
  style?: AMapStyle
  crs?: 'GCJ02' | 'WGS84'
  subdomains?: string[]
}

const TILE_URL: Record<AMapStyle, string> = {
  img: '//webst{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
  elec:
    '//webrd{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  cva:
    '//webst{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}'
}

/**
 * 高德地图 ImageryProvider。
 * style: img 影像 / elec 电子 / cva 注记；crs='WGS84' 时用 GCJ02TilingScheme 做火星坐标校正。
 */
class AMapImageryProvider extends UrlTemplateImageryProvider {
  constructor(options: AMapImageryProviderOptions = {}) {
    const style = options.style || 'elec'
    const url =
      options.url ||
      [options.protocol || '', TILE_URL[style] || TILE_URL.elec].join('')
    const subdomains =
      options.subdomains && options.subdomains.length
        ? options.subdomains
        : ['01', '02', '03', '04']
    super({
      url,
      subdomains,
      ...(options.crs === 'WGS84' ? { tilingScheme: new GCJ02TilingScheme() } : {})
    })
  }
}

export default AMapImageryProvider
