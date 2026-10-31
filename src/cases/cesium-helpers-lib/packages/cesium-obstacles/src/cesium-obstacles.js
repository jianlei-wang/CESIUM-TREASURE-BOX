import {Cartesian2, Cartesian3, Math as CesiumMath, Ray} from "@cesium/core";

export {createTriangleMesh, createTriangleMeshFromGltf, meshGroundHeight, meshObstacleAhead} from "./triangle-mesh.js";
export {triangleTrees} from "./triangle-trees.js";
export {gltfTriangles} from "./gltf-mesh.js";
export {Group} from "./mesh-builder.js";

/** @typedef {import("./triangle-mesh.js").TriangleMesh} TriangleMesh */
/** @typedef {import("./gltf-mesh.js").GltfTriangles} GltfTriangles */

// the mover keeps REACH meters from the obstacles in view, and slides along them. Reading the depth stalls
// the frame until the GPU is done, so an obstacle is looked for at most every SAMPLE_INTERVAL milliseconds,
// or when the direction of the steps turns. Out of view, there is no obstacle: Cesium's ways to look there
// render the scene once more, 50 to 100 ms on an integrated GPU
const REACH = 0.4;
const SAMPLE_INTERVAL = 100;
const TURN = Math.cos(CesiumMath.toRadians(10));
// in meters: farther from the obstacle, a point read beside or above it is on something else, at its edge
const SAME_SURFACE = 1;
// in pixels: how far beside and above the obstacle the points giving its plane are read
const SPREAD = 8;

const probeScratch = new Cartesian3();
const probeWindowScratch = new Cartesian2();
const nearWindowScratch = new Cartesian2();
const towardScratch = new Cartesian3();
const besideScratch = new Cartesian3();
const upScratch = new Cartesian3();
const rayScratch = new Ray();
// in meters: how far beside the ray ahead the second ray is cast, for the wall's direction
const BESIDE = 0.1;
const awayScratch = new Cartesian3();

/**
 * An obstacle's plane: a point of it and its normal toward the mover, if one was in view.
 * @typedef {{point?: Cartesian3, normal?: Cartesian3}} Obstacle
 */

/**
 * The step to take toward an obstacle: in full, along the obstacle for the rest of the step, or none.
 * @param {Cartesian3} toward The unit direction of the step.
 * @param {number} length The length of the step, in meters.
 * @param {Cartesian3} eye Where the mover is.
 * @param {Obstacle | undefined} obstacle The obstacle ahead, if any.
 * @param {Cartesian3} result The direction of the step to take.
 * @return {{direction: Cartesian3, length: number}}
 */
export function blockedStep(toward, length, eye, obstacle, result) {
  if (!obstacle?.point || !obstacle.normal) {
    return {direction: Cartesian3.clone(toward, result), length};
  }
  // how far the step brings the mover toward the plane, and how far it is from it
  const facing = Cartesian3.dot(toward, obstacle.normal);
  const away = Cartesian3.dot(Cartesian3.subtract(eye, obstacle.point, awayScratch), obstacle.normal);
  if (facing >= 0 || away + facing * length > REACH) {
    return {direction: Cartesian3.clone(toward, result), length};
  }
  // along the obstacle, the rest of the step
  const slide = Cartesian3.subtract(toward, Cartesian3.multiplyByScalar(obstacle.normal, facing, result), result);
  const sliding = Cartesian3.magnitude(slide);
  if (sliding <= CesiumMath.EPSILON6) {
    return {direction: slide, length: 0};
  }
  return {direction: Cartesian3.normalize(slide, slide), length: length * sliding};
}

/**
 * Looks for the obstacles in view ahead of the mover, a walker or a drone, in the depth of the last frame.
 */
export class ObstacleProbe {
  /**
   * @param {import('@cesium/engine').Scene} scene
   */
  constructor(scene) {
    this.scene_ = scene;

    // the last look in each direction of steps: when, which way, and the obstacle, if one was in view
    /** @type {Map<string, Obstacle & {time: number, direction: Cartesian3}>} */
    this.looks_ = new Map();
  }

