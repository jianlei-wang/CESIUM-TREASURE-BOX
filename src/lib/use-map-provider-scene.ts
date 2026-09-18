import { ref } from 'vue'
import {
  Camera,
  Cartesian3,
  Color,
  ImageryLayer,
  Rectangle,
  Viewer,
  type ImageryProvider
} from 'cesium'

export type MapSceneCallbacks = {
  onStatus?: (message: string) => void
}

const DEFAULT_VIEW_RECTANGLE = Rectangle.fromDegrees(75.0, 0.0, 140.0, 60.0)

/**
 * 国内地图厂商底图案例公共场景管理。
 * - mount：创建无底图 Viewer（场景纯色背景，底图由各案例按需添加）。
 * - applyProvider：清空旧图层并添加 provider，监听瓦片加载失败给出友好提示。
 * - flyToLonLat：相机飞到指定经纬度（默认高度）。
 * - teardown：销毁。
 */
export function useMapProviderScene(callbacks: MapSceneCallbacks = {}) {
  const container = ref<HTMLElement | null>(null)
  const viewer = ref<Viewer>()

  function mount(): Viewer | undefined {
    if (!container.value) return undefined
    if (viewer.value && !viewer.value.isDestroyed()) return viewer.value

    Camera.DEFAULT_VIEW_RECTANGLE = DEFAULT_VIEW_RECTANGLE
    const v = new Viewer(container.value, {
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
      scene3DOnly: true
    })
    v.scene.globe.baseColor = Color.fromCssColorString('#152b4c')
    v.camera.flyHome(0)
    viewer.value = v
    return v
  }

  function applyProvider(provider: ImageryProvider): ImageryLayer | undefined {
    return applyProviders([provider])[0]
  }

  function applyProviders(providers: ImageryProvider[]): ImageryLayer[] {
    const v = viewer.value
    if (!v || v.isDestroyed()) return []
    v.imageryLayers.removeAll()
    const layers: ImageryLayer[] = []
    for (const provider of providers) {
      const layer = v.imageryLayers.addImageryProvider(provider)
      let failCount = 0
      const onError = () => {
        failCount += 1
        if (failCount >= 3) {
          layer.errorEvent.removeEventListener(onError)
          callbacks.onStatus?.('底图瓦片加载失败：请检查网络连接或 Key 是否有效')
        }
      }
      layer.errorEvent.addEventListener(onError)
      layers.push(layer)
    }
    v.scene.requestRender()
    return layers
  }

  function flyToLonLat(lon: number, lat: number, height = 12000): void {
    const v = viewer.value
    if (!v || v.isDestroyed()) return
    v.camera.flyTo({
      destination: Cartesian3.fromDegrees(lon, lat, height),
      duration: 0
    })
  }

  function teardown(): void {
    viewer.value?.destroy()
    viewer.value = undefined
  }

  return {
    container,
    viewer,
    mount,
    applyProvider,
    applyProviders,
    flyToLonLat,
    teardown
  }
}
