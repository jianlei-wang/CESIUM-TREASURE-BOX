import { UrlTemplateImageryProvider } from 'cesium'
import GCJ02TilingScheme from './GCJ02TilingScheme'

export type GoogleStyle = 'img' | 'elec' | 'cva' | 'ter' | 'img_cva'

export type GoogleImageryProviderOptions = {
  protocol?: string
  url?: string
  style?: GoogleStyle
  crs?: 'GCJ02' | 'WGS84'
  subdomains?: string[]
}

const TILE_URL: Record<GoogleStyle, string> = {
  img: 'https://gac-geo.googlecnapps.cn/maps/vt?lyrs=s&x={x}&y={y}&z={z}',
  elec: 'https://gac-geo.googlecnapps.cn/maps/vt?lyrs=m&x={x}&y={y}&z={z}',
  cva: 'https://gac-geo.googlecnapps.cn/maps/vt?lyrs=h&x={x}&y={y}&z={z}',
  ter: 'https://gac-geo.googlecnapps.cn/maps/vt?lyrs=t@131,r&x={x}&y={y}&z={z}',
  img_cva: 'https://gac-geo.googlecnapps.cn/maps/vt?lyrs=y&x={x}&y={y}&z={z}'
}

/**
 * 谷歌地图 ImageryProvider（走 gac-geo.googlecnapps.cn 中国节点）。
 * style: img 影像 / elec 电子 / cva 注记 / ter 地形 / img_cva 影像+注记。
 */
class GoogleImageryProvider extends UrlTemplateImageryProvider {
  constructor(options: GoogleImageryProviderOptions = {}) {
    const style = options.style || 'elec'
    const url =
      options.url ||
      [options.protocol || '', TILE_URL[style] || TILE_URL.elec].join('')
    super({
      url,
      ...(options.crs === 'WGS84' ? { tilingScheme: new GCJ02TilingScheme() } : {})
    })
  }
}

export default GoogleImageryProvider
