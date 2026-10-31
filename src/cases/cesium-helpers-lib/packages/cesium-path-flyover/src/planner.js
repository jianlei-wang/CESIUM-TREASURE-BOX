import {Cartesian3, Cartographic, Math as CesiumMath, Matrix4} from "@cesium/core";
import {Transforms} from "@cesium/engine";

export const SAMPLE_SPACING = 20;
const MAX_OFFSET = 60;
const OFFSET_STEP = 15;
const OFFSET_DEGREES = Array.from({length: (2 * MAX_OFFSET) / OFFSET_STEP + 1}, (_, i) => -MAX_OFFSET + i * OFFSET_STEP);
const OFFSET_RADIANS = OFFSET_DEGREES.map(CesiumMath.toRadians);
const TRANSITION_COST = 0.5;
// fractions of the camera-to-marker line checked against the terrain, from the
// camera (0) to 3% short of the marker: dense near the marker, where a gorge wall
// a few metres behind the track can hide it, sparse near the camera, which sits
// high above the ground
const LOS_FRACTIONS = Array.from({length: 11}, (_, p) => 1 - (1 - p / 12) ** 2);
const SMOOTH_SIGMA = 5;
// samples whose lines of sight are sampled at once, 99 positions each
const LIFT_BATCH = 512;
const RELIEF_RING = 8;

const enuScratch = new Matrix4();
const offsetScratch = new Cartesian3();
const cameraScratch = new Cartesian3();
const pointScratch = new Cartesian3();

/**
 * Camera position relative to the marker, in the marker's east-north-up frame.
 * @param {number} heading radians, 0 north, clockwise
 * @param {number} range camera distance to the marker, meters
 * @param {number} pitch radians, negative looks down
 * @param {number} lift extra height, meters
 * @param {Cartesian3} result
 * @return {Cartesian3}
 */
export function cameraOffsetEnu(heading, range, pitch, lift, result) {
  const back = range * Math.cos(pitch);
  result.x = -Math.sin(heading) * back;
  result.y = -Math.cos(heading) * back;
  result.z = range * Math.sin(-pitch) + lift;
  return result;
}

/**
 * Minimum-cost sequence of candidates, one per sample, with a penalty on the
 * change of candidate value between consecutive samples. Ties go to the lowest index.
 * The costs are read through a function: a table of them, samples by candidates,
 * would take tens of MB on a long track at a fine grid.
 * @param {number} n samples
 * @param {(sample: number, candidate: number) => number} cost
 * @param {number[]} values candidate values in ascending order, used for the transition penalty
 * @param {number} transitionCost cost per unit of value change
 * @param {number} [maxStep=Infinity] largest allowed value change between consecutive samples
 * @return {number[]} chosen candidate index per sample
 */
export function viterbi(n, cost, values, transitionCost, maxStep = Infinity) {
  const m = values.length;
  // the values are sorted, so the candidates within reach are a band around each
  const lows = values.map((v) => values.findIndex((w) => v - w <= maxStep));
  const highs = values.map((v) => values.findLastIndex((w) => w - v <= maxStep));
  let previous = new Float64Array(m);
  let current = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    previous[j] = cost(0, j);
  }
  const from = new Uint16Array(n * m);
  for (let i = 1; i < n; i++) {
    for (let j = 0; j < m; j++) {
      let best = Infinity;
      let bestK = 0;
      for (let k = lows[j]; k <= highs[j]; k++) {
        const total = previous[k] + transitionCost * Math.abs(values[j] - values[k]);
        if (total < best) {
          best = total;
          bestK = k;
        }
      }
      current[j] = best + cost(i, j);
      from[i * m + j] = bestK;
    }
    [previous, current] = [current, previous];
  }
  let j = previous.indexOf(Math.min(...previous));
  const path = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    path[i] = j;
    j = from[i * m + j];
  }
  return path;
}

/**
 * @param {number[]} values
 * @param {number} before samples looked back
 * @param {number} after samples looked ahead
 * @return {number[]} out[i] = max(values[i - before .. i + after]), clamped to the array
 */
