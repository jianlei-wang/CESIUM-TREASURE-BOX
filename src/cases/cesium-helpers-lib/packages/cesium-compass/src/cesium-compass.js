// Original code from TerriaJS
// https://github.com/TerriaJS/terriajs/blob/master/lib/ReactViews/Map/Navigation/Compass.jsx

import {LitElement, css, svg, html} from 'lit';
import {styleMap} from 'lit/directives/style-map.js';

import {Cartesian2, Cartesian3, FixedFrameTransforms, Matrix4, Ellipsoid, Ray, Math as CesiumMath} from '@cesium/core';

const vectorScratch = new Cartesian2();
const windowPositionScratch = new Cartesian2();
const clickLocationScratch = new Cartesian2();
const centerScratch = new Cartesian3();
const oldTransformScratch = new Matrix4();
const newTransformScratch = new Matrix4();

const pickRayScratch = new Ray();

/**
 * Hit radius of the center gyro as a fraction of the compass radius. Deliberately larger than
 * the drawn disc (40% of the diameter, see the `.gyro` CSS) so the orbit target stays usable
 * on touch screens.
 */
const gyroHitRadiusFraction = 0.45;

/**
 * Ticks every 30 degrees, with longer ones at the cardinals. North gets the accent tip instead.
 */
const tickSvg = Array.from({length: 12}, (_, i) => i * 30)
  .filter(angle => angle !== 0)
  .map(angle => {
    const cardinal = angle % 90 === 0;
    return svg`<line class="tick ${cardinal ? 'cardinal' : ''}" x1="50" y1="${cardinal ? 4 : 6}" x2="50" y2="${cardinal ? 11.5 : 9.5}" transform="rotate(${angle} 50 50)"/>`;
  });

/**
 * @param {boolean} pulse
 */
const roseSvg = (pulse) => svg`<svg viewBox="0 0 100 100">
  ${tickSvg}
  <path class="north ${pulse ? 'pulse' : ''}" d="M50 2.5 L45.6 12.5 L54.4 12.5 Z"/>
  <text class="label n" x="50" y="22">N</text>
  <text class="label" x="78" y="50">E</text>
  <text class="label" x="50" y="78">S</text>
  <text class="label" x="22" y="50">W</text>
</svg>`;

/**
 * Four chevrons around a center dot: drag in any direction to orbit.
 */
const gyroSvg = svg`<svg viewBox="0 0 34 34">
  <circle class="core" cx="17" cy="17" r="2.4"/>
  ${[0, 90, 180, 270].map(angle => svg`<path class="chevron" d="M13.2 9.2 L17 5.4 L20.8 9.2" transform="rotate(${angle} 17 17)"/>`)}
</svg>`;

/**
 * @param {number} halfAngle Half of the arc angle, in radians.
 */
const rotationMarkerSvg = halfAngle => {
  const dx = 43 * Math.sin(halfAngle);
  const y = 50 - 43 * Math.cos(halfAngle);
  return svg`<svg viewBox="0 0 100 100"><path d="M${50 - dx} ${y} A43 43 0 0 1 ${50 + dx} ${y}"/></svg>`;
};

/**
 * @typedef {Object} Context
 * @property {DOMRect} compassRectangle
 * @property {Cartesian2} compassCenter
 * @property {Cartesian3 | undefined} viewCenter
 * @property {Matrix4} frame
 * @property {Matrix4} frameBackup the camera transform before the gesture, restored after a reset
 * @property {number} rotateInitialCursorAngle
 * @property {number} rotateInitialCameraAngle
 * @property {boolean} orbitIsLook
 * @property {number} orbitLastTimestamp
 */

export default class CesiumCompass extends LitElement {

  /** @override */
  static get properties() {
    return {
      scene: {type: Object},
      clock: {type: Object},
      ready: {type: Boolean},
      heading: {type: Number},
      northPulse: {type: Boolean},
      dragging: {type: String, reflect: true},
      orbitCursorAngle: {type: Number},
      orbitCursorOpacity: {type: Number},
      resetSpeed: {type: Number},
    };
  }

