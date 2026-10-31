// The clouds' noise, made once on the CPU: a cube of voxels that tiles in every direction, for
// CloudsMarch.glsl to read instead of computing noise for each sample. Red is the base shape,
// Perlin-Worley noise: billows of inverted Worley noise, broken up by gradient noise, as in
// Schneider's "The Real-Time Volumetric Cloudscapes of Horizon Zero Dawn" (2015); green and blue
// are inverted Worley noise at twice and four times its frequency, the details that erode the
// edges. And a square of texels that tiles over the clouds' map, for CloudsDensity.glsl to read
// once rather than compute noise at each sample: red and green jitter the map's lookup, blue varies
// its coverage. Each channel is stretched over the bytes' range.
import {Math as CesiumMath} from '@cesium/core';

// cells of the base shape across the cube
const BASE_CELLS = 4;
// the map noise's square spans this many cells of the map, its jitter varying over this many of
// them, its coverage over this many: whole periods across the square, for it to tile
const MAP_TILE_CELLS = 64;
const JITTER_CELLS = 2;
const COVERAGE_CELLS = 8;

/**
 * A hash of a lattice point, 0 to 1.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} seed
 */
function hash(x, y, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * @param {number} a
 * @param {number} n
 */
function wrap(a, n) {
  return ((a % n) + n) % n;
}

/**
 * Gradient noise that repeats every `period` cells, about -1 to 1, with the random directions of
 * its lattice points computed once.
 * @param {number} period
 * @param {number} seed
 */
function perlin(period, seed) {
  const gradients = new Float32Array(period ** 3 * 3);
  for (let c = 0; c < period ** 3; c++) {
    const cx = c % period;
    const cy = Math.floor(c / period) % period;
    const cz = Math.floor(c / period ** 2);
    const theta = CesiumMath.TWO_PI * hash(cx, cy, cz, seed);
    const cosPhi = 2 * hash(cx, cy, cz, seed + 1) - 1;
    const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
    gradients.set([sinPhi * Math.cos(theta), sinPhi * Math.sin(theta), cosPhi], 3 * c);
  }
  const fade = (/** @type {number} */ t) => t * t * t * (t * (t * 6 - 15) + 10);
  // the corners of a voxel's cell are within one cell of it, so their wrapped index is a lookup
  const wrapped = Int32Array.from({length: period + 1}, (_, i) => wrap(i, period));
  /**
   * @param {number} x in cells
   * @param {number} y
   * @param {number} z
   */
  return (x, y, z) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;
    const x0 = wrapped[ix];
    const x1 = wrapped[ix + 1];
    const y0 = period * wrapped[iy];
    const y1 = period * wrapped[iy + 1];
    const z0 = period * period * wrapped[iz];
    const z1 = period * period * wrapped[iz + 1];
    const dot = (/** @type {number} */ c, /** @type {number} */ dx, /** @type {number} */ dy, /** @type {number} */ dz) =>
      gradients[3 * c] * dx + gradients[3 * c + 1] * dy + gradients[3 * c + 2] * dz;
    const u = fade(fx);
    const v = fade(fy);
    const w = fade(fz);
    const a = dot(x0 + y0 + z0, fx, fy, fz);
    const b = dot(x1 + y0 + z0, fx - 1, fy, fz);
    const c = dot(x0 + y1 + z0, fx, fy - 1, fz);
    const d = dot(x1 + y1 + z0, fx - 1, fy - 1, fz);
    const e = dot(x0 + y0 + z1, fx, fy, fz - 1);
    const f = dot(x1 + y0 + z1, fx - 1, fy, fz - 1);
    const g = dot(x0 + y1 + z1, fx, fy - 1, fz - 1);
    const h = dot(x1 + y1 + z1, fx - 1, fy - 1, fz - 1);
    const lower = a + (b - a) * u + (c + (d - c) * u - a - (b - a) * u) * v;
    const upper = e + (f - e) * u + (g + (h - g) * u - e - (f - e) * u) * v;
    return 2 * (lower + (upper - lower) * w);
  };
}

/**
 * The distance to the nearest of one random point in each of `cells` cells across, repeating
 * every `cells`, 0 to about 1, in cells, with the points computed once.
 * @param {number} cells
 * @param {number} seed
 */
