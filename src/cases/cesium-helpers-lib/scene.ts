import {
  Cartesian3,
  EllipsoidTerrainProvider,
  JulianDate,
  Math as CesiumMath,
  RequestScheduler,
  Viewer
} from 'cesium'
import {
  createMapScene,
  destroyScene,
  loadBingImagery,
  loadWorldTerrain,
  type SceneCallbacks
} from '../../lib/cesium-scene'

export type HelperViewerOptions = {
  smooth?: boolean
  onStatus?: (message: string) => void
}

let schedulerConfigured = false

function configureScheduler(): void {
  if (schedulerConfigured) return
  schedulerConfigured = true
  Object.assign(RequestScheduler.requestsByServer, {
    'ecn.t0.tiles.virtualearth.net:443': 28,
    'ecn.t1.tiles.virtualearth.net:443': 28,
    'ecn.t2.tiles.virtualearth.net:443': 28,
    'ecn.t3.tiles.virtualearth.net:443': 28,
    'tile.openstreetmap.org:443': 28
  })
}

export async function createHelperViewer(
  container: HTMLElement,
  options: HelperViewerOptions = {}
): Promise<Viewer> {
  configureScheduler()
  const callbacks: SceneCallbacks = {
    onStatus: options.onStatus,
    onBasemapReady: () => options.onStatus?.('')
  }
  const viewer = createMapScene(container, callbacks)
  loadBingImagery(viewer, callbacks)

  try {
    await loadWorldTerrain(viewer)
  } catch {
    viewer.terrainProvider = new EllipsoidTerrainProvider()
  }

  if (options.smooth) {
    viewer.canvas.style.imageRendering = 'auto'
  }

  viewer.scene.requestRenderMode = true
  viewer.scene.globe.showGroundAtmosphere = true
  viewer.scene.postProcessStages.fxaa.enabled = true

  const afternoon = new Date()
  afternoon.setHours(14, 0, 0, 0)
  viewer.clock.currentTime = JulianDate.fromDate(afternoon)
  viewer.clock.shouldAnimate = false

  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(7.863775, 46.686447, 1200),
    orientation: {
      heading: CesiumMath.toRadians(25.0),
      pitch: 0.0
    }
  })
  return viewer
}

export function destroyHelperViewer(viewer: Viewer | undefined): void {
  if (!viewer || viewer.isDestroyed()) return
  destroyScene(viewer)
}
