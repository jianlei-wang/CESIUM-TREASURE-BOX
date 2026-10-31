import {Cartesian3, FixedFrameTransforms, Matrix3, Matrix4} from '@cesium/core';
import {SceneMode} from '@cesium/engine';
import {LitElement, css, html, svg} from 'lit';

// The cube's faces, by the axis they face (0 east, 1 north, 2 up) and its sign, and the axes, in the east-north-up
// frame at the camera: x to the east, y to the north, z up, as ParaView's orientation axes
const FACES = [
  {name: 'e', label: 'E', axis: 0, sign: 1},
  {name: 'w', label: 'W', axis: 0, sign: -1},
  {name: 'n', label: 'N', axis: 1, sign: 1},
  {name: 's', label: 'S', axis: 1, sign: -1},
  {name: 'top', label: 'top', axis: 2, sign: 1},
  {name: 'bottom', label: 'bottom', axis: 2, sign: -1},
];
const AXES = [{name: 'x', axis: 0}, {name: 'y', axis: 1}, {name: 'z', axis: 2}];

// In 2D and Columbus view, Cesium's world frame is the projection's turned: east along y, north along z, up along x
// (Camera.TRANSFORM_2D, private, so written out here)
const PROJECTED_FRAME = new Matrix4(
  0, 0, 1, 0,
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
);

const frameScratch = new Matrix4();
const seenScratch = new Matrix4();
const rotationScratch = new Matrix3();
const axesScratch = [new Cartesian3(), new Cartesian3(), new Cartesian3()];

/**
 * Which way north and up are, at any angle, drawn as the camera sees them, orthographic, the labels upright: a cube,
 * its faces named by the direction they face, or, its faces hidden and its axes shown by CSS (`::part()`), ParaView's
 * orientation axes, three axes from the center, x to the east, y to the north, z up. The axes are hidden by default.
 * The geometry is drawn for a unit cube and unit axes, sized by CSS from the custom properties.
 */
export default class CesiumViewCube extends LitElement {

  /** @override */
  static get properties() {
    return {
      scene: {type: Object},
      axes: {state: true},
    };
  }

