import { ref, type Ref } from 'vue'
import {
  Cartesian3,
  Cesium3DTileset,
  Credit,
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
import { runtimeConfig } from '../runtime-config'

export const DEFAULT_TILESET_BASE = 'https://data.3dbag.nl/v20250903/cesium3dtiles'
export const TILESET_LOAD_TIMEOUT_MS = 8000

export const FALLBACK_TILESET_URL =
  'https://api.pdok.nl/kadaster/3d-basisvoorziening/ogc/v1/collections/gebouwen/3dtiles?f=json'
export const FALLBACK_NOTICE =
  '3DBAG 官方数据源当前不可达，已切换 PDOK 3D Basisvoorziening 全国建筑白模（数据来源：PDOK / Kadaster，CC BY 4.0）。官方数据恢复后点击「重置」或重新进入案例即可恢复 3DBAG 数据。'

export function whiteModelTilesetBase(): string {
  const override = runtimeConfig.whiteModelTilesetBase
  return (override || DEFAULT_TILESET_BASE).replace(/\/+$/, '')
}

export function buildTilesetUrl(suffix: string): string {
  return `${whiteModelTilesetBase()}/${suffix}/tileset.json`
}

export async function requestTilesetJson(url: string): Promise<void> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TILESET_LOAD_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const json: unknown = await response.json()
    if (!json || typeof json !== 'object' || !('root' in json)) {
      throw new Error('返回内容不是有效的 tileset.json')
    }
  } finally {
    window.clearTimeout(timer)
  }
}

export function describeTilesetError(error: unknown): string {
  let detail: string
  if (error instanceof DOMException && error.name === 'AbortError') {
    detail = `数据源在 ${TILESET_LOAD_TIMEOUT_MS / 1000} 秒内无响应`
  } else if (error instanceof Error) {
    detail = /failed to fetch|networkerror|load failed|network request failed/i.test(error.message)
      ? '数据源网络不可达（连接被拒绝、重置或超时）'
      : error.message
  } else {
    detail = String(error)
  }
  return `建筑白模加载失败：${detail}。官网数据源 ${whiteModelTilesetBase()} 与 PDOK 备用数据源均不可用，请稍后重试。`
}

export const AMSTERDAM = { lon: 4.9041, lat: 52.3676 }

export const LOD_OPTIONS = [
  { label: 'LOD 2.2（精细）', suffix: 'lod22' },
  { label: 'LOD 1.3（简化）', suffix: 'lod13' },
  { label: 'LOD 1.2（最简）', suffix: 'lod12' }
]

export function flyToAmsterdam(viewer: Viewer, height = 18000): void {
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(AMSTERDAM.lon, AMSTERDAM.lat, height),
    orientation: {
      heading: -1.1,
      pitch: height > 5000 ? -CesiumMath.PI_OVER_TWO + 0.22 : -0.55,
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
  usingFallback: Ref<boolean>
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
  const usingFallback = ref(false)

  const perfFps = ref(0)
  const perfTiles = ref(0)
  const perfTriangles = ref(0)
  const perfMemory = ref(0)
  const perfQueue = ref(0)

  let disposed = false
  let perfTimer: number | undefined
  let lastFrameTime = 0
  let loadSeq = 0
  let noticeTimer: number | undefined
  let fallbackCredit: Credit | undefined

  function clearNoticeTimer(): void {
    if (noticeTimer !== undefined) {
      window.clearTimeout(noticeTimer)
      noticeTimer = undefined
    }
  }

  function syncFallbackCredit(v: Viewer, active: boolean): void {
    if (active && !fallbackCredit) {
      fallbackCredit = new Credit('PDOK / Kadaster (CC BY 4.0)', true)
      v.creditDisplay.addStaticCredit(fallbackCredit)
    } else if (!active && fallbackCredit) {
      v.creditDisplay.removeStaticCredit(fallbackCredit)
      fallbackCredit = undefined
    }
  }

  function showFallbackNotice(): void {
    clearNoticeTimer()
    statusMessage.value = FALLBACK_NOTICE
    noticeTimer = window.setTimeout(() => {
      noticeTimer = undefined
      if (!disposed) statusMessage.value = ''
    }, 15000)
  }

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
    const seq = ++loadSeq
    loading.value = true
    let model: Cesium3DTileset | undefined
    let usedFallback = usingFallback.value
    try {
      clearNoticeTimer()
      if (!usingFallback.value) {
        const url = buildTilesetUrl(LOD_OPTIONS[lodIndex.value].suffix)
        try {
          await requestTilesetJson(url)
          if (seq !== loadSeq || disposed || v.isDestroyed()) return
          model = await Cesium3DTileset.fromUrl(url)
        } catch {
          if (seq !== loadSeq || disposed || v.isDestroyed()) return
          statusMessage.value = '3DBAG 官方数据源不可达，正在切换 PDOK 全国建筑白模…'
        }
      }
      if (!model) {
        await requestTilesetJson(FALLBACK_TILESET_URL)
        if (seq !== loadSeq || disposed || v.isDestroyed()) return
        model = await Cesium3DTileset.fromUrl(FALLBACK_TILESET_URL)
        usedFallback = true
      }
      if (seq !== loadSeq || disposed || v.isDestroyed()) {
        model.destroy()
        return
      }
      model.maximumScreenSpaceError = 16
      model.skipLevelOfDetail = !usedFallback
      v.scene.primitives.add(model)
      tileset.value = model
      usingFallback.value = usedFallback
      syncFallbackCredit(v, usedFallback)
      onTilesetReady?.(v, model)
      if (usedFallback) {
        flyToAmsterdam(v, 900)
        showFallbackNotice()
      } else {
        flyToAmsterdam(v)
        statusMessage.value = ''
      }
    } catch (error) {
      if (seq !== loadSeq || disposed) return
      statusMessage.value = describeTilesetError(error)
    } finally {
      if (seq === loadSeq) loading.value = false
    }
  }

  function removeModel(): void {
    loadSeq += 1
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
        if (noticeTimer === undefined) statusMessage.value = ''
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
    if (usingFallback.value) {
      flyToAmsterdam(v, 900)
      return
    }
    flyToAmsterdam(v)
  }

  async function reset(onTilesetReady?: OnTilesetReady): Promise<void> {
    const v = viewer.value
    if (!v || v.isDestroyed()) return
    removeModel()
    lodIndex.value = 0
    usingFallback.value = false
    syncFallbackCredit(v, false)
    statusMessage.value = '正在加载 LOD 2.2（精细）建筑模型…'
    await addModel(onTilesetReady)
  }

  function teardown(): void {
    disposed = true
    clearNoticeTimer()
    if (perfTimer !== undefined) {
      window.clearInterval(perfTimer)
      perfTimer = undefined
    }
    removeModel()
    const current = viewer.value
    if (current && !current.isDestroyed() && fallbackCredit) {
      current.creditDisplay.removeStaticCredit(fallbackCredit)
      fallbackCredit = undefined
    }
    destroyScene(current)
    viewer.value = undefined
    usingFallback.value = false
  }

  return {
    container,
    statusMessage,
    loading,
    viewer,
    tileset,
    lodIndex,
    usingFallback,
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
