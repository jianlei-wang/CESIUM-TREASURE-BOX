import {Math as CesiumMath} from '@cesium/core';
import {imageData} from './weather-map.js';

// The clouds' map, from a map of the rain: a radar sees the rain, "not the small cloud droplets and
// ice crystals that make up the rest of the cloud" (UBC ATSC 201), so the clouds are derived from
// it rather than drawn where it rains. Red is the rain, as it is; green is the coverage, the rain
// spread into a cloud shield wider than it; blue is the type of the clouds, from a flat deck over
// drizzle to towers over heavy rain, the precipitation turning the map "to cumulonimbus clouds"
// (Schneider 2015).

// the cloud shield reaches this far beyond the rain, in meters, its edge soft over about as much: 5
// to 15 km wide
const SHIELD_SPREAD = 5000;
// the rain rate, in mm/h, at intensity 1, the map's intensity being sqrt(R / RAIN_RATE), as
// RainHaze.glsl's
const RAIN_RATE = 10;
// the deck at this rain rate and below, in mm/h, towers at this one and above, about 40 dBZ (UBC
// ATSC 201): the type is remap(log(R), log(0.5), log(10), 0, 1)
const DECK_RATE = 0.5;
const TOWER_RATE = 10;
// meters, for the size of the map's pixels
const EARTH_RADIUS = 6371000;
// a Gaussian is approximated by this many box blurs, each a running sum whatever its width
const BOXES = 3;

/** @type {WeakMap<object, import('./weather-map.js').WeatherMapOptions>} */
const cloudMaps = new WeakMap();

/**
 * Blurs values in place along rows (step 1) or columns (step width) by a box of a radius, a running
 * sum, the edges held.
 * @param {Float32Array} values
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 * @param {boolean} rows
 */
function boxBlur(values, width, height, radius, rows) {
  const [count, length, step, stride] = rows ? [height, width, 1, width] : [width, height, width, 1];
  const line = new Float32Array(length);
  for (let i = 0; i < count; i++) {
    const start = i * stride;
    for (let j = 0; j < length; j++) {
      line[j] = values[start + j * step];
    }
    let sum = 0;
    for (let j = -radius; j <= radius; j++) {
      sum += line[CesiumMath.clamp(j, 0, length - 1)];
    }
    for (let j = 0; j < length; j++) {
      values[start + j * step] = sum / (2 * radius + 1);
      sum += line[Math.min(j + radius + 1, length - 1)] - line[Math.max(j - radius, 0)];
    }
  }
}

/**
 * Dilates values in place along rows or columns: the highest within a radius.
 * @param {Float32Array} values
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 * @param {boolean} rows
 */
function dilate(values, width, height, radius, rows) {
  const [count, length, step, stride] = rows ? [height, width, 1, width] : [width, height, width, 1];
  const line = new Float32Array(length);
  for (let i = 0; i < count; i++) {
    const start = i * stride;
    for (let j = 0; j < length; j++) {
      line[j] = values[start + j * step];
    }
    for (let j = 0; j < length; j++) {
      let max = 0;
      for (let k = Math.max(j - radius, 0); k <= Math.min(j + radius, length - 1); k++) {
        max = Math.max(max, line[k]);
      }
      values[start + j * step] = max;
    }
  }
}

/**
 * The clouds' map of a map of the rain, over the same rectangle, made once for each image.
 * @param {import('./weather-map.js').WeatherMapOptions} map
 * @returns {import('./weather-map.js').WeatherMapOptions}
 */
export default function createCloudMap(map) {
  const known = cloudMaps.get(map.image);
  if (known) {
    return known;
  }
  const {width, height, data} = /** @type {{width: number, height: number, data: Uint8ClampedArray}} */ (imageData(map.image));
  const {west, south, east, north} = map.rectangle;
  const pixel = 0.5 * EARTH_RADIUS * (((east - west) * Math.cos(0.5 * (south + north))) / width + (north - south) / height);
  // the rain dilated by the spread, in pixels, then softened by a Gaussian of half of it, the
  // radius of each box for its standard deviation
  const spread = Math.max(Math.round(SHIELD_SPREAD / pixel), 1);
  const sigma = 0.5 * spread;
  const radius = Math.max(Math.round(0.5 * (Math.sqrt((12 * sigma * sigma) / BOXES + 1) - 1)), 1);
  const shield = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    shield[i] = data[4 * i] > 0 ? 1 : 0;
  }
  dilate(shield, width, height, spread, true);
  dilate(shield, width, height, spread, false);
  for (let box = 0; box < BOXES; box++) {
    boxBlur(shield, width, height, radius, true);
    boxBlur(shield, width, height, radius, false);
  }
  const cloud = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const intensity = data[4 * i] / 255;
    const rate = RAIN_RATE * intensity * intensity;
    cloud[4 * i] = data[4 * i];
    cloud[4 * i + 1] = Math.round(255 * shield[i]);
    cloud[4 * i + 2] = rate > DECK_RATE ? Math.round((255 * Math.log(rate / DECK_RATE)) / Math.log(TOWER_RATE / DECK_RATE)) : 0;
    cloud[4 * i + 3] = 255;
  }
  const cloudMap = {image: {width, height, data: cloud}, rectangle: map.rectangle};
  cloudMaps.set(map.image, cloudMap);
  return cloudMap;
}