export function maxWindow(values, before, after) {
  // a sliding window maximum: the indices of the window's candidates for the
  // maximum, in order, with their values descending
  /** @type {number[]} */
  const deque = [];
  let next = 0;
  return values.map((_, i) => {
    for (const end = Math.min(i + after, values.length - 1); next <= end; next++) {
      while (deque.length > 0 && values[deque[deque.length - 1]] <= values[next]) {
        deque.pop();
      }
      deque.push(next);
    }
    if (deque[0] < i - before) {
      deque.shift();
    }
    return values[deque[0]];
  });
}

/**
 * Gaussian filter with nearest edge mode.
 * @param {number[]} values
 * @param {number} sigma in samples
 * @return {number[]}
 */
export function gaussianSmooth(values, sigma) {
  if (sigma <= 0) {
    return values.slice();
  }
  const radius = Math.ceil(3 * sigma);
  /** @type {number[]} */
  const kernel = [];
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel.push(w);
    sum += w;
  }
  const last = values.length - 1;
  return values.map((_, i) => {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      acc += kernel[k + radius] * values[CesiumMath.clamp(i + k, 0, last)];
    }
    return acc / sum;
  });
}

/**
 * Signed heading change per metre of track, degrees per metre, clockwise positive,
 * from headings tabulated at a fixed spacing. The first entry is 0. Signed so that
 * a smoothing over it lets the zigzags of a GPS track cancel out and keeps the
 * net turning.
 * @param {number[]} headings radians
 * @param {number} spacing metres between samples
 * @return {number[]}
 */
export function curvature(headings, spacing) {
  return headings.map((heading, i) =>
    i === 0 ? 0 : CesiumMath.toDegrees(CesiumMath.negativePiToPi(heading - headings[i - 1])) / spacing
  );
}

/**
 * Zero-lag Gaussian smoothing of a position path, per coordinate.
 * @param {Cartesian3[]} positions
 * @param {number} sigma in samples
 * @return {Cartesian3[]}
 */
export function smoothPositions(positions, sigma) {
  const xs = gaussianSmooth(positions.map((p) => p.x), sigma);
  const ys = gaussianSmooth(positions.map((p) => p.y), sigma);
  const zs = gaussianSmooth(positions.map((p) => p.z), sigma);
  return xs.map((x, i) => new Cartesian3(x, ys[i], zs[i]));
}

/**
 * Smooths a lower-bound constraint such as a lift profile without ever going
 * below it: widen every requirement by the blur radius, plus `ahead` samples
 * forward so the camera climbs before it has to, then blur. A Gaussian alone
 * would average a short spike down.
 * @param {number[]} values raw requirement per sample
 * @param {number} ahead anticipation, samples
 * @param {number} sigma Gaussian sigma, samples
 * @return {number[]}
 */
export function smoothConstraint(values, ahead, sigma) {
  const radius = Math.ceil(3 * sigma);
  return gaussianSmooth(maxWindow(values, radius, radius + ahead), sigma);
}

/**
 * @param {number[]} values profile sampled uniformly over [0, 1]
 * @param {number} fraction
 * @return {number}
 */
export function sampleProfile(values, fraction) {
  const last = values.length - 1;
  const index = CesiumMath.clamp(fraction, 0, 1) * last;
  const i = Math.min(Math.floor(index), last);
  const t = index - i;
  return t === 0 ? values[i] : CesiumMath.lerp(values[i], values[i + 1], t);
}

/**
 * Height of the terrain around each target above the target, smoothed: a ring of
 * RELIEF_RING points at the camera range around it, the highest one. Zero where the
 * surroundings lie below the track.
 * @param {Cartesian3[]} targets
 * @param {number[]} heights of the targets above the ellipsoid, meters
 * @param {number[]} ranges meters, per target
 * @param {import('@cesium/core').Ellipsoid} ellipsoid
 * @param {(cartographics: Cartographic[]) => Promise<(number | undefined)[]>} heightsAt terrain height per position
 * @return {Promise<number[]>} meters, per target
 */
