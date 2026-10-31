import {Cartesian2, Cartesian3, Cartographic, FixedFrameTransforms, IntersectionTests, Math as CesiumMath, Matrix4, Plane} from '@cesium/core';
import {EasingFunction} from '@cesium/engine';

// in meters, how far the camera stays from its target by default, out of the scene's way: an orthographic view's
// size does not depend on it, its depth's precision does (32-bit floats: half a millimeter at 5 km)
const ORBIT = 5000;
// the keys, as in the Sims: Q and E turn, WASD or the arrows slide across the ground while held, [x, y] on the screen
/** @type {Record<string, [number, number]>} */
const PAN = {w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0]};
// how fast the keys slide the view, a share of the screen's width a second; how long a turn and a glide take, in ms;
// how far two fingers turn before the view turns with them, so that a pinch does not turn it
const PAN_SPEED = 0.4;
const TURN_TIME = 450;
const GLIDE_TIME = 400;
const TWIST = CesiumMath.toRadians(15);
// after a drag, the view drifts on, slowing down by this share of its speed a frame (as three.js's OrbitControls' damping
// of 0.05), if let go within LET_GO ms of the last move
const DAMPING = 0.95;
const LET_GO = 60;

const easeInOut = EasingFunction.QUADRATIC_IN_OUT;
const positionScratch = new Cartesian2();
const planeScratch = new Plane(Cartesian3.UNIT_Z, 0);
const normalScratch = new Cartesian3();
const deltaScratch = new Cartesian3();
const frameScratch = new Matrix4();
const directionScratch = new Cartesian3();
const upScratch = new Cartesian3();
const orbitScratch = new Cartesian3();

/**
 * An isometric view, as in a game: an orthographic camera at a fixed pitch, looking from a corner. A drag turns the
 * view, a right drag (or Ctrl or Shift with the left) and one finger slide it across the ground, the wheel and a pinch
 * zoom where they point, two fingers twist it; Q and E turn it a quarter, WASD and the arrows slide it, a double click
 * glides to the spot.
 */
export default class CesiumIso {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {{pitch?: number, heading?: number, size?: number, minSize?: number, maxSize?: number,
   *   limit?: (target: Cartesian3) => Cartesian3, orbit?: number}} [options] The pitch, in degrees down from the horizon; a
   *   corner's heading, in degrees, the others a quarter turn apart; the size, in meters across the screen's shorter side,
   *   and its bounds; a limit, a target moved back where the view may stand: it stops sliding there; the orbit, in meters
   *   from the target to the camera, beyond the scene: closer, faces a fraction of a millimeter apart do not fight.
   */
  constructor(viewer, options = {}) {
    this.viewer = viewer;
    this.pitch_ = CesiumMath.toRadians(options.pitch ?? 30);
    this.corner_ = CesiumMath.toRadians(options.heading ?? 45);
    this.size_ = options.size ?? 400;
    this.minSize_ = options.minSize ?? 20;
    this.maxSize_ = options.maxSize ?? 8000;
    this.limit_ = options.limit;
    this.orbit_ = options.orbit ?? ORBIT;
    this.active_ = false;
    /** @type {Cartesian3} */
    this.target_ = new Cartesian3();
    this.heading_ = 0;
    /** @type {Map<number, Cartesian2>} */
    this.pointers_ = new Map();
    /** @type {{grab?: Cartesian3 | undefined, turn?: boolean, last?: {x: number, y: number}, distance?: number, angle?: number, twist?: number} | undefined} */
    this.drag_ = undefined;
    /** @type {Set<string>} */
    this.held_ = new Set();
    /** @type {{from: number, to: number, start: number} | undefined} */
    this.turning_ = undefined;
    /** @type {{from: Cartesian3, to: Cartesian3, start: number} | undefined} */
    this.gliding_ = undefined;
    /** @type {number | undefined} */
    this.frame_ = undefined;
    /** @type {number | undefined} */
    this.slid_ = undefined;
    /** @type {(() => void) | undefined} */
    this.settling_ = undefined;
    // the view's last move during a drag, and how fast it moved then: turning in radians, sliding in meters, a ms
    /** @type {{time: number, heading: number, target: Cartesian3, turn: number, slide: Cartesian3} | undefined} */
    this.moved_ = undefined;
    /** @type {{turn: number, slide: Cartesian3} | undefined} */
    this.drift_ = undefined;
    /** @type {number | undefined} */
    this.drifted_ = undefined;
    // the camera's frustum before, given back on deactivation
    /** @type {any} */
    this.frustum_ = undefined;

    this.listeners_ = /** @type {[EventTarget, string, (e: any) => void][]} */ ([
      [viewer.scene.canvas, 'pointerdown', e => this.down_(e)],
      [viewer.scene.canvas, 'pointermove', e => this.move_(e)],
      [viewer.scene.canvas, 'pointerup', e => this.up_(e)],
      [viewer.scene.canvas, 'pointercancel', e => this.up_(e)],
      [viewer.scene.canvas, 'wheel', e => this.wheel_(e)],
      [viewer.scene.canvas, 'dblclick', e => this.glideTo(this.pick_(this.at_(e)))],
      [viewer.scene.canvas, 'contextmenu', e => e.preventDefault()],
      [window, 'keydown', e => this.keydown_(e)],
      [window, 'keyup', e => this.held_.delete(e.key.toLowerCase())],
      [window, 'blur', () => this.held_.clear()],
      [window, 'resize', () => this.place_()],
    ]);
  }