  /** @override */
  static get styles() {
    return css`
      :host {
        --cesium-compass-fill-color: rgba(0, 0, 0, 0.6);
        --cesium-compass-stroke-color: rgb(224, 225, 226);
        --cesium-compass-north-color: rgb(233, 84, 64);
        --cesium-compass-size: 70px;

        display: block;
        width: var(--cesium-compass-size);
        height: var(--cesium-compass-size);
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        color: var(--cesium-compass-stroke-color);
        user-select: none;
        -webkit-tap-highlight-color: transparent;
      }
      :host * {
        box-sizing: border-box;
      }
      .compass {
        position: relative;
        width: 100%;
        height: 100%;
        touch-action: none;
      }
      .face {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: var(--cesium-compass-fill-color);
        -webkit-backdrop-filter: blur(6px);
        backdrop-filter: blur(6px);
        box-shadow:
          inset 0 0 0 1px rgba(255, 255, 255, 0.15),
          0 2px 8px rgba(0, 0, 0, 0.35);
      }
      .ring {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        cursor: grab;
        transition: background-color 150ms ease;
      }
      .ring:hover, :host([dragging="rotate"]) .ring {
        background-color: rgba(255, 255, 255, 0.06);
      }
      :host([dragging="rotate"]) .ring {
        cursor: grabbing;
      }
      .rose {
        position: absolute;
        inset: 0;
        will-change: transform;
        pointer-events: none;
        transition: transform 80ms linear;
      }
      /* the ring must follow the cursor without lag while a gesture drives the camera */
      :host(:not([dragging=""])) .rose {
        transition: none;
      }
      .rose .tick {
        stroke: currentColor;
        stroke-width: 1.2;
        stroke-linecap: round;
        opacity: 0.45;
      }
      .rose .tick.cardinal {
        stroke-width: 1.8;
        opacity: 0.9;
      }
      .rose .north {
        fill: var(--cesium-compass-north-color);
        transform-origin: 50px 9px;
        transform-box: view-box;
      }
      .rose .north.pulse {
        animation: north-pulse 450ms ease-out;
      }
      @keyframes north-pulse {
        0% { transform: scale(1); }
        35% { transform: scale(1.6); filter: brightness(1.4); }
        100% { transform: scale(1); }
      }
      .rose .label {
        fill: currentColor;
        font-size: 7.5px;
        font-weight: 300;
        opacity: 0.55;
        text-anchor: middle;
        dominant-baseline: central;
        letter-spacing: 0.02em;
      }
      .rose .label.n {
        font-size: 10px;
        font-weight: 700;
        opacity: 1;
      }
      .gyro {
        position: absolute;
        left: 30%;
        top: 30%;
        width: 40%;
        height: 40%;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.10);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18), 0 1px 3px rgba(0, 0, 0, 0.3);
        cursor: move;
        transition: background-color 150ms ease;
      }
      .gyro:hover, :host([dragging="orbit"]) .gyro {
        background: rgba(255, 255, 255, 0.22);
      }
      .gyro .core {
        fill: currentColor;
      }
      .gyro .chevron {
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
        opacity: 0.85;
      }
      .rotation-marker {
        position: absolute;
        inset: 0;
        will-change: opacity, transform;
        pointer-events: none;
        transition: opacity 120ms ease;
      }
      .rotation-marker path {
        fill: none;
        stroke: currentColor;
        stroke-width: 4;
        stroke-linecap: round;
      }
      svg {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
      }
      @media (prefers-reduced-motion: reduce) {
        .ring, .gyro, .rotation-marker, .rose {
          transition: none;
        }
        .rose .north.pulse {
          animation: none;
        }
      }
    `;
  }

