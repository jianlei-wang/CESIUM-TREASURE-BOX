import {Math as CesiumMath} from '@cesium/core';
import Controls from '@geoblocks/cesium-input';
import HoldZoom from './zoom.js';

// short of 87.4 degrees, where Cesium reads the heading from the up vector and turns the view around
const MAX_PITCH = CesiumMath.toRadians(85);
// in seconds: a frame after a backgrounded tab must not turn far
const MAX_DELTA = 0.1;
// the field of view out of the zoom, which the wheel changes
const MIN_FOV = CesiumMath.toRadians(1);
const MAX_FOV = CesiumMath.toRadians(60);

// the default bindings: the right stick looks around, L2 or the right mouse button zooms in, held; the mouse's
// movement looks around too, under the pointer lock
/** @satisfies {Record<string, import('@geoblocks/cesium-input').Binding>} */
export const LOOK_BINDINGS = {
  look: {type: 'vector', stick: 'right'},
  zoom: {type: 'button', buttons: [6], mouse: [2]},
};

/** @typedef {{look: {x: number, y: number}, zoom: boolean}} LookIntent */

/**
 * @param {number} pitch
 * @return {number} The pitch, short of straight up or down, where the heading flips.
 */
export function clampPitch(pitch) {
  return CesiumMath.clamp(pitch, -MAX_PITCH, MAX_PITCH);
}

export default class FirstPersonCameraMode {

  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {number} [zoomFactor=CesiumMath.toRadians(5)]
   * @param {number} [movementFactor=0.003]
   */
  constructor(viewer, zoomFactor = CesiumMath.toRadians(5), movementFactor = 0.003) {
    this.viewer_ = viewer;
    this.scene_ = viewer.scene;

    this.movementFactor_ = movementFactor;
    this.zoomFactor_ = zoomFactor;
    this.originalFov_ = undefined;
    this.movementX_ = 0;
    this.movementY_ = 0;

    /**
     * Turn rate of the look at full deflection, the right stick by default, in radians per second.
     * @type {number}
     */
    this.lookRate = CesiumMath.toRadians(120);

    /**
     * Added to the field of view out of the zoom, in radians: wider while sprinting, as in GTA 5.
     * @type {number}
     */
    this.fovOffset = 0;

    /**
     * Where the look's intent comes from, read on each tick: {look: {x, y}, zoom}, look the turn rate from -1
     * to 1, x right and y up, and zoom whether the zoom is held. The first gamepad and the right mouse button
     * by default, with LOOK_BINDINGS; any object with a read() method otherwise, touch controls for
     * instance. The mouse's movement turns the view as well. The mode turns its active on and off with its
     * own: replace it while the mode is not active.
     * @type {{read(): LookIntent, active?: boolean}}
     */
    this.input = new Controls(LOOK_BINDINGS);

    this.zoom_ = new HoldZoom();
    // the field of view out of the zoom, which the wheel changes
    this.baseFov_ = 0;
    this.lastTick_ = 0;
    // whether the mode entered: Chrome repeats pointerlockchange when the locked element asks again
    this.entered_ = false;

    this.onMouseMoveCallback_ = this.onMouseMove_.bind(this);
    // the wheel on the canvas itself, as Cesium's handler reads it (its delta the opposite of deltaY), the page kept from
    // scrolling; not on the widget's handler, whose wheel action is the app's
    this.onWheelCallback_ = (/** @type {WheelEvent} */ event) => {
      event.preventDefault();
      this.onMouseWheel_(-event.deltaY);
    };
    // the camera controller's inputs before the mode, given back as they were
    /** @type {boolean | undefined} */
    this.inputsBefore_ = undefined;
    this.onTickCallback_ = this.onTick_.bind(this);
    // Cesium's handler captures the pointer on pointerdown, which throws while the pointer is locked:
    // keep the canvas's pointer events from it, the mouse events still come
    this.onCanvasPointerCallback_ = (/** @type {PointerEvent} */ event) => {
      if (event.target === this.scene_.canvas) {
        event.stopPropagation();
      }
    };
    this.onPointerLockChangeCallback_ = this.onPointerLockChange_.bind(this);
    this.onPointerLockErrorCallback_ = (/** @type {Event} */ event) => console.error(event);

    document.addEventListener('pointerlockchange', this.onPointerLockChangeCallback_);
    document.addEventListener('pointerlockerror', this.onPointerLockErrorCallback_);
  }

  onPointerLockChange_() {
    if (this.active === this.entered_) {
      return;
    }
    if (this.active) {
      this.enter_();
    } else {
      this.leave_();
    }
  }

  enter_() {
    this.entered_ = true;
    const controller = this.scene_.screenSpaceCameraController;
    this.inputsBefore_ = controller.enableInputs;
    controller.enableInputs = false;
    const frustum = this.frustum_();
    this.originalFov_ = frustum.fov;
    this.baseFov_ = /** @type {number} */ (frustum.fov);
    this.zoom_.zoom = 0;
    this.lastTick_ = performance.now();
    this.input.active = true;
    document.addEventListener('mousemove', this.onMouseMoveCallback_);
    window.addEventListener('pointerdown', this.onCanvasPointerCallback_, true);
    window.addEventListener('pointerup', this.onCanvasPointerCallback_, true);
    this.viewer_.clock.onTick.addEventListener(this.onTickCallback_);
    this.scene_.canvas.addEventListener('wheel', this.onWheelCallback_, {passive: false});
  }

