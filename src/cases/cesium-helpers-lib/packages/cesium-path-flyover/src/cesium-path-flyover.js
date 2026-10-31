import {
  Cartesian3,
  Cartographic,
  CatmullRomSpline,
  Color,
  Event,
  GeometryInstance,
  Math as CesiumMath,
  Matrix4,
} from "@cesium/core";
import {
  EllipsoidTerrainProvider,
  GroundPolylineGeometry,
  GroundPolylinePrimitive,
  KeyboardEventModifier,
  Material,
  PointPrimitiveCollection,
  PolylineMaterialAppearance,
  SceneMode,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Transforms,
} from "@cesium/engine";
import FreeLook from "./free-look.js";
import {breathe, dampAngle, decimate, easedProgress, easedProgressInverse, fetchTrackText, forwardHeading, parseTrack, parseTrackName} from "./track.js";
import TerrainSampler from "./terrain.js";
import {SAMPLE_SPACING, cameraOffsetEnu, curvature, gaussianSmooth, planCamera, reliefProfile, sampleProfile, smoothPositions} from "./planner.js";
import {deriveRun} from "./run.js";
import Trail from "./shaders/Trail.js";

const MIN_POINT_DISTANCE = 10;
const MARKER_HEIGHT = 2;
const HEADING_SAMPLES = 8;
const EASE_SECONDS = 3;
const ANTICIPATION_SECONDS = 1;
const TARGET_SIGMA = 1.5; // samples; the look-at target is the track blurred over about 30 m
const CURVATURE_SIGMA = 5; // samples, 100 m
// net turning, degrees per metre after the 100 m smoothing, that doubles the range
// at bendZoom 1: a hairpin reaches it, a GPS zigzag on a straight stays near zero
const FULL_ZOOM_CURVATURE = 0.5;
const BREATH_HEADING = CesiumMath.toRadians(5); // at breathing 1
const BREATH_HEIGHT = 10; // meters, at breathing 1
const BREATH_ROLL = CesiumMath.toRadians(2); // at breathing 1
const FULL_BANK_RATE = CesiumMath.toRadians(30); // heading rate, per second, at which the bank is full
const BANK_SIGMA = 2; // samples; the planner's offsets step on a grid
// terrain level for every height sample, track and planner alike: within a metre
// of the most detailed level, an order of magnitude fewer tiles, and the same
// tiles for the track and for the planner's corridor around it
const SAMPLE_LEVEL = 16;
// beyond this length the planner's corridor is sampled a level coarser: 27% to
// 56% fewer tiles on a 377 km route, from the middle to the spectator style,
// with the same clearance and occlusions; on a short gorge the coarser mesh
// moves the lift by up to 50 m, and the track's own heights stay at SAMPLE_LEVEL
const LONG_TRACK = 50000; // meters
const LONG_TRACK_PLAN_LEVEL = 15;
const ACCENT = Color.fromCssColorString("#FF680A");
const TRAIL_WIDTH = 16; // pixels, the glow included
const MARKER_SIZE = 18; // pixels

const MODIFIERS = [KeyboardEventModifier.SHIFT, KeyboardEventModifier.CTRL, KeyboardEventModifier.ALT];
// none, each, and every combination of them
const MODIFIER_COMBINATIONS = Array.from({length: 2 ** MODIFIERS.length}, (_, bits) => {
  const held = MODIFIERS.filter((_, i) => bits & (1 << i));
  return held.length === 0 ? undefined : held.length === 1 ? held[0] : held;
});

const markerScratch = new Cartesian3();
const targetScratch = new Cartesian3();
const sampleScratches = Array.from({length: HEADING_SAMPLES + 1}, () => new Cartesian3());
const pairScratch = sampleScratches.slice(0, 2);
const offsetScratch = new Cartesian3();
const cameraScratch = new Cartesian3();
const plannedScratch = new Cartesian3();
const cartographicScratch = new Cartographic();
const enuScratch = new Matrix4();