  /** @override */
  static get styles() {
    return css`
      :host {
        --cesium-view-cube-size: 100px;
        /* in shares of the widget's size, bare numbers: the cube's side, its faces' labels' size, the axes' length
           from the center, their labels' distance from it and size */
        --cesium-view-cube-cube-size: 0.6;
        --cesium-view-cube-face-label-size: 0.12;
        --cesium-view-cube-axis-length: 0.28;
        --cesium-view-cube-axis-label-distance: 0.39;
        --cesium-view-cube-axis-label-size: 0.2;
        /* how much a face turns toward the camera, 0 edge on to 1 facing it, before its label shows */
        --cesium-view-cube-face-label-threshold: 0.25;
        --cesium-view-cube-fill-color: rgb(224, 225, 226);
        --cesium-view-cube-stroke-color: rgba(0, 0, 0, 0.6);
        --cesium-view-cube-face-stroke-width: 1px;
        --cesium-view-cube-label-color: rgba(0, 0, 0, 0.6);
        --cesium-view-cube-x-color: rgb(230, 50, 40);
        --cesium-view-cube-y-color: rgb(230, 200, 30);
        --cesium-view-cube-z-color: rgb(40, 180, 60);
        --cesium-view-cube-axis-width: 2px;
        display: block;
        width: var(--cesium-view-cube-size);
        height: var(--cesium-view-cube-size);
      }
      svg {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
        user-select: none;
      }
      /* the drawing is 2 units across, its center at 0: a share s of the widget is 2 s units */
      .cube {
        transform: scale(var(--cesium-view-cube-cube-size));
      }
      .axes {
        transform: scale(calc(var(--cesium-view-cube-axis-length) * 2));
      }
      .face {
        fill: var(--cesium-view-cube-fill-color);
        stroke: var(--cesium-view-cube-stroke-color);
        stroke-width: var(--cesium-view-cube-face-stroke-width);
        stroke-linejoin: round;
        vector-effect: non-scaling-stroke;
      }
      text {
        text-anchor: middle;
        dominant-baseline: central;
        pointer-events: none;
      }
      /* at the face's center (--x, --y, a unit cube's), shown once the face turns enough toward the camera (--facing) */
      .face-label {
        fill: var(--cesium-view-cube-label-color);
        font-size: calc(var(--cesium-view-cube-face-label-size) * 2px);
        transform: translate(calc(var(--x) * var(--cesium-view-cube-cube-size) * 1px),
          calc(var(--y) * var(--cesium-view-cube-cube-size) * 1px));
        opacity: clamp(0, calc((var(--facing) - var(--cesium-view-cube-face-label-threshold)) * 1000), 1);
      }
      /* hidden by default: the page shows them (::part(axis), ::part(axis-label)) */
      .axis,
      .axis-label {
        display: none;
      }
      .axis {
        stroke-width: var(--cesium-view-cube-axis-width);
        stroke-linecap: round;
        vector-effect: non-scaling-stroke;
      }
      .axis-x {
        stroke: var(--cesium-view-cube-x-color);
        fill: var(--cesium-view-cube-x-color);
      }
      .axis-y {
        stroke: var(--cesium-view-cube-y-color);
        fill: var(--cesium-view-cube-y-color);
      }
      .axis-z {
        stroke: var(--cesium-view-cube-z-color);
        fill: var(--cesium-view-cube-z-color);
      }
      /* along its axis (--x, --y, a unit one's); after the colors, its stroke none */
      .axis-label {
        stroke: none;
        font-size: calc(var(--cesium-view-cube-axis-label-size) * 2px);
        font-weight: bold;
        transform: translate(calc(var(--x) * var(--cesium-view-cube-axis-label-distance) * 2px),
          calc(var(--y) * var(--cesium-view-cube-axis-label-distance) * 2px));
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
     * East, north and up as the camera sees them: the drawing's x to the right, y down, and z toward the camera.
     * @type {Cartesian3[]}
     */
    this.axes = [Cartesian3.UNIT_X, new Cartesian3(0, -1, 0), new Cartesian3(0, 0, 1)];

    /**
     * The scene listened to, and how to stop.
     * @type {{scene: import('@cesium/engine').Scene, remove: import('@cesium/core').Event.RemoveCallback} | null}
     */
    this.listening = null;
  }

  /** @override */
  connectedCallback() {
    super.connectedCallback();
    // re-arm the postRender listener in willUpdate() after a reconnect
    this.requestUpdate();
  }

  /** @override */
  disconnectedCallback() {
    this.stopListening();
    super.disconnectedCallback();
  }

  stopListening() {
    this.listening?.remove();
    this.listening = null;
  }

  /** @override */
  willUpdate() {
    // here, not in updated(): the axes set before this render, not in another
    if (this.listening?.scene !== this.scene) {
      this.stopListening();
      if (this.scene) {
        const scene = this.scene;
        this.listening = {scene, remove: scene.postRender.addEventListener(() => this.updateFromCamera())};
        this.updateFromCamera();
      }
    }
  }

  /**
   * East, north and up at the camera, turned by its view; new axes, and a render, only when they change.
   */
  updateFromCamera() {
    const {camera, ellipsoid, mode} = this.scene;
    const frame = mode === SceneMode.SCENE3D
      ? FixedFrameTransforms.eastNorthUpToFixedFrame(camera.positionWC, ellipsoid, frameScratch)
      : PROJECTED_FRAME;
    const rotation = Matrix4.getMatrix3(Matrix4.multiply(camera.viewMatrix, frame, seenScratch), rotationScratch);
    const changed = axesScratch.map((seen, i) => {
      Matrix3.getColumn(rotation, i, seen);
      // the eye's y is up, the drawing's down
      seen.y = -seen.y;
      return !Cartesian3.equalsEpsilon(seen, this.axes[i], 1e-6);
    }).includes(true);
    if (changed) {
      this.axes = axesScratch.map(seen => Cartesian3.clone(seen));
    }
  }

  /** @override */
  render() {
    const axes = this.axes;
    /** @type {(weights: number[]) => {x: number, y: number}} */
    const point = weights => ({
      x: weights.reduce((sum, w, i) => sum + w * axes[i].x, 0),
      y: weights.reduce((sum, w, i) => sum + w * axes[i].y, 0),
    });
    // a convex cube: the faces turned toward the camera never overlap, no sorting needed; one seen edge on is left out
    const shown = FACES.filter(({axis, sign}) => sign * axes[axis].z > 1e-3);
    const faces = shown.map(({name, axis, sign}) => {
      const [u, v] = [0, 1, 2].filter(i => i !== axis);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
        const weights = [0, 0, 0];
        weights[axis] = sign;
        weights[u] = a;
        weights[v] = b;
        return point(weights);
      });
      return svg`<polygon class="face" part="face face-${name}" points=${corners.map(({x, y}) => `${x},${y}`).join(' ')}></polygon>`;
    });
    // the faces' labels out of the scaled cube, at their size
    const faceLabels = shown.map(({name, label, axis, sign}) => {
      const center = point([0, 1, 2].map(i => (i === axis ? sign : 0)));
      return svg`<text class="face-label" part="face-label face-label-${name}"
        style="--x: ${center.x}; --y: ${center.y}; --facing: ${sign * axes[axis].z}">${label}</text>`;
    });
    // the axes from the center, those pointing away first: behind the cube, the others in front of it
    const sorted = AXES.toSorted((a, b) => axes[a.axis].z - axes[b.axis].z);
    /** @type {(drawn: typeof AXES) => unknown} */
    const lines = drawn => svg`<g class="axes">${drawn.map(({name, axis}) => {
      const tip = point([0, 1, 2].map(i => (i === axis ? 1 : 0)));
      return svg`<line class="axis axis-${name}" part="axis axis-${name}" x1="0" y1="0" x2=${tip.x} y2=${tip.y}></line>`;
    })}</g>`;
    const axisLabels = sorted.map(({name, axis}) => {
      const tip = point([0, 1, 2].map(i => (i === axis ? 1 : 0)));
      return svg`<text class="axis-label axis-${name}" part="axis-label axis-label-${name}"
        style="--x: ${tip.x}; --y: ${tip.y}">${name}</text>`;
    });
    const away = sorted.filter(({axis}) => axes[axis].z < 0);
    const toward = sorted.filter(({axis}) => axes[axis].z >= 0);
    return html`
      <svg viewBox="-1 -1 2 2" role="img" aria-label="View orientation">
        ${lines(away)}<g class="cube">${faces}</g>${faceLabels}${lines(toward)}${axisLabels}
      </svg>
    `;
  }
}

customElements.define('cesium-view-cube', CesiumViewCube);
