import { Credit, UrlTemplateImageryProvider } from 'cesium'

const BING_SUBDOMAINS = ['0', '1', '2', '3']
const BING_CREDIT = new Credit('© Microsoft Bing Maps')

function toQuadKey(x: number, y: number, level: number): string {
  let quadKey = ''
  for (let bit = level; bit > 0; bit -= 1) {
    let digit = 0
    const mask = 1 << (bit - 1)
    if ((x & mask) !== 0) digit += 1
    if ((y & mask) !== 0) digit += 2
    quadKey += digit.toString()
  }
  return quadKey
}

export function createBingImageryProvider(): UrlTemplateImageryProvider {
  return new UrlTemplateImageryProvider({
    url: 'https://ecn.t{s}.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=1',
    subdomains: BING_SUBDOMAINS,
    maximumLevel: 19,
    credit: BING_CREDIT,
    customTags: {
      quadkey: (_provider: unknown, x: number, y: number, level: number) => toQuadKey(x, y, level)
    }
  })
}

export function createBingRoadImageryProvider(): UrlTemplateImageryProvider {
  return new UrlTemplateImageryProvider({
    url: 'https://ecn.t{s}.tiles.virtualearth.net/tiles/r{quadkey}.png?g=1',
    subdomains: BING_SUBDOMAINS,
    maximumLevel: 19,
    credit: BING_CREDIT,
    customTags: {
      quadkey: (_provider: unknown, x: number, y: number, level: number) => toQuadKey(x, y, level)
    }
  })
}