  get active() {
    return this.active_;
  }

  set active(active) {
    if (active === this.active_) {
      return;
    }
    this.active_ = active;
    const {scene} = this.viewer;
    scene.screenSpaceCameraController.enableInputs = !active;
    for (const [target, type, listener] of this.listeners_) {
      if (active) {
        target.addEventListener(type, listener, type === 'wheel' ? {passive: false} : undefined);
      } else {
        target.removeEventListener(type, listener);
      }
    }
    if (active) {
      // about the ground in the middle of the screen, from the nearest corner; before the scene has loaded, the
      // ellipsoid there, raised to the terrain once its tiles are in, if the globe is shown
      const {canvas, camera, globe} = scene;
      const middle = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
      const picked = this.pick_(middle);
      this.target_ = picked ?? camera.pickEllipsoid(middle, scene.ellipsoid) ?? Cartesian3.clone(camera.positionWC);
      this.heading_ = this.cornerAfter_(camera.heading, 0);
      this.frustum_ = camera.frustum.clone();
      // off any transform the camera was fixed to (once: Cesium reads the depth back here)
      camera.lookAtTransform(Matrix4.IDENTITY);
      camera.switchToOrthographicFrustum();
      this.place_();
      if (!picked && globe?.show) {
        this.settling_ = globe.tileLoadProgressEvent.addEventListener(queued => {
          const spot = Cartographic.fromCartesian(this.target_, scene.ellipsoid);
          const height = queued ? undefined : globe.getHeight(spot);
          if (height !== undefined) {
            this.settle_();
            this.target_ = Cartesian3.fromRadians(spot.longitude, spot.latitude, height, scene.ellipsoid);
            this.place_();
          }
        });
      }
    } else {
      this.settle_();
      cancelAnimationFrame(this.frame_ ?? 0);
      this.frame_ = this.turning_ = this.gliding_ = this.drag_ = this.moved_ = this.drift_ = this.drifted_ = undefined;
      this.pointers_.clear();
      this.held_.clear();
      const {canvas} = scene;
      if (this.frustum_.aspectRatio !== undefined) {
        this.frustum_.aspectRatio = canvas.clientWidth / canvas.clientHeight;
      }
      scene.camera.frustum = this.frustum_;
      scene.requestRender();
    }
  }

  /**
   * What the view turns about, in the middle of the screen, a copy; set once active, the view moves there at once.
   */
  get target() {
    return Cartesian3.clone(this.target_);
  }

