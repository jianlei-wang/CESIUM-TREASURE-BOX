// An HTML layer over a CesiumJS scene, one a widget, shared by whoever draws over it, and pins: elements kept on a point of the
// world as the camera moves. The layer is in the canvas's parent, over the canvas's box and clipped to it, its pixels the canvas's;
// it takes no pointer, its content may (pointer-events: auto). It lives as long as the widget, which takes it away with its own
// element. The pins are under what else is drawn in the layer (a tool's line, its label), the nearest of them on top.
//
// A pin is an anchor moved to its point's place on every render, the size of the layer, laid out as a flex row from its corner:
// the element in it keeps its own width, in flow or positioned (its containing block the layer's size, not nothing), and its
// own transform, to stand above the point or to pop up. Hidden while its point is behind the camera or the globe's horizon, or,
// asked, behind what the scene shows in front of it.
//
// A line is a few points of the world joined, an SVG path under the pins redrawn on every render: cut where it passes behind the
// camera, and, asked, split into what is seen and what the scene or a test of the caller's hides (two paths, styled apart).

import {Cartesian2, Cartesian3, EllipsoidalOccluder, Matrix4, Plane} from '@cesium/core';
import {SceneMode, SceneTransforms} from '@cesium/engine';
import {alongSegment, clipPolygon, gapsOf, insideRange, pathOf, polylinesOf, runsAlong, samePoints, windowProjection} from './overlay-lines.js';

/**
 * Where a pin stands: a point, a function read on every render (a thing that moves), or none (hidden).
 * @typedef {Cartesian3 | (() => Cartesian3 | undefined) | undefined} Position
 */
/**
 * @typedef {object} PinOptions
 * @property {[number, number]} [offset] In pixels, right and down, from the point's place.
 * @property {boolean | 'depth'} [occlude] Hidden behind the globe's horizon (true, by default), also behind what the scene shows
 *     in front of the point ('depth': a read of the depth buffer a render, a perspective view's), or never (false).
 * @property {boolean} [live] A position read as it changes, the scene rendered on every frame while the pin is: for a point that
 *     moves by itself in a scene that renders on request (requestRenderMode).
 */
/**
 * @typedef {object} Pin
 * @property {HTMLElement} element The element pinned.
 * @property {HTMLDivElement} anchor What holds it, moved to the point's place.
 * @property {(position: Position) => void} move
 * @property {boolean} hidden Hidden whatever its position, which it keeps: for a pin shown now and then on the same point.
 * @property {() => void} remove The pin taken away, its element put back where it was, if it was somewhere.
 */
/**
 * A line's points: a few, joined in order, or several such polylines, apart (a list of lists); or a function giving them, read on
 * every render.
 * @typedef {Cartesian3[] | Cartesian3[][] | (() => Cartesian3[] | Cartesian3[][])} Points
 */
/**
 * @typedef {object} LineOptions
 * @property {boolean} [closed] The last point joined to the first.
 * @property {false | 'depth' | ((point: Cartesian3, windowPosition: Cartesian2) => boolean)} [occlude] Never hidden (false, by
 *     default); hidden where the scene shows something in front of it ('depth': reads of the depth buffer, a perspective view's);
 *     or where a test of the caller's says so (a function: true for hidden).
 * @property {number} [step] In pixels, how far apart along the line it is tested: 24 by default.
 * @property {string} [className] Classes of its paths, besides `cesium-overlay-seen` and `cesium-overlay-hidden`: the hidden path's
 *     only one besides its own.
 * @property {string[]} [strokes] A seen path for each, of that class too, all of the same path: a halo, an edge and a core. One by
 *     default; the hidden path is one, of none of them.
 * @property {boolean} [fill] A closed line of three points or more filled too, under its lines: what of it is in view, never
 *     hidden.
 */
/**
 * @typedef {object} Line
 * @property {SVGGElement} element What holds its paths: it may be moved into a tool's own `<svg>` (its paths then need `fill: none`).
 * @property {(points: Points) => void} move Other points: drawn again, and a render asked for, if they differ.
 * @property {boolean} hidden Not drawn, its points kept.
 * @property {() => void} remove
 */
