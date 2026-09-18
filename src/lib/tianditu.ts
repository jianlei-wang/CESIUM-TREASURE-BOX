import { Credit, UrlTemplateImageryProvider } from 'cesium'

export const TIANDITU_TOKEN = '0a94f560c3f216b0047de09d2861ed12'

const TIANDITU_SUBDOMAINS = ['0', '1', '2', '3', '4', '5', '6', '7']

const TIANDITU_CREDIT = new Credit(
  '<a href="https://www.tianditu.gov.cn/" target="_blank" rel="noopener noreferrer">© 天地图</a>'
)

type TiandituLayer = 'img' | 'cia'

function tiandituTemplate(layer: TiandituLayer) {
  return `https://t{s}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_TOKEN}`
}

export function createTiandituImageryProvider() {
  return new UrlTemplateImageryProvider({
    url: tiandituTemplate('img'),
    subdomains: TIANDITU_SUBDOMAINS,
    maximumLevel: 18,
    credit: TIANDITU_CREDIT
  })
}

export function createTiandituLabelProvider() {
  return new UrlTemplateImageryProvider({
    url: tiandituTemplate('cia'),
    subdomains: TIANDITU_SUBDOMAINS,
    maximumLevel: 18,
    credit: TIANDITU_CREDIT
  })
}