  set target(position) {
    this.settle_();
    this.target_ = Cartesian3.clone(position);
    if (this.active_) {
      this.place_();
    }
  }

  /**
   * No more waiting for the terrain under the first target.
   */
  settle_() {
    this.settling_?.();
    this.settling_ = undefined;
  }

  /**
   * The view's heading, in degrees, clockwise from the north, where the camera looks.
   */
  get heading() {
    return CesiumMath.toDegrees(this.heading_);
  }

  /**
   * The heading set, in degrees: the view turned there at once, with no easing (turnTo eases); an animation under way,
   * a drift or a turn, is dropped. While active.
   * @param {number} heading
   */
  set heading(heading) {
    this.turning_ = this.drift_ = this.drifted_ = undefined;
    this.heading_ = CesiumMath.toRadians(heading);
    this.place_();
  }

  /**
   * The view's size, in meters across the screen's shorter side; set, within its bounds, the view zooms at once about
   * its target (zoom zooms about a point of the screen).
   */
  get size() {
    return this.size_;
  }

  set size(size) {
    this.size_ = CesiumMath.clamp(size, this.minSize_, this.maxSize_);
    this.place_();
  }

  /**
   * A turn, eased, to a heading, in degrees, the shorter way round: the view toward a side a place is seen from.
   * @param {number} heading
   */
  turnTo(heading) {
    this.drift_ = this.drifted_ = undefined;
    this.anchor_();
    const to = CesiumMath.toRadians(heading);
    const delta = CesiumMath.negativePiToPi(to - this.heading_);
    this.turning_ = {from: this.heading_, to: this.heading_ + delta, start: performance.now()};
    this.animate_();
  }

  /**
   * A quarter turn, eased, to the next corner: the camera clockwise about the middle, seen from above (-1, as Q), or
   * the other way (1, as E); 0 to the nearest.
   * @param {number} sign
   */
  turn(sign) {
    this.drift_ = this.drifted_ = undefined;
    this.anchor_();
    this.turning_ = {from: this.heading_, to: this.cornerAfter_(this.heading_, -sign), start: performance.now()};
    this.animate_();
  }

  /**
   * Zooms in (a factor below 1) or out, toward a point on the screen, by default its middle.
   * @param {number} factor
   * @param {Cartesian2} [at]
   */
  zoom(factor, at) {
    const {canvas} = this.viewer.scene;
    const point = at ?? new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const before = this.ground_(point, this.target_);
    this.size_ = CesiumMath.clamp(this.size_ * factor, this.minSize_, this.maxSize_);
    this.place_();
    if (before) {
      this.keep_(before, point);
    }
  }

  /**
   * Glides the view's middle to a position, eased.
   * @param {Cartesian3 | undefined} position
   */
  glideTo(position) {
    if (!position) {
      return;
    }
    this.drift_ = this.drifted_ = undefined;
    this.gliding_ = {from: Cartesian3.clone(this.target_), to: Cartesian3.clone(position), start: performance.now()};
    this.animate_();
  }

  /**
   * The camera on its orbit about the target, the frustum as wide as the size on the shorter side. Set straight: in
   * the target's east-north-up frame, looking along the heading, down by the pitch; Cesium's lookAt and setView would
   * read the depth under the middle back from the GPU to size an orthographic frustum, a stall at each move.
   */
  place_() {
    if (!this.active_) {
      return;
    }
    if (this.limit_) {
      this.target_ = Cartesian3.clone(this.limit_(this.target_), this.target_);
    }
    const {camera, ellipsoid} = this.viewer.scene;
    const [sh, ch, sp, cp] = [Math.sin(this.heading_), Math.cos(this.heading_), Math.sin(this.pitch_), Math.cos(this.pitch_)];
    const frame = FixedFrameTransforms.eastNorthUpToFixedFrame(this.target_, ellipsoid, frameScratch);
    const direction = Matrix4.multiplyByPointAsVector(frame, Cartesian3.fromElements(sh * cp, ch * cp, -sp, directionScratch), directionScratch);
    const up = Matrix4.multiplyByPointAsVector(frame, Cartesian3.fromElements(sh * sp, ch * sp, cp, upScratch), upScratch);
    Matrix4.multiplyByPoint(frame, Cartesian3.fromElements(-sh * cp * this.orbit_, -ch * cp * this.orbit_, sp * this.orbit_, orbitScratch), camera.position);
    Cartesian3.clone(direction, camera.direction);
    Cartesian3.clone(up, camera.up);
    Cartesian3.cross(direction, up, camera.right);
    // the orthographic frustum's width
    // the orthographic frustum's width; a subclass placing the camera on a perspective frustum has none to set
    if ('width' in camera.frustum) {
      camera.frustum.width = this.width_();
    }
    this.viewer.scene.requestRender();
  }

