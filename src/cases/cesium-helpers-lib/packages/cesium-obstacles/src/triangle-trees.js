import {buildBvh, trianglesOf} from "@geoblocks/cesium-bvh";

// The trees of a triangle mesh (triangle-mesh.js), made apart from it: plain typed arrays, no Cesium, so a worker can build them and
// hand them over (`createTriangleMesh`'s `trees`) while the page goes on.

// the faces flatter than this, of the cosine of their slope, are floors, stairs and ramps
const FLOOR = 0.5;

/**
 * @typedef {object} TriangleTrees
 * @property {Float64Array} tris The triangles, nine numbers each: a corner and its two edges from it, the groups' one after the other.
 * @property {ReturnType<typeof buildBvh>} floorTree The floors, stairs and ramps.
 * @property {ReturnType<typeof buildBvh>} wallTree The rest.
 */

/**
 * The trees over the triangles of groups: the floors in one, the walls in another.
 * @param {{vertices: ArrayLike<number>, triangles: ArrayLike<number>}[]} groups x, y, z in meters, z up; the ones that collide, a
 *     group with `collide: false` is the caller's to leave out.
 * @return {TriangleTrees}
 */
export function triangleTrees(groups) {
  const tris = trianglesOf(groups);
  /** @type {number[]} */
  const floorIds = [];
  /** @type {number[]} */
  const wallIds = [];
  for (let k = 0; k < tris.length / 9; k++) {
    // the normal, not a unit one: the cross of the two edges
    const o = k * 9;
    const x = tris[o + 4] * tris[o + 8] - tris[o + 5] * tris[o + 7];
    const y = tris[o + 5] * tris[o + 6] - tris[o + 3] * tris[o + 8];
    const z = tris[o + 3] * tris[o + 7] - tris[o + 4] * tris[o + 6];
    (Math.abs(z) >= FLOOR * Math.sqrt(x * x + y * y + z * z) ? floorIds : wallIds).push(k);
  }
  return {tris, floorTree: buildBvh(tris, floorIds), wallTree: buildBvh(tris, wallIds)};
}