  /**
   * The obstacle in view ahead of steps in a direction, looked for again at most every SAMPLE_INTERVAL.
   * @param {Cartesian3} toward The unit direction of the steps.
   * @param {string} key Which steps these are.
   * @return {Obstacle}
   */
  ahead(toward, key) {
    const now = performance.now();
    const last = this.looks_.get(key);
    if (last && now - last.time < SAMPLE_INTERVAL && Cartesian3.dot(last.direction, toward) > TURN) {
      return last;
    }
    const scene = this.scene_;
    const eye = scene.camera.positionWC;
    /** @type {Obstacle & {time: number, direction: Cartesian3}} */
    const look = {time: now, direction: Cartesian3.clone(toward)};
    this.looks_.set(key, look);
    // in view: the depth of the last frame along the steps from the eye, and a little beside and above for
    // the obstacle's plane
    const ahead = Cartesian3.add(eye, Cartesian3.multiplyByScalar(toward, 2, probeScratch), probeScratch);
    const window = scene.cartesianToCanvasCoordinates(ahead, probeWindowScratch);
    const canvas = scene.canvas;
    if (window && window.x > 10 && window.y > SPREAD + 1 && window.x < canvas.clientWidth - 10 && window.y < canvas.clientHeight - 1 && scene.pickPositionSupported) {
      const point = scene.pickPosition(window);
      if (!point) {
        return look;
      }
      // from the point to one read on the screen, if it is on the same surface
      const fromPoint = (/** @type {number} */ x, /** @type {number} */ y) => {
        const near = scene.pickPosition(Cartesian2.fromElements(x, y, nearWindowScratch));
        return near && Cartesian3.distance(near, point) < SAME_SURFACE ? Cartesian3.subtract(near, point, near) : undefined;
      };
      const across = fromPoint(window.x + SPREAD, window.y);
      const up = fromPoint(window.x, window.y - SPREAD);
      let normal;
      if (across && up) {
        normal = Cartesian3.cross(across, up, new Cartesian3());
      } else if (across) {
        // only beside: a wall, upright
        normal = Cartesian3.cross(scene.ellipsoid.geodeticSurfaceNormal(point, new Cartesian3()), across, new Cartesian3());
      }
      if (!normal || Cartesian3.magnitude(normal) < CesiumMath.EPSILON6) {
        normal = Cartesian3.negate(toward, new Cartesian3());
      }
      Cartesian3.normalize(normal, normal);
      if (Cartesian3.dot(normal, Cartesian3.subtract(eye, point, towardScratch)) < 0) {
        Cartesian3.negate(normal, normal);
      }
      look.point = point;
      look.normal = normal;
    }
    return look;
  }
}

/**
 * The obstacle ahead of a mover in a 3D tileset, by rays cast on its loaded tiles on the CPU: in any
 * direction, without reading the depth, which waits for the GPU. For a walker's obstacleAhead. The walls are
 * taken as upright, as buildings' are; each ray takes a few milliseconds, as Cesium reads the tiles' geometry
 * back from the GPU.
 * FIXME: Cesium3DTileset.pick and Scene.frameState are private, https://github.com/CesiumGS/cesium/issues/13901
 * @param {import('@cesium/engine').Scene} scene
 * @param {import('@cesium/engine').Cesium3DTileset} tileset
 * @param {Cartesian3} eye Where the mover is.
 * @param {Cartesian3} toward The unit direction of the steps, level.
 * @param {number} [reach=1] How far ahead, in meters.
 * @return {Obstacle | undefined}
 */
export function tilesetObstacle(scene, tileset, eye, toward, reach = 1) {
  // @ts-expect-error the scene's frame state is private
  const frameState = scene.frameState;
  const pick = (/** @type {Cartesian3} */ origin) => {
    Cartesian3.clone(origin, rayScratch.origin);
    Cartesian3.clone(toward, rayScratch.direction);
    // @ts-expect-error the tileset's pick is private
    const hit = tileset.pick(rayScratch, frameState);
    return hit && Cartesian3.distance(hit, origin) <= reach ? hit : undefined;
  };
  const point = pick(eye);
  if (!point) {
    return undefined;
  }
  const up = scene.ellipsoid.geodeticSurfaceNormal(eye, upScratch);
  const side = Cartesian3.normalize(Cartesian3.cross(toward, up, besideScratch), besideScratch);
  const beside = pick(Cartesian3.add(eye, Cartesian3.multiplyByScalar(side, BESIDE, besideScratch), besideScratch));
  let normal;
  if (beside) {
    // upright, across the wall
    normal = Cartesian3.cross(up, Cartesian3.subtract(beside, point, beside), new Cartesian3());
  }
  if (!normal || Cartesian3.magnitude(normal) < CesiumMath.EPSILON6) {
    normal = Cartesian3.negate(toward, new Cartesian3());
  }
  Cartesian3.normalize(normal, normal);
  if (Cartesian3.dot(normal, Cartesian3.subtract(eye, point, towardScratch)) < 0) {
    Cartesian3.negate(normal, normal);
  }
  return {point: Cartesian3.clone(point), normal};
}