  /**
   * The view's width, in meters: the size on the screen's shorter side.
   */
  width_() {
    const {canvas} = this.viewer.scene;
    return this.size_ * Math.max(1, canvas.clientWidth / canvas.clientHeight);
  }

  /**
   * The heading of the corner after the nearest, by a sign.
   * @param {number} heading
   * @param {number} sign
   */
  cornerAfter_(heading, sign) {
    const quarter = CesiumMath.PI_OVER_TWO;
    return this.corner_ + (Math.round((heading - this.corner_) / quarter) + sign) * quarter;
  }

  /**
   * A point of the canvas, from a pointer event.
   * @param {MouseEvent} e
   */
  at_(e) {
    const rect = this.viewer.scene.canvas.getBoundingClientRect();
    return new Cartesian2(e.clientX - rect.left, e.clientY - rect.top);
  }

  /**
   * What is seen at a point of the canvas: the scene, else the globe, if shown.
   * @param {Cartesian2} point
   * @returns {Cartesian3 | undefined}
   */
  pick_(point) {
    const {scene} = this.viewer;
    const position = scene.pickPositionSupported ? scene.pickPosition(point) : undefined;
    const ray = position || !scene.globe?.show ? undefined : scene.camera.getPickRay(point);
    return position ?? (ray && scene.globe.pick(ray, scene));
  }

  /**
   * Where a point of the canvas meets the ground's plane through a position.
   * @param {Cartesian2} point
   * @param {Cartesian3} through
   * @returns {Cartesian3 | undefined}
   */
  ground_(point, through) {
    const {scene} = this.viewer;
    const normal = scene.ellipsoid.geodeticSurfaceNormal(through, normalScratch);
    const plane = Plane.fromPointNormal(through, normal, planeScratch);
    const ray = scene.camera.getPickRay(Cartesian2.clone(point, positionScratch));
    return ray && IntersectionTests.rayPlane(ray, plane, new Cartesian3());
  }

  /**
   * Slides the view so that a position of the ground is under a point of the canvas.
   * @param {Cartesian3} position
   * @param {Cartesian2} point
   */
  keep_(position, point) {
    const now = this.ground_(point, position);
    if (now) {
      Cartesian3.add(this.target_, Cartesian3.subtract(position, now, deltaScratch), this.target_);
      this.place_();
    }
  }

