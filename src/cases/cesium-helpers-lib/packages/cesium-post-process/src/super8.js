import {PostProcessStage, PostProcessStageComposite} from '@cesium/engine';
import createBlur from './blur.js';
import Effect from './effect.js';
import {acquireFrames, releaseFrames} from './frame-clock.js';
import Frame from './shaders/Frame.js';
import Noise from './shaders/Noise.js';
import Super8Shader from './shaders/Super8.js';

// spread of the halation glow, the sigma and step of Cesium's blur stage, at half resolution:
// a glow this wide does not need more
const HALATION_SIGMA = 6;
const HALATION_STEP = 1;
const HALATION_SCALE = 0.5;
// Super 8 runs at 18 frames per second, as in Super8.glsl
const FRAME_RATE = 18;

/**
 * A Super 8 home movie: faded warm colors, halation, grain, gate weave,
 * flicker, light leaks and the rounded corners of the camera gate. The film moves, so while
 * active the scene renders at its 18 frames per second, also in requestRenderMode.
 */
export default class Super8 extends Effect {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {{fade?: number, halation?: number, grain?: number, weave?: number, flicker?: number, lightLeaks?: number, aspectRatio?: number}} [options]
   */
  constructor(viewer, options = {}) {
    super(viewer);
    this.fade_ = options.fade ?? 0.5;
    this.halation_ = options.halation ?? 0.5;
    this.grain_ = options.grain ?? 0.15;
    this.weave_ = options.weave ?? 1.5;
    this.flicker_ = options.flicker ?? 0.08;
    this.lightLeaks_ = options.lightLeaks ?? 0.5;
    this.aspectRatio_ = options.aspectRatio ?? 4 / 3;
  }

  /** @override */
  createStage_() {
    // a single level of composite: Cesium's texture cache hands the stage after a nested series
    // of stages the output of that series instead of the scene
    const blur = createBlur('czm_super8_halation', HALATION_SCALE);
    const stage = new PostProcessStageComposite({
      stages: [
        blur,
        new PostProcessStage({
          fragmentShader: Frame + Noise + Super8Shader,
          uniforms: {
            blurTexture: blur.name,
            time: () => performance.now() / 1000,
            fade: () => this.fade_,
            halation: () => this.halation_,
            grain: () => this.grain_,
            weave: () => this.weave_,
            flicker: () => this.flicker_,
            lightLeaks: () => this.lightLeaks_,
            aspectRatio: () => this.aspectRatio_,
          },
        }),
      ],
      // both read the scene
      inputPreviousStageTexture: false,
      uniforms: blur.uniforms,
    });
    stage.uniforms.sigma = HALATION_SIGMA;
    stage.uniforms.stepSize = HALATION_STEP;
    return stage;
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  activated_(scene) {
    // a new picture only with each film frame, not with each frame of the display
    acquireFrames(scene, FRAME_RATE);
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  deactivating_(scene) {
    releaseFrames(scene, FRAME_RATE);
  }

  /**
   * Faded colors: less saturation, lifted blacks, a warm cast; 0 to 1.
   */
  get fade() {
    return this.fade_;
  }

  set fade(value) {
    this.fade_ = value;
  }

  /**
   * Warm glow bleeding around the highlights, 0 to 1.
   */
  get halation() {
    return this.halation_;
  }

  set halation(value) {
    this.halation_ = value;
  }

  /**
   * Film grain, 0 to 1.
   */
  get grain() {
    return this.grain_;
  }

  set grain(value) {
    this.grain_ = value;
  }

  /**
   * Drift of the picture in the gate, in CSS pixels.
   */
  get weave() {
    return this.weave_;
  }

  set weave(value) {
    this.weave_ = value;
  }

  /**
   * Change of brightness from frame to frame, 0 to 1.
   */
  get flicker() {
    return this.flicker_;
  }

  set flicker(value) {
    this.flicker_ = value;
  }

  /**
   * Warm light leaks along the edge, 0 to 1.
   */
  get lightLeaks() {
    return this.lightLeaks_;
  }

  set lightLeaks(value) {
    this.lightLeaks_ = value;
  }

  /**
   * Width over height of the visible frame, with rounded corners; 0 for the
   * whole canvas.
   */
  get aspectRatio() {
    return this.aspectRatio_;
  }

  set aspectRatio(value) {
    this.aspectRatio_ = value;
  }
}
