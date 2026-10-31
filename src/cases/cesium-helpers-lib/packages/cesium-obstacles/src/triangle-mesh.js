import {Cartesian3, Cartographic, Ellipsoid, FixedFrameTransforms, Matrix4} from "@cesium/core";
import {Axis} from "@cesium/engine";
import {bvhQueries, refitBvh, trianglesOf} from "@geoblocks/cesium-bvh";
import {gltfTriangles} from "./gltf-mesh.js";
import {triangleTrees} from "./triangle-trees.js";

/** @typedef {import("./gltf-mesh.js").GltfTriangles} GltfTriangles */
/** @typedef {import("./cesium-obstacles.js").Obstacle} Obstacle */

// Triangles known on the CPU, in meters, z up, in the frame of a model matrix: the floors under a mover and the
// walls ahead of it, in any direction, without reading the depth, which waits for the GPU.

const originScratch = new Cartesian3();
const directionScratch = new Cartesian3();
const rayScratch = new Cartesian3();
const rayOriginScratch = new Cartesian3();
const frameScratch = new Matrix4();
const edgeScratch = [new Cartesian3(), new Cartesian3()];
const normalScratch = new Cartesian3();
const toPointScratch = new Cartesian3();
const nearestScratch = new Cartesian3();
const belowScratch = new Cartographic();
const floorScratch = new Cartesian3();
const floorCartographicScratch = new Cartographic();

/**
 * @typedef {object} TriangleMesh The floors and walls of triangles, in the frame of a model matrix.
 * @property {(x: number, y: number, z: number) => number | undefined} floorBelow The highest floor's height at
 *     a position of the frame, not above it.
 * @property {(origin: Cartesian3, direction: Cartesian3, maxDistance: number, options?: {walls?: boolean}) =>
 *     {position: Cartesian3, normal: Cartesian3, distance: number} | undefined} raycast The first surface along a
 *     ray on the globe.
 * @property {(point: Cartesian3, radius: number, options?: {walls?: boolean}) =>
 *     {position: Cartesian3, normal: Cartesian3, distance: number} | undefined} nearest The surface nearest a point
 *     on the globe, within a radius.
 * @property {(x: number, y: number, z: number, result?: Cartesian3) => Cartesian3} position A position of the
 *     frame on the globe.
 * @property {(position: Cartesian3, result?: Cartesian3) => Cartesian3} local A position on the globe in the frame.
 * @property {() => void} refit The triangles' places read again from the groups' vertices, which moved in place (a piece dragged,
 *     a door opened), their triangles the same: a few milliseconds, where a new mesh takes a tenth of a second. The floors stay floors
 *     and the walls walls, whatever the new slopes; the more triangles go far the slower the queries, so make a new mesh then.
 */

/**
 * The floors and walls of groups of triangles; a group with `collide: false` is left out.
 * @param {{vertices: Float32Array, triangles: Uint32Array, collide?: boolean}[]} groups x, y, z, in meters, z up.
 * @param {Matrix4} modelMatrix From the triangles' frame to the globe.
 * @param {{trees?: import("./triangle-trees.js").TriangleTrees}} [options] trees: `triangleTrees` of the groups that collide, in this
 *     order, made apart (in a worker, say) so that a page does not wait for them; the groups themselves stay the mesh's to refit.
 * @return {TriangleMesh}
 */
export function createTriangleMesh(groups, modelMatrix, {trees} = {}) {
  return collisionMesh(groups.filter(group => group.collide !== false), modelMatrix, trees);
}

/**
 * The floors and walls of a glTF's triangles, drawn elsewhere or not at all: its meshes in its default scene
 * (`gltfTriangles`), its y up turned z up.
 * @param {ArrayBuffer | Uint8Array | object} gltf A binary glTF, or a glTF's JSON.
 * @param {Matrix4} modelMatrix The model's, from the glTF's frame, z up, to the globe.
 * @param {{buffers?: ArrayBuffer | Uint8Array | (ArrayBuffer | Uint8Array)[], collide?: (primitive: GltfTriangles) => boolean,
 *     forwardAxis?: Axis}} [options] buffers: with a glTF's JSON, its binary buffer or buffers; collide: whether a
 *     primitive is an obstacle, all by default; forwardAxis: the one the Model is loaded with, Cesium's default
 *     Axis.Z, which turns the model a quarter round its up axis, or Axis.X.
 * @return {TriangleMesh}
 */
export function createTriangleMeshFromGltf(gltf, modelMatrix, {buffers, collide = () => true, forwardAxis = Axis.Z} = {}) {
  const primitives = gltfTriangles(gltf, buffers, forwardAxis).filter(primitive => collide(primitive));
  return collisionMesh(primitives, modelMatrix);
}