/**
 * @typedef {object} Overlay
 * @property {HTMLDivElement} element The layer over the canvas: what is appended to it is drawn over the pins.
 * @property {(element: HTMLElement, position?: Position, options?: PinOptions) => Pin} pin
 * @property {(points: Points, options?: LineOptions) => Line} line
 */

// in the layer, scoped to it, and in a cascade layer: a page's rule wins whatever its specificity
const STYLE = `
@layer cesium-overlay {
  @scope {
    :scope {
      position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 5;
      /* what changes in it (a path, a pin's place) lays out and paints nothing of the page outside it */
      contain: strict;
      /* the tools' palette, theirs to read (--overlay-*), a page's to set (--cesium-overlay-*) */
      --overlay-core: var(--cesium-overlay-core, #fffaf3);
      --overlay-edge: var(--cesium-overlay-edge, #2b1d10);
      --overlay-glow: var(--cesium-overlay-glow, #ff9a3c);
      --overlay-label-background: var(--cesium-overlay-label-background, color-mix(in srgb, var(--overlay-core) 93%, transparent));
      --overlay-label-color: var(--cesium-overlay-label-color, var(--overlay-edge));
      --overlay-hint-background: var(--cesium-overlay-hint-background, #333e);
      --overlay-hint-color: var(--cesium-overlay-hint-color, #fff);
      --overlay-font: var(--cesium-overlay-font, 12px/1.3 system-ui, sans-serif);
    }
    .cesium-overlay-pins { position: absolute; inset: 0; isolation: isolate; }
    .cesium-overlay-pin { position: absolute; inset: 0; display: flex; align-items: flex-start; }
    /* the lines, under the pins: a seen path in the palette's core, a hidden one faint and dashed */
    .cesium-overlay-lines { position: absolute; inset: 0; width: 100%; height: 100%; }
    .cesium-overlay-seen, .cesium-overlay-hidden { fill: none; stroke: var(--overlay-core); stroke-width: 1.5; stroke-linecap: round; }
    .cesium-overlay-hidden { stroke-width: 1; stroke-dasharray: 3 4; stroke-opacity: .6; }
    .cesium-overlay-fill { fill: var(--overlay-core); fill-opacity: .15; stroke: none; }
    /* important: a layer's normal rule loses to any of a page's, its display among them */
    [hidden] { display: none !important; }
    /* the palette's two pills, for a page's pins: a value (a length, a depth) and a hint (what to do) */
    .cesium-overlay-label, .cesium-overlay-hint { padding: 3px 8px; border-radius: 8px; white-space: nowrap; font: var(--overlay-font); }
    .cesium-overlay-label { background: var(--overlay-label-background); color: var(--overlay-label-color); box-shadow: 0 1px 6px #0003; }
    .cesium-overlay-hint { background: var(--overlay-hint-background); color: var(--overlay-hint-color); }
  }
}
`;
// in meters: how much nearer than a pin's point what the scene shows there may be, still taken for the pinned thing itself
const DEPTH_TOLERANCE = 0.5;
// for a line, also this many pixels' worth of meters at its distance: a line on a surface is not hidden by it
const DEPTH_PIXELS = 2;
// in meters: a line is cut this far beyond twice the camera's near distance, where Cesium's projection still holds (its clip z
// turns negative under 2 near far / (near + far))
const NEAR_MARGIN = 1;
// in pixels: where a line changes from seen to hidden is found to about this
const LINE_PRECISION = 2;
// in milliseconds: how long a task spends on reads of the depth buffer, between renders, once the GPU has drawn the frame (a read
// before waits for it: 32 ms right after a render of the K2O page, 0.1 to 0.4 ms after), where the browser does not say how long it
// is idle; the first test of a task always finishes, so that each task gets on, and what is left goes to the next task
const TASK_BUDGET = 8;
// in milliseconds: how long the reads wait for the browser to be idle before they run all the same (a page never idle)
const IDLE_WAIT = 100;
// without a WebGL 2 context's fence to tell when the frame is drawn, how long to wait for it
const FRAME_WAIT = 50;
// a first, coarse pass tests this many times `step` apart, halved to `step`: a split shown soon, then found to LINE_PRECISION
const COARSE = 4;
// how much a view may change and still be the same, in its matrix's entries
const VIEW_EPSILON = 1e-6;
// how many renders of the same view a test waits for the GPU to draw, before reading through those that follow
const REWAITS = 2;
// thrown by a test out of time: its segment keeps the split it had
const OUT_OF_TIME = Symbol('out of time');
const SVG = 'http://www.w3.org/2000/svg';