/**
 * The look of the run: two dials, and overrides of any row they derive (see `Run`
 * and `RUN_TABLE` in run.js; `range` is a baseline, wider in bends above style 0.5).
 * Then the mechanics of the run.
 * @typedef {Object} Mechanics
 * @property {number} [style=0.5] 0 the pilot: low, close, tight, banking into turns; 1 the spectator: high, far, wide in bends, climbing over walls
 * @property {number} [motion=0.5] 0 rigid, locked on the path; 1 floating: slow to react, drifting in heading, height and roll
 * @property {number} [clearance=40] minimum camera height above terrain, meters
 * @property {number} [maxLift=250] meters the camera may climb to keep the marker in view; beyond it a brief occlusion is accepted (its own clearance above the terrain is never capped)
 * @property {number | false} [screenSpaceError=false] globe maximumScreenSpaceError while playing, restored on stop; false leaves it alone
 * @property {boolean} [freeLook=true] while playing, drag to look around the marker and wheel to zoom; the camera keeps following
 * @property {number | false} [recenterDelay=2] seconds after the last input before the view returns to the plan; false leaves it until recenter()
 */

/** @typedef {Mechanics & Partial<import('./run.js').Run>} Options */

/**
 * The camera path, sampled uniformly over the playback time. The camera looks at
 * `targets`, the marker path smoothed over a few samples so that the zigzags of a
 * track do not shake the camera, with the given heading.
 * @typedef {Object} Path
 * @property {Cartesian3[]} targets
 * @property {number[]} headings radians, with the terrain planner's offsets
 * @property {number[]} range meters, per sample: the run's range, wider in bends
 * @property {number[]} lift meters, per sample: the terrain planner's lift, the climb toward the surrounding relief and the breathing drift
 * @property {number[]} roll radians, per sample: the bank into the turns of the heading plus the breathing drift, positive leans right
 * @property {number[]} ground per spline point, its fraction of the track's length on the ground, where the trail measures it
 */

export default class CesiumPathFlyover {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {Options} [options]
   */
  constructor(viewer, options = {}) {
    this.viewer = viewer;
    this.run_ = deriveRun(options);
    this.pitch = CesiumMath.toRadians(this.run_.pitch);
    this.clearance = options.clearance ?? 40;
    this.maxLift = options.maxLift ?? 250;
    this.screenSpaceError = options.screenSpaceError ?? false;
    this.freeLook = options.freeLook ?? true;
    this.recenterDelay = options.recenterDelay ?? 2;
    /**
     * Free look while playing: the look, its input handler, and the camera
     * controller's inputs to restore.
     * @type {{look: FreeLook, handler: ScreenSpaceEventHandler, enableInputs: boolean} | undefined}
     */
    this.looking_ = undefined;
    /** @type {Event<(progress: number) => void>} raised with the progress, 0 to 1, whenever the camera is placed */
    this.progressChanged = new Event();

    /** @type {CatmullRomSpline | undefined} */
    this.spline_ = undefined;
    this.totalLength_ = 0;
    /** @type {string | undefined} */
    this.name_ = undefined;
    /** @type {number[] | undefined} the recorded time of each spline point, seconds since the epoch */
    this.times_ = undefined;
    /** @type {Path | undefined} */
    this.path_ = undefined;
    /** @type {object | undefined} the load under way */
    this.load_ = undefined;
    this.t_ = 0;
    // the wall clock at progress 0 of the current playback
    this.startTime_ = 0;
    /** @type {{promise: Promise<void>, resolve: (value: void) => void} | undefined} */
    this.play_ = undefined;
    /** @type {number | undefined} */
    this.savedScreenSpaceError_ = undefined;

    /** @type {GroundPolylinePrimitive | undefined} */
    this.track_ = undefined;
    /** @type {Material | undefined} the track's, its progress uniform follows the marker */
    this.trail_ = undefined;
    this.markers_ = new PointPrimitiveCollection();
    this.marker_ = this.markers_.add({
      pixelSize: MARKER_SIZE,
      color: ACCENT,
      outlineColor: Color.WHITE,
      outlineWidth: 2.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: false,
    });
    viewer.scene.primitives.add(this.markers_);
  }

  /**
   * Seconds for the whole run at the run's speed, the ease ramps included; 0 before a track is loaded.
   * @type {number}
   */
  get duration() {
    return this.totalLength_ > 0 ? this.totalLength_ / this.run_.speed + EASE_SECONDS : 0;
  }

