import {Math as CesiumMath} from "@cesium/core";
import {sampleProfile} from "./planner.js";

/**
 * @typedef {Object} Run
 * @property {number} range camera distance to the marker, meters, before the bend zoom
 * @property {number} pitch degrees, negative looks down
 * @property {number} lookAhead meters of path ahead whose direction sets the heading
 * @property {number} bendZoom 0 to 1, how much the range grows in bends (up to twice)
 * @property {number} reliefRise how far the camera climbs toward the crests around the track, 0 none, 1 to their height
 * @property {number} turnCost meters of lift one degree of heading offset is worth to the terrain planner
 * @property {number} headingTau heading damping time constant, seconds
 * @property {number} panRate largest heading change, degrees per second, for the heading and for the planner's offsets
 * @property {number} breathing 0 to 1, amplitude of the slow drift in heading, height and roll
 * @property {number} bank degrees of roll into a turn, reached when the heading turns at 30 degrees per second or more
 * @property {number} speed ground speed along the track, meters per second
 */

/**
 * The feel of a run. Each row is one parameter with its value at the 0 end, the
 * middle (today's default) and the 1 end of its dial.
 * @type {{name: keyof Run, dial: 'style' | 'motion', values: [number, number, number]}[]}
 */
export const RUN_TABLE = [
  {name: "range", dial: "style", values: [250, 400, 900]},
  {name: "pitch", dial: "style", values: [-15, -25, -45]},
  {name: "lookAhead", dial: "style", values: [200, 400, 700]},
  {name: "bendZoom", dial: "style", values: [0, 0, 1]},
  {name: "reliefRise", dial: "style", values: [0, 0, 0.5]},
  {name: "turnCost", dial: "style", values: [0.5, 1.5, 30]},
  {name: "headingTau", dial: "motion", values: [0.5, 1, 3]},
  {name: "panRate", dial: "motion", values: [45, 30, 15]},
  {name: "breathing", dial: "motion", values: [0, 0, 1]},
  {name: "bank", dial: "style", values: [12, 0, 0]},
  {name: "speed", dial: "style", values: [120, 200, 350]},
];

/**
 * Interpolates every row of the table at its dial; an explicit option with the
 * row's name wins.
 * @param {{style?: number, motion?: number} & Partial<Run>} options
 * @return {Run}
 */
export function deriveRun(options) {
  const dials = {
    style: CesiumMath.clamp(options.style ?? 0.5, 0, 1),
    motion: CesiumMath.clamp(options.motion ?? 0.5, 0, 1),
  };
  const run = /** @type {Run} */ ({});
  for (const {name, dial, values} of RUN_TABLE) {
    run[name] = options[name] ?? sampleProfile(values, dials[dial]);
  }
  return run;
}