export async function reliefProfile(targets, heights, ranges, ellipsoid, heightsAt) {
  /** @type {Cartographic[]} */
  const cartographics = [];
  targets.forEach((target, i) => {
    // @ts-expect-error Transforms.eastNorthUpToFixedFrame is missing from the @cesium/engine 26.4.0 typings
    const enu = Transforms.eastNorthUpToFixedFrame(target, ellipsoid, enuScratch);
    for (let k = 0; k < RELIEF_RING; k++) {
      const angle = (k * CesiumMath.TWO_PI) / RELIEF_RING;
      offsetScratch.x = ranges[i] * Math.sin(angle);
      offsetScratch.y = ranges[i] * Math.cos(angle);
      offsetScratch.z = 0;
      const point = Matrix4.multiplyByPoint(enu, offsetScratch, pointScratch);
      cartographics.push(/** @type {Cartographic} */ (Cartographic.fromCartesian(point, ellipsoid)));
    }
  });
  const terrains = await heightsAt(cartographics);
  const relief = heights.map((height, i) => {
    let highest = -Infinity;
    for (let k = 0; k < RELIEF_RING; k++) {
      const terrain = terrains[i * RELIEF_RING + k];
      if (terrain !== undefined) {
        highest = Math.max(highest, terrain);
      }
    }
    return Math.max(0, highest - height);
  });
  return gaussianSmooth(relief, SMOOTH_SIGMA);
}

/**
 * @typedef {Object} Samples
 * @property {Cartesian3[]} positions camera anchor positions, uniformly spaced
 * @property {number[]} headings heading the camera has at each position, radians
 * @property {number[]} ranges camera distance to the anchor at each position, meters
 * @property {number[]} rise meters added to the camera height at each position, before the lift
 */

/**
 * @typedef {Object} PlanOptions
 * @property {number} pitch radians, negative
 * @property {number} clearance meters
 * @property {number} ahead samples of anticipation for the lift
 * @property {number} maxTurn largest heading offset change between consecutive samples, radians
 * @property {number} maxLift meters of lift for the line of sight; what would need more stays hidden
 * @property {number} offsetCost meters of lift one degree of heading offset is worth
 * @property {import('@cesium/core').Ellipsoid} ellipsoid
 */

/**
 * @typedef {Object} Plan
 * @property {number[]} headingOffset radians, per sample
 * @property {number[]} lift meters, per sample
 */

/**
 * Lift needed, per sample and per candidate heading, for the camera and its line
 * of sight to the marker to clear the terrain. One terrain query per batch of samples.
 * @param {Samples} samples
 * @param {number[][]} headings candidate headings per sample
 * @param {PlanOptions} options
 * @param {(cartographics: Cartographic[]) => Promise<(number | undefined)[]>} heightsAt
 * @return {Promise<number[][]>}
 */
async function liftsNeeded(samples, headings, options, heightsAt) {
  /** @type {number[][]} */
  const lifts = [];
  // a batch at a time, the positions of a whole long track would take tens of
  // MB, with the next batch's terrain on the way while the current one is
  // pending: its tiles load while the current batch is interpolated
  const batch = (/** @type {number} */ start) =>
    liftsNeededFrom(samples, headings, options, heightsAt, start, Math.min(start + LIFT_BATCH, headings.length));
  let next = headings.length > 0 ? batch(0) : undefined;
  for (let start = 0; start < headings.length; start += LIFT_BATCH) {
    const current = /** @type {Promise<number[][]>} */ (next);
    next = start + LIFT_BATCH < headings.length ? batch(start + LIFT_BATCH) : undefined;
    lifts.push(...(await current));
  }
  return lifts;
}

/**
 * The lifts of liftsNeeded for the samples from `start` to `end`, excluded.
 * @param {Samples} samples
 * @param {number[][]} headings
 * @param {PlanOptions} options
 * @param {(cartographics: Cartographic[]) => Promise<(number | undefined)[]>} heightsAt
 * @param {number} start
 * @param {number} end
 * @return {Promise<number[][]>}
 */
