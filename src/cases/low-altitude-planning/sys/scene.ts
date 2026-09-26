import 'cesium/Build/Cesium/Widgets/widgets.css'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileStyle,
  Color,
  Credit,
  createOsmBuildingsAsync,
  createWorldTerrainAsync,
  Ellipsoid,
  HeadingPitchRange,
  Ion,
  Math as CesiumMath,
  Matrix4,
  sampleTerrainMostDetailed,
  UrlTemplateImageryProvider,
  Viewer,
  type Cesium3DTileset,
  type ImageryLayer,
  type Scene,
  type TerrainProvider
} from 'cesium'
import type { AreaBounds, ElevationModel, LonLat } from './types'

const ION_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmNGI3MTJlZi1kNGFmLTQ1OWQtYmJiMC0yMDViNjM0ZDdjYzMiLCJpZCI6Mzg2MzU3LCJpYXQiOjE3NzAwODA5MDJ9.-ggs9Xfr6ptMLXTs0MS7xdieNVFr7TMV7yyd-yjxyHw'

const BING_SUBDOMAINS = ['0', '1', '2', '3']

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

function createBingProvider(): UrlTemplateImageryProvider {
  return new UrlTemplateImageryProvider({
    url: 'https://ecn.t{s}.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=1',
    subdomains: BING_SUBDOMAINS,
    maximumLevel: 19,
    credit: new Credit('© Microsoft Bing Maps'),
    customTags: {
      quadkey: (_provider: unknown, x: number, y: number, level: number) => toQuadKey(x, y, level)
    }
  })
}

export function createSystemViewer(container: HTMLElement): Viewer {
  Ion.defaultAccessToken = ION_TOKEN
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
  viewer.scene.globe.baseColor = Color.fromCssColorString('#0a1a2b')
  viewer.scene.globe.depthTestAgainstTerrain = true
  viewer.scene.fog.enabled = true
  return viewer
}

export function addSystemImagery(viewer: Viewer, onFail?: (message: string) => void): ImageryLayer | undefined {
  if (viewer.isDestroyed()) return undefined
  const layer = viewer.imageryLayers.addImageryProvider(createBingProvider())
  let failCount = 0
  const onError = () => {
    failCount += 1
    if (failCount >= 3) {
      layer.errorEvent.removeEventListener(onError)
      onFail?.('Bing 影像瓦片加载失败：已使用纯色地表，业务图层不受影响')
    }
  }
  layer.errorEvent.addEventListener(onError)
  return layer
}

/** 在作业区范围内按规则网格采样地表高程，供双线性插值使用。 */
export async function sampleElevationModel(
  provider: TerrainProvider,
  bounds: AreaBounds,
  nx = 25,
  ny = 25
): Promise<ElevationModel> {
  const positions: Cartographic[] = []
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      positions.push(
        Cartographic.fromDegrees(
          bounds.west + (ix / (nx - 1)) * (bounds.east - bounds.west),
          bounds.south + (iy / (ny - 1)) * (bounds.north - bounds.south)
        )
      )
    }
  }
  const sampled = await sampleTerrainMostDetailed(provider, positions)
  const finite = sampled.map((carto) => carto.height).filter((h) => Number.isFinite(h))
  if (!finite.length) throw new Error('terrain sampling returned no finite heights')
  // 个别瓦片失败时用有效样本均值补齐，避免出现 0 值把贴合地表的要素拉到地下。
  const fallback = finite.reduce((sum, h) => sum + h, 0) / finite.length
  const heights = sampled.map((carto) => (Number.isFinite(carto.height) ? carto.height : fallback))
  return { ...bounds, nx, ny, heights }
}

/**
 * 加载 Cesium World Terrain 全球地形，并建立作业区地表高程模型。
 * 模型用于把“真高”换算为椭球高，避免贴地要素沉入地形；失败时返回 undefined。
 */
export async function addSystemTerrain(
  viewer: Viewer,
  bounds: AreaBounds,
  onStatus?: (message: string) => void
): Promise<ElevationModel | undefined> {
  if (viewer.isDestroyed()) return undefined
  try {
    const provider = await createWorldTerrainAsync()
    if (viewer.isDestroyed()) return undefined
    // 先采样高程，确认可用后再挂到 Viewer，避免“地形已生效但高程模型缺失”
    // 导致所有贴合地表的要素整体沉入地下。
    const model = await sampleElevationModel(provider, bounds)
    viewer.terrainProvider = provider
    const min = Math.min(...model.heights)
    const max = Math.max(...model.heights)
    onStatus?.(`已加载 World Terrain 地形，作业区高程 ${min.toFixed(0)}~${max.toFixed(0)} m`)
    return model
  } catch {
    onStatus?.('地形数据加载失败，已使用椭球面基准')
    return undefined
  }
}

/**
 * 加载 Cesium OSM Buildings 真实三维白模（全球覆盖，含建筑体块与高度）。
 * 通过 Ion 默认令牌访问；失败时返回 undefined，由调用方决定回退策略。
 */
export async function addOsmWhiteModels(
  viewer: Viewer,
  onStatus?: (message: string) => void
): Promise<Cesium3DTileset | undefined> {
  if (viewer.isDestroyed()) return undefined
  try {
    const tileset = await createOsmBuildingsAsync({
      style: new Cesium3DTileStyle({ color: "color('white', 0.96)" }),
      showOutline: true
    })
    if (viewer.isDestroyed()) {
      tileset.destroy()
      return undefined
    }
    tileset.maximumScreenSpaceError = 16
    viewer.scene.primitives.add(tileset)
    onStatus?.('已加载 Cesium OSM 真实三维白模')
    return tileset
  } catch {
    onStatus?.('三维白模加载失败，已回退为规划建筑体块')
    return undefined
  }
}

/** 以固定俯角俯视目标四至。 */
export function setSystemCamera(viewer: Viewer, bounds: AreaBounds): void {
  if (viewer.isDestroyed()) return
  const lon = (bounds.west + bounds.east) / 2
  const lat = (bounds.south + bounds.north) / 2
  const span = Math.max(bounds.east - bounds.west, bounds.north - bounds.south)
  const range = Math.max(span * 111000 * 1.35, 12000)
  viewer.camera.lookAt(
    Cartesian3.fromDegrees(lon, lat, 0),
    new HeadingPitchRange(CesiumMath.toRadians(8), CesiumMath.toRadians(-58), range)
  )
  viewer.camera.lookAtTransform(Matrix4.IDENTITY)
}

export function flyToLonLat(viewer: Viewer, point: LonLat, alt: number, range = 1600): void {
  if (viewer.isDestroyed()) return
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(point.lon, point.lat - 0.004, alt + range * 0.8),
    orientation: {
      heading: 0,
      pitch: CesiumMath.toRadians(-48),
      roll: 0
    },
    duration: 0.9
  })
}

export function destroySystemViewer(viewer: Viewer | undefined): void {
  if (viewer && !viewer.isDestroyed()) viewer.destroy()
}

/** 椭球面拾取：屏幕坐标 → 经纬度。 */
export function pickLonLat(scene: Scene, position: Cartesian2): LonLat | undefined {
  const cartesian = scene.camera.pickEllipsoid(position, Ellipsoid.WGS84)
  if (!cartesian) return undefined
  const carto = Cartographic.fromCartesian(cartesian)
  return { lon: CesiumMath.toDegrees(carto.longitude), lat: CesiumMath.toDegrees(carto.latitude) }
}
