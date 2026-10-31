import {Cartesian3, Math as CesiumMath, Matrix4} from '@cesium/core';
import {PostProcessStage} from '@cesium/engine';
import {acquireTerrainDepth, releaseTerrainDepth} from './depth-test.js';
import Effect from './effect.js';
import {heightUniforms} from './height.js';
import {LocalFrame} from './local-frame.js';
import EyeFromDepth from './shaders/EyeFromDepth.js';
import Height from './shaders/Height.js';
import Normal from './shaders/Normal.js';
import OpenSkyShader from './shaders/OpenSky.js';
import {openSkyUniforms} from './open-sky.js';
import SnowLineShader from './shaders/SnowLine.js';

// the water's level when there is no water: far above everything
const NO_WATER = 1e9;

const sunScratch = new Cartesian3();

/**
 * Snow above an altitude, on the slopes gentle enough to hold it, shaded by
 * the sun.
 */
export default class SnowLine extends Effect {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {{altitude?: number, transition?: number, maxSlope?: number, coverage?: number, patchiness?: number, waterLevel?: number,
   *   sunDirection?: Cartesian3, grain?: number, sceneLight?: number, steepCover?: number, origin?: Cartesian3,
   *   openSky?: import('./open-sky.js').default}} [options]
   */
  constructor(viewer, options = {}) {
    super(viewer);
    this.altitude_ = options.altitude ?? 2000;
    this.transition_ = options.transition ?? 200;
    this.maxSlope_ = options.maxSlope ?? 50;
    this.coverage_ = options.coverage ?? 1;
    this.patchiness_ = options.patchiness ?? 0;
    this.waterLevel_ = options.waterLevel;
    this.sunDirection_ = options.sunDirection && Cartesian3.normalize(options.sunDirection, new Cartesian3());
    this.grain_ = options.grain ?? 90;
    this.sceneLight_ = options.sceneLight ?? 0;
    this.steepCover_ = options.steepCover ?? 0.35;
    this.frame_ = new LocalFrame(options.origin);
    this.openSky_ = options.openSky;
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  createStage_(scene) {
    const stage = new PostProcessStage({
      fragmentShader: EyeFromDepth + Height + Normal + OpenSkyShader + SnowLineShader,
      uniforms: {
        ...heightUniforms(scene),
        ...openSkyUniforms(scene, () => this.openSky_),
        altitude: () => this.altitude_,
        transition: () => this.transition_,
        maxSlope: () => CesiumMath.toRadians(this.maxSlope_),
        coverage: () => this.coverage_,
        patchiness: () => this.patchiness_,
        waterLevel: () => this.waterLevel_ ?? NO_WATER,
        sunEC: () => this.sunDirection_ ? Matrix4.multiplyByPointAsVector(scene.camera.viewMatrix, this.sunDirection_, sunScratch) : sunScratch,
        ownSun: () => this.sunDirection_ ? 1 : 0,
        grain: () => this.grain_,
        sceneLight: () => this.sceneLight_,
        steepCover: () => this.steepCover_,
        localFromEye: () => this.frame_.fromEye(scene),
      },
    });
    // with no coverage the pass would only copy: off
    stage.enabled = this.coverage_ > 0;
    return stage;
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  activated_(scene) {
    this.frame_.anchor(scene);
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
   * Altitude of the snow line, in meters above the ellipsoid.
   */
  get altitude() {
    return this.altitude_;
  }

  set altitude(value) {
    this.altitude_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * Height of the band around the altitude over which the snow thins out, in meters.
   */
  get transition() {
    return this.transition_;
  }

  set transition(value) {
    this.transition_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * Steepest slope that holds snow, in degrees.
   */
  get maxSlope() {
    return this.maxSlope_;
  }

  set maxSlope(value) {
    this.maxSlope_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * Opacity of the snow, 0 (none: the stage is off) to 1.
   */
  get coverage() {
    return this.coverage_;
  }

  set coverage(value) {
    this.coverage_ = value;
    if (this.stage_) {
      this.stage_.enabled = value > 0;
    }
    this.viewer.scene.requestRender();
  }

  /**
   * How far the coverage thins the snow into patches, 0 to 1: at 0 the coverage is the snow's opacity, at 1 the share of the ground it
   * covers, the noise leaving the rest bare.
   */
  get patchiness() {
    return this.patchiness_;
  }

  set patchiness(value) {
    this.patchiness_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * The water's height above the ellipsoid, in meters, or undefined for none: what lies within a quarter meter of it holds no snow,
   * so that a flat lake stays water.
   */
  get waterLevel() {
    return this.waterLevel_;
  }

  set waterLevel(value) {
    this.waterLevel_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * The direction toward the sun that the snow is shaded by, in world coordinates, or undefined for Cesium's own sun. For a scene lit by a
   * light of its own: `scene.light.direction` is the way the light travels, so give its negation.
   */
  get sunDirection() {
    return this.sunDirection_;
  }

  set sunDirection(value) {
    this.sunDirection_ = value && Cartesian3.normalize(value, new Cartesian3());
    this.viewer.scene.requestRender();
  }

  /**
   * The noise's largest scale, in meters, its finer ones a third and a ninth of it: the size of the patches and of the snow line's
   * irregularities. A few meters for a garden, tens for a mountainside.
   */
  get grain() {
    return this.grain_;
  }

  set grain(value) {
    this.grain_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * How far the snow's brightness is the scene's own, 0 to 1: at 0 the snow is shaded by the sun alone and stays bright at dusk; at 1 it
   * keeps the scene's shadows and darkens with its light, for a scene lit by a light of its own that goes down at night.
   */
  get sceneLight() {
    return this.sceneLight_;
  }

  set sceneLight(value) {
    this.sceneLight_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * What is open to the sky, or undefined for all of it: the rest holds no snow (a deck under a roof, the ground under a tree, a cloud's top).
   */
  get openSky() {
    return this.openSky_;
  }

  set openSky(value) {
    this.openSky_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * The thin cover the steep slopes keep at the limit, as a fraction of the coverage, 0 to 1: the rock showing through on a mountain; 0
   * for none on the walls of a building.
   */
  get steepCover() {
    return this.steepCover_;
  }

  set steepCover(value) {
    this.steepCover_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * The point of the world the noise is laid about, which keeps the snow's patches where they are as the camera moves; the camera's
   * position when the effect is activated if none is given. Keep it within a few kilometers of what is looked at for a grain of a few meters.
   */
  get origin() {
    return this.frame_.origin;
  }

  set origin(value) {
    this.frame_.origin = value;
    this.viewer.scene.requestRender();
  }
}
