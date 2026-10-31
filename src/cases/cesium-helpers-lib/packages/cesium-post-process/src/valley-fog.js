import {Color} from '@cesium/core';
import {PostProcessStage} from '@cesium/engine';
import {acquireTerrainDepth, releaseTerrainDepth} from './depth-test.js';
import Effect from './effect.js';
import {heightUniforms} from './height.js';
import EyeFromDepth from './shaders/EyeFromDepth.js';
import Fog from './shaders/Fog.js';
import Height from './shaders/Height.js';
import ValleyFogShader from './shaders/ValleyFog.js';

/**
 * Fog filling the valleys below an altitude: from above, a sea of fog with the
 * peaks standing out; from inside, the visibility drops with the distance.
 */
export default class ValleyFog extends Effect {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {{top?: number, density?: number, softness?: number, color?: Color}} [options]
   */
  constructor(viewer, options = {}) {
    super(viewer);
    this.top_ = options.top ?? 1500;
    this.density_ = options.density ?? 0.005;
    this.softness_ = options.softness ?? 100;
    this.color_ = options.color ?? new Color(0.85, 0.88, 0.92, 1);
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  createStage_(scene) {
    return new PostProcessStage({
      fragmentShader: EyeFromDepth + Height + Fog + ValleyFogShader,
      uniforms: {
        ...heightUniforms(scene),
        top: () => this.top_,
        density: () => this.density_,
        softness: () => this.softness_,
        color: () => this.color_,
      },
    });
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  activated_(scene) {
    acquireTerrainDepth(scene);
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  deactivating_(scene) {
    releaseTerrainDepth(scene);
  }

  /**
   * Altitude of the top of the fog, in meters above the ellipsoid.
   */
  get top() {
    return this.top_;
  }

  set top(value) {
    this.top_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * Density of the fog, per meter: about 1 / visibility.
   */
  get density() {
    return this.density_;
  }

  set density(value) {
    this.density_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * Height of the band under the top over which the fog thins out, in meters.
   */
  get softness() {
    return this.softness_;
  }

  set softness(value) {
    this.softness_ = value;
    this.viewer.scene.requestRender();
  }

  get color() {
    return this.color_;
  }

  set color(value) {
    this.color_ = value;
    this.viewer.scene.requestRender();
  }
}