  /**
   * @param {string} url GPX or GeoJSON
   */
  async load(url) {
    this.stop();
    // a load started later wins, whichever answers first
    const load = (this.load_ = {});
    const scene = this.viewer.scene;
    const text = await fetchTrackText(url);
    if (load !== this.load_) {
      return;
    }
    const coords = decimate(parseTrack(text), MIN_POINT_DISTANCE, scene.ellipsoid);
    if (coords.length < 2) {
      throw new Error(`A track needs at least two points more than ${MIN_POINT_DISTANCE} m apart`);
    }
    // the track drapes on the terrain, so it needs no heights and can show right away
    this.removeTrack_();
    this.track_ = scene.primitives.add(this.createTrack_(coords));
    scene.requestRender();

    // one sampler per load: tiles fetched for the track serve the targets and, on
    // a track up to LONG_TRACK, the planner too
    const sampler = new TerrainSampler(scene.terrainProvider, SAMPLE_LEVEL);
    const cartographics = coords.map(([lon, lat]) => Cartographic.fromDegrees(lon, lat));
    const terrain = await sampler.heightsAt(cartographics);
    if (load !== this.load_) {
      return;
    }
    const points = cartographics.map((c, i) =>
      Cartesian3.fromRadians(c.longitude, c.latitude, (terrain[i] ?? 0) + MARKER_HEIGHT, scene.ellipsoid)
    );
    const distances = [0];
    for (let i = 1; i < points.length; i++) {
      distances.push(distances[i - 1] + Cartesian3.distance(points[i - 1], points[i]));
    }
    this.totalLength_ = distances[distances.length - 1];
    this.spline_ = new CatmullRomSpline({
      points,
      times: distances.map((d) => d / this.totalLength_),
    });
    this.name_ = parseTrackName(text);
    this.times_ = coords.every((c) => c.length > 2) ? coords.map((c) => /** @type {number} */ (c[2])) : undefined;
    const planSampler = this.totalLength_ > LONG_TRACK ? new TerrainSampler(scene.terrainProvider, LONG_TRACK_PLAN_LEVEL) : sampler;
    const path = await this.computePath_(sampler, planSampler);
    if (load !== this.load_) {
      return;
    }
    this.path_ = path;
    this.t_ = 0;
    // a scrub during the load placed the split on the previous track's path
    if (this.trail_) {
      this.trail_.uniforms.progress = 0;
    }
    this.marker_.position = points[0];
    this.marker_.show = true;
    scene.requestRender();
  }

