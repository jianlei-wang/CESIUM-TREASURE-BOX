import 'cesium/Build/Cesium/Widgets/widgets.css'
import {
  Camera,
  Cartesian3,
  Color,
  Credit,
  HeadingPitchRange,
  Ion,
  Math as CesiumMath,
  Matrix4,
  UrlTemplateImageryProvider,
  Viewer,
  createWorldTerrainAsync,
  type ImageryLayer,
  type TerrainProvider
} from 'cesium'
import type { AreaBounds } from './types'

export type { AreaBounds } from './types'

/**
 * 本案例为「系统DEMO」模块下的自包含案例：
 * 场景、地形、影像、模型、渲染与 UI 全部代码均位于本案例文件夹内，不复用项目其他部分。
 */
const WILDFIRE_ION_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmNGI3MTJlZi1kNGFmLTQ1OWQtYmJiMC0yMDViNjM0ZDdjYzMiLCJpZCI6Mzg2MzU3LCJpYXQiOjE3NzAwODA5MDJ9.-ggs9Xfr6ptMLXTs0MS7xdieNVFr7TMV7yyd-yjxyHw'

const BING_SUBDOMAINS = ['0', '1', '2', '3']
const BING_CREDIT = new Credit('© Microsoft Bing Maps')

export type WildfireSceneCallbacks = {
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

export function createWildfireBingProvider(): UrlTemplateImageryProvider {
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

export function createWildfireViewer(container: HTMLElement, bounds: AreaBounds): Viewer {
  Ion.defaultAccessToken = WILDFIRE_ION_TOKEN

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
    contextOptions: { webgl: { alpha: false, preserveDrawingBuffer: true } }
  })

  viewer.scene.globe.baseColor = Color.fromCssColorString('#14241c')
  viewer.scene.globe.depthTestAgainstTerrain = true
  viewer.scene.fog.enabled = true
  // 粒子系统按 frameState.time 推进发射节奏：默认时钟不前进会导致粒子永不生成。
  viewer.clock.shouldAnimate = true
  return viewer
}

export function addWildfireImagery(
  viewer: Viewer,
  status: WildfireSceneCallbacks = {}
): ImageryLayer | undefined {
  if (viewer.isDestroyed()) return undefined
  const layer = viewer.imageryLayers.addImageryProvider(createWildfireBingProvider())

  let failCount = 0
  const onError = () => {
    failCount += 1
    if (failCount >= 3) {
      layer.errorEvent.removeEventListener(onError)
      status.onStatus?.('Bing 影像瓦片加载失败：已使用纯色地表，火场专题不受影响')
    }
  }
  layer.errorEvent.addEventListener(onError)
  return layer
}

export async function loadWildfireTerrain(viewer: Viewer): Promise<TerrainProvider | undefined> {
  try {
    const provider = await createWorldTerrainAsync()
    if (!viewer.isDestroyed()) viewer.terrainProvider = provider
    return provider
  } catch {
    return undefined
  }
}

export function setWildfireCamera(viewer: Viewer, bounds: AreaBounds, altitude = 0): void {
  if (viewer.isDestroyed()) return
  const lon = (bounds.west + bounds.east) / 2
  const lat = (bounds.south + bounds.north) / 2
  const span = Math.max(bounds.east - bounds.west, bounds.north - bounds.south)
  const range = Math.max(span * 111000 * 1.25, 6000)
  const center = Cartesian3.fromDegrees(lon, lat, Number.isFinite(altitude) ? altitude : 0)
  viewer.camera.lookAt(
    center,
    new HeadingPitchRange(CesiumMath.toRadians(18), CesiumMath.toRadians(-33), range)
  )
  viewer.camera.lookAtTransform(Matrix4.IDENTITY)
}

export function destroyWildfireViewer(viewer: Viewer | undefined): void {
  if (viewer && !viewer.isDestroyed()) viewer.destroy()
}

/**
 * 抓取当前三维场景画面用于分析报告配图。
 * 依赖创建 Viewer 时开启的 preserveDrawingBuffer；输出等比缩放的 JPEG dataURL 以控制体积。
 */
export function captureWildfireCanvas(viewer: Viewer | undefined, maxWidth = 1000): string | undefined {
  if (!viewer || viewer.isDestroyed()) return undefined
  try {
    const source = viewer.scene.canvas
    if (!source || source.width === 0 || source.height === 0) return undefined
    viewer.render()
    const scale = Math.min(1, maxWidth / source.width)
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(source.width * scale))
    out.height = Math.max(1, Math.round(source.height * scale))
    const ctx = out.getContext('2d')
    if (!ctx) return undefined
    ctx.fillStyle = '#0a1524'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(source, 0, 0, out.width, out.height)
    return out.toDataURL('image/jpeg', 0.88)
  } catch {
    return undefined
  }
}
