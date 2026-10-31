import {Math as CesiumMath} from '@cesium/core';

// seconds to zoom in or out, as GTA 5's aim
const ZOOM_TIME = 0.2;

/**
 * A zoom held by a button: it eases the field of view to zoomFov, never wider than the view, and slows the
 * look down by as much, so that the view stays steady.
 */
export default class HoldZoom {
  constructor() {
    /**
     * Field of view zoomed in, in radians.
     * @type {number}
     */
    this.zoomFov = CesiumMath.toRadians(20);

    /**
     * How far the zoom is, 0 out to 1 in.
     * @type {number}
     */
    this.zoom = 0;
  }

  /**
   * @param {boolean} held Whether the zoom is held.
   * @param {number} dt Seconds.
   */
  update(held, dt) {
    this.zoom = CesiumMath.clamp(this.zoom + (held ? dt : -dt) / ZOOM_TIME, 0, 1);
  }

  /**
   * @param {number} base The field of view out of the zoom, in radians.
   * @return {number} The field of view, in radians.
   */
  fov(base) {
    return CesiumMath.lerp(base, Math.min(this.zoomFov, base), this.zoom);
  }

  /**
   * @param {number} base The field of view out of the zoom, in radians.
   * @return {number} How much slower the look turns, 1 out of the zoom.
   */
  lookScale(base) {
    return this.zoom > 0 ? this.fov(base) / base : 1;
  }
}