async function liftsNeededFrom(samples, headings, options, heightsAt, start, end) {
  /** @type {Cartographic[]} */
  const cartographics = [];
  for (let i = start; i < end; i++) {
    const marker = samples.positions[i];
    // @ts-expect-error Transforms.eastNorthUpToFixedFrame is missing from the @cesium/engine 26.4.0 typings
    const enu = Transforms.eastNorthUpToFixedFrame(marker, options.ellipsoid, enuScratch);
    for (const heading of headings[i]) {
      cameraOffsetEnu(heading, samples.ranges[i], options.pitch, samples.rise[i], offsetScratch);
      const camera = Matrix4.multiplyByPoint(enu, offsetScratch, cameraScratch);
      for (const fraction of LOS_FRACTIONS) {
        const point = Cartesian3.lerp(camera, marker, fraction, pointScratch);
        cartographics.push(/** @type {Cartographic} */ (Cartographic.fromCartesian(point, options.ellipsoid)));
      }
    }
  }
  const terrains = await heightsAt(cartographics);

  let index = 0;
  return headings.slice(start, end).map((candidates) =>
    candidates.map(() => {
      let cameraLift = 0;
      let sightLift = 0;
      for (const fraction of LOS_FRACTIONS) {
        const terrain = terrains[index];
        const height = cartographics[index].height;
        index++;
        if (terrain === undefined) {
          continue;
        }
        // the marker sits on the ground, so the clearance tapers to zero toward it
        const deficit = terrain + options.clearance * (1 - fraction) - height;
        if (deficit <= 0) {
          continue;
        }
        if (fraction === 0) {
          cameraLift = deficit;
        } else {
          sightLift = Math.max(sightLift, deficit / (1 - fraction));
        }
      }
      // a wall right behind the marker would ask for kilometres of lift to see
      // past it; above the cap, a brief occlusion is the better picture. The
      // camera's own clearance is never capped
      return Math.max(cameraLift, Math.min(sightLift, options.maxLift));
    })
  );
}

/**
 * Plans, per sample, the cheapest mix of heading offset and lift that keeps the
 * camera and its line of sight to the marker clear of the terrain.
 * @param {Samples} samples
 * @param {PlanOptions} options
 * @param {(cartographics: Cartographic[]) => Promise<(number | undefined)[]>} heightsAt terrain height per position
 * @return {Promise<Plan>}
 */
export async function planCamera(samples, options, heightsAt) {
  const {headings} = samples;
  const candidateLifts = await liftsNeeded(
    samples,
    headings.map((heading) => OFFSET_RADIANS.map((offset) => heading + offset)),
    options,
    heightsAt
  );
  // The candidates are 15 degrees apart, a pan of hundreds of degrees per second
  // at flyover speeds if taken in one sample. The search runs on a finer grid
  // whose lift is interpolated between the sampled candidates, and may only move
  // one grid step per sample, so a turn starts as early as it needs to.
  // Without any turn allowed (a pan rate of 0), the offset keeps its first candidate.
  const turn = CesiumMath.toDegrees(options.maxTurn);
  const step = turn > 0 ? OFFSET_STEP / Math.ceil(OFFSET_STEP / turn) : OFFSET_STEP;
  /** @type {number[]} */
  const gridDegrees = [];
  for (let d = -MAX_OFFSET; d <= MAX_OFFSET + 1e-9; d += step) {
    gridDegrees.push(d);
  }
  const fractions = gridDegrees.map((d) => (d + MAX_OFFSET) / (2 * MAX_OFFSET));
  const penalties = gridDegrees.map((d) => options.offsetCost * Math.abs(d));
  const chosen = viterbi(
    candidateLifts.length,
    (i, j) => sampleProfile(candidateLifts[i], fractions[j]) + penalties[j],
    gridDegrees,
    TRANSITION_COST,
    turn > 0 ? step + 1e-9 : 0
  );
  const headingOffset = chosen.map((j) => CesiumMath.toRadians(gridDegrees[j]));

  // the lift at the chosen headings, sampled again rather than interpolated
  // between the candidates: the interpolation undercuts the camera's own
  // clearance where the ground between two candidates is not flat (39 m for
  // 40 on the Réchy gorge, with an occluded sample), and that clearance is a
  // guarantee
  const finalLifts = await liftsNeeded(
    samples,
    headings.map((heading, i) => [heading + headingOffset[i]]),
    options,
    heightsAt
  );
  return {
    headingOffset,
    lift: smoothConstraint(finalLifts.map((lifts) => lifts[0]), options.ahead, SMOOTH_SIGMA),
  };
}
