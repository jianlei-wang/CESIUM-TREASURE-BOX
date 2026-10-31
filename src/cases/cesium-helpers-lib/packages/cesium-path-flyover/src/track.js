import {Cartesian3, Math as CesiumMath, Matrix4} from "@cesium/core";
import {Resource, Transforms} from "@cesium/engine";

const scratchA = new Cartesian3();
const scratchB = new Cartesian3();
const scratchMatrix = new Matrix4();

/**
 * @typedef {[number, number] | [number, number, number]} LonLat longitude and latitude in
 * degrees, then the point's time in seconds since the epoch when the track records it
 */

/**
 * @param {string} text GPX or GeoJSON content
 * @return {LonLat[]}
 */
export function parseTrack(text) {
  const coords = parseGeoJson(text) ?? parseGpx(text);
  if (!coords) {
    throw new Error("No track found: expected a GeoJSON LineString or GPX trkpt or rtept elements");
  }
  if (coords.length < 2) {
    throw new Error("A track needs at least two points");
  }
  return coords;
}

/**
 * @param {string} text GPX or GeoJSON content
 * @return {string | undefined} the name of the track, or of the first named feature
 */
export function parseTrackName(text) {
  const json = parseJson(text);
  if (json) {
    /** @type {any[]} */
    const features = json.type === "FeatureCollection" ? json.features ?? [] : [json];
    return features.find((f) => f.properties?.name)?.properties.name;
  }
  return /<(?:\w+:)?(?:trk|rte)\b[^>]*>\s*<(?:\w+:)?name>([^<]*)<\/(?:\w+:)?name>/.exec(text)?.[1].trim() || undefined;
}

/**
 * @param {string} text
 * @return {any} the parsed JSON, undefined when the text is none
 */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * @param {string} text
 * @return {LonLat[] | undefined}
 */
function parseGeoJson(text) {
  const json = parseJson(text);
  if (!json) {
    return undefined;
  }
  const geometries = [];
  if (json.type === "FeatureCollection") {
    for (const feature of json.features ?? []) {
      geometries.push(feature.geometry);
    }
  } else if (json.type === "Feature") {
    geometries.push(json.geometry);
  } else {
    geometries.push(json);
  }
  for (const geometry of geometries) {
    if (geometry?.type === "LineString") {
      return geometry.coordinates.map(toLonLat);
    }
    if (geometry?.type === "MultiLineString") {
      return geometry.coordinates.flat().map(toLonLat);
    }
  }
  return undefined;
}

/**
 * @param {number[]} coordinate
 * @return {LonLat}
 */
function toLonLat(coordinate) {
  return [coordinate[0], coordinate[1]];
}

/**
 * @param {string} text
 * @return {LonLat[] | undefined}
 */
function parseGpx(text) {
  return parseGpxPoints(text, "trkpt") ?? parseGpxPoints(text, "rtept");
}

/**
 * @param {string} text
 * @param {string} tag
 * @return {LonLat[] | undefined}
 */
function parseGpxPoints(text, tag) {
  const coords = [];
  // a point's children up to its closing tag, or none for a self-closing point
  const pattern = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, "g");
  for (const [, attributes, , children] of text.matchAll(pattern)) {
    const lat = /\blat\s*=\s*["']([^"']+)["']/.exec(attributes);
    const lon = /\blon\s*=\s*["']([^"']+)["']/.exec(attributes);
    if (lat && lon) {
      const coord = /** @type {LonLat} */ ([parseFloat(lon[1]), parseFloat(lat[1])]);
      const time = children && /<(?:\w+:)?time>([^<]*)</.exec(children);
      const seconds = time ? Date.parse(time[1]) / 1000 : NaN;
      if (!isNaN(seconds)) {
        coord.push(seconds);
      }
      coords.push(coord);
    }
  }
  return coords.length > 0 ? coords : undefined;
}

/**
 * @param {LonLat[]} coords
 * @param {number} minDistance meters
 * @param {import('@cesium/core').Ellipsoid} ellipsoid
 * @return {LonLat[]}
 */
export function decimate(coords, minDistance, ellipsoid) {
  const kept = [coords[0]];
  let last = Cartesian3.fromDegrees(coords[0][0], coords[0][1], 0, ellipsoid, scratchA);
  for (let i = 1; i < coords.length; i++) {
    const current = Cartesian3.fromDegrees(coords[i][0], coords[i][1], 0, ellipsoid, scratchB);
    if (Cartesian3.distance(last, current) >= minDistance) {
      kept.push(coords[i]);
      last = Cartesian3.clone(current, scratchA);
    }
  }
  return kept;
}