/**
 * The floors and walls of triangles.
 * @param {{vertices: Float32Array, triangles: Uint32Array}[]} colliding
 * @param {Matrix4} modelMatrix From the triangles' frame to the globe.
 * @param {import("./triangle-trees.js").TriangleTrees} [trees] The trees of these triangles, if made already.
 * @return {TriangleMesh}
 */
function collisionMesh(colliding, modelMatrix, trees) {
  const toLocal = Matrix4.inverse(modelMatrix, new Matrix4());
  const toNormal = Matrix4.inverseTranspose(modelMatrix, new Matrix4());

  // the triangles as the trees take them (a corner, then its two edges), the groups' one after the other: the floors in a tree, the
  // walls in another, made here or given
  const {tris, floorTree, wallTree} = trees ?? triangleTrees(colliding);
  /**
   * A triangle's normal, not a unit one: the cross of its edges, in scratch.
   * @param {number} triangle
   * @return {Cartesian3}
   */
  const crossOf = triangle => Cartesian3.cross(Cartesian3.unpack(/** @type {any} */ (tris), triangle * 9 + 3, edgeScratch[0]),
    Cartesian3.unpack(/** @type {any} */ (tris), triangle * 9 + 6, edgeScratch[1]), normalScratch);
  // a hit at the ray's start counts (the tree's `min` leaves it out by default): a mover stands on a floor at its feet
  const floorQueries = bvhQueries(floorTree, {min: -Infinity});
  const wallQueries = bvhQueries(wallTree, {min: -Infinity});

  /**
   * The highest floor at a position of the frame, not above it: the nearest along a ray straight down.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @return {number | undefined} Its height, in meters.
   */
  const floorBelow = (x, y, z) => {
    const distance = floorQueries.nearest(x, y, z, 0, 0, -1, Infinity);
    return distance === Infinity ? undefined : z - distance;
  };

  /**
   * The nearest triangle along a ray, in meters.
   * @param {Cartesian3} o The origin.
   * @param {Cartesian3} d The unit direction.
   * @param {number} far The longest distance.
   * @param {boolean} wallsOnly Whether to skip the floors.
   * @return {{distance: number, triangle: number} | undefined}
   */
  const nearestHit = (o, d, far, wallsOnly) => {
    const wall = wallQueries.nearestHit(o.x, o.y, o.z, d.x, d.y, d.z, far);
    const floor = wallsOnly ? undefined : floorQueries.nearestHit(o.x, o.y, o.z, d.x, d.y, d.z, far);
    return !floor || (wall && wall.distance <= floor.distance) ? wall : floor;
  };

  /**
   * A triangle's unit normal on the globe, pointing the way of a vector.
   * @param {number} triangle The triangle's number.
   * @param {Cartesian3} toward
   * @return {Cartesian3}
   */
  const normalToward = (triangle, toward) => {
    const normal = Matrix4.multiplyByPointAsVector(toNormal, crossOf(triangle), new Cartesian3());
    Cartesian3.normalize(normal, normal);
    return Cartesian3.dot(normal, toward) < 0 ? Cartesian3.negate(normal, normal) : normal;
  };

  return {
    floorBelow,
    refit: () => {
      trianglesOf(colliding, tris);
      refitBvh(floorTree, tris);
      refitBvh(wallTree, tris);
    },
    /**
     * The first surface along a ray on the globe.
     * @param {Cartesian3} origin
     * @param {Cartesian3} direction A unit vector.
     * @param {number} maxDistance In meters.
     * @param {{walls?: boolean}} [options] walls: skip the floors, stairs and ramps, which a mover stands on.
     * @return {{position: Cartesian3, normal: Cartesian3, distance: number} | undefined} Where the
     *     ray stops, the surface's normal toward the ray's origin, and the distance in meters.
     */
    raycast: (origin, direction, maxDistance, {walls = false} = {}) => {
      const o = Matrix4.multiplyByPoint(toLocal, origin, originScratch);
      const d = Matrix4.multiplyByPointAsVector(toLocal, direction, directionScratch);
      // the frame's units in a meter along the ray, should the matrix scale
      const perMeter = Cartesian3.magnitude(d);
      Cartesian3.divideByScalar(d, perMeter, d);
      const hit = nearestHit(o, d, maxDistance * perMeter, walls);
      if (!hit) {
        return undefined;
      }
      const point = Cartesian3.add(o, Cartesian3.multiplyByScalar(d, hit.distance, rayScratch), rayScratch);
      const position = Matrix4.multiplyByPoint(modelMatrix, point, new Cartesian3());
      const normal = normalToward(hit.triangle, Cartesian3.negate(direction, toPointScratch));
      return {position, normal, distance: Cartesian3.distance(origin, position)};
    },
    /**
     * The surface nearest a point on the globe, within a radius: a mover's body kept clear of the walls, in
     * every direction, by the point of a triangle nearest its middle.
     * @param {Cartesian3} point
     * @param {number} radius In meters.
     * @param {{walls?: boolean}} [options] walls: skip the floors, stairs and ramps, which a mover stands on.
     * @return {{position: Cartesian3, normal: Cartesian3, distance: number} | undefined} The nearest point of
     *     the surface, its normal toward the point, and the distance in meters.
     */
    nearest: (point, radius, {walls = false} = {}) => {
      const p = Matrix4.multiplyByPoint(toLocal, point, originScratch);
      const r = radius * Matrix4.getMaximumScale(toLocal);
      const wall = wallQueries.closest(p.x, p.y, p.z, r);
      const floor = walls ? undefined : floorQueries.closest(p.x, p.y, p.z, r);
      const best = !floor || (wall && wall.distance <= floor.distance) ? wall : floor;
      if (!best) {
        return undefined;
      }
      const position = Matrix4.multiplyByPoint(modelMatrix, Cartesian3.unpack(best.point, 0, nearestScratch), new Cartesian3());
      const normal = normalToward(best.triangle, Cartesian3.subtract(point, position, toPointScratch));
      return {position, normal, distance: Cartesian3.distance(point, position)};
    },
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {Cartesian3} [result]
     * @return {Cartesian3} A position of the frame on the globe.
     */
    position: (x, y, z, result = new Cartesian3()) => Matrix4.multiplyByPoint(modelMatrix, Cartesian3.fromElements(x, y, z, result), result),
    /**
     * @param {Cartesian3} position
     * @param {Cartesian3} [result]
     * @return {Cartesian3} A position on the globe in the frame.
     */
    local: (/** @type {Cartesian3} */ position, result = new Cartesian3()) => Matrix4.multiplyByPoint(toLocal, position, result),
  };
}

