import { WebMapTileServiceImageryProvider } from 'cesium'

const MAX_LEVELS = 60

export function createWmtsImageryProvider(
  url: string,
  layer: string,
  tileMatrixSetID: string,
  format = 'image/png'
): WebMapTileServiceImageryProvider {
  const tileMatrixLabels = Array.from(
    { length: MAX_LEVELS },
    (_, level) => `${tileMatrixSetID}:${level}`
  )
  const template = `${url}?layer={layer}&style={Style}&tilematrixset={tilematrixset}&Service=WMTS&Request=GetTile&Version=1.0.0&Format={format}&TileMatrix={TileMatrix}&TileCol={TileCol}&TileRow={TileRow}`
  return new WebMapTileServiceImageryProvider({
    url: template,
    layer,
    style: '',
    format,
    tileMatrixSetID,
    tileMatrixLabels
  })
}