  /**
   * The target moved onto what is seen in the middle of the screen: the view does not change, being orthographic, but
   * it turns about the ground there.
   */
  anchor_() {
    const {canvas} = this.viewer.scene;
    const ground = this.pick_(new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
    if (ground) {
      this.target_ = ground;
      this.place_();
    }
  }

  /**
   * @param {PointerEvent} e
   */
  down_(e) {
    const canvas = this.viewer.scene.canvas;
    canvas.setPointerCapture(e.pointerId);
    this.settle_();
    this.pointers_.set(e.pointerId, this.at_(e));
    this.gliding_ = this.drift_ = this.drifted_ = undefined;
    this.snapshot_(e.timeStamp);
    this.drag_ = this.start_(e);
  }

  /**
   * What the pointers down do: one finger, the right button, or the left with Ctrl or Shift slide the view; the left
   * turns it; two fingers pinch, slide and twist it.
   * @param {PointerEvent} e
   */
  start_(e) {
    const points = [...this.pointers_.values()];
    if (points.length === 2) {
      const [a, b] = points;
      const middle = Cartesian2.lerp(a, b, 0.5, new Cartesian2());
      return {grab: this.ground_(middle, this.target_), distance: Cartesian2.distance(a, b), angle: Math.atan2(b.y - a.y, b.x - a.x), twist: 0};
    }
    const slide = e.pointerType === 'touch' || e.button === 2 || e.ctrlKey || e.shiftKey;
    const point = /** @type {{x: number, y: number}} */ (points[0]);
    return slide ? {grab: this.ground_(new Cartesian2(point.x, point.y), this.target_)} : {turn: true, last: point};
  }

  /**
   * @param {PointerEvent} e
   */
  move_(e) {
    if (!this.pointers_.has(e.pointerId) || !this.drag_) {
      return;
    }
    this.pointers_.set(e.pointerId, this.at_(e));
    const drag = this.drag_;
    const points = [...this.pointers_.values()];
    if (points.length === 2 && drag.distance !== undefined) {
      const [a, b] = /** @type {[Cartesian2, Cartesian2]} */ (points);
      const middle = Cartesian2.lerp(a, b, 0.5, new Cartesian2());
      const [distance, angle] = [Cartesian2.distance(a, b), Math.atan2(b.y - a.y, b.x - a.x)];
      this.size_ = CesiumMath.clamp(this.size_ * drag.distance / distance, this.minSize_, this.maxSize_);
      this.place_();
      if (drag.grab) {
        this.keep_(drag.grab, middle);
      }
      const turned = CesiumMath.negativePiToPi(angle - /** @type {number} */ (drag.angle));
      drag.twist = /** @type {number} */ (drag.twist) + turned;
      if (Math.abs(drag.twist) >= TWIST) {
        // the screen's y down: the fingers turning clockwise on it turn the ground clockwise under them
        this.heading_ -= turned;
        this.place_();
      }
      Object.assign(drag, {distance, angle});
      // no drift after a pinch
      this.snapshot_(e.timeStamp);
      return;
    } else if (drag.turn && drag.last) {
      const point = /** @type {{x: number, y: number}} */ (points[0]);
      this.heading_ -= CesiumMath.TWO_PI * (point.x - drag.last.x) / this.viewer.scene.canvas.clientHeight;
      drag.last = point;
      this.place_();
    } else if (drag.grab) {
      const point = /** @type {{x: number, y: number}} */ (points[0]);
      this.keep_(drag.grab, new Cartesian2(point.x, point.y));
    }
    this.track_(e.timeStamp);
  }

  /**
   * Where the view is, to measure its next move from.
   * @param {number} time
   */
  snapshot_(time) {
    this.moved_ = {time, heading: this.heading_, target: Cartesian3.clone(this.target_), turn: 0, slide: new Cartesian3()};
  }

  /**
   * How fast the view moves under the drag, smoothed over the last moves.
   * @param {number} time
   */
  track_(time) {
    const moved = this.moved_;
    const dt = moved ? time - moved.time : 0;
    if (!moved || dt <= 0) {
      return;
    }
    const slide = Cartesian3.divideByScalar(Cartesian3.subtract(this.target_, moved.target, deltaScratch), dt, deltaScratch);
    moved.turn = (moved.turn + (this.heading_ - moved.heading) / dt) / 2;
    Cartesian3.divideByScalar(Cartesian3.add(moved.slide, slide, moved.slide), 2, moved.slide);
    Object.assign(moved, {time, heading: this.heading_, target: Cartesian3.clone(this.target_, moved.target)});
  }

  /**
   * @param {PointerEvent} e
   */
  up_(e) {
    // a pointer pressed elsewhere (on a control over the canvas) and let go here was never the view's
    if (!this.pointers_.has(e.pointerId)) {
      return;
    }
    this.pointers_.delete(e.pointerId);
    // a finger lifted: the other slides on, from here
    this.drag_ = this.pointers_.size ? this.start_(e) : undefined;
    if (this.drag_) {
      this.snapshot_(e.timeStamp);
      return;
    }
    // let go while moving: the view drifts on, slowing down; else it turns about the ground in the middle
    const moved = this.moved_;
    this.moved_ = undefined;
    if (moved && e.timeStamp - moved.time < LET_GO && (moved.turn || Cartesian3.magnitude(moved.slide))) {
      this.drift_ = {turn: moved.turn, slide: moved.slide};
      this.animate_();
    } else {
      this.anchor_();
    }
  }

  /**
   * @param {WheelEvent} e
   */
  wheel_(e) {
    e.preventDefault();
    this.zoom(Math.pow(1.0015, e.deltaY * (e.deltaMode === 1 ? 33 : 1)), this.at_(e));
  }

  /**
   * @param {KeyboardEvent} e
   */
  keydown_(e) {
    const target = /** @type {Element | null} */ (e.target);
    if (target?.closest?.('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'q' || key === 'e') {
      this.turn(key === 'q' ? -1 : 1);
    } else if (key in PAN) {
      this.held_.add(key);
      e.preventDefault();
      this.animate_();
    }
  }

  /**
   * The keys held, the drift, the turn and the glide, a frame at a time, until they are done.
   */
  animate_() {
    if (this.frame_ !== undefined) {
      return;
    }
    const step = (/** @type {number} */ now) => {
      this.frame_ = undefined;
      if (!this.active_) {
        return;
      }
      if (this.held_.size) {
        const [x, y] = [...this.held_].reduce(([x, y], key) => [x + (PAN[key]?.[0] ?? 0), y + (PAN[key]?.[1] ?? 0)], [0, 0]);
        const width = this.width_();
        const meters = PAN_SPEED * width * Math.min(0.05, (now - (this.slid_ ?? now)) / 1000);
        const {canvas} = this.viewer.scene;
        const middle = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
        const length = Math.hypot(x, y);
        if (length) {
          // the ground in the middle kept under a point of the screen as far from it as the keys slide, the other way;
          // up the screen, the ground foreshortened by the pitch
          const pixels = meters / width * canvas.clientWidth;
          this.keep_(this.target_, new Cartesian2(middle.x - x / length * pixels, middle.y + y / length * pixels * Math.sin(this.pitch_)));
        }
      }
      this.slid_ = this.held_.size ? now : undefined;
      if (this.drift_) {
        const dt = Math.min(50, now - (this.drifted_ ?? now));
        this.heading_ += this.drift_.turn * dt;
        Cartesian3.add(this.target_, Cartesian3.multiplyByScalar(this.drift_.slide, dt, deltaScratch), this.target_);
        this.place_();
        const keep = DAMPING ** (dt * 60 / 1000);
        this.drift_.turn *= keep;
        Cartesian3.multiplyByScalar(this.drift_.slide, keep, this.drift_.slide);
        this.drifted_ = now;
        // stopped: under a pixel a second
        if (Math.abs(this.drift_.turn) < 1e-5 && Cartesian3.magnitude(this.drift_.slide) < this.width_() * 1e-6) {
          this.drift_ = this.drifted_ = undefined;
          this.anchor_();
        }
      }
      if (this.gliding_) {
        const t = Math.min(1, (now - this.gliding_.start) / GLIDE_TIME);
        Cartesian3.lerp(this.gliding_.from, this.gliding_.to, easeInOut(t), this.target_);
        this.place_();
        if (t === 1) {
          this.gliding_ = undefined;
        }
      }
      if (this.turning_) {
        const t = Math.min(1, (now - this.turning_.start) / TURN_TIME);
        this.heading_ = CesiumMath.lerp(this.turning_.from, this.turning_.to, easeInOut(t));
        this.place_();
        if (t === 1) {
          this.turning_ = undefined;
        }
      }
      if (this.held_.size || this.drift_ || this.gliding_ || this.turning_) {
        this.frame_ = requestAnimationFrame(step);
      }
    };
    this.frame_ = requestAnimationFrame(step);
  }
}
