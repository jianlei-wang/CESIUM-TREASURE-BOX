import {Cartesian3, Math as CesiumMath} from '@cesium/core';
import {PostProcessStage} from '@cesium/engine';
import Effect from './effect.js';
import DroneDisplayShader from './shaders/DroneDisplay.js';

// a 3S battery, full, empty, the seconds it takes to drain between them at the cruise throttle,
// and how far its voltage sags at full throttle
const FULL_VOLTS = 12.6;
const EMPTY_VOLTS = 10.5;
const DRAIN_SECONDS = 2400;
const SAG_VOLTS = 0.4;
// the throttle in percent at cruise, and more of it per m/s of climb
const CRUISE_THROTTLE = 70;
const CLIMB_THROTTLE = 5;
// seconds for the speeds to get two thirds of the way to the camera's; after a pause longer than
// the gap, as in requestRenderMode, the motion is not measured across it
const SMOOTHING = 0.5;
const GAP = 0.5;

/**
 * A fixed-wing plane's OSD as ArduPilot draws it on an HD video system, in the
 * blocky white glyphs of an analog chip with some in color: an artificial
 * horizon of dots following the camera's pitch and roll as ArduPilot's does,
 * the flight mode, the heading, the altitude since the display turned on, the
 * vertical speed and the air speed of the camera, the throttle following its
 * climb, the battery voltage draining with the throttle, and a made-up link
 * quality; and in failsafe while the control link is lost, the RTL mode and the
 * FAILSAFE warning.
 */
export default class DroneDisplay extends Effect {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {{opacity?: number}} [options]
   */
  constructor(viewer, options = {}) {
    super(viewer);
    this.opacity_ = options.opacity ?? 1;
    this.rxLoss_ = false;
    // when the display turned on, and the camera's height then
    this.startTime_ = 0;
    this.startHeight_ = 0;
    // the camera's speed and vertical speed in m/s, smoothed, from its position and height at the
    // previous frame
    this.speed_ = 0;
    this.verticalSpeed_ = 0;
    this.previousPosition_ = new Cartesian3();
    this.previousHeight_ = 0;
    this.previousTime_ = 0;
    // the share of the battery drained
    this.drained_ = 0;
    this.onPostRender_ = () => this.measure_(false);
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  createStage_(scene) {
    return new PostProcessStage({
      fragmentShader: DroneDisplayShader,
      uniforms: {
        opacity: () => this.opacity_,
        pitch: () => CesiumMath.toDegrees(scene.camera.pitch),
        roll: () => CesiumMath.toDegrees(CesiumMath.negativePiToPi(scene.camera.roll)),
        heading: () => CesiumMath.toDegrees(scene.camera.heading),
        altitude: () => scene.camera.positionCartographic.height - this.startHeight_,
        verticalSpeed: () => this.verticalSpeed_,
        speed: () => this.speed_ * 3.6,
        voltage: () => this.voltage_(),
        linkQuality: () => this.linkQuality_(),
        throttle: () => this.throttle_(),
        failsafe: () => (this.rxLoss_ ? 1 : 0),
        // twice per second, as ArduPilot's blinking
        blink: () => (Math.floor(performance.now() / 250) % 2 === 0 ? 1 : 0),
      },
    });
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  activated_(scene) {
    this.startTime_ = performance.now() / 1000;
    this.startHeight_ = scene.camera.positionCartographic.height;
    this.speed_ = 0;
    this.verticalSpeed_ = 0;
    this.drained_ = 0;
    this.measure_(true);
    scene.postRender.addEventListener(this.onPostRender_);
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  deactivating_(scene) {
    scene.postRender.removeEventListener(this.onPostRender_);
  }

  /**
   * Eases the speeds toward the camera's motion since the previous frame, and
   * drains the battery at the throttle.
   * @param {boolean} first whether there is no previous frame
   */
  measure_(first) {
    const camera = this.viewer.scene.camera;
    const time = performance.now() / 1000;
    const height = camera.positionCartographic.height;
    const dt = time - this.previousTime_;
    if (!first && dt > 0 && dt < GAP) {
      const ease = 1 - Math.exp(-dt / SMOOTHING);
      this.speed_ += (Cartesian3.distance(camera.positionWC, this.previousPosition_) / dt - this.speed_) * ease;
      this.verticalSpeed_ += ((height - this.previousHeight_) / dt - this.verticalSpeed_) * ease;
    }
    if (!first) {
      this.drained_ += (dt / DRAIN_SECONDS) * (this.throttle_() / CRUISE_THROTTLE);
    }
    Cartesian3.clone(camera.positionWC, this.previousPosition_);
    this.previousHeight_ = height;
    this.previousTime_ = time;
  }

  // the battery drains over the flight, and sags under the throttle's load
  voltage_() {
    const drained = (FULL_VOLTS - EMPTY_VOLTS) * Math.min(this.drained_, 1);
    return FULL_VOLTS - drained - (SAG_VOLTS * this.throttle_()) / 100;
  }

  // the link hovers in the nineties, with a deep dip once in a while
  linkQuality_() {
    const seconds = performance.now() / 1000 - this.startTime_;
    const wander = 4 * Math.abs(Math.sin(seconds * 0.9) * Math.sin(seconds * 0.37));
    const dip = Math.sin(seconds * 0.11) > 0.97 ? 35 : 0;
    return Math.round(99 - wander - dip);
  }

  // the throttle holds the cruise, more of it climbing and less diving, wandering a little
  throttle_() {
    const seconds = performance.now() / 1000 - this.startTime_;
    const wander = 2 * Math.sin(seconds * 0.3) * Math.sin(seconds * 0.13 + 1);
    return Math.round(CesiumMath.clamp(CRUISE_THROTTLE + CLIMB_THROTTLE * this.verticalSpeed_ + wander, 0, 100));
  }

  /**
   * Opacity of the display, 0 to 1.
   */
  get opacity() {
    return this.opacity_;
  }

  set opacity(value) {
    this.opacity_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * Whether the control link is lost: the mode turns to RTL, the link bar to
   * red, and the FAILSAFE warning blinks below the middle. It blinks only while
   * the scene renders.
   */
  get rxLoss() {
    return this.rxLoss_;
  }

  set rxLoss(value) {
    this.rxLoss_ = value;
    this.viewer.scene.requestRender();
  }
}
