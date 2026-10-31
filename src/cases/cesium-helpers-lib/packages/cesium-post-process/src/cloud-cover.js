// Seen from above, Clouds draws the clouds over the rain under them, which Precipitation then
// leaves to them: the scenes where clouds are drawn, by the active Clouds, with their shadow maps,
// through which Precipitation lights its haze.

/**
 * A shadow map of the clouds: its texture, undefined until it is drawn, the ground point it is
 * centered on, its side, and the base and the top of the slab it covers.
 * @typedef {{texture: () => any, center: import('@cesium/core').Cartesian3, extent: () => number, base: () => number, top: () => number}} CloudShadow
 */

/** @type {WeakMap<import('@cesium/engine').Scene, CloudShadow[]>} */
const covers = new WeakMap();

/**
 * @param {import('@cesium/engine').Scene} scene
 * @param {CloudShadow} shadow
 */
export function acquireCloudCover(scene, shadow) {
  covers.set(scene, [...(covers.get(scene) ?? []), shadow]);
}

/**
 * @param {import('@cesium/engine').Scene} scene
 * @param {CloudShadow} shadow
 */
export function releaseCloudCover(scene, shadow) {
  const shadows = (covers.get(scene) ?? []).filter((other) => other !== shadow);
  if (shadows.length > 0) {
    covers.set(scene, shadows);
  } else {
    covers.delete(scene);
  }
}

/**
 * Whether clouds are drawn in the scene.
 * @param {import('@cesium/engine').Scene} scene
 */
export function hasCloudCover(scene) {
  return covers.has(scene);
}

/**
 * The shadow map of the clouds drawn in the scene, the last activated's, or undefined without.
 * @param {import('@cesium/engine').Scene} scene
 */
export function cloudShadow(scene) {
  return covers.get(scene)?.at(-1);
}
