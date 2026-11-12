import { Cartographic, Cartesian3, type Cartesian2, type Scene } from 'cesium'

export function pickGlobePoint(scene: Scene, windowPosition: Cartesian2): Cartesian3 | undefined {
  if (!scene || scene.isDestroyed()) return undefined
  if (scene.pickPositionSupported) {
    try {
      const picked = scene.pickPosition(windowPosition)
      if (picked) return picked
    } catch {
      /* depth picking 不可用时回退地形拾取 */
    }
  }
  const ray = scene.camera.getPickRay(windowPosition)
  if (ray) {
    const globePoint = scene.globe.pick(ray, scene)
    if (globePoint) return globePoint
  }
  return scene.camera.pickEllipsoid(windowPosition, scene.globe.ellipsoid)
}

export function pickLonLat(scene: Scene, windowPosition: Cartesian2): { lon: number; lat: number } | undefined {
  const point = pickGlobePoint(scene, windowPosition)
  if (!point) return undefined
  const carto = Cartographic.fromCartesian(point, scene.globe.ellipsoid)
  return {
    lon: (carto.longitude * 180) / Math.PI,
    lat: (carto.latitude * 180) / Math.PI
  }
}
