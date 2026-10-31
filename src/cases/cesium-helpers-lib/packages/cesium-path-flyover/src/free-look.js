// packages/cesium-path-flyover/free-look.js
import {Math as CesiumMath} from "@cesium/core";
import {damp} from "./track.js";

const DEGREES_PER_PIXEL = 0.3;
const MIN_PITCH = CesiumMath.toRadians(-85);
const MAX_PITCH = CesiumMath.toRadians(-5);
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const WHEEL_STEP = 1.1;
const DAMP_TAU = 0.15;
const RETURN_SECONDS = 1.5;
const EPSILON = CesiumMath.EPSILON4;

/**
 * @typedef {Object} View
 * @property {number} headingDelta radians, added to the planned heading
 * @property {number} pitchDelta radians, added to the planned pitch
 * @property {number} zoom factor on the planned range, below 1 closer
 */

/**
 * The viewer's offsets on top of the planned camera: pixel drags and wheel
 * notches become damped heading, pitch and zoom deltas, and the view returns to
 * the plan by itself after a pause or on request. Pure: time is passed in.
 */
export default class FreeLook {
  /**
   * @param {{pitch: number, recenterDelay: number | false}} options planned pitch in
   *   radians (the delta is clamped so the final pitch stays between -85 and -5 degrees);
   *   seconds of idle before the view returns, false never
   */
  constructor(options) {
    this.pitch_ = options.pitch;
    this.recenterDelay_ = options.recenterDelay;
    /** @type {View} where the input wants the view */
    this.raw_ = {headingDelta: 0, pitchDelta: 0, zoom: 1};
    /** @type {View} where the view is, damped toward raw_ */
    this.view_ = {headingDelta: 0, pitchDelta: 0, zoom: 1};
    this.dragging_ = false;
    this.lastInput_ = -Infinity;
    /** @type {number | undefined} */
    this.lastUpdate_ = undefined;
    /** @type {{start: number, from: View} | undefined} */
    this.return_ = undefined;
  }

  /** @return {View} */
  get view() {
    return this.view_;
  }

  /** @return {boolean} whether the view differs from the plan or is about to */
  get active() {
    return (
      this.dragging_ ||
      this.return_ !== undefined ||
      Math.abs(this.view_.headingDelta) > EPSILON ||
      Math.abs(this.view_.pitchDelta) > EPSILON ||
      Math.abs(this.view_.zoom - 1) > EPSILON
    );
  }

  /** @param {number} now seconds */
  dragStart(now) {
    this.dragging_ = true;
    this.input_(now);
  }

  /**
   * @param {number} dx pixels, right positive
   * @param {number} dy pixels, down positive: dragging down looks more from above
   * @param {number} now seconds
   */
  drag(dx, dy, now) {
    if (!this.dragging_) {
      return;
    }
    this.input_(now);
    this.raw_.headingDelta += CesiumMath.toRadians(DEGREES_PER_PIXEL * dx);
    this.raw_.pitchDelta = CesiumMath.clamp(
      this.raw_.pitchDelta - CesiumMath.toRadians(DEGREES_PER_PIXEL * dy),
      MIN_PITCH - this.pitch_,
      MAX_PITCH - this.pitch_
    );
  }

  /** @param {number} now seconds */
  dragEnd(now) {
    this.dragging_ = false;
    this.input_(now);
  }

  /**
   * @param {number} factor on the range, below 1 closer
   * @param {number} now seconds
   */
  zoomBy(factor, now) {
    this.input_(now);
    this.raw_.zoom = CesiumMath.clamp(this.raw_.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  }

  /**
   * @param {number} delta wheel delta, positive scrolls up and zooms in
   * @param {number} now seconds
   */
  wheel(delta, now) {
    this.zoomBy(delta > 0 ? 1 / WHEEL_STEP : WHEEL_STEP, now);
  }

  /**
   * Starts the return to the plan.
   * @param {number} now seconds
   */
  recenter(now) {
    this.dragging_ = false;
    if (this.active) {
      // the short way back: a drag of several turns unwinds less than half a turn
      this.view_.headingDelta = CesiumMath.negativePiToPi(this.view_.headingDelta);
      this.raw_.headingDelta = CesiumMath.negativePiToPi(this.raw_.headingDelta);
      this.return_ = {start: now, from: {...this.view_}};
    }
  }

  /**
   * Advances the damping and the return.
   * @param {number} now seconds
   * @return {View}
   */
  update(now) {
    const dt = this.lastUpdate_ === undefined ? 0 : now - this.lastUpdate_;
    this.lastUpdate_ = now;
    if (!this.return_) {
      this.view_.headingDelta = damp(this.view_.headingDelta, this.raw_.headingDelta, dt, DAMP_TAU);
      this.view_.pitchDelta = damp(this.view_.pitchDelta, this.raw_.pitchDelta, dt, DAMP_TAU);
      this.view_.zoom = damp(this.view_.zoom, this.raw_.zoom, dt, DAMP_TAU);
      if (this.recenterDelay_ !== false && !this.dragging_ && this.active && now - this.lastInput_ >= this.recenterDelay_) {
        // from the deadline, not from the frame that noticed it: a slow frame rate
        // must not delay the return
        this.recenter(this.lastInput_ + this.recenterDelay_);
      }
    }
    if (this.return_) {
      const u = CesiumMath.clamp((now - this.return_.start) / RETURN_SECONDS, 0, 1);
      const remaining = 1 - u * u * (3 - 2 * u);
      const from = this.return_.from;
      this.view_.headingDelta = from.headingDelta * remaining;
      this.view_.pitchDelta = from.pitchDelta * remaining;
      this.view_.zoom = 1 + (from.zoom - 1) * remaining;
      if (u >= 1) {
        this.return_ = undefined;
        this.raw_ = {headingDelta: 0, pitchDelta: 0, zoom: 1};
      }
    }
    return this.view_;
  }

  /**
   * Every input restarts the idle clock; one during a return cancels it and holds
   * the view where it is.
   * @param {number} now seconds
   */
  input_(now) {
    this.lastInput_ = now;
    if (this.return_) {
      this.return_ = undefined;
      Object.assign(this.raw_, this.view_);
    }
  }
}
