import {
  Cartesian2,
  Cartesian3,
  Math as CesiumMath,
} from "@cesium/core";
import {
  CameraEventType,
  PostProcessStage,
  PostProcessStageComposite,
  PostProcessStageLibrary,
  ScreenSpaceEventType,
} from "@cesium/engine";
import EyeFromDepth from "./shaders/EyeFromDepth.js";
import Lens from "./shaders/Lens.js";

// blur of the depth of field and of the rim, the sigma of Cesium's blur stage
const LENS_BLUR = 3;

const middleScratch = new Cartesian2();

export default class CesiumBinoculars {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {number} [zoomFactor] magnification per mouse wheel notch
   * @param {number} [maxMagnification]
   */
  constructor(viewer, zoomFactor = 1.25, maxMagnification = 20) {
    this.viewer = viewer;
    this.zoomFactor_ = zoomFactor;
    this.maxMagnification = maxMagnification;
    this.originalFov_ = undefined;
    this.active_ = false;

    /**
     * @type {Pick<import('@cesium/engine').ScreenSpaceCameraController, 'enableZoom' | 'enableRotate' | 'enableTilt' | 'lookEventTypes'> | undefined}
     */
    this.previousController_ = undefined;
    /**
     * @type {ReturnType<import('@cesium/engine').ScreenSpaceEventHandler['getInputAction']> | undefined}
     */
    this.previousAction_ = undefined;
    /** @type {PostProcessStageComposite | undefined} */
    this.lens_ = undefined;
    this.previousDepthTestAgainstTerrain_ = false;
    this.reticle_ = false;
    this.onPreRender_ = this.onPreRender.bind(this);
    this.onMouseWheel_ = this.onMouseWheel.bind(this);
  }

  get active() {
    return this.active_;
  }

  set active(active) {
    if (active === this.active_) {
      return;
    }
    this.active_ = active;
    const controller = this.viewer.scene.screenSpaceCameraController;
    const handler = this.viewer.screenSpaceEventHandler;
    if (active) {
      this.originalFov_ = this.frustum_.fov;
      const {enableZoom, enableRotate, enableTilt, lookEventTypes} = controller;
      this.previousController_ = {enableZoom, enableRotate, enableTilt, lookEventTypes};
      // stand still: a drag turns the camera in place instead of moving it around the globe
      controller.enableZoom = false;
      controller.enableRotate = false;
      controller.enableTilt = false;
      controller.lookEventTypes = CameraEventType.LEFT_DRAG;
      this.previousAction_ = handler.getInputAction(ScreenSpaceEventType.WHEEL);
      handler.setInputAction(this.onMouseWheel_, ScreenSpaceEventType.WHEEL);
      this.addLens_();
      this.viewer.scene.preRender.addEventListener(this.onPreRender_);
    } else {
      this.viewer.scene.preRender.removeEventListener(this.onPreRender_);
      this.removeLens_();
      this.frustum_.fov = this.originalFov_;
      Object.assign(controller, this.previousController_);
      if (this.previousAction_) {
        handler.setInputAction(this.previousAction_, ScreenSpaceEventType.WHEEL);
      } else {
        handler.removeInputAction(ScreenSpaceEventType.WHEEL);
      }
    }
    // requestRenderMode: adding or removing the lens stage does not request a render
    this.viewer.scene.requestRender();
  }

  addLens_() {
    const scene = this.viewer.scene;
    // the post-process stages only get the depth of the terrain when it is depth tested
    if (scene.globe) {
      this.previousDepthTestAgainstTerrain_ = scene.globe.depthTestAgainstTerrain;
      scene.globe.depthTestAgainstTerrain = true;
    }
    const blur = PostProcessStageLibrary.createBlurStage();
    this.lens_ = new PostProcessStageComposite({
      stages: [
        blur,
        new PostProcessStage({
          fragmentShader: EyeFromDepth + Lens,
          uniforms: {
            blurTexture: blur.name,
            magnification: () => this.magnification,
            reticle: () => (this.reticle_ ? 1 : 0),
            pixelsPerMil: () => (scene.drawingBufferHeight / 2 / Math.tan(/** @type {number} */ (this.frustum_.fovy) / 2)) * 0.001,
          },
        }),
      ],
      // both read the scene
      inputPreviousStageTexture: false,
      uniforms: blur.uniforms,
    });
    this.lens_.uniforms.sigma = LENS_BLUR;
    scene.postProcessStages.add(this.lens_);
  }

  removeLens_() {
    const scene = this.viewer.scene;
    // removing a stage also destroys it
    scene.postProcessStages.remove(/** @type {PostProcessStageComposite} */ (this.lens_));
    this.lens_ = undefined;
    if (scene.globe) {
      scene.globe.depthTestAgainstTerrain = this.previousDepthTestAgainstTerrain_;
    }
  }

  /**
   * Whether to draw a rangefinder reticle: a mil scale (milliradians) that
   * grows with the magnification, so an object's size is its distance times
   * the mils it covers, divided by 1000.
   */
  get reticle() {
    return this.reticle_;
  }

  set reticle(value) {
    this.reticle_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * Distance in meters from the camera to what is in the middle of the view,
   * terrain or 3D Tiles; undefined for the sky, when inactive or when picking
   * positions is not supported. Picked when read.
   */
  get distance() {
    const scene = this.viewer.scene;
    if (!this.active_ || !scene.pickPositionSupported) {
      return undefined;
    }
    const canvas = scene.canvas;
    const middle = Cartesian2.fromElements(canvas.clientWidth / 2, canvas.clientHeight / 2, middleScratch);
    const position = scene.pickPosition(middle);
    return position && Cartesian3.distance(scene.camera.positionWC, position);
  }

  get frustum_() {
    return /** @type {import('@cesium/core').PerspectiveFrustum} */ (this.viewer.scene.camera.frustum);
  }

  /**
   * Magnification relative to the field of view when the binoculars were activated, 1 when inactive.
   * The magnification is proportional to 1 / tan(fov / 2).
   */
  get magnification() {
    if (!this.active_) {
      return 1;
    }
    return Math.tan(/** @type {number} */ (this.originalFov_) / 2) / Math.tan(/** @type {number} */ (this.frustum_.fov) / 2);
  }

  /**
   * Only applies while active; clamped between 1 and maxMagnification.
   */
  set magnification(magnification) {
    if (!this.active_) {
      return;
    }
    const clamped = CesiumMath.clamp(magnification, 1, this.maxMagnification);
    this.frustum_.fov = 2 * Math.atan(Math.tan(/** @type {number} */ (this.originalFov_) / 2) / clamped);
  }

  /**
   * In 3D, Cesium's look turns the camera around its own axes, which rolls the view: keep the horizon level.
   */
  onPreRender() {
    const camera = this.viewer.scene.camera;
    if (Math.abs(CesiumMath.negativePiToPi(camera.roll)) > CesiumMath.EPSILON6) {
      camera.setView({orientation: {heading: camera.heading, pitch: camera.pitch, roll: 0}});
    }
  }

  /**
   * @param {number} delta 120 per mouse wheel notch, positive to zoom in; trackpads send smaller values
   */
  onMouseWheel(delta) {
    this.magnification *= Math.pow(this.zoomFactor_, delta / 120);
  }
}
