import { UrlTemplateImageryProvider } from 'cesium'

export type GeoVisStyle = 'vec' | 'img'

export type GeoVisImageryProviderOptions = {
  protocol?: string
  url?: string
  style?: GeoVisStyle
  key?: string
  subdomains?: string[]
}

const TILE_URL: Record<GeoVisStyle, string> = {
  vec: 'https://api.open.geovisearth.com/map/v1/vec/{z}/{x}/{y}?token={key}',
  img: 'https://api.open.geovisearth.com/pj/base/v1/2025/{z}/{x}/{y}?token={key}'
}

/**
 * 星图（中科星图）ImageryProvider。
 * 需用户手动申请 token；style: vec 矢量 / img 影像。
 */
class GeoVisImageryProvider extends UrlTemplateImageryProvider {
  constructor(options: GeoVisImageryProviderOptions = {}) {
    const style = options.style || 'vec'
    const url =
      options.url ||
      TILE_URL[style].replace(/\{key\}/g, options.key || '')
    const subdomains =
      options.subdomains && options.subdomains.length
        ? options.subdomains
        : ['1', '2', '3']
    super({ url, subdomains })
  }
}

export default GeoVisImageryProvider
