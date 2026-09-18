import 'cesium/Build/Cesium/Widgets/widgets.css'
import { Camera, Color, createWorldTerrainAsync, EllipsoidTerrainProvider, ImageryLayer, Ion, Rectangle, Viewer, type TerrainProvider } from 'cesium'
import { createBingImageryProvider } from './bing'

const CESIUM_ION_ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmNGI3MTJlZi1kNGFmLTQ1OWQtYmJiMC0yMDViNjM0ZDdjYzMiLCJpZCI6Mzg2MzU3LCJpYXQiOjE3NzAwODA5MDJ9.-ggs9Xfr6ptMLXTs0MS7xdieNVFr7TMV7yyd-yjxyHw'

declare global {
  interface Window {
    mapViewer?: Viewer
  }
}

export type SceneCallbacks = {
  onStatus?: (message: string) => void
  onBasemapReady?: (name: string) => void
}

export type MapSceneOptions = {
  skyAtmosphere?: boolean
  skyBox?: boolean
}

export const DEFAULT_VIEW_RECTANGLE = Rectangle.fromDegrees(75.0, 0.0, 140.0, 60.0)

let activeViewer: Viewer | undefined

export type CesiumStats = {
  triangles: number
  tileQueue: number
}

export function getCesiumStats(): CesiumStats {
  const viewer = activeViewer
  if (!viewer || viewer.isDestroyed()) return { triangles: 0, tileQueue: 0 }

  const scene = viewer.scene as unknown as {
    frameState: { commandList: Array<{ count: number }> }
  }
  const commands = scene.frameState.commandList
  let vertices = 0
  for (let i = 0; i < commands.length; i += 1) {
    vertices += commands[i].count
  }

  return {
    triangles: Math.round(vertices / 3),
    tileQueue: (viewer.scene.globe as unknown as { tileLoadQueueLength: number }).tileLoadQueueLength
  }
}

export function createMapScene(container: HTMLElement, callbacks: SceneCallbacks = {}, options: MapSceneOptions = {}): Viewer {
  Camera.DEFAULT_VIEW_RECTANGLE = DEFAULT_VIEW_RECTANGLE
  Ion.defaultAccessToken = CESIUM_ION_ACCESS_TOKEN

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
    skyAtmosphere: options.skyAtmosphere ? undefined : false,
    skyBox: options.skyBox ? undefined : false,
    shadows: false,
    scene3DOnly: true
  })

  viewer.scene.globe.baseColor = Color.fromCssColorString('#152b4c')
  viewer.camera.flyHome(0)
  activeViewer = viewer
  window.mapViewer = viewer
  return viewer
}
export function loadBingImagery(viewer: Viewer, callbacks: SceneCallbacks = {}, onLayer?: (layer: ImageryLayer) => void): void {
  if (!viewer || viewer.isDestroyed()) return

  const imageryLayer = viewer.imageryLayers.addImageryProvider(createBingImageryProvider())
  onLayer?.(imageryLayer)

  let failCount = 0
  const onImageryError = () => {
    failCount += 1
    if (failCount >= 3) {
      imageryLayer.errorEvent.removeEventListener(onImageryError)
      callbacks.onStatus?.('Bing 地图瓦片加载失败：请检查网络连接与服务访问状态')
    }
  }
  imageryLayer.errorEvent.addEventListener(onImageryError)
  callbacks.onBasemapReady?.('Bing 地图')
}

export async function loadWorldTerrain(viewer: Viewer): Promise<TerrainProvider> {
  const terrainProvider = await createWorldTerrainAsync({ requestVertexNormals: true })
  if (!viewer.isDestroyed()) viewer.terrainProvider = terrainProvider
  return terrainProvider
}

export async function setTerrainEnabled(viewer: Viewer, enabled: boolean): Promise<void> {
  if (enabled) {
    await loadWorldTerrain(viewer)
  } else {
    viewer.terrainProvider = new EllipsoidTerrainProvider()
  }
}

export function destroyScene(viewer: Viewer | undefined): void {
  if (viewer && activeViewer === viewer) activeViewer = undefined
  if (viewer && window.mapViewer === viewer) window.mapViewer = undefined
  viewer?.destroy()
}
