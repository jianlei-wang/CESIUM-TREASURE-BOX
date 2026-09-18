import { UrlTemplateImageryProvider } from 'cesium'
import GCJ02TilingScheme from './GCJ02TilingScheme'

export type TencentStyle = 'img' | 'elec'

export type TencentImageryProviderOptions = {
  protocol?: string
  url?: string
  style?: TencentStyle
  crs?: 'GCJ02' | 'WGS84'
  subdomains?: string[]
  customTags?: any
}

const TILE_URL: Record<TencentStyle, string> = {
  img: '//p{s}.map.gtimg.com/sateTiles/{z}/{sx}/{sy}/{x}_{reverseY}.jpg?version=400',
  elec:
    '//rt{s}.map.gtimg.com/tile?z={z}&x={x}&y={reverseY}&styleid={style}&scene=0&version=347'
}

/**
 * 腾讯地图 ImageryProvider。
 * img 影像用 customTags 计算 {sx}/{sy}（x>>4 与 ((1<<level)-1-y)>>4）；elec 电子 styleid 由 style 替换。
 */
class TencentImageryProvider extends UrlTemplateImageryProvider {
  constructor(options: TencentImageryProviderOptions = {}) {
    const style = options.style || 'elec'
    const urlTemplate = options.url || TILE_URL[style] || TILE_URL.elec
    const url = [options.protocol || '', urlTemplate].join('').replace('{style}', options.style || '1')

    const subdomains =
      options.subdomains && options.subdomains.length
        ? options.subdomains
        : ['0', '1', '2']

    const opts: UrlTemplateImageryProvider.ConstructorOptions = { url, subdomains }
    if (style === 'img') {
      opts.customTags = {
        sx: (imageryProvider: unknown, x: number, y: number, level: number) => x >> 4,
        sy: (imageryProvider: unknown, x: number, y: number, level: number) =>
          ((1 << level) - 1 - y) >> 4
      }
    }
    if (options.crs === 'WGS84') {
      opts.tilingScheme = new GCJ02TilingScheme()
    }
    super(opts)
  }
}

export default TencentImageryProvider
