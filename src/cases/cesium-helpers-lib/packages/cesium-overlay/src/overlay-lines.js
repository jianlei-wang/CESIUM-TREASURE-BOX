// The overlay's lines, apart from the scene: the part of a segment or a polygon in view, a line split into the runs a test
// sees and hides, found by samples and halving where the test changes between two of them, and the paths drawing them.

import {Cartesian2, Cartesian3, FixedFrameTransforms, Matrix4} from '@cesium/core';

/**
 * Points of the world put on the canvas, as SceneTransforms.worldToWindowCoordinates puts them in a 3D scene, from a view's
 * matrices taken once: that call computes them again for each point (about 1.4 µs a point, most of a long line's render).
 * @param {Matrix4} viewMatrix
 * @param {Matrix4} projectionMatrix
 * @param {number} width The canvas's, in CSS pixels.
 * @param {number} height
 * @return {(point: Cartesian3) => Cartesian2 | undefined} In CSS pixels, y down; undefined behind the camera.
 */
export function windowProjection(viewMatrix, projectionMatrix, width, height) {
  // copies: a camera's matrices change in place
  const view = Matrix4.clone(viewMatrix);
  const viewProjection = Matrix4.multiply(projectionMatrix, view, new Matrix4());
  const viewport = Matrix4.computeViewportTransformation({x: 0, y: 0, width, height}, 0, 1, new Matrix4());
  const eye = new Cartesian3();
  return point => Matrix4.multiplyByPoint(view, point, eye).z < 0
    ? FixedFrameTransforms.pointToWindowCoordinates(viewProjection, viewport, point, new Cartesian2()) : undefined;
}

/**
 * The part of a segment in front of a plane, as a range along it: 0 at its start, 1 at its end.
 * @param {import('@cesium/core').Cartesian3} p
 * @param {import('@cesium/core').Cartesian3} q
 * @param {(point: import('@cesium/core').Cartesian3) => number} ahead How far a point is in front of the plane: negative behind it.
 * @return {[number, number] | undefined} Undefined if it is all behind.
 */
export function nearRange(p, q, ahead) {
  const [dp, dq] = [ahead(p), ahead(q)];
  if (dp <= 0 && dq <= 0) {
    return undefined;
  }
  return [dp > 0 ? 0 : dp / (dp - dq), dq > 0 ? 1 : dp / (dp - dq)];
}

/**
 * The part of a segment inside several planes (the view's sides and its near plane): where their ranges overlap.
 * @param {import('@cesium/core').Cartesian3} p
 * @param {import('@cesium/core').Cartesian3} q
 * @param {((point: import('@cesium/core').Cartesian3) => number)[]} aheads How far a point is inside each plane.
 * @return {[number, number] | undefined} Undefined if no part is inside them all.
 */
export function insideRange(p, q, aheads) {
  let [from, to] = [0, 1];
  for (const ahead of aheads) {
    const range = nearRange(p, q, ahead);
    if (!range) {
      return undefined;
    }
    [from, to] = [Math.max(from, range[0]), Math.min(to, range[1])];
  }
  return from < to ? [from, to] : undefined;
}

/**
 * The part of a polygon inside several planes, cut at each in turn (Sutherland-Hodgman): a corner where an edge crosses one.
 * @param {Cartesian3[]} points Its corners, in order.
 * @param {((point: Cartesian3) => number)[]} aheads How far a point is inside each plane.
 * @return {Cartesian3[]} The corners of what is inside, new where cut; none if less than a triangle is.
 */
export function clipPolygon(points, aheads) {
  let kept = points;
  for (const ahead of aheads) {
    const distances = kept.map(ahead);
    kept = kept.flatMap((p, k) => {
      const next = (k + 1) % kept.length;
      const [dp, dq] = [distances[k], distances[next]];
      const crossing = (dp >= 0) !== (dq >= 0) ? [Cartesian3.lerp(p, kept[next], dp / (dp - dq), new Cartesian3())] : [];
      return dp >= 0 ? [p, ...crossing] : crossing;
    });
  }
  return kept.length > 2 ? kept : [];
}