  leave_() {
    this.entered_ = false;
    this.scene_.screenSpaceCameraController.enableInputs = this.inputsBefore_ ?? true;
    this.frustum_().fov = this.originalFov_;
    this.zoom_.zoom = 0;
    this.input.active = false;
    document.removeEventListener('mousemove', this.onMouseMoveCallback_);
    window.removeEventListener('pointerdown', this.onCanvasPointerCallback_, true);
    window.removeEventListener('pointerup', this.onCanvasPointerCallback_, true);
    this.viewer_.clock.onTick.removeEventListener(this.onTickCallback_);
    this.scene_.canvas.removeEventListener('wheel', this.onWheelCallback_);
  }

  get active() {
    return document.pointerLockElement !== null;
  }

  set active(active) {
    if (active) {
      if (!this.active) {
        // the mouse's raw counts, without the system's acceleration, where the browser has them
        const canvas = this.scene_.canvas;
        // a plain lock only where the option is not supported: without a user activation it would fail too
        canvas.requestPointerLock({unadjustedMovement: true})?.catch(error => {
          if (error.name === 'NotSupportedError') {
            canvas.requestPointerLock()?.catch(() => {});
          }
        });
      }
    } else if (this.active) {
      document.exitPointerLock();
    }
  }

  /**
   * How far the zoom is, 0 out to 1 in.
   * @return {number}
   */
  get zoom() {
    return this.zoom_.zoom;
  }

  /**
   * Field of view zoomed in, in radians.
   * @return {number}
   */
  get zoomFov() {
    return this.zoom_.zoomFov;
  }

  set zoomFov(fov) {
    this.zoom_.zoomFov = fov;
  }

  /**
   * @return {import('@cesium/core').PerspectiveFrustum}
   */
  frustum_() {
    return /** @type {import('@cesium/core').PerspectiveFrustum} */ (this.scene_.camera.frustum);
  }

  /**
   * @return {number} The field of view out of the zoom: the wheel's with the offset, which never closes it.
   */
  unzoomedFov_() {
    return Math.max(this.baseFov_ + this.fovOffset, MIN_FOV);
  }

  /**
   * @return {number} How much slower the look turns, by the zoom.
   */
  lookScale_() {
    return this.zoom_.lookScale(this.unzoomedFov_());
  }

  /**
   * @param {number} movement The wheel's delta, Cesium's sign: positive rolled away from the user, the view zoomed in.
   */
  onMouseWheel_(movement) {
    if (this.zoom_.zoom > 0) {
      // the zoom owns the field of view
      return;
    }
    const fov = this.baseFov_ + (movement > 0 ? -this.zoomFactor_ : this.zoomFactor_);
    this.baseFov_ = CesiumMath.clamp(fov, MIN_FOV, MAX_FOV);
  }

  /**
   * @param {MouseEvent} event
   */
  onMouseMove_(event) {
    // Firefox bug: first pointerlock event fires movementX=-2, movementY=0 spuriously
    if (event.movementX !== 0 || event.movementY !== 0) {
      this.movementX_ += event.movementX;
      this.movementY_ += event.movementY;
      this.scene_.requestRender();
    }
  }

  onTick_() {
    const timestamp = performance.now();
    const dt = Math.min((timestamp - this.lastTick_) / 1000, MAX_DELTA);
    this.lastTick_ = timestamp;

    const {look, zoom} = this.input.read();
    this.zoom_.update(zoom, dt);
    const fov = this.zoom_.fov(this.unzoomedFov_());
    const frustum = this.frustum_();
    if (fov !== frustum.fov) {
      frustum.fov = fov;
      this.scene_.requestRender();
    }

    // the mouse since the last tick, and the look's turn rate, slowed down by the zoom; on the tick, before
    // the frame renders, not a frame late after it
    const scale = this.lookScale_();
    const heading = (this.movementX_ * this.movementFactor_ + look.x * this.lookRate * dt) * scale;
    const pitch = (-this.movementY_ * this.movementFactor_ + look.y * this.lookRate * dt) * scale;
    this.movementX_ = 0;
    this.movementY_ = 0;
    if (heading !== 0 || pitch !== 0) {
      const camera = this.scene_.camera;
      camera.setView({
        orientation: {
          heading: camera.heading + heading,
          pitch: clampPitch(camera.pitch + pitch)
        }
      });
      this.scene_.requestRender();
    }
  }

  destroy() {
    // the pointer is released later, after the pointerlockchange listener is gone: leave now
    if (this.entered_) {
      this.leave_();
    }
    if (this.active) {
      document.exitPointerLock();
    }
    document.removeEventListener('pointerlockchange', this.onPointerLockChangeCallback_);
    document.removeEventListener('pointerlockerror', this.onPointerLockErrorCallback_);
  }
}