  constructor() {
    super();

    /**
     * Required. In TypeScript, replace with a `declare scene: Scene;` field.
     * @type {import('@cesium/engine').Scene}
     */
    this.scene = /** @type {import('@cesium/engine').Scene} */ (/** @type {unknown} */ (undefined));

    /**
     * Required. In TypeScript, replace with a `declare clock: Clock;` field.
     * @type {import('@cesium/core').Clock}
     */
    this.clock = /** @type {import('@cesium/core').Clock} */ (/** @type {unknown} */ (undefined));

    /**
     * @type {boolean}
     */
    this.ready = false;

    /**
     * @type {number}
     */
    this.resetSpeed = Math.PI / 100;

    /**
     * Which gesture is in progress, mirrored to the `dragging` attribute for styling.
     * @type {'' | 'rotate' | 'orbit'}
     */
    this.dragging = '';

    /**
     * Heading unwrapped to a continuous value, so the CSS transition on the rose never
     * takes the long way round when the camera crosses north.
     * @type {number}
     */
    this.displayHeading = 0;

    /**
     * True for a moment after a reset finished, to flash the north tip.
     * @type {boolean}
     */
    this.northPulse = false;

    /**
     * @type {number}
     */
    this.animationFrame = 0;

    /**
     * @type {ReturnType<typeof setTimeout> | undefined}
     */
    this.northPulseTimeout = undefined;

    /**
     * @type {boolean}
     */
    this.rotateClick = false;

    /**
     * @type {import('@cesium/core').Event.RemoveCallback | null}
     */
    this.unlistenFromPostRender = null;

    /**
     * @type {import('@cesium/core').Event.RemoveCallback | null}
     */
    this.unlistenFromClockTick = null;

    /**
     * @type {number}
     */
    this.orbitCursorOpacity = 0;
    this.orbitCursorAngle = 0;

    /**
     * @type {number}
     */
    this.heading = 0;

    this.handleRotatePointerMoveFunction = this.handleRotatePointerMove.bind(this);
    this.handleRotatePointerUpFunction = this.handleRotatePointerUp.bind(this);

    this.handleOrbitPointerMoveFunction = this.handleOrbitPointerMove.bind(this);
    this.handleOrbitPointerUpFunction = this.handleOrbitPointerUp.bind(this);
    this.handleOrbitTickFunction = this.handleOrbitTick.bind(this);

    /**
     * @type {Context}
     */
    this.context = /** @type {Context} */ ({});
  }

  /** @override */
  willUpdate() {
    if (this.scene && this.clock && !this.unlistenFromPostRender) {
      this.unlistenFromPostRender = this.scene.postRender.addEventListener(() => {
        const heading = this.scene.camera.heading;
        this.displayHeading += CesiumMath.negativePiToPi(heading - this.heading);
        this.heading = heading;
      });
      this.ready = true;
    }
  }

  get roseStyle() {
    return {
      transform: `rotate(${-this.displayHeading}rad)`
    };
  }

  get rotationMarkerHalfAngle() {
    const fraction = (this.orbitCursorOpacity - 0.5) * 2;
    return CesiumMath.toRadians(16 + 12 * fraction);
  }

  get rotationMarkerStyle() {
    return {
      transform: `rotate(-${this.orbitCursorAngle}rad)`,
      opacity: `${this.orbitCursorOpacity}`
    };
  }

  /**
   * Cursor position relative to the compass center.
   * @param {PointerEvent} event
   * @return {Cartesian2}
   */
  cursorVector(event) {
    clickLocationScratch.x = event.clientX - this.context.compassRectangle.left;
    clickLocationScratch.y = event.clientY - this.context.compassRectangle.top;
    return Cartesian2.subtract(clickLocationScratch, this.context.compassCenter, vectorScratch);
  }