  /**
   * @param {import('./track.js').LonLat[]} coords
   * @return {GroundPolylinePrimitive}
   */
  createTrack_(coords) {
    const ellipsoid = this.viewer.scene.ellipsoid;
    this.trail_ = new Material({
      translucent: true,
      fabric: {uniforms: {color: ACCENT, progress: 0, width: TRAIL_WIDTH}, source: Trail},
    });
    return new GroundPolylinePrimitive({
      allowPicking: false,
      geometryInstances: new GeometryInstance({
        geometry: new GroundPolylineGeometry({
          positions: coords.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, 0, ellipsoid)),
          width: TRAIL_WIDTH,
        }),
      }),
      appearance: new PolylineMaterialAppearance({material: this.trail_}),
    });
  }

  /**
   * Tabulates the smoothed look-at target and the damped heading over the playback
   * time, then plans the terrain offsets and lifts on exactly that path.
   * @param {TerrainSampler} sampler for the targets
   * @param {TerrainSampler} [planSampler] for the planner's corridor, the targets' by default
   * @return {Promise<Path>}
   */
  async computePath_(sampler, planSampler = sampler) {
    const scene = this.viewer.scene;
    const spline = /** @type {CatmullRomSpline} */ (this.spline_);
    const count = Math.ceil(this.totalLength_ / SAMPLE_SPACING) + 1;
    const dt = this.duration / (count - 1);
    const ramp = EASE_SECONDS / this.duration;
    const run = this.run_;
    const panRate = CesiumMath.toRadians(run.panRate);
    const positions = [];
    /** @type {number[]} */
    const headings = [];
    /** @type {number[]} */
    const rise = [];
    const progresses = [];
    let heading = this.headingAt_(0, 0);
    for (let k = 0; k < count; k++) {
      const progress = easedProgress(k / (count - 1), ramp);
      progresses.push(progress);
      if (k > 0) {
        // damped, and never faster than the pan limit: the damping alone swings
        // through a hairpin at up to 75 degrees per second
        const damped = dampAngle(heading, this.headingAt_(progress, heading), dt, run.headingTau);
        heading += CesiumMath.clamp(CesiumMath.negativePiToPi(damped - heading), -panRate * dt, panRate * dt);
      }
      // the drift rides on the damped heading (its own rate stays under 3 degrees
      // per second at full amplitude) and the planner plans on the drifting one
      const breath = run.breathing * breathe(k * dt, this.totalLength_);
      positions.push(spline.evaluate(progress, new Cartesian3()));
      headings.push(heading + BREATH_HEADING * breath);
      rise.push(BREATH_HEIGHT * run.breathing * breathe(k * dt, this.totalLength_ + 100));
    }
    const range = this.rangeProfile_(progresses);
    const {targets, heights} = await this.smoothTargets_(positions, sampler);
    if (!(scene.terrainProvider instanceof EllipsoidTerrainProvider)) {
      const heightsAt = (/** @type {Cartographic[]} */ cartographics) => planSampler.heightsAt(cartographics);
      if (run.reliefRise > 0) {
        // a spectator sees over the ridges around the track; the camera keeps
        // looking at the target, so the rise only steepens the view
        const relief = await reliefProfile(targets, heights, range, scene.ellipsoid, heightsAt);
        relief.forEach((r, k) => {
          rise[k] += run.reliefRise * r;
        });
      }
      const plan = await planCamera(
        {positions: targets, headings, ranges: range, rise},
        {
          pitch: this.pitch,
          clearance: this.clearance,
          ahead: Math.ceil(ANTICIPATION_SECONDS / dt),
          maxTurn: panRate * dt,
          maxLift: this.maxLift,
          offsetCost: run.turnCost,
          ellipsoid: scene.ellipsoid,
        },
        heightsAt
      );
      plan.headingOffset.forEach((offset, k) => {
        headings[k] += offset;
        rise[k] += plan.lift[k];
      });
    }
    return {targets, headings, range, lift: rise, roll: this.rollProfile_(headings, dt), ground: this.groundFractions_()};
  }

  /**
   * Each spline point's fraction of the track's length on the ground: the marker
   * runs on the climbs too, the trail's length along the line is flat.
   * @return {number[]}
   */
  groundFractions_() {
    const ellipsoid = this.viewer.scene.ellipsoid;
    const flat = /** @type {CatmullRomSpline} */ (this.spline_).points.map((p) => ellipsoid.scaleToGeodeticSurface(p, new Cartesian3()));
    const distances = [0];
    for (let i = 1; i < flat.length; i++) {
      distances.push(distances[i - 1] + Cartesian3.distance(flat[i - 1], flat[i]));
    }
    const total = distances[distances.length - 1];
    return distances.map((d) => d / total);
  }

  /**
   * The bank into the turns of the heading, and the breathing drift on top.
   * @param {number[]} headings
   * @param {number} dt seconds between samples
   * @return {number[]}
   */
  rollProfile_(headings, dt) {
    const run = this.run_;
    const count = headings.length;
    const full = CesiumMath.toRadians(run.bank);
    const bank = headings.map((h, k) => {
      const rate = CesiumMath.negativePiToPi(headings[Math.min(k + 1, count - 1)] - h) / dt;
      return full * CesiumMath.clamp(rate / FULL_BANK_RATE, -1, 1);
    });
    return gaussianSmooth(bank, BANK_SIGMA).map((b, k) => b + BREATH_ROLL * run.breathing * breathe(k * dt, this.totalLength_ + 200));
  }

  /**
   * The run's range, widened where the track curls so a bend reads as a shape:
   * up to twice at full bendZoom on a bend of FULL_ZOOM_CURVATURE or tighter. The
   * curl is the track's own, measured on a uniform grid along its length: the
   * camera heading has the look-ahead window's smoothing in it already, and the
   * time-sampled path has steps too short to carry a direction in the speed ramps.
   * @param {number[]} progresses progress of each time sample, one per grid step
   * @return {number[]}
   */
  rangeProfile_(progresses) {
    const run = this.run_;
    const spline = /** @type {CatmullRomSpline} */ (this.spline_);
    const count = progresses.length;
    const half = Math.min(SAMPLE_SPACING / 2 / this.totalLength_, 0.5);
    /** @type {number[]} */
    const directions = [];
    for (let j = 0; j < count; j++) {
      const s = j / (count - 1);
      spline.evaluate(Math.max(s - half, 0), pairScratch[0]);
      spline.evaluate(Math.min(s + half, 1), pairScratch[1]);
      directions.push(forwardHeading(pairScratch, directions[j - 1] ?? 0));
    }
    // smooth the signed turning first: the zigzags of a GPS track cancel out
    // instead of adding up, which read as a bend on every straight; then the
    // factor again: what a zigzag leaves after the abs (a fifth of the zoom on a
    // straight of the fixtures) thins out under the threshold, and the range
    // changes by less between samples
    const bends = gaussianSmooth(curvature(directions, SAMPLE_SPACING), CURVATURE_SIGMA).map(Math.abs);
    const factor = gaussianSmooth(
      bends.map((c) => 1 + run.bendZoom * Math.min(c / FULL_ZOOM_CURVATURE, 1)),
      CURVATURE_SIGMA
    );
    return progresses.map((p) => run.range * sampleProfile(factor, p));
  }

  /**
   * The marker path blurred over TARGET_SIGMA samples. The blur cuts the corners
   * of bends, into a slope by up to 16 m on the alpine fixtures, so the heights
   * are raised to the marker's height above the ground there and blurred again:
   * the raise alone would put the kinks back that the blur removed.
   * @param {Cartesian3[]} positions
   * @param {TerrainSampler} sampler
   * @return {Promise<{targets: Cartesian3[], heights: number[]}>} with the targets' heights above the ellipsoid
   */
  async smoothTargets_(positions, sampler) {
    const scene = this.viewer.scene;
    const targets = smoothPositions(positions, TARGET_SIGMA);
    const cartographics = targets.map((p) => Cartographic.fromCartesian(p, scene.ellipsoid));
    const terrain = await sampler.heightsAt(cartographics);
    const raised = cartographics.map((c, i) => Math.max(c.height, (terrain[i] ?? -Infinity) + MARKER_HEIGHT));
    const heights = gaussianSmooth(raised, TARGET_SIGMA);
    return {targets: cartographics.map((c, i) => Cartesian3.fromRadians(c.longitude, c.latitude, heights[i], scene.ellipsoid)), heights};
  }

  /**
   * @return {Promise<void>} resolves when the end of the track is reached
   */
  play() {
    if (this.play_) {
      return this.play_.promise;
    }
    if (!this.path_) {
      throw new Error("Call load() before play()");
    }
    if (this.t_ >= 1) {
      this.t_ = 0;
    }
    this.startTime_ = this.now_() - this.t_ * this.duration;
    this.play_ = Promise.withResolvers();
    this.viewer.scene.preUpdate.addEventListener(this.update_, this);
    // fewer, coarser tiles keep terrain streaming up with a fast camera
    const globe = this.viewer.scene.globe;
    if (globe && this.screenSpaceError !== false) {
      this.savedScreenSpaceError_ = globe.maximumScreenSpaceError;
      globe.maximumScreenSpaceError = this.screenSpaceError;
    }
    if (this.freeLook) {
      this.installFreeLook_();
    }
    return this.play_.promise;
  }

  stop() {
    this.viewer.scene.preUpdate.removeEventListener(this.update_, this);
    if (this.savedScreenSpaceError_ !== undefined) {
      this.viewer.scene.globe.maximumScreenSpaceError = this.savedScreenSpaceError_;
      this.savedScreenSpaceError_ = undefined;
    }
    this.removeFreeLook_();
    this.play_?.resolve();
    this.play_ = undefined;
  }

  /**
   * Position along the run, 0 to 1. Setting it jumps there: while playing, playback
   * goes on from the new position; while stopped, the camera and marker are placed
   * at once.
   * @return {number}
   */
  get progress() {
    return this.t_;
  }

  set progress(value) {
    this.t_ = CesiumMath.clamp(value, 0, 1);
    if (this.play_) {
      this.startTime_ = this.now_() - this.t_ * this.duration;
    } else if (this.path_) {
      this.placeFrame_();
    }
  }

  /**
   * Position of the marker, undefined before a track is loaded.
   * @return {Cartesian3 | undefined}
   */
  get position() {
    return this.marker_.show ? this.marker_.position : undefined;
  }

  /**
   * Positions of the marker along the track, one per track point kept, at the marker's
   * height above the terrain; undefined before a track is loaded. Not to be modified.
   * @return {Cartesian3[] | undefined}
   */
  get points() {
    return this.spline_?.points;
  }

  /**
   * Name of the track, undefined before a track is loaded or when the file has none.
   * @return {string | undefined}
   */
  get name() {
    return this.name_;
  }

  /**
   * Recorded time of each of the points, seconds since the epoch; undefined before a
   * track is loaded or when a point has no time. Not to be modified.
   * @return {number[] | undefined}
   */
  get times() {
    return this.times_;
  }

  /**
   * Distance of the marker along the track in meters, undefined before a track is loaded.
   * Setting it moves the run there, as setting the progress does.
   * @return {number | undefined}
   */
  get distance() {
    return this.spline_ ? easedProgress(this.t_, EASE_SECONDS / this.duration) * this.totalLength_ : undefined;
  }

  /**
   * @param {number} value
   */
  set distance(value) {
    if (this.spline_) {
      this.progress = easedProgressInverse(value / this.totalLength_, EASE_SECONDS / this.duration);
    }
  }

  /**
   * Starts the return of the view to the planned camera.
   */
  recenter() {
    this.looking_?.look.recenter(this.now_());
  }

  /**
   * @return {{heading: number, pitch: number, zoom: number}} the viewer's offsets: radians, radians, range factor
   */
  get view() {
    const view = this.looking_?.look.view;
    return view ? {heading: view.headingDelta, pitch: view.pitchDelta, zoom: view.zoom} : {heading: 0, pitch: 0, zoom: 1};
  }

  /** @return {number} seconds; a seam for the tests */
  now_() {
    return performance.now() / 1000;
  }

  /**
   * @param {HTMLCanvasElement} canvas
   * @return {ScreenSpaceEventHandler} a seam for the tests
   */
  createInputHandler_(canvas) {
    return new ScreenSpaceEventHandler(canvas);
  }

  installFreeLook_() {
    const scene = this.viewer.scene;
    const look = new FreeLook({pitch: this.pitch, recenterDelay: this.recenterDelay});
    const handler = this.createInputHandler_(scene.canvas);
    this.looking_ = {look, handler, enableInputs: scene.screenSpaceCameraController.enableInputs};
    scene.screenSpaceCameraController.enableInputs = false;
    // no render requests here: the frame loop renders every frame while playing. The
    // handler sends an event to the action registered with the modifier keys held,
    // and to it alone, so the drag listens under every combination: a button
    // released with Shift, or Shift and Ctrl, down must still end it
    const dragStart = () => look.dragStart(this.now_());
    const drag = (/** @type {{startPosition: {x: number, y: number}, endPosition: {x: number, y: number}}} */ movement) =>
      look.drag(movement.endPosition.x - movement.startPosition.x, movement.endPosition.y - movement.startPosition.y, this.now_());
    const dragEnd = () => look.dragEnd(this.now_());
    for (const modifier of MODIFIER_COMBINATIONS) {
      handler.setInputAction(dragStart, ScreenSpaceEventType.LEFT_DOWN, modifier);
      handler.setInputAction(drag, ScreenSpaceEventType.MOUSE_MOVE, modifier);
      handler.setInputAction(dragEnd, ScreenSpaceEventType.LEFT_UP, modifier);
    }
    handler.setInputAction((/** @type {number} */ delta) => look.wheel(delta, this.now_()), ScreenSpaceEventType.WHEEL);
    // the runtime passes {distance: {startPosition, endPosition}} with the finger
    // distances in y (the typings describe another shape); fingers moving apart zoom in
    handler.setInputAction(
      (/** @type {any} */ movement) => look.zoomBy(movement.distance.startPosition.y / movement.distance.endPosition.y, this.now_()),
      ScreenSpaceEventType.PINCH_MOVE
    );
  }

  removeFreeLook_() {
    if (this.looking_) {
      this.looking_.handler.destroy();
      this.viewer.scene.screenSpaceCameraController.enableInputs = this.looking_.enableInputs;
      this.looking_ = undefined;
    }
  }

  destroy() {
    this.stop();
    this.removeTrack_();
    this.viewer.scene.primitives.remove(this.markers_);
  }

  removeTrack_() {
    if (this.track_) {
      this.viewer.scene.primitives.remove(this.track_);
      this.track_ = undefined;
    }
  }

  /**
   * Path heading at a progress value, from the weighted tangents over a lookAhead
   * meters window starting at the marker. Near the end the window slides back so it
   * keeps its full length: the heading settles on the track's final stretch instead
   * of jittering on a collapsing window.
   * @param {number} progress
   * @param {number} previous heading returned when the tangents vanish
   * @return {number}
   */
  headingAt_(progress, previous) {
    const spline = /** @type {CatmullRomSpline} */ (this.spline_);
    const window = Math.min(this.run_.lookAhead / this.totalLength_, 1);
    const start = Math.min(progress, 1 - window);
    for (let k = 0; k <= HEADING_SAMPLES; k++) {
      spline.evaluate(start + (k * window) / HEADING_SAMPLES, sampleScratches[k]);
    }
    return forwardHeading(sampleScratches, previous);
  }

  update_() {
    if (this.viewer.scene.mode === SceneMode.MORPHING) {
      return;
    }
    this.t_ = Math.min((this.now_() - this.startTime_) / this.duration, 1);
    this.placeFrame_();
    if (this.t_ >= 1) {
      this.stop();
    }
  }

  /**
   * How far a camera at `offset` in the `enu` frame sits below the clearance over
   * the terrain the loaded tiles know about; 0 when clear or unknown.
   * @param {Matrix4} enu
   * @param {Cartesian3} offset
   * @return {number} meters
   */
  shortfall_(enu, offset) {
    const scene = this.viewer.scene;
    const cartographic = Cartographic.fromCartesian(Matrix4.multiplyByPoint(enu, offset, cameraScratch), scene.ellipsoid, cartographicScratch);
    const ground = scene.globe?.getHeight(cartographic);
    return ground === undefined ? 0 : Math.max(0, ground + this.clearance - cartographic.height);
  }

  /**
   * Places the marker and the camera for the current progress.
   */
  placeFrame_() {
    const scene = this.viewer.scene;
    const spline = /** @type {CatmullRomSpline} */ (this.spline_);
    const path = /** @type {Path} */ (this.path_);
    const along = easedProgress(this.t_, EASE_SECONDS / this.duration);
    this.marker_.position = spline.evaluate(along, markerScratch);
    if (this.trail_) {
      const i0 = spline.findTimeInterval(along);
      const times = spline.times;
      this.trail_.uniforms.progress = CesiumMath.lerp(path.ground[i0], path.ground[i0 + 1], (along - times[i0]) / (times[i0 + 1] - times[i0]));
    }

    const index = this.t_ * (path.targets.length - 1);
    const i = Math.min(Math.floor(index), path.targets.length - 1);
    const target = Cartesian3.lerp(path.targets[i], path.targets[Math.min(i + 1, path.targets.length - 1)], index - i, targetScratch);
    const heading = sampleProfile(path.headings, this.t_);
    const range = sampleProfile(path.range, this.t_);
    const lift = sampleProfile(path.lift, this.t_);
    const planned = cameraOffsetEnu(heading, range, this.pitch, lift, plannedScratch);
    let offset = planned;
    const look = this.looking_?.look;
    if (look) {
      const view = look.update(this.now_());
      if (look.active) {
        offset = cameraOffsetEnu(heading + view.headingDelta, range * view.zoom, this.pitch + view.pitchDelta, lift, offsetScratch);
        // the plan cleared the planned camera, not one the viewer swung aside: lift
        // this one by what it lacks beyond what the planned one lacks against the
        // loaded tiles, so the lift is zero at zero offsets and never jumps
        // @ts-expect-error Transforms.eastNorthUpToFixedFrame is missing from the @cesium/engine 26.4.0 typings
        const enu = Transforms.eastNorthUpToFixedFrame(target, scene.ellipsoid, enuScratch);
        offset.z += Math.max(0, this.shortfall_(enu, offset) - this.shortfall_(enu, planned));
      }
    }
    scene.camera.lookAt(target, offset);
    scene.camera.lookAtTransform(Matrix4.IDENTITY);
    // lookAt levels the horizon, so the twist is the whole roll
    scene.camera.twistRight(sampleProfile(path.roll, this.t_));
    scene.requestRender();
    this.progressChanged.raiseEvent(this.t_);
  }
}
