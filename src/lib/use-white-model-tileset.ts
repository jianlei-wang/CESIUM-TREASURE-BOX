import { ref, type Ref } from 'vue'
import {
  Cartesian3,
  Cesium3DTileset,
  Math as CesiumMath,
  type Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  type MapSceneOptions,
  type SceneCallbacks
} from './cesium-scene'

export const TILESET_URL =
  'https://data.3dbag.nl/v20250903/cesium3dtiles/lod22/tileset.json'

export const AMSTERDAM = { lon: 4.9041, lat: 52.3676 }

export const LOD_OPTIONS = [
  { label: 'LOD 2.2（精细）', suffix: 'lod22' },
  { label: 'LOD 1.3（简化）', suffix: 'lod13' },
  { label: 'LOD 1.2（最简）', suffix: 'lod12' }
]

export function buildTilesetUrl(suffix: string): string {
  return `https://data.3dbag.nl/v20250903/cesium3dtiles/${suffix}/tileset.json`
}

export function flyToAmsterdam(viewer: Viewer): void {
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(AMSTERDAM.lon, AMSTERDAM.lat, 18000),
    orientation: {
      heading: -1.1,
      pitch: -CesiumMath.PI_OVER_TWO + 0.22,
      roll: 0
    }
  })
}

export interface WhiteModelBase {
  container: Ref<HTMLElement | null>
  statusMessage: Ref<string>
  loading: Ref<boolean>
  viewer: Ref<Viewer | undefined>
  tileset: Ref<Cesium3DTileset | undefined>
  lodIndex: Ref<number>
  perfFps: Ref<number>
  perfTiles: Ref<number>
  perfTriangles: Ref<number>
  perfMemory: Ref<number>
  perfQueue: Ref<number>
  mount: (onTilesetReady?: OnTilesetReady) => Promise<void>
  switchLod: (onTilesetReady?: OnTilesetReady) => Promise<void>
  flyToCity: () => void
  reset: (onTilesetReady?: OnTilesetReady) => Promise<void>
  teardown: () => void
}

export type OnTilesetReady = (
  viewer: Viewer,
  tileset: Cesium3DTileset
) => void

export function useWhiteModelTileset(sceneOptions: MapSceneOptions = {}): WhiteModelBase {
  const container = ref<HTMLElement | null>(null)
  const statusMessage = ref('正在加载 Bing 地图…')
  const loading = ref(false)
  const viewer = ref<Viewer | undefined>(undefined)
  const tileset = ref<Cesium3DTileset | undefined>(undefined)
  const lodIndex = ref(0)

  const perfFps = ref(0)
  const perfTiles = ref(0)
  const perfTriangles = ref(0)
  const perfMemory = ref(0)
  const perfQueue = ref(0)

  let disposed = false
  let perfTimer: number | undefined
  let lastFrameTime = 0

  function updatePerf(): void {
    const v = viewer.value
    const ts = tileset.value
    if (!v || !ts || v.isDestroyed()) return
    const now = performance.now()
    if (lastFrameTime > 0) {
      const dt = (now - lastFrameTime) / 1000
      if (dt > 0) perfFps.value = Math.round(1 / dt)
    }
    lastFrameTime = now
    const stats = ts.statistics
    perfTiles.value = stats?.numberOfTilesWithContentReady ?? 0
    perfTriangles.value = stats?.trianglesLength ?? 0
    perfMemory.value = Math.round(ts.totalMemoryUsageInBytes / (1024 * 1024))
    perfQueue.value = stats?.numberOfPendingRequests ?? 0
  }

  async function addModel(onTilesetReady?: OnTilesetReady): Promise<void> {
    const v = viewer.value
    if (!v || v.isDestroyed()) return
    loading.value = true
    try {
      const model = await Cesium3DTileset.fromUrl(
        buildTilesetUrl(LOD_OPTIONS[lodIndex.value].suffix)
      )
      model.maximumScreenSpaceError = 16
      model.skipLevelOfDetail = true
      v.scene.primitives.add(model)
      tileset.value = model
      onTilesetReady?.(v, model)
      flyToAmsterdam(v)
      statusMessage.value = ''
    } catch (error) {
      statusMessage.value = error instanceof Error ? error.message : String(error)
    } finally {
      loading.value = false
    }
  }

  function removeModel(): void {
    const v = viewer.value
    const ts = tileset.value
    if (!v || v.isDestroyed() || !ts) return
    v.scene.primitives.remove(ts)
    tileset.value = undefined
  }

  async function mount(onTilesetReady?: OnTilesetReady): Promise<void> {
    if (!container.value) return
    const sceneCallbacks: SceneCallbacks = {
      onStatus: (message) => {
        statusMessage.value = message
      },
      onBasemapReady: () => {
        statusMessage.value = ''
      }
    }
    try {
      viewer.value = createMapScene(container.value, sceneCallbacks, sceneOptions)
      loadBingImagery(viewer.value, sceneCallbacks)
      viewer.value.scene.globe.depthTestAgainstTerrain = true
      viewer.value.scene.globe.maximumScreenSpaceError = 2
      statusMessage.value = '正在加载荷兰全境建筑白模…'
      await addModel(onTilesetReady)
      if (disposed || !viewer.value || viewer.value.isDestroyed()) return
      perfTimer = window.setInterval(updatePerf, 300)
    } catch (error) {
      if (!disposed) {
        statusMessage.value = error instanceof Error ? error.message : String(error)
      }
    }
  }

  async function switchLod(onTilesetReady?: OnTilesetReady): Promise<void> {
    const v = viewer.value
    if (!v || v.isDestroyed()) return
    removeModel()
    statusMessage.value = `正在加载 ${LOD_OPTIONS[lodIndex.value].label} 建筑模型…`
    await addModel(onTilesetReady)
  }

  function flyToCity(): void {
    const v = viewer.value
    if (!v || v.isDestroyed()) return
    flyToAmsterdam(v)
  }

  async function reset(onTilesetReady?: OnTilesetReady): Promise<void> {
    const v = viewer.value
    if (!v || v.isDestroyed()) return
    removeModel()
    lodIndex.value = 0
    statusMessage.value = '正在加载 LOD 2.2（精细）建筑模型…'
    await addModel(onTilesetReady)
  }

  function teardown(): void {
    disposed = true
    if (perfTimer !== undefined) {
      window.clearInterval(perfTimer)
      perfTimer = undefined
    }
    removeModel()
    destroyScene(viewer.value)
    viewer.value = undefined
  }

  return {
    container,
    statusMessage,
    loading,
    viewer,
    tileset,
    lodIndex,
    perfFps,
    perfTiles,
    perfTriangles,
    perfMemory,
    perfQueue,
    mount,
    switchLod,
    flyToCity,
    reset,
    teardown
  }
}