  /** @override */
  disconnectedCallback() {
    this.cancelAnimation();
    clearTimeout(this.northPulseTimeout);
    if (this.unlistenFromPostRender) {
      this.unlistenFromPostRender();
    }
    if (this.unlistenFromClockTick) {
      this.unlistenFromClockTick();
      this.unlistenFromClockTick = null;
      this.orbitCursorOpacity = 0;
    }
    super.disconnectedCallback();
  }

  /**
   * @param {PointerEvent} event
   */
  handlePointerDown(event) {
    this.cancelAnimation();
    const camera = this.scene.camera;
    const compassElement = /** @type {HTMLDivElement} */ (event.currentTarget);
    this.context.compassRectangle = compassElement.getBoundingClientRect();
    this.context.compassCenter = new Cartesian2(
      (this.context.compassRectangle.right - this.context.compassRectangle.left) / 2,
      (this.context.compassRectangle.bottom - this.context.compassRectangle.top) / 2
    );
    const vector = this.cursorVector(event);
    const distanceFromCenter = Cartesian2.magnitude(vector);

    windowPositionScratch.x = this.scene.canvas.clientWidth / 2;
    windowPositionScratch.y = this.scene.canvas.clientHeight / 2;
    camera.getPickRay(windowPositionScratch, pickRayScratch);
    this.context.viewCenter = this.scene.globe.pick(pickRayScratch, this.scene, centerScratch);

    this.context.frameBackup = Matrix4.clone(camera.transform, this.context.frameBackup || new Matrix4());
    this.context.frame = FixedFrameTransforms.eastNorthUpToFixedFrame(
      this.context.viewCenter ? this.context.viewCenter : camera.positionWC,
      Ellipsoid.WGS84,
      newTransformScratch
    );

    const maxDistance = this.context.compassRectangle.width / 2;
    const distanceFraction = distanceFromCenter / maxDistance;

    if (distanceFraction < gyroHitRadiusFraction) {
      this.orbit(vector);
    } else if (distanceFraction < 1) {
      this.rotate(vector);
    }
    event.stopPropagation();
    event.preventDefault();
  }

  /**
   * @param {Cartesian2} cursorVector
   */
  rotate(cursorVector) {
    const camera = this.scene.camera;

    this.context.rotateInitialCursorAngle = Math.atan2(-cursorVector.y, cursorVector.x);

    const oldTransform = Matrix4.clone(camera.transform, oldTransformScratch);

    camera.lookAtTransform(this.context.frame);
    this.context.rotateInitialCameraAngle = Math.atan2(camera.position.y, camera.position.x);
    camera.lookAtTransform(oldTransform);

    this.rotateClick = true;
    this.dragging = 'rotate';

    document.addEventListener('pointermove', this.handleRotatePointerMoveFunction, false);
    document.addEventListener('pointerup', this.handleRotatePointerUpFunction, false);
  }

  /**
   * @param {PointerEvent} event
   */
  handleRotatePointerMove(event) {
    if (this.moveUpIfTooCloseToTerrain()) {
      return;
    }
    const camera = this.scene.camera;
    const vector = this.cursorVector(event);
    const angle = Math.atan2(-vector.y, vector.x);

    const angleDifference = angle - this.context.rotateInitialCursorAngle;
    const newCameraAngle = CesiumMath.zeroToTwoPi(
      this.context.rotateInitialCameraAngle - angleDifference
    );

    const oldTransform = Matrix4.clone(camera.transform, oldTransformScratch);
    camera.lookAtTransform(this.context.frame);
    const currentCameraAngle = Math.atan2(camera.position.y, camera.position.x);
    camera.rotateRight(newCameraAngle - currentCameraAngle);
    camera.lookAtTransform(oldTransform);

    this.rotateClick = false;
  }

  handleRotatePointerUp() {
    document.removeEventListener('pointermove', this.handleRotatePointerMoveFunction, false);
    document.removeEventListener('pointerup', this.handleRotatePointerUpFunction, false);
    this.dragging = '';

    if (this.rotateClick) {
      this.handleRingClick();
    }
  }

