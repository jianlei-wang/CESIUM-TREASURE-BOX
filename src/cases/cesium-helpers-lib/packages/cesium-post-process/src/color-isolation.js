import {PostProcessStage} from '@cesium/engine';
import Effect from './effect.js';
import ColorIsolationShader from './shaders/ColorIsolation.js';

/**
 * Color isolation: one hue keeps its color, the rest of the scene turns gray.
 */
export default class ColorIsolation extends Effect {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {{hue?: number, range?: number, strength?: number}} [options]
   */
  constructor(viewer, options = {}) {
    super(viewer);
    this.hue_ = options.hue ?? 0;
    this.range_ = options.range ?? 60;
    this.strength_ = options.strength ?? 1;
  }

  /** @override */
  createStage_() {
    return new PostProcessStage({
      fragmentShader: ColorIsolationShader,
      uniforms: {
        hue: () => this.hue_ / 360,
        range: () => this.range_ / 360,
        strength: () => this.strength_,
      },
    });
  }

  /**
   * Hue kept in color, in degrees: 0 red, 60 yellow, 120 green, 180 cyan,
   * 240 blue, 300 magenta.
   */
  get hue() {
    return this.hue_;
  }

  set hue(value) {
    this.hue_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * Half width of the hues kept, in degrees.
   */
  get range() {
    return this.range_;
  }

  set range(value) {
    this.range_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * How gray the rest turns, 0 to 1.
   */
  get strength() {
    return this.strength_;
  }

  set strength(value) {
    this.strength_ = value;
    this.viewer.scene.requestRender();
  }
}
