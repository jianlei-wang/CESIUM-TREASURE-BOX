// Animated effects need the scene to render at their frame rate, also in requestRenderMode. With a
// timer each, their render requests would not line up and would add up: one timer per scene
// requests renders at the highest rate the active effects need.

/** @type {WeakMap<import('@cesium/engine').Scene, {rates: number[], interval: ReturnType<typeof setInterval> | undefined}>} */
const clocks = new WeakMap();

/**
 * @param {import('@cesium/engine').Scene} scene
 * @param {{rates: number[], interval: ReturnType<typeof setInterval> | undefined}} clock
 */
function restart(scene, clock) {
  clearInterval(clock.interval);
  clock.interval = clock.rates.length > 0 ? setInterval(() => tick(scene, clock), 1000 / Math.max(...clock.rates)) : undefined;
}

/**
 * A render request; once the scene is destroyed, with effects left active, the clock stops: a
 * destroyed scene throws on every call.
 * @param {import('@cesium/engine').Scene} scene
 * @param {{rates: number[], interval: ReturnType<typeof setInterval> | undefined}} clock
 */
function tick(scene, clock) {
  if (scene.isDestroyed()) {
    clearInterval(clock.interval);
    clocks.delete(scene);
    return;
  }
  scene.requestRender();
}

/**
 * @param {import('@cesium/engine').Scene} scene
 * @param {number} rate frames per second
 */
export function acquireFrames(scene, rate) {
  let clock = clocks.get(scene);
  if (!clock) {
    clock = {rates: [], interval: undefined};
    clocks.set(scene, clock);
  }
  clock.rates.push(rate);
  restart(scene, clock);
}

/**
 * @param {import('@cesium/engine').Scene} scene
 * @param {number} rate the rate given to acquireFrames
 */
export function releaseFrames(scene, rate) {
  const clock = clocks.get(scene);
  const index = clock ? clock.rates.indexOf(rate) : -1;
  if (!clock || index < 0) {
    return;
  }
  clock.rates.splice(index, 1);
  restart(scene, clock);
  if (clock.rates.length === 0) {
    clocks.delete(scene);
  }
}