  /**
   * A click on the ring faces north; a second click, when already facing north, goes top-down.
   */
  handleRingClick() {
    if (Math.abs(CesiumMath.negativePiToPi(this.scene.camera.heading)) < CesiumMath.toRadians(1)) {
      this.resetToTopDown();
    } else {
      this.resetToNorth();
    }
  }

  /**
   * @param {MouseEvent} event
   */
  handleGyroDoubleClick(event) {
    event.stopPropagation();
    event.preventDefault();
    this.resetToTopDown();
  }

  resetToNorth() {
    const camera = this.scene.camera;
    camera.lookAtTransform(this.context.frame);
    const angle = CesiumMath.negativePiToPi(
      CesiumMath.PI_OVER_TWO + Math.atan2(camera.position.y, camera.position.x)
    );
    this.animateInFrame(angle, delta => camera.rotateLeft(delta));
  }

  /**
   * Animates the camera to look straight down. Orbits around the view center when there is
   * one, otherwise tilts the camera in place.
   */
  resetToTopDown() {
    const camera = this.scene.camera;
    if (this.context.viewCenter) {
      camera.lookAtTransform(this.context.frame);
      const p = camera.position;
      const elevation = Math.atan2(p.z, Math.hypot(p.x, p.y));
      this.animateInFrame(CesiumMath.PI_OVER_TWO - elevation, delta => camera.rotateDown(delta));
    } else {
      const angle = -CesiumMath.PI_OVER_TWO - camera.pitch;
      this.animateInFrame(angle, delta => camera.lookUp(delta), false);
    }
  }

  /**
   * Spreads `angle` over successive frames at `resetSpeed`, calling `apply` with each increment.
   * The camera is expected to already be in the frame; the previous transform is restored at the end.
   * @param {number} angle
   * @param {(delta: number) => void} apply
   * @param {boolean} [inFrame=true] whether `lookAtTransform(frame)` was applied before calling
   */
  animateInFrame(angle, apply, inFrame = true) {
    const camera = this.scene.camera;
    const oldTransform = inFrame ? Matrix4.clone(this.context.frameBackup, new Matrix4()) : undefined;
    const duration = Math.abs(angle) / this.resetSpeed;

    let prevProgress = 0;
    const start = performance.now();
    const finish = () => {
      if (oldTransform) {
        camera.lookAtTransform(oldTransform);
      }
      this.animationFrame = 0;
      this.flashNorth();
    };
    const step = () => {
      const elapsed = performance.now() - start;
      const progress = duration > 0 ? CesiumMath.clamp(elapsed / duration, 0, 1) : 1;
      apply((progress - prevProgress) * angle);
      prevProgress = progress;
      if (progress < 1) {
        this.animationFrame = window.requestAnimationFrame(step);
      } else {
        finish();
      }
    };
    if (duration === 0) {
      finish();
      return;
    }
    this.animationFrame = window.requestAnimationFrame(step);
  }

