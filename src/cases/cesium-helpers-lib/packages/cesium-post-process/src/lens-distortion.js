import {PostProcessStage} from '@cesium/engine';
import Effect from './effect.js';
import LensDistortionShader from './shaders/LensDistortion.js';

/**
 * The barrel distortion and dark corners of a wide-angle lens, like those of
 * FPV cameras.
 */
export default class LensDistortion extends Effect {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {{distortion?: number, vignette?: number}} [options]
   */
  constructor(viewer, options = {}) {
    super(viewer);
    this.distortion_ = options.distortion ?? 0.5;
    this.vignette_ = options.vignette ?? 0.5;
  }

  /** @override */
  createStage_() {
    const stage = new PostProcessStage({
      fragmentShader: LensDistortionShader,
      uniforms: {
        distortion: () => this.distortion_,
        vignette: () => this.vignette_,
      },
    });
    // no pass at all without distortion or vignette
    stage.enabled = this.enabled_();
    return stage;
  }

  enabled_() {
    return this.distortion_ > 0 || this.vignette_ > 0;
  }

  /**
   * Bending of straight lines toward the edges, 0 to 1.
   */
  get distortion() {
    return this.distortion_;
  }

  set distortion(value) {
    this.distortion_ = value;
    this.update_();
  }

  /**
   * Darkening of the corners, 0 to 1.
   */
  get vignette() {
    return this.vignette_;
  }

  set vignette(value) {
    this.vignette_ = value;
    this.update_();
  }

  update_() {
    if (this.stage_) {
      this.stage_.enabled = this.enabled_();
    }
    this.viewer.scene.requestRender();
  }
}
