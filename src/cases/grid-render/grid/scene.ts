import 'cesium/Build/Cesium/Widgets/widgets.css'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Credit,
  Ellipsoid,
  HeadingPitchRange,
  Ion,
  Math as CesiumMath,
  Matrix4,
  UrlTemplateImageryProvider,
  Viewer,
  type ImageryLayer,
  type Scene
} from 'cesium'
import type { AreaBounds, LonLat } from './types'

/**
 * 本案例为「系统DEMO」模块下的自包含案例：
 * 场景、网格引擎、渲染与 UI 全部代码均位于本案例文件夹内，不复用项目其他部分。
 *
 * 网格渲染以椭球面为基座（不加载地形），网格线按固定抬升高度贴合椭球，
 * 保证任意相机高度下网格线始终可见且性能稳定。
 */
const GRID_ION_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmNGI3MTJlZi1kNGFmLTQ1OWQtYmJiMC0yMDViNjM0ZDdjYzMiLCJpZCI6Mzg2MzU3LCJpYXQiOjE3NzAwODA5MDJ9.-ggs9Xfr6ptMLXTs0MS7xdieNVFr7TMV7yyd-yjxyHw'

const BING_SUBDOMAINS = ['0', '1', '2', '3']
const BING_CREDIT = new Credit('© Microsoft Bing Maps')

export type GridSceneCallbacks = {
  onStatus?: (message: string) => void
}

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

export function createGridBingProvider(): UrlTemplateImageryProvider {
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

export function createGridViewer(container: HTMLElement): Viewer {
  Ion.defaultAccessToken = GRID_ION_TOKEN
  const viewer = new Viewer(container, {
    animation: false,
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    skyAtmosphere: false,
    skyBox: false,
    shadows: false,
    scene3DOnly: true,
    contextOptions: { webgl: { alpha: false } }
  })
  viewer.scene.globe.baseColor = Color.fromCssColorString('#0b1a2b')
  viewer.scene.globe.depthTestAgainstTerrain = false
  viewer.scene.fog.enabled = true
  return viewer
}

export function addGridImagery(viewer: Viewer, status: GridSceneCallbacks = {}): ImageryLayer | undefined {
  if (viewer.isDestroyed()) return undefined
  const layer = viewer.imageryLayers.addImageryProvider(createGridBingProvider())
  let failCount = 0
  const onError = () => {
    failCount += 1
    if (failCount >= 3) {
      layer.errorEvent.removeEventListener(onError)
      status.onStatus?.('Bing 影像瓦片加载失败：已使用纯色地表，网格渲染不受影响')
    }
  }
  layer.errorEvent.addEventListener(onError)
  return layer
}

/** 定位到目标四至：相机以固定俯角俯视范围中心。 */
export function setGridCamera(viewer: Viewer, bounds: AreaBounds): void {
  if (viewer.isDestroyed()) return
  const lon = (bounds.west + bounds.east) / 2
  const lat = (bounds.south + bounds.north) / 2
  const span = Math.max(bounds.east - bounds.west, bounds.north - bounds.south)
  const range = Math.max(span * 111000 * 1.6, 12000)
  viewer.camera.lookAt(
    Cartesian3.fromDegrees(lon, lat, 0),
    new HeadingPitchRange(CesiumMath.toRadians(12), CesiumMath.toRadians(-52), range)
  )
  viewer.camera.lookAtTransform(Matrix4.IDENTITY)
}

export function destroyGridViewer(viewer: Viewer | undefined): void {
  if (viewer && !viewer.isDestroyed()) viewer.destroy()
}

/** 椭球面拾取：把屏幕坐标换算为经纬度（网格单元按经纬度解析归属）。 */
export function pickLonLat(scene: Scene, windowPosition: Cartesian2): LonLat | undefined {
  const cartesian = scene.camera.pickEllipsoid(windowPosition, Ellipsoid.WGS84)
  if (!cartesian) return undefined
  const carto = Cartographic.fromCartesian(cartesian)
  return { lon: CesiumMath.toDegrees(carto.longitude), lat: CesiumMath.toDegrees(carto.latitude) }
}