/**
 * The obstacle ahead of a mover in a mesh, for a walker's or a drone's obstacleAhead: rays cast from the mover's
 * position, and from points about it, in the direction of its steps, the nearest surface hit within the reach,
 * in every direction, as ObstacleProbe's ahead would return it.
 * @param {TriangleMesh} mesh
 * @param {() => Cartesian3} from Where the mover is, on the globe.
 * @param {{offsets?: Cartesian3[], reach: number, walls?: boolean}} options offsets: where the rays start, in
 *     meters east, north and up of the mover, the mover alone by default; reach: how far ahead, in meters;
 *     walls: whether the floors, stairs and ramps are left to the ground, true by default.
 * @return {(toward: Cartesian3, key?: string) => Obstacle | undefined}
 */
export function meshObstacleAhead(mesh, from, {offsets = [Cartesian3.ZERO], reach, walls = true}) {
  const options = {walls};
  return toward => {
    const position = from();
    const frame = FixedFrameTransforms.eastNorthUpToFixedFrame(position, Ellipsoid.WGS84, frameScratch);
    let nearest;
    for (const offset of offsets) {
      const origin = Matrix4.multiplyByPoint(frame, offset, rayOriginScratch);
      const hit = mesh.raycast(origin, toward, reach, options);
      if (hit && (!nearest || hit.distance < nearest.distance)) {
        nearest = hit;
      }
    }
    return nearest && {point: nearest.position, normal: nearest.normal};
  };
}

/**
 * The ground of a mover in a mesh, for a walker's or a drone's groundHeight: the highest floor below a point
 * under the mover.
 * @param {TriangleMesh} mesh
 * @param {{below?: number}} [options] below: how far under the mover, in meters, the floor is looked for from: a
 *     walker's knees, the highest step it climbs; 0 by default.
 * @return {(position: Cartographic) => number | undefined} The floor's height above the ellipsoid, in meters,
 *     undefined off the mesh's floors.
 */
export function meshGroundHeight(mesh, {below = 0} = {}) {
  return position => {
    const point = Cartographic.clone(position, belowScratch);
    point.height -= below;
    const {x, y, z} = mesh.local(Cartographic.toCartesian(point, Ellipsoid.WGS84, floorScratch), floorScratch);
    const floor = mesh.floorBelow(x, y, z);
    return floor === undefined ? undefined :
      Cartographic.fromCartesian(mesh.position(x, y, floor, floorScratch), Ellipsoid.WGS84, floorCartographicScratch).height;
  };
}
