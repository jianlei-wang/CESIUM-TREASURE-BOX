// The post-process stages only get the depth of the terrain when it is depth tested. Several
// effects may need it at once: the first one turns depth testing on, the last one restores it.

/** @type {WeakMap<import('@cesium/engine').Globe, {count: number, previous: boolean}>} */
const users = new WeakMap();

/**
 * @param {import('@cesium/engine').Scene} scene
 */
export function acquireTerrainDepth(scene) {
  const globe = scene.globe;
  if (!globe) {
    return;
  }
  const user = users.get(globe);
  if (user) {
    user.count++;
    return;
  }
  users.set(globe, {count: 1, previous: globe.depthTestAgainstTerrain});
  globe.depthTestAgainstTerrain = true;
}

/**
 * @param {import('@cesium/engine').Scene} scene
 */
export function releaseTerrainDepth(scene) {
  const globe = scene.globe;
  const user = globe && users.get(globe);
  if (!globe || !user) {
    return;
  }
  if (--user.count === 0) {
    globe.depthTestAgainstTerrain = user.previous;
    users.delete(globe);
  }
}
