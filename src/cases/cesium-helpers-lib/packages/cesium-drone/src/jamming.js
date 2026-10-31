import {Cartesian3, Cartographic, Math as CesiumMath} from '@cesium/core';

// the jammer's antenna, in meters above the ground
const ANTENNA = 10;
// the jamming is full within this share of its range
const FULL = 0.15;
// the share of the jamming that gets over a ridge between the jammer and the drone
const SHIELDED = 0.15;
// the terrain heights sampled along the line from the antenna to the drone
const SAMPLES = 16;

const antennaScratch = new Cartographic();
const droneScratch = new Cartographic();
const sampleScratch = new Cartographic();
const antennaPositionScratch = new Cartesian3();

/**
 * @typedef {{longitude: number, latitude: number, range: number}} Jammer
 * A jammer on the ground: its position in degrees, and its range in meters.
 */

/**
 * How strongly the jammers reach a position, 0 to 1: from 0 at a jammer's
 * range to 1 near it, much less behind terrain that hides it; the strongest
 * jammer wins. Only the terrain loaded in the globe hides a jammer.
 * @param {import('@cesium/engine').Globe} globe
 * @param {Cartesian3} position
 * @param {Jammer[]} jammers
 * @return {number}
 */
export function jammingAt(globe, position, jammers) {
  const drone = Cartographic.fromCartesian(position, undefined, droneScratch);
  let strongest = 0;
  for (const jammer of jammers) {
    const antenna = Cartographic.fromDegrees(jammer.longitude, jammer.latitude, 0, antennaScratch);
    antenna.height = (globe.getHeight(antenna) ?? 0) + ANTENNA;
    const distance = Cartesian3.distance(position, Cartographic.toCartesian(antenna, undefined, antennaPositionScratch));
    if (distance >= jammer.range) {
      continue;
    }
    const t = CesiumMath.clamp((jammer.range - distance) / (jammer.range * (1 - FULL)), 0, 1);
    let strength = t * t * (3 - 2 * t);
    if (hidden(globe, antenna, drone)) {
      strength *= SHIELDED;
    }
    strongest = Math.max(strongest, strength);
  }
  return strongest;
}

/**
 * Whether the terrain rises above the straight line between two points.
 * @param {import('@cesium/engine').Globe} globe
 * @param {Cartographic} from
 * @param {Cartographic} to
 * @return {boolean}
 */
function hidden(globe, from, to) {
  for (let i = 1; i < SAMPLES; i++) {
    const f = i / SAMPLES;
    sampleScratch.longitude = CesiumMath.lerp(from.longitude, to.longitude, f);
    sampleScratch.latitude = CesiumMath.lerp(from.latitude, to.latitude, f);
    const ground = globe.getHeight(sampleScratch);
    if (ground !== undefined && ground > CesiumMath.lerp(from.height, to.height, f)) {
      return true;
    }
  }
  return false;
}
