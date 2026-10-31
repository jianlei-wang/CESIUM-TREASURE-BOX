import {Matrix4, PixelDatatype, Math as CesiumMath} from '@cesium/core';
import {PostProcessStage, PostProcessStageComposite} from '@cesium/engine';
import {acquireTerrainDepth, releaseTerrainDepth} from './depth-test.js';
import Effect from './effect.js';
import EyeFromDepth from './shaders/EyeFromDepth.js';
import Hash from './shaders/Hash.js';
import MotionBlurShader from './shaders/MotionBlur.js';
import MotionBlurVelocity from './shaders/MotionBlurVelocity.js';

/**
 * Camera motion blur: each pixel is blurred along its motion on the screen
 * since the previous frame, over the exposure time.
 */
export default class MotionBlur extends Effect {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {{strength?: number, exposure?: number}} [options]
   */
  constructor(viewer, options = {}) {
    super(viewer);
    this.strength_ = options.strength ?? 1;
    this.exposure_ = options.exposure ?? 1 / 24;
    this.previousViewProjection_ = new Matrix4();
    this.reprojection_ = new Matrix4();
    this.previousTime_ = 0;
    this.onPostRender_ = () => {
      const camera = this.viewer.scene.camera;
      Matrix4.multiply(camera.frustum.projectionMatrix, camera.viewMatrix, this.previousViewProjection_);
      this.previousTime_ = performance.now();
    };
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  createStage_(scene) {
    // the velocity of each pixel is computed once, at half resolution, rather than once per
    // sample of the gather; the distances need the range of floats
    const velocity = new PostProcessStage({
      name: 'czm_motion_blur_velocity',
      fragmentShader: EyeFromDepth + MotionBlurVelocity,
      uniforms: {
        reprojection: () =>
          Matrix4.multiply(this.previousViewProjection_, scene.camera.inverseViewMatrix, this.reprojection_),
        // the blur spans the motion during the exposure, whatever the frame rate; after a pause
        // in requestRenderMode, the time since the previous frame is not the time of the motion
        exposureScale: () =>
          (this.strength_ * this.exposure_) /
          CesiumMath.clamp((performance.now() - this.previousTime_) / 1000, 1 / 240, 1 / 10),
      },
      textureScale: 0.5,
      pixelDatatype: PixelDatatype.FLOAT,
    });
    const stage = new PostProcessStageComposite({
      stages: [
        velocity,
        new PostProcessStage({
          fragmentShader: Hash + MotionBlurShader,
          uniforms: {velocityTexture: velocity.name},
        }),
      ],
      // the gather reads the scene, not the velocities
      inputPreviousStageTexture: false,
    });
    // no pass at all without strength
    stage.enabled = this.strength_ > 0;
    return stage;
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  activated_(scene) {
    acquireTerrainDepth(scene);
    this.onPostRender_();
    scene.postRender.addEventListener(this.onPostRender_);
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  deactivating_(scene) {
    scene.postRender.removeEventListener(this.onPostRender_);
    releaseTerrainDepth(scene);
  }

  /**
   * Strength of the blur, 0 to 1: a fraction of the exposure.
   */
  get strength() {
    return this.strength_;
  }

  set strength(value) {
    this.strength_ = value;
    if (this.stage_) {
      this.stage_.enabled = value > 0;
    }
    this.viewer.scene.requestRender();
  }

  /**
   * Exposure time, in seconds: 1/48 is the 180 degree shutter of film at 24
   * frames per second, longer blurs more.
   */
  get exposure() {
    return this.exposure_;
  }

  set exposure(value) {
    this.exposure_ = value;
    this.viewer.scene.requestRender();
  }
}
