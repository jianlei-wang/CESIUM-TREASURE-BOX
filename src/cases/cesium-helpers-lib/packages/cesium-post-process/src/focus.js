import {Cartesian3, Cartesian4, Matrix4} from '@cesium/core';

/**
 * What an effect focuses on: a position, a function called every frame for a moving target, or
 * undefined for what is in the middle of the screen.
 * @typedef {Cartesian3 | (() => Cartesian3 | undefined) | undefined} Focus
 */

const eyeScratch = new Cartesian3();

/**
 * The focus in eye coordinates, computed in double precision; w is 0 for the middle of the
 * screen, which the shaders read from the depth texture.
 * @param {import('@cesium/engine').Scene} scene
 * @param {Focus} focus
 * @param {Cartesian4} result
 */
export function eyeFocus(scene, focus, result) {
  const position = typeof focus === 'function' ? focus() : focus;
  if (!position) {
    return Cartesian4.fromElements(0, 0, 0, 0, result);
  }
  const eye = Matrix4.multiplyByPoint(scene.camera.viewMatrix, position, eyeScratch);
  return Cartesian4.fromElements(eye.x, eye.y, eye.z, 1, result);
}
