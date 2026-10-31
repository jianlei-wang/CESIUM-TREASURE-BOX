import {Cartesian4} from '@cesium/core';
import {PostProcessStage, PostProcessStageComposite} from '@cesium/engine';
import createBlur from './blur.js';
import {acquireTerrainDepth, releaseTerrainDepth} from './depth-test.js';
import Effect from './effect.js';
import {eyeFocus} from './focus.js';
import EyeFromDepth from './shaders/EyeFromDepth.js';
import TiltShiftShader from './shaders/TiltShift.js';

const focusScratch = new Cartesian4();

/**
 * Tilt-shift: a narrow depth of field around the focus, which makes the scene
 * look like a scale model.
 */
export default class TiltShift extends Effect {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {{focus?: import('./focus.js').Focus, range?: number, blur?: number, saturation?: number}} [options]
   */
  constructor(viewer, options = {}) {
    super(viewer);
    this.focus_ = options.focus;
    this.range_ = options.range ?? 0.3;
    this.blur_ = options.blur ?? 4;
    this.saturation_ = options.saturation ?? 0.3;
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  createStage_(scene) {
    const blur = createBlur('czm_tilt_shift_blur');
    const stage = new PostProcessStageComposite({
      stages: [
        blur,
        new PostProcessStage({
          fragmentShader: EyeFromDepth + TiltShiftShader,
          uniforms: {
            blurTexture: blur.name,
            focus: () => eyeFocus(scene, this.focus_, focusScratch),
            range: () => this.range_,
            saturation: () => this.saturation_,
          },
        }),
      ],
      // both read the scene
      inputPreviousStageTexture: false,
      uniforms: blur.uniforms,
    });
    stage.uniforms.sigma = this.blur_;
    return stage;
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
   * What to focus on: a position, a function returning one, or undefined for
   * what is in the middle of the screen.
   */
  get focus() {
    return this.focus_;
  }

  set focus(value) {
    this.focus_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * Width of the sharp band, in factors of two of the focal distance; with an orthographic camera,
   * in shares of the view's height.
   */
  get range() {
    return this.range_;
  }

  set range(value) {
    this.range_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * Blur away from the focus, the sigma of Cesium's blur stage.
   */
  get blur() {
    return this.blur_;
  }

  set blur(value) {
    this.blur_ = value;
    if (this.stage_) {
      this.stage_.uniforms.sigma = value;
    }
    this.viewer.scene.requestRender();
  }

  /**
   * Color and contrast boost, 0 to 1.
   */
  get saturation() {
    return this.saturation_;
  }

  set saturation(value) {
    this.saturation_ = value;
    this.viewer.scene.requestRender();
  }
}
