import { UrlTemplateImageryProvider } from 'cesium'

export type TdtStyle = 'vec' | 'cva' | 'img' | 'cia' | 'ter'

export type TdtImageryProviderOptions = {
  protocol?: string
  url?: string
  style?: TdtStyle
  key?: string
  subdomains?: string[]
}

const TDT_SUBDOMAINS = ['0', '1', '2', '3', '4', '5', '6', '7']

const TILE_URL =
  '//t{s}.tianditu.gov.cn/DataServer?T={style}_w&x={x}&y={y}&l={z}&tk={key}'

/**
 * 天地图 ImageryProvider。
 * 需用户手动申请 key（tk），key 为空时瓦片请求将失败；style: vec/cva/img/cia/ter。
 */
class TdtImageryProvider extends UrlTemplateImageryProvider {
  constructor(options: TdtImageryProviderOptions = {}) {
    const style = options.style || 'vec'
    const url =
      options.url ||
      [
        options.protocol || '',
        TILE_URL.replace(/\{style\}/g, style).replace(/\{key\}/g, options.key || '')
      ].join('')
    super({
      url,
      subdomains:
        options.subdomains && options.subdomains.length
          ? options.subdomains
          : TDT_SUBDOMAINS,
      maximumLevel: 18
    })
  }
}

export default TdtImageryProvider