function worley(cells, seed) {
  const points = new Float32Array(cells ** 3 * 3);
  for (let c = 0; c < cells ** 3; c++) {
    const cx = c % cells;
    const cy = Math.floor(c / cells) % cells;
    const cz = Math.floor(c / cells ** 2);
    points.set([hash(cx, cy, cz, seed), hash(cx, cy, cz, seed + 1), hash(cx, cy, cz, seed + 2)], 3 * c);
  }
  // the cells around a voxel are within one of its cell, so their wrapped index is a lookup
  const wrapped = Int32Array.from({length: cells + 2}, (_, i) => wrap(i - 1, cells));
  /**
   * @param {number} x in cells
   * @param {number} y
   * @param {number} z
   */
  return (x, y, z) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    let nearest = Infinity;
    for (let dz = -1; dz <= 1; dz++) {
      const wz = cells * cells * wrapped[iz + dz + 1];
      for (let dy = -1; dy <= 1; dy++) {
        const wy = wz + cells * wrapped[iy + dy + 1];
        for (let dx = -1; dx <= 1; dx++) {
          const p = 3 * (wy + wrapped[ix + dx + 1]);
          const px = ix + dx + points[p] - x;
          const py = iy + dy + points[p + 1] - y;
          const pz = iz + dz + points[p + 2] - z;
          const d = px * px + py * py + pz * pz;
          if (d < nearest) {
            nearest = d;
          }
        }
      }
    }
    return nearest < 1 ? Math.sqrt(nearest) : 1;
  };
}

/**
 * The noise as RGBA bytes, x fastest, then y, then z.
 * @param {number} [size] voxels along each side
 */
export default function createCloudNoise(size = 64) {
  const channels = [new Float32Array(size ** 3), new Float32Array(size ** 3), new Float32Array(size ** 3)];
  const gradients = [0, 1, 2].map((octave) => perlin(BASE_CELLS * 2 ** octave, 10 + octave));
  const [billowCells, shapeDetail, fineShapeDetail, detail, fineDetail] = [
    worley(BASE_CELLS, 20),
    worley(2 * BASE_CELLS, 30),
    worley(4 * BASE_CELLS, 40),
    worley(4 * BASE_CELLS, 50),
    worley(8 * BASE_CELLS, 60),
  ];
  let i = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // the voxel's center, in the base shape's cells
        const bx = ((x + 0.5) / size) * BASE_CELLS;
        const by = ((y + 0.5) / size) * BASE_CELLS;
        const bz = ((z + 0.5) / size) * BASE_CELLS;
        let gradient = 0;
        for (let octave = 0; octave < 3; octave++) {
          const scale = 2 ** octave;
          gradient += gradients[octave](bx * scale, by * scale, bz * scale) / scale;
        }
        const billows = 1 - billowCells(bx, by, bz);
        // the billows, raised where the gradient noise is high
        channels[0][i] = billows + (0.5 + 0.35 * gradient) * (1 - billows);
        channels[1][i] = 1 - (0.7 * shapeDetail(2 * bx, 2 * by, 2 * bz) + 0.3 * fineShapeDetail(4 * bx, 4 * by, 4 * bz));
        channels[2][i] = 1 - (0.7 * detail(4 * bx, 4 * by, 4 * bz) + 0.3 * fineDetail(8 * bx, 8 * by, 8 * bz));
        i++;
      }
    }
  }
  return toBytes(channels);
}

/**
 * Channels of values as RGBA bytes, each stretched over the bytes' range, alpha opaque.
 * @param {Float32Array[]} channels
 */
function toBytes(channels) {
  const bytes = new Uint8Array(channels[0].length * 4);
  channels.forEach((values, channel) => {
    let min = Infinity;
    let max = -Infinity;
    for (const value of values) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    for (let j = 0; j < values.length; j++) {
      bytes[4 * j + channel] = Math.round((255 * (values[j] - min)) / (max - min));
    }
  });
  for (let j = 3; j < bytes.length; j += 4) {
    bytes[j] = 255;
  }
  return bytes;
}

/**
 * The noise over the clouds' map as RGBA bytes, x fastest: a square that tiles, MAP_TILE_CELLS
 * cells of the map across, with gradient noise over JITTER_CELLS in red and green and over
 * COVERAGE_CELLS in blue.
 * @param {number} [size] texels along each side
 */
export function createMapNoise(size = 256) {
  const noises = [
    [perlin(MAP_TILE_CELLS / JITTER_CELLS, 70), JITTER_CELLS],
    [perlin(MAP_TILE_CELLS / JITTER_CELLS, 80), JITTER_CELLS],
    [perlin(MAP_TILE_CELLS / COVERAGE_CELLS, 90), COVERAGE_CELLS],
  ];
  const channels = noises.map(() => new Float32Array(size * size));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // the texel's center, in the map's cells
      const cx = ((x + 0.5) / size) * MAP_TILE_CELLS;
      const cy = ((y + 0.5) / size) * MAP_TILE_CELLS;
      noises.forEach(([noise, cells], channel) => {
        channels[channel][y * size + x] = /** @type {Function} */ (noise)(cx / /** @type {number} */ (cells), cy / /** @type {number} */ (cells), 0);
      });
    }
  }
  return toBytes(channels);
}
