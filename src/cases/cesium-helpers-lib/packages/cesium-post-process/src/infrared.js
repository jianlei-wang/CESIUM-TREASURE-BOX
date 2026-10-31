import {PostProcessStage} from '@cesium/engine';
import Effect from './effect.js';
import InfraredShader from './shaders/Infrared.js';

/**
 * Black and white infrared film: bright foliage, dark sky and water.
 */
export default class Infrared extends Effect {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {{strength?: number}} [options]
   */
  constructor(viewer, options = {}) {
    super(viewer);
    this.strength_ = options.strength ?? 1;
  }

  /** @override */
  createStage_() {
    return new PostProcessStage({
      fragmentShader: InfraredShader,
      uniforms: {
        strength: () => this.strength_,
      },
    });
  }

  /**
   * How far from the original colors, 0 to 1.
   */
  get strength() {
    return this.strength_;
  }

  set strength(value) {
    this.strength_ = value;
    this.viewer.scene.requestRender();
  }
}
