import { Cartographic, Cartesian2, Cartesian3, type Scene } from 'cesium'

export function pickPosition(scene: Scene, windowPosition: Cartesian2): Cartesian3 | undefined {
  if (!scene || scene.isDestroyed()) return undefined

  if (scene.pickPositionSupported) {
    try {
      const picked = scene.pickPosition(windowPosition)
      if (picked) return picked
    } catch {
      // depth picking 失败时回退地形拾取
    }
  }

  const ray = scene.camera.getPickRay(windowPosition)
  if (ray) {
    const globePosition = scene.globe.pick(ray, scene)
    if (globePosition) return globePosition
  }

  return scene.camera.pickEllipsoid(windowPosition, scene.globe.ellipsoid)
}

export function pickCartographic(scene: Scene, windowPosition: Cartesian2): Cartographic | undefined {
  const position = pickPosition(scene, windowPosition)
  if (!position) return undefined
  return Cartographic.fromCartesian(position, scene.globe.ellipsoid)
}
