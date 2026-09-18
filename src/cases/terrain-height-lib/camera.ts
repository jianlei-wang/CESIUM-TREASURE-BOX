import {
  Cartesian3,
  Math as CesiumMath,
  OrthographicFrustum,
  type Scene,
  type Viewer
} from 'cesium'
import { delay } from './grid'

export type CameraSnapshot = {
  position: Cartesian3
  direction: Cartesian3
  up: Cartesian3
  frustum: unknown
}

export type RectLike = { west: number; south: number; east: number; north: number }

export function snapshotCamera(viewer: Viewer): CameraSnapshot {
  const camera = viewer.camera
  return {
    position: Cartesian3.clone(camera.positionWC),
    direction: Cartesian3.clone(camera.directionWC),
    up: Cartesian3.clone(camera.upWC),
    frustum: camera.frustum
  }
}

export function restoreCamera(viewer: Viewer, snapshot: CameraSnapshot): void {
  const camera = viewer.camera
  try {
    camera.setView({
      destination: snapshot.position,
      orientation: { direction: snapshot.direction, up: snapshot.up }
    })
  } catch {
    // 忽略恢复失败，尽量还原视锥
  }
  camera.frustum = snapshot.frustum as never
  viewer.scene.requestRender()
}

export function nextFrame(scene: Scene): Promise<void> {
  return new Promise((resolve) => {
    const remove = scene.postRender.addEventListener(() => {
      remove()
      resolve()
    })
    scene.requestRender()
  })
}

/** 等待地球瓦片连续 3 次（每次间隔 120ms）处于加载完成状态 */
export async function waitForTilesLoaded(viewer: Viewer, timeoutMs = 30000): Promise<boolean> {
  const globe = viewer.scene.globe
  await nextFrame(viewer.scene)
  const start = performance.now()
  let consecutive = 0
  while (performance.now() - start < timeoutMs) {
    await delay(120)
    if (globe.tilesLoaded) {
      consecutive += 1
      if (consecutive >= 3) return true
    } else {
      consecutive = 0
    }
  }
  return globe.tilesLoaded
}

export type RefineOptions = {
  timeoutMs?: number
  heightScale?: number
  onProgress?: (message: string) => void
}

export type RefineHandle = {
  restore: () => void
}

/**
 * 依赖相机 LOD 的方案（getHeight / 派生着色器 / pick 深度）公共前提：
 * 先把相机瞬移到矩形正上方并等待精细瓦片加载完成，锁定输入，返回 restore 恢复。
 */
export async function refineOverhead(
  viewer: Viewer,
  rectangle: RectLike,
  options: RefineOptions = {}
): Promise<RefineHandle> {
  const scene = viewer.scene
  const controller = scene.screenSpaceCameraController
  const snapshot = snapshotCamera(viewer)
  const previousInputs = controller.enableInputs
  viewer.camera.cancelFlight()
  controller.enableInputs = false

  const centerLon = (rectangle.west + rectangle.east) / 2
  const centerLat = (rectangle.south + rectangle.north) / 2
  const width = Cartesian3.distance(
    Cartesian3.fromRadians(rectangle.west, centerLat),
    Cartesian3.fromRadians(rectangle.east, centerLat)
  )
  const height = Cartesian3.distance(
    Cartesian3.fromRadians(centerLon, rectangle.south),
    Cartesian3.fromRadians(centerLon, rectangle.north)
  )
  const span = Math.sqrt(width * width + height * height)
  const cameraHeight = span * (options.heightScale ?? 2.0)

  options.onProgress?.('正在瞬移相机并等待精细地形瓦片加载…')
  viewer.camera.setView({
    destination: Cartesian3.fromRadians(centerLon, centerLat, cameraHeight),
    orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 }
  })
  await waitForTilesLoaded(viewer, options.timeoutMs ?? 30000)

  let restored = false
  const restore = (): void => {
    if (restored) return
    restored = true
    controller.enableInputs = previousInputs
    restoreCamera(viewer, snapshot)
  }
  return { restore }
}

/** 矩形东西/南北跨度（米）与中心经纬度 */
export function rectangleDimensions(rectangle: RectLike): {
  width: number
  height: number
  centerLon: number
  centerLat: number
} {
  const centerLon = (rectangle.west + rectangle.east) / 2
  const centerLat = (rectangle.south + rectangle.north) / 2
  const width = Cartesian3.distance(
    Cartesian3.fromRadians(rectangle.west, centerLat),
    Cartesian3.fromRadians(rectangle.east, centerLat)
  )
  const height = Cartesian3.distance(
    Cartesian3.fromRadians(centerLon, rectangle.south),
    Cartesian3.fromRadians(centerLon, rectangle.north)
  )
  return { width, height, centerLon, centerLat }
}

/**
 * 构造矩形正上方、朝下、right 朝东、up 朝北的正交相机。
 * width 为东西向全宽（米），aspectRatio = width / height，使非方形矩形也能精确铺满 N×N 视口。
 */
export function placeOrthoTopDown(
  viewer: Viewer,
  rectangle: RectLike,
  options: { width: number; aspectRatio: number; near: number; far: number; cameraHeight: number }
): void {
  const { centerLon, centerLat } = rectangleDimensions(rectangle)
  viewer.camera.setView({
    destination: Cartesian3.fromRadians(centerLon, centerLat, options.cameraHeight),
    orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 }
  })
  viewer.camera.frustum = new OrthographicFrustum({
    width: options.width,
    aspectRatio: options.aspectRatio,
    near: options.near,
    far: options.far
  })
}
