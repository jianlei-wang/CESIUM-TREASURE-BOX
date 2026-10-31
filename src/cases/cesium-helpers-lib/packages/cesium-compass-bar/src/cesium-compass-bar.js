import { Math as CesiumMath } from "@cesium/core";
import { LitElement, css, html } from "lit";

const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export default class CesiumCompassBar extends LitElement {
  /** @override */
  static get properties() {
    return {
      scene: { type: Object },
      heading: { type: Number },
      intercardinalWidth: { state: true },
      hostWidth: { state: true },
    };
  }

  /** @override */
  static get styles() {
    return css`
      :host {
        --cesium-compass-bar-tick-color: rgb(224, 225, 226);
        --cesium-compass-bar-intercardinal-width: 100px;
        display: block;
        position: relative;
        background-color: rgba(0, 0, 0, 0.6);
        border-radius: 6px;
      }
      :host * {
        box-sizing: content-box;
      }
      .container {
        height: 100%;
        overflow: hidden;
        cursor: grab;
        touch-action: none;
        user-select: none;
        mask-image: linear-gradient(to right, transparent, #000 15%, #000 85%, transparent);
      }
      .container.dragging {
        cursor: grabbing;
      }
      .compass-bar {
        display: flex;
        align-items: flex-end;
      }
      .compass-bar > div {
        flex: none;
        width: var(--cesium-compass-bar-intercardinal-width);
        text-align: center;
      }
      .label {
        padding: 4px;
        color: var(--cesium-compass-bar-tick-color);
      }
      .ticks {
        display: flex;
        justify-content: space-between;
        margin: 0 calc(100% / 18);
      }
      .ticks > div {
        width: 1px;
        height: 6px;
        background-color: var(--cesium-compass-bar-tick-color);
      }
      .ticks > div:nth-child(5) {
        height: 10px;
      }
      .center-tick {
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 10px;
        height: 6px;
        clip-path: polygon(0 0, 100% 0, 50% 100%);
        background-color: var(--cesium-compass-bar-tick-color);
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
     * @type {number}
     */
    this.intercardinalWidth = 0;

    /**
     * @type {number}
     */
    this.hostWidth = 0;

    /**
     * @type {number}
     */
    this.heading = 0;

    /**
     * @type {import('@cesium/core').Event.RemoveCallback | null}
     */
    this.unlistenFromPostRender = null;

    this.resizeObserver = new ResizeObserver(() => this.measure());

    /**
     * @type {{pointerId: number, x: number, heading: number} | null}
     */
    this.drag = null;
  }

  /**
   * @param {PointerEvent} event
   */
  onPointerDown(event) {
    if (!this.scene || event.button !== 0) {
      return;
    }
    /** @type {HTMLElement} */ (event.currentTarget).setPointerCapture(event.pointerId);
    this.drag = { pointerId: event.pointerId, x: event.clientX, heading: this.scene.camera.heading };
    this.requestUpdate();
  }

  /**
   * @param {PointerEvent} event
   */
  onPointerMove(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId || this.intercardinalWidth <= 0) {
      return;
    }
    // the tape follows the pointer, so dragging right decreases the heading
    const heading = this.drag.heading - ((event.clientX - this.drag.x) / this.intercardinalWidth) * CesiumMath.PI_OVER_FOUR;
    const camera = this.scene.camera;
    camera.setView({ orientation: { heading, pitch: camera.pitch, roll: camera.roll } });
  }

  /**
   * @param {PointerEvent} event
   */
  onPointerEnd(event) {
    if (this.drag && event.pointerId === this.drag.pointerId) {
      this.drag = null;
      this.requestUpdate();
    }
  }

  /** @override */
  connectedCallback() {
    super.connectedCallback();
    this.resizeObserver.observe(this);
    // re-arm the postRender listener in updated() after a reconnect
    this.requestUpdate();
  }

  /** @override */
  disconnectedCallback() {
    this.resizeObserver.disconnect();
    if (this.unlistenFromPostRender) {
      this.unlistenFromPostRender();
      this.unlistenFromPostRender = null;
    }
    super.disconnectedCallback();
  }

  measure() {
    // the tape is laid out inside .container, which excludes the host padding and border
    this.hostWidth = this.renderRoot.querySelector('.container')?.clientWidth ?? 0;
    this.intercardinalWidth = parseFloat(getComputedStyle(this).getPropertyValue('--cesium-compass-bar-intercardinal-width'));
  }

  /** @override */
  updated() {
    if (this.scene && !this.unlistenFromPostRender) {
      this.unlistenFromPostRender = this.scene.postRender.addEventListener(
        () => {
          this.heading = this.scene.camera.heading;
        }
      );
    }
  }

  /** @override */
  render() {
    const width = this.intercardinalWidth;
    // positions in intercardinal units: the camera heading and the half span of the bar
    const center = this.heading / CesiumMath.PI_OVER_FOUR;
    const halfSpan = width > 0 ? this.hostWidth / 2 / width : 0;
    const first = Math.ceil(center - halfSpan - 0.5);
    const last = Math.floor(center + halfSpan + 0.5);
    // whole pixels keep the 1px ticks crisp
    const offset = Math.round(this.hostWidth / 2 - width / 2 + (first - center) * width);

    const ticks = html`
      <div class="ticks">
        ${Array(9)
          .fill(undefined)
          .map((_, index, arr) => html`<div part="tick ${index === Math.floor(arr.length / 2) ? 'major' : 'minor'}"></div>`)}
      </div>
    `;
    const cells = [];
    for (let k = first; k <= last; k++) {
      const direction = DIRECTIONS[CesiumMath.mod(k, 8)];
      cells.push(html`
        <div>
          <div class="label" part="label ${k % 2 === 0 ? 'major' : 'minor'}">${direction}</div>
          ${ticks}
        </div>
      `);
    }
    return html`
      <div
        class="container ${this.drag ? 'dragging' : ''}"
        @pointerdown=${this.onPointerDown}
        @pointermove=${this.onPointerMove}
        @pointerup=${this.onPointerEnd}
        @pointercancel=${this.onPointerEnd}
      >
        <div class="compass-bar" style="transform: translateX(${offset}px)">${cells}</div>
      </div>
      <div class="center-tick" part="center-tick"></div>
    `;
  }
}

customElements.define("cesium-compass-bar", CesiumCompassBar);