/**
 * Weighted average of the forward tangents along the upcoming samples, in the
 * east-north-up frame of the first sample. Nearer steps weigh more.
 * @param {Cartesian3[]} samples current position followed by points ahead
 * @param {number} previous heading returned when the steps cancel or vanish
 * @return {number} heading in radians, 0 is north, clockwise
 */
export function forwardHeading(samples, previous) {
  // @ts-expect-error Transforms.eastNorthUpToFixedFrame is missing from the @cesium/engine 26.4.0 typings
  const enu = Transforms.eastNorthUpToFixedFrame(samples[0], undefined, scratchMatrix);
  const inverse = Matrix4.inverseTransformation(enu, scratchMatrix);
  const steps = samples.length - 1;
  let east = 0;
  let north = 0;
  let last = Matrix4.multiplyByPoint(inverse, samples[0], scratchA);
  for (let i = 1; i <= steps; i++) {
    const current = Matrix4.multiplyByPoint(inverse, samples[i], scratchB);
    const dx = current.x - last.x;
    const dy = current.y - last.y;
    const length = Math.hypot(dx, dy);
    if (length > CesiumMath.EPSILON6) {
      const weight = 1 - (i - 1) / steps;
      east += (dx / length) * weight;
      north += (dy / length) * weight;
    }
    last = Cartesian3.clone(current, scratchA);
  }
  if (Math.hypot(east, north) < CesiumMath.EPSILON6) {
    return previous;
  }
  return Math.atan2(east, north);
}

/**
 * @param {string} url
 * @return {Promise<string>}
 */
export function fetchTrackText(url) {
  return /** @type {Promise<string>} */ (Resource.fetchText({url}));
}

/**
 * Frame-rate independent exponential smoothing.
 * @param {number} current
 * @param {number} target
 * @param {number} dt seconds since the last call
 * @param {number} tau time constant in seconds
 * @return {number}
 */
export function damp(current, target, dt, tau) {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/**
 * Same as damp for angles in radians, taking the short way around.
 * @param {number} current
 * @param {number} target
 * @param {number} dt
 * @param {number} tau
 * @return {number}
 */
export function dampAngle(current, target, dt, tau) {
  return damp(current, current + CesiumMath.negativePiToPi(target - current), dt, tau);
}

const BREATH_PERIODS = [12, 19, 31];

/**
 * A slow drift in [-1, 1]: three sines with incommensurate periods, phases from
 * the seed, so a run replays the same way.
 * @param {number} seconds
 * @param {number} seed
 * @return {number}
 */
export function breathe(seconds, seed) {
  let value = 0;
  BREATH_PERIODS.forEach((period, i) => {
    value += Math.sin((CesiumMath.TWO_PI * seconds) / period + seed * (i + 1));
  });
  return value / BREATH_PERIODS.length;
}

/**
 * Maps a linear time fraction to a path fraction: smoothstep speed ramps over
 * the first and last `ramp` fraction of the time, constant speed in between.
 * @param {number} u time fraction in [0, 1]
 * @param {number} ramp fraction of the time spent in each ramp, at most 0.5
 * @return {number} path fraction in [0, 1]
 */
export function easedProgress(u, ramp) {
  if (ramp <= 0) {
    return u;
  }
  const r = Math.min(ramp, 0.5);
  // integral of smoothstep(x) = 3x^2 - 2x^3 from 0 to x
  const rampDistance = (/** @type {number} */ x) => r * (x ** 3 - x ** 4 / 2);
  const total = 1 - r;
  let distance;
  if (u < r) {
    distance = rampDistance(u / r);
  } else if (u <= 1 - r) {
    distance = r / 2 + (u - r);
  } else {
    distance = total - rampDistance((1 - u) / r);
  }
  return distance / total;
}

/**
 * Inverse of easedProgress: the time fraction at which a path fraction is reached.
 * @param {number} p path fraction in [0, 1]
 * @param {number} ramp fraction of the time spent in each ramp, at most 0.5
 * @return {number} time fraction in [0, 1]
 */
export function easedProgressInverse(p, ramp) {
  // easedProgress rises steadily, a bisection finds the time without solving the ramps' quartic
  let low = 0;
  let high = 1;
  for (let i = 0; i < 50; i++) {
    const middle = (low + high) / 2;
    if (easedProgress(middle, ramp) < p) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}