/**
 * A place on the screen between a segment's two ends, as a place along the segment: a perspective view draws the near part
 * longer, so places even on the screen are not even in the world (an orthographic view: two equal depths).
 * @param {number} s From 0 at the first end to 1 at the other, on the screen.
 * @param {number} depthA The first end's depth in front of the camera.
 * @param {number} depthB The other's.
 * @return {number} From 0 to 1 along the segment.
 */
export function alongSegment(s, depthA, depthB) {
  return s * depthA / ((1 - s) * depthB + s * depthA);
}

/**
 * How many gaps a segment is tested in: one every `step` pixels in the fine pass, `factor` times fewer in the coarse one, whose
 * samples are among the fine pass's (its count a multiple). A segment shorter than a step is tested at its two ends alone, in both.
 * @param {number} length The segment's part in view, on the screen, in pixels.
 * @param {number} step In pixels.
 * @param {number} factor How many times fewer the coarse pass's gaps are, at most.
 * @return {{coarse: number, fine: number}}
 */
export function gapsOf(length, step, factor) {
  const wanted = Math.max(1, Math.ceil(length / step));
  const coarse = Math.ceil(wanted / factor);
  return {coarse, fine: coarse * Math.ceil(wanted / coarse)};
}

/**
 * A line, from 0 to 1, split where a test changes: sampled `count` times along, and where two samples differ, the change found by
 * halving the gap `refine` times. A run shorter than the gap between samples may be missed.
 * @param {(t: number) => boolean} test Whether the line is hidden at a place along it.
 * @param {number} count How many gaps between samples: count + 1 samples, both ends included.
 * @param {number} refine How many halvings for each change.
 * @return {[number, number, boolean][]} The runs in order, from, to and hidden, each meeting the next.
 */
export function runsAlong(test, count, refine) {
  /** @type {[number, number, boolean][]} */
  const runs = [];
  let from = 0;
  let before = test(0);
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    const now = test(t);
    if (now !== before) {
      let [low, high] = [(i - 1) / count, t];
      for (let k = 0; k < refine; k++) {
        const middle = (low + high) / 2;
        [low, high] = test(middle) === before ? [middle, high] : [low, middle];
      }
      const change = (low + high) / 2;
      runs.push([from, change, before]);
      [from, before] = [change, now];
    }
  }
  runs.push([from, 1, before]);
  return runs;
}

/**
 * A line's points as polylines: a few points, one; a list of lists, each.
 * @param {Cartesian3[] | Cartesian3[][]} points
 * @return {Cartesian3[][]}
 */
export function polylinesOf(points) {
  return Array.isArray(points[0]) ? /** @type {Cartesian3[][]} */ (points) : [/** @type {Cartesian3[]} */ (points)];
}

/**
 * Whether two lines' points are the same, polyline by polyline, point by point.
 * @param {Cartesian3[] | Cartesian3[][]} a
 * @param {Cartesian3[] | Cartesian3[][]} b
 */
export function samePoints(a, b) {
  const [p, q] = [polylinesOf(a), polylinesOf(b)];
  return p.length === q.length && p.every((each, k) => each.length === q[k].length && each.every((point, i) => Cartesian3.equals(point, q[k][i])));
}

/**
 * An SVG path through pieces on the screen, in order: a piece starting where the one before ends goes on from it, so that their
 * corner is joined (`stroke-linejoin`); a closed polyline drawn in one go, back to its start, is closed, its first corner joined too.
 * @param {[{x: number, y: number}, {x: number, y: number}][]} pieces
 * @param {boolean} closed
 * @return {string}
 */
export function pathOf(pieces, closed) {
  let d = '';
  let [last, start, moves] = ['', '', 0];
  for (const [p, q] of pieces) {
    const [from, to] = [p, q].map(({x, y}) => `${x.toFixed(1)} ${y.toFixed(1)}`);
    if (from !== last) {
      d += `M${from}`;
      [start, moves] = [from, moves + 1];
    }
    d += `L${to}`;
    last = to;
  }
  return closed && moves === 1 && last === start ? `${d}Z` : d;
}
