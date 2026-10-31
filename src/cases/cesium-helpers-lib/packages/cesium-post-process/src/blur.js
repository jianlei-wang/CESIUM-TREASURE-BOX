import {PostProcessStage, PostProcessStageComposite, PostProcessStageSampleMode} from '@cesium/engine';
// @ts-expect-error the engine exports its shader sources, but does not type them
import {_shadersGaussianBlur1D as GaussianBlur1D} from '@cesium/engine';

/**
 * A Gaussian blur in two passes, as PostProcessStageLibrary.createBlurStage()
 * builds it, with its own name: the library names every blur czm_blur, and a
 * collection holds one stage per name, so two effects with a library blur
 * break each other when one is removed.
 * @param {string} name of the composite; the passes are named after it
 * @param {number} [textureScale=1] resolution of the passes relative to the viewport: a wide blur
 * costs a quarter at half resolution, with a step half as long for the same spread
 * @return {PostProcessStageComposite} with `sigma` and `stepSize` uniforms shared by both passes
 */
export default function createBlur(name, textureScale = 1) {
  const passes = ['x', 'y'].map(
    (axis, direction) =>
      new PostProcessStage({
        name: `${name}_${axis}`,
        fragmentShader: `#define USE_STEP_SIZE\n${GaussianBlur1D}`,
        uniforms: {delta: 1, sigma: 2, stepSize: 1, direction},
        sampleMode: PostProcessStageSampleMode.LINEAR,
        textureScale,
      })
  );
  const shared = (/** @type {string} */ uniform) => ({
    get: () => passes[0].uniforms[uniform],
    set: (/** @type {number} */ value) => {
      for (const pass of passes) {
        pass.uniforms[uniform] = value;
      }
    },
  });
  return new PostProcessStageComposite({
    name,
    stages: passes,
    uniforms: Object.defineProperties({}, {sigma: shared('sigma'), stepSize: shared('stepSize')}),
  });
}
