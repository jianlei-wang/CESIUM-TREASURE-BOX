/**
 * 三个天空主题案例共用的 Viewer + SkyAtmos 挂载逻辑。
 *
 * 只负责场景、底图、地形、相机与实例生命周期；参数面板由各案例用 Vue 模板实现，
 * 通过 apply() 把参数表翻译后的局部配置提交给管线。
 */
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { SkyAtmos } from './src/index.ts'

const INITIAL_TIME = '2026-05-01T06:00Z'

export function createDefaultValues(preset) {
  const options = {
    ...SkyAtmos.getDefaultOptions(),
    time: INITIAL_TIME,
  }
  return { preset, options }
}

/**
 * 在容器内创建地球并接入天空管线。
 * @param {{ container: HTMLElement, signal?: AbortSignal, ionToken?: string, tiandituToken?: string }} params
 */
export async function mountSkyAtmos({
  container,
  signal,
  ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim() || '',
  tiandituToken = import.meta.env.VITE_TIANDITU_TOKEN?.trim() || '',
}) {
  const assertActive = () => {
    if (signal?.aborted) {
      throw Object.assign(new Error('挂载已取消。'), { name: 'AbortError' })
    }
  }
  assertActive()

  Cesium.Ion.defaultAccessToken = ionToken

  const viewer = new Cesium.Viewer(container, {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    baseLayer: false,
    geocoder: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    homeButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: false,
  })

  const imageryProvider = tiandituToken
    ? new Cesium.WebMapTileServiceImageryProvider({
        url: `https://t1.tianditu.gov.cn/img_w/wmts?tk=${encodeURIComponent(tiandituToken)}`,
        layer: 'img',
        style: 'default',
        format: 'tiles',
        tileMatrixSetID: 'w',
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        maximumLevel: 18,
        credit: '天地图',
      })
    : await Cesium.TileMapServiceImageryProvider.fromUrl(
        Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'),
      )

  viewer.imageryLayers.addImageryProvider(imageryProvider)

  if (signal?.aborted) {
    viewer.destroy()
    assertActive()
  }

  viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider()
  if (ionToken) {
    Cesium.createWorldTerrainAsync()
      .then((terrainProvider) => {
        if (!viewer.isDestroyed()) viewer.terrainProvider = terrainProvider
      })
      .catch((error) => {
        console.warn('[sky-atmos] 地形加载失败，继续使用椭球地形：', error)
      })
  }

  viewer.scene.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(104.07, 30.4, 9000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-20), roll: 0 },
  })

  const instance = new SkyAtmos(viewer, { time: INITIAL_TIME })

  const apply = (patch) => {
    instance.update(patch)
    if (patch.time) {
      viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(patch.time)
    }
    viewer.scene.requestRender()
  }

  const destroy = () => {
    try {
      instance.dispose()
    } catch (error) {
      console.error('[sky-atmos] 释放天空效果失败：', error)
    }
    if (!viewer.isDestroyed()) viewer.destroy()
  }

  return { viewer, instance, apply, destroy, initialTime: INITIAL_TIME }
}