// the scene's overlay kept on the scene, by a key every copy of this module shares: two copies bundled find the same layer
const KEY = Symbol.for('@geoblocks/cesium-overlay');

/**
 * The scene's overlay: made by the first to ask, the same for the others.
 * @param {import('@cesium/engine').Scene | {scene: import('@cesium/engine').Scene}} target A scene, or a Viewer or CesiumWidget.
 * @return {Overlay}
 */
export function overlayOf(target) {
  const scene = 'scene' in target ? target.scene : target;
  // the scene seen as a holder of the key: Cesium's types know nothing of it
  const holder = /** @type {{[KEY]?: Overlay}} */ (/** @type {unknown} */ (scene));
  const known = holder[KEY];
  if (known) {
    return known;
  }
  const {canvas, camera} = scene;
  const doc = canvas.ownerDocument;
  // the layer is placed in its parent's box: a parent left static (Cesium's stylesheet not loaded) made relative
  const parent = canvas.parentElement ?? doc.body;
  if (getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }
  const element = doc.createElement('div');
  element.className = 'cesium-overlay';
  const style = doc.createElement('style');
  style.textContent = STYLE;
  const layer = doc.createElement('div');
  layer.className = 'cesium-overlay-pins';
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'cesium-overlay-lines');
  element.append(svg, layer, style);
  parent.append(element);
  /** @type {Set<{anchor: HTMLDivElement, at: () => Cartesian3 | undefined, hidden: boolean, offset: [number, number], occlude: boolean | 'depth', live: boolean, shown: string}>} */
  const pins = new Set();
  /** @typedef {{seen: SVGPathElement[], hidden: SVGPathElement, fill: SVGPathElement | null, at: () => Cartesian3[] | Cartesian3[][], closed: boolean, occlude: LineOptions['occlude'],
   *   step: number, off: boolean, runs: {a: Cartesian3, b: Cartesian3, runs: [number, number, boolean][], view: number, pass: number,
   *   samples: Map<number, boolean>}[]}} Drawn */
  /** @typedef {{until: number, tested: boolean, pass: number}} Budget */
  /** @type {Set<Drawn>} */
  const lines = new Set();
  const occluder = new EllipsoidalOccluder(scene.ellipsoid);
  const picked = new Cartesian3();
  const fromEye = new Cartesian3();
  const pixel = new Cartesian2();
  // the view, counted: a line's split is found again once it has changed
  let view = 0;
  const lastView = new Matrix4();
  /** A point's depth in front of the camera, along its direction. @param {Cartesian3} point */
  const depthOf = point => Cartesian3.dot(Cartesian3.subtract(point, camera.positionWC, fromEye), camera.directionWC);
  /** @type {((point: Cartesian3) => number)[]} */
  let inside = [];
  /** A point's place on the canvas, in this view. @type {(point: Cartesian3) => Cartesian2 | undefined} */
  let toWindow = point => SceneTransforms.worldToWindowCoordinates(scene, point);
  // how far a point is inside the view: in front of where the projection holds, and within the frustum's sides (its planes 0 to 3;
  // 4 is its near plane, replaced here, 5 its far one, past what is drawn). Cesium's IntersectionTests cut at one plane; a
  // segment's part inside several is the overlap of their ranges (insideRange)
  const updateInside = () => {
    const {planes} = camera.frustum.computeCullingVolume(camera.positionWC, camera.directionWC, camera.upWC);
    // copies: the culling volume's planes are rewritten by the next one computed (a read of the depth buffer computes one)
    const sides = planes.slice(0, 4).map(each => Plane.fromCartesian4(each, new Plane(Cartesian3.UNIT_X, 0)))
      .map(side => (/** @type {Cartesian3} */ point) => Plane.getPointDistance(side, point));
    inside = [point => depthOf(point) - 2 * camera.frustum.near - NEAR_MARGIN, ...sides];
    // the view's matrices taken once for all the lines' points; Cesium's own call for a 2D or Columbus view, which a matrix does not
    // cover (its map wraps)
    toWindow = scene.mode === SceneMode.SCENE3D
      ? windowProjection(camera.viewMatrix, camera.frustum.projectionMatrix, canvas.clientWidth, canvas.clientHeight)
      : point => SceneTransforms.worldToWindowCoordinates(scene, point);
  };
  /** Whether the scene shows something in front of a point, at its place on the canvas. @param {Cartesian3} point @param {Cartesian2} at */
  const behindDepth = (point, at) => {
    if (!scene.pickPositionSupported) {
      return false;
    }
    const front = scene.pickPosition(at, picked);
    if (!front) {
      return false;
    }
    const depth = depthOf(point);
    // a drawing buffer's pixel (the ratio 1): the tolerance needs no more than its order
    const size = camera.frustum.getPixelDimensions(scene.drawingBufferWidth, scene.drawingBufferHeight, depth, 1, pixel);
    return depthOf(front) < depth - DEPTH_TOLERANCE - DEPTH_PIXELS * Math.max(size.x, size.y);
  };
  // each path's shape as last set, kept here: a long one read back from the DOM to compare costs as much as setting it
  /** @type {WeakMap<SVGPathElement, string>} */
  const drawnPaths = new WeakMap();
  /** A path's shape, set only if it changed: no paint between the tasks' reads for nothing. @param {SVGPathElement} path @param {string} d */
  const setPath = (path, d) => {
    if (drawnPaths.get(path) !== d) {
      drawnPaths.set(path, d);
      path.setAttribute('d', d);
    }
  };
  /**
   * A line's paths: each segment's part in view, split into runs. A segment is tested again when the view or the segment has changed
   * since its last test: a caller's test always, the depth buffer's within a task's time; else the runs found last are kept, and
   * a new segment is seen.
   * @param {Drawn} line @param {Budget} budget How long a task may read the depth buffer, counted from the end of its first test
   *     (which may wait for the GPU, and always finishes), and whether one has finished (in a render: tested, 0 ms, never read);
   *     the pass, 0 coarse, 1 fine (a split found by a coarse pass is tested again by a fine one).
   * @return {boolean} Whether a segment was left untested for want of time.
   */
  const draw = (line, budget) => {
    const late = () => budget.tested && performance.now() > budget.until;
    const polylines = polylinesOf(line.off ? [] : line.at());
    const paths = {seen: '', hidden: ''};
    const {occlude, step} = line;
    const perspective = 'fov' in camera.frustum;
    let left = false;
    // a segment's place among all the line's, its runs kept by it
    let index = 0;
    for (const points of polylines) {
      const closed = line.closed && points.length > 2;
      /** @type {{seen: [Cartesian2, Cartesian2][], hidden: [Cartesian2, Cartesian2][]}} */
      const pieces = {seen: [], hidden: []};
      // the last segment's test at its end, the next one's start: a corner read once, not once for each of its two segments
      /** @type {{point: Cartesian3, hidden: boolean} | undefined} */
      let corner;
      (closed ? points : points.slice(0, -1)).forEach((a, j) => {
        const k = index++;
        const before = corner;
        corner = undefined;
        const b = points[(j + 1) % points.length];
        const range = insideRange(a, b, inside);
        /** @param {number} u */
        const along = u => Cartesian3.lerp(a, b, u, new Cartesian3());
        const ends = range?.map(u => toWindow(along(u)));
        if (!range || !ends?.[0] || !ends[1]) {
          return;
        }
        const [near, far] = range;
        const kept = line.runs[k];
        const same = kept && Cartesian3.equals(kept.a, a) && Cartesian3.equals(kept.b, b);
        /** @type {[number, number, boolean][]} */
        let runs = same ? kept.runs : [[0, 1, false]];
        const stale = !same || kept.view !== view || kept.pass < budget.pass;
        const testing = occlude && stale && (typeof occlude === 'function' || !late());
        left ||= Boolean(occlude && stale && !testing);
        if (occlude && testing) try {
          // places even on the screen between the part's two ends, as places along the whole segment
          const [depthA, depthB] = perspective ? [depthOf(along(near)), depthOf(along(far))] : [1, 1];
          /** @param {number} s */
          const at = s => near + alongSegment(s, depthA, depthB) * (far - near);
          const length = Cartesian2.distance(ends[0], ends[1]);
          // a caller's test, cheap, fine at once
          const pass = typeof occlude === 'function' ? 1 : budget.pass;
          // the coarse pass's samples among the fine pass's, kept, not read again; a segment shorter than `step` tested at its ends alone
          const {coarse, fine} = gapsOf(length, step, COARSE);
          /** @type {Map<number, boolean>} */
          const samples = new Map();
          const known = same && kept.view === view ? kept.samples : undefined;
          /** Whether the line is hidden at a place of its part in view, on the screen. @param {number} s */
          const hiddenAt = s => {
            const index = Math.round(s * fine);
            const onGrid = Math.abs(s * fine - index) < 1e-9;
            const seen = onGrid ? known?.get(index) ?? (index === 0 && near === 0 && before && Cartesian3.equals(before.point, a) ? before.hidden : undefined)
              : undefined;
            if (seen !== undefined) {
              samples.set(index, seen);
              return seen;
            }
            const hidden = test(s);
            if (onGrid) {
              samples.set(index, hidden);
            }
            return hidden;
          };
          /** @param {number} s */
          const test = s => {
            const point = along(at(s));
            const place = toWindow(point);
            if (occlude === 'depth' && late()) {
              throw OUT_OF_TIME;
            }
            return Boolean(place) && (occlude === 'depth' ? behindDepth(point, /** @type {Cartesian2} */ (place)) : occlude(point, /** @type {Cartesian2} */ (place)));
          };
          // a caller's test: every `step` pixels, two tests for a segment shorter than that (an outline of many points)
          const gaps = typeof occlude === 'function' ? Math.max(1, Math.ceil(length / step)) : pass === 0 ? coarse : fine;
          const found = runsAlong(hiddenAt, gaps, pass === 0 && occlude === 'depth' ? Math.ceil(Math.log2(COARSE))
            : Math.max(0, Math.ceil(Math.log2(length / gaps / LINE_PRECISION))));
          // along the whole segment: what is out of view, untested, seen
          runs = [[0, near, false], ...found.map(([from, to, hidden]) => /** @type {[number, number, boolean]} */ ([at(from), at(to), hidden])), [far, 1, false]];
          line.runs[k] = {a: Cartesian3.clone(a), b: Cartesian3.clone(b), runs, view, pass, samples};
          const last = samples.get(fine);
          corner = far === 1 && last !== undefined ? {point: b, hidden: last} : undefined;
          if (!budget.tested && occlude === 'depth') {
            budget.tested = true;
            budget.until = performance.now() + budget.until;
          }
        } catch (error) {
          if (error !== OUT_OF_TIME) {
            throw error;
          }
          left = true;
        }
        for (const [from, to, hidden] of runs) {
          const [start, end] = [Math.max(from, near), Math.min(to, far)];
          if (start >= end) {
            continue;
          }
          const [p, q] = [start, end].map(u => (u === near ? ends[0] : u === far ? ends[1] : toWindow(along(u))));
          if (p && q) {
            pieces[hidden ? 'hidden' : 'seen'].push([p, q]);
          }
        }
      });
      paths.seen += pathOf(pieces.seen, closed);
      paths.hidden += pathOf(pieces.hidden, closed);
    }
    line.seen.forEach(path => setPath(path, paths.seen));
    setPath(line.hidden, paths.hidden);
    if (line.fill) {
      const shapes = line.closed ? polylines.filter(points => points.length > 2)
        .map(points => clipPolygon(points, inside).map(toWindow)) : [];
      setPath(line.fill, shapes.filter(corners => corners.length && corners.every(Boolean))
        .map(corners => `M${corners.map(at => `${/** @type {Cartesian2} */ (at).x.toFixed(1)} ${/** @type {Cartesian2} */ (at).y.toFixed(1)}`).join('L')}Z`).join(''));
    }
    return left;
  };
  /** All the lines, those with a split left to find given time first next time. @param {Budget} budget */
  const drawLines = budget => {
    updateInside();
    let left = false;
    for (const line of lines) {
      left = draw(line, budget) || left;
    }
    return left;
  };
  // The depth buffer's tests, for a view: once the GPU has drawn its frame (a fence in the scene's own context, the page's to ask
  // for as any page; without WebGL 2, a wait), in tasks between renders, until none is left. A new view stops them and starts
  // them again; a render of the same view (a scene rendering on every frame) does not.
  const gl = canvas.getContext('webgl2');
  // the next task given how long it may read: all the time the browser says is free (requestIdleCallback), what is left of a frame
  // while the camera moves, up to 50 ms once it is still; where it has none (Safari), at once for TASK_BUDGET, a chain of setTimeout
  // being held 4 ms a link
  const idle = globalThis.requestIdleCallback?.bind(globalThis);
  const channel = new MessageChannel();
  /** @type {(() => void) | undefined} */
  let next;
  channel.port1.onmessage = () => next?.();
  /** @param {(budget: number) => void} task */
  const soon = task => {
    if (idle) {
      idle(deadline => task(deadline.didTimeout ? TASK_BUDGET : deadline.timeRemaining()), {timeout: IDLE_WAIT});
      return;
    }
    next = () => task(TASK_BUDGET);
    channel.port2.postMessage(0);
  };
  /** @type {number | undefined} */
  let testedView;
  let waiting = 0;
  /** @type {WebGLSync | null} */
  let fence = null;
  const dropFence = () => {
    if (gl && fence) {
      gl.deleteSync(fence);
    }
    fence = null;
  };
  // A fence at each render while tests are pending: they read once the GPU has drawn the last frame, so that no read waits for it.
  // A scene may keep rendering the same view (a camera whose axes Cesium normalizes in turn, by 1e-15, rendered again each time;
  // or one rendering every frame, whose GPU is busy with the next frame when the last one is drawn): after REWAITS renders without
  // a drawn frame, the tests read through, waiting for the GPU once a task.
  let pending = false;
  let fenced = 0;
  const fenceNow = () => {
    dropFence();
    fenced++;
    if (gl && !gl.isContextLost()) {
      fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
    }
  };
  /** Whether the GPU has drawn the last frame fenced: a lost context, or none, taken as drawn. */
  const frameDrawn = () => !gl || !fence || gl.isContextLost() || gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.UNSIGNALED;
  const test = () => {
    if (testedView === view) {
      return;
    }
    testedView = view;
    pending = true;
    clearTimeout(waiting);
    fenceNow();
    const of = view;
    let pass = 0;
    let since = fenced;
    /** @param {number} budget */
    const work = budget => {
      if (view !== of) {
        return;
      }
      // a frame not drawn yet: polled, unless renders have gone on too long without one
      if (!frameDrawn() && fenced - since < REWAITS) {
        waiting = setTimeout(() => soon(work), gl ? 2 : FRAME_WAIT);
        return;
      }
      since = fenced;
      if (drawLines({until: budget, tested: false, pass})) {
        soon(work);
      } else if (pass === 0) {
        pass = 1;
        soon(work);
      } else {
        testedView = undefined;
        pending = false;
        dropFence();
      }
    };
    waiting = setTimeout(() => soon(work), gl ? 0 : FRAME_WAIT);
  };
  // after a render: the view counted, the lines drawn, the depth buffer's tests started or fenced again; then the pins
  const rendered = () => {
    // to a micrometer and a microradian: a render of the same view may move it by 1e-9 (floating point)
    if (!Matrix4.equalsEpsilon(camera.viewMatrix, lastView, VIEW_EPSILON)) {
      view++;
      testedView = undefined;
      Matrix4.clone(camera.viewMatrix, lastView);
    }
    if (pending) {
      fenceNow();
    }
    if (lines.size > 0 && drawLines({until: 0, tested: true, pass: 1})) {
      test();
    }
    place();
  };
  const place = () => {
    occluder.cameraPosition = camera.positionWC;
    /** @type {[HTMLDivElement, number][]} */
    const near = [];
    let live = false;
    for (const pin of pins) {
      live ||= pin.live && !pin.hidden;
      const point = pin.hidden ? undefined : pin.at();
      let shown = point && (pin.occlude === false || occluder.isPointVisible(point)) ? SceneTransforms.worldToWindowCoordinates(scene, point) : undefined;
      if (shown && point && pin.occlude === 'depth' && scene.pickPositionSupported) {
        const front = scene.pickPosition(shown, picked);
        if (front && Cartesian3.distance(camera.positionWC, front) < Cartesian3.distance(camera.positionWC, point) - DEPTH_TOLERANCE) {
          shown = undefined;
        }
      }
      const translate = shown ? `${shown.x + pin.offset[0]}px ${shown.y + pin.offset[1]}px` : '';
      if (translate !== pin.shown) {
        pin.shown = translate;
        pin.anchor.hidden = !shown;
        if (shown) {
          pin.anchor.style.translate = translate;
        }
      }
      if (shown && point && pins.size > 1) {
        near.push([pin.anchor, Cartesian3.distanceSquared(camera.positionWC, point)]);
      }
    }
    // the nearest on top
    near.sort(([, a], [, b]) => b - a).forEach(([anchor], k) => anchor.style.zIndex = String(k));
    if (live) {
      scene.requestRender();
    }
  };
  scene.postRender.addEventListener(rendered);
  const overlay = {
    /** The layer: append to it what is drawn over the scene without a point of its own (it is over the pins). */
    element,
    /**
     * @param {HTMLElement} content
     * @param {Position} [position]
     * @param {PinOptions} [options]
     * @return {Pin}
     */
    pin(content, position, {offset = [0, 0], occlude = true, live = false} = {}) {
      const anchor = doc.createElement('div');
      anchor.className = 'cesium-overlay-pin';
      anchor.hidden = true;
      // where the element was, to put it back
      const [home, next] = [content.parentNode, content.nextSibling];
      anchor.append(content);
      layer.append(anchor);
      const pin = {anchor, at: /** @type {() => Cartesian3 | undefined} */ (() => undefined), hidden: false, offset, occlude, live, shown: ''};
      pins.add(pin);
      /** @param {Position} to */
      const move = to => {
        pin.at = typeof to === 'function' ? to : () => to;
        place();
        scene.requestRender();
      };
      move(position);
      return {
        element: content,
        anchor,
        move,
        get hidden() {
          return pin.hidden;
        },
        set hidden(hidden) {
          pin.hidden = hidden;
          place();
          scene.requestRender();
        },
        remove() {
          pins.delete(pin);
          if (home) {
            home.insertBefore(content, next?.parentNode === home ? next : null);
          } else {
            content.remove();
          }
          anchor.remove();
        },
      };
    },
    /**
     * @param {Points} points
     * @param {LineOptions} [options]
     * @return {Line}
     */
    line(points, {closed = false, occlude = false, step = 24, className = '', strokes = [''], fill = false} = {}) {
      // a pin's `true` (the horizon's test) means nothing for a line: none
      occlude = /** @type {unknown} */ (occlude) === true ? false : occlude;
      const group = doc.createElementNS(SVG, 'g');
      /** @param {string} kind */
      const path = kind => {
        const each = doc.createElementNS(SVG, 'path');
        const [first, ...more] = kind.split(' ');
        each.setAttribute('class', [`cesium-overlay-${first}`, ...more, className].filter(Boolean).join(' '));
        group.append(each);
        return each;
      };
      // the fill under the lines, the hidden path under the seen ones, one a stroke (a halo, an edge, a core), all of the same path
      const filled = fill ? path('fill') : null;
      const hidden = path('hidden');
      /** @type {Drawn} */
      const line = {seen: strokes.map(stroke => path(`seen ${stroke}`.trim())), hidden, fill: filled, at: () => /** @type {Cartesian3[]} */ ([]), closed, occlude, step, off: false, runs: []};
      svg.append(group);
      lines.add(line);
      const redraw = () => {
        updateInside();
        draw(line, {until: -Infinity, tested: true, pass: 1});
        scene.requestRender();
      };
      // drawn again and a render asked for only if the points changed: a tool moving its line as it renders (postRender) asks for
      // no render more once they are still
      /** @param {Points} to */
      const move = to => {
        const before = line.at();
        line.at = typeof to === 'function' ? to : () => to;
        if (!samePoints(before, line.at())) {
          redraw();
        }
      };
      move(points);
      return {
        element: group,
        move,
        get hidden() {
          return line.off;
        },
        set hidden(hidden) {
          if (hidden !== line.off) {
            line.off = hidden;
            redraw();
          }
        },
        remove() {
          lines.delete(line);
          group.remove();
        },
      };
    },
  };
  holder[KEY] = overlay;
  return overlay;
}