  cancelAnimation() {
    if (this.animationFrame) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
      this.scene.camera.lookAtTransform(this.context.frameBackup);
    }
  }

  flashNorth() {
    clearTimeout(this.northPulseTimeout);
    this.northPulse = false;
    // let Lit render the class removal before adding it again, so a second flash restarts
    requestAnimationFrame(() => {
      this.northPulse = true;
      this.northPulseTimeout = setTimeout(() => { this.northPulse = false; }, 500);
    });
  }

  /**
   * @param {Cartesian2} cursorVector
   */
  orbit(cursorVector) {
    this.context.orbitIsLook = !this.context.viewCenter;
    this.context.orbitLastTimestamp = performance.now();
    this.dragging = 'orbit';

    document.addEventListener('pointermove', this.handleOrbitPointerMoveFunction, false);
    document.addEventListener('pointerup', this.handleOrbitPointerUpFunction, false);

    this.unlistenFromClockTick = this.clock.onTick.addEventListener(this.handleOrbitTickFunction);

    this.updateAngleAndOpacity(cursorVector, this.context.compassRectangle.width);
  }

  handleOrbitTick() {
    if (this.moveUpIfTooCloseToTerrain()) {
      return;
    }
    const camera = this.scene.camera;
    const timestamp = performance.now();

    const deltaT = timestamp - this.context.orbitLastTimestamp;
    const rate = ((this.orbitCursorOpacity - 0.5) * 2.5) / 1000;
    const distance = deltaT * rate;

    const angle = this.orbitCursorAngle + CesiumMath.PI_OVER_TWO;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;

    const oldTransform = Matrix4.clone(camera.transform, oldTransformScratch);
    camera.lookAtTransform(this.context.frame);
    if (this.context.orbitIsLook) {
      camera.look(Cartesian3.UNIT_Z, -x);
      camera.look(camera.right, -y);
    } else {
      camera.rotateLeft(x);
      camera.rotateUp(y);
    }
    camera.lookAtTransform(oldTransform);

    this.context.orbitLastTimestamp = timestamp;
  }

  distanceToTerrain() {
    const camera = this.scene.camera;
    const height = this.scene.globe.getHeight(camera.positionCartographic);
    if (height === undefined) return Infinity;
    return camera.positionCartographic.height - height;
  }

  moveUpIfTooCloseToTerrain() {
    const controller = this.scene.screenSpaceCameraController;
    if (!controller.enableCollisionDetection) {
      return false;
    }
    const distanceDiff = this.distanceToTerrain() - controller.minimumZoomDistance;
    if (CesiumMath.lessThan(distanceDiff, 0.0, CesiumMath.EPSILON1)) {
      this.scene.camera.moveUp(-distanceDiff);
      return true;
    }
    return false;
  }

  /**
   * @param {Cartesian2} vector
   * @param {number} compassWidth
   */
  updateAngleAndOpacity(vector, compassWidth) {
    const angle = Math.atan2(-vector.y, vector.x);
    this.orbitCursorAngle = CesiumMath.zeroToTwoPi(angle - CesiumMath.PI_OVER_TWO);

    const distance = Cartesian2.magnitude(vector);
    const maxDistance = compassWidth / 2.0;
    const distanceFraction = Math.min(distance / maxDistance, 1.0);
    this.orbitCursorOpacity = 0.5 * distanceFraction * distanceFraction + 0.5;
  }

  /**
   * @param {PointerEvent} event
   */
  handleOrbitPointerMove(event) {
    const cursorVector = this.cursorVector(event);
    this.updateAngleAndOpacity(cursorVector, this.context.compassRectangle.width);
  }

  handleOrbitPointerUp() {
    document.removeEventListener('pointermove', this.handleOrbitPointerMoveFunction, false);
    document.removeEventListener('pointerup', this.handleOrbitPointerUpFunction, false);
    if (this.unlistenFromClockTick) {
      this.unlistenFromClockTick();
    }
    this.dragging = '';
    this.orbitCursorOpacity = 0;
  }

  /** @override */
  render() {
    if (this.ready) {
      return html`
        <div class="compass" @pointerdown=${this.handlePointerDown}>
          <div class="face"></div>
          <div class="ring" role="button" aria-label="Rotate the view, click to face north"></div>
          <div class="rose" style=${styleMap(this.roseStyle)}>${roseSvg(this.northPulse)}</div>
          <div class="gyro" role="button" aria-label="Orbit the view, double-click to look down" @dblclick=${this.handleGyroDoubleClick}>${gyroSvg}</div>
          <div class="rotation-marker" style=${styleMap(this.rotationMarkerStyle)}>${rotationMarkerSvg(this.rotationMarkerHalfAngle)}</div>
        </div>
      `;
    } else {
      return html``;
    }
  }
}

customElements.define('cesium-compass', CesiumCompass);
