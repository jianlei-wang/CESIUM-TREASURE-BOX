import {Cartesian3, Ellipsoid, FixedFrameTransforms, Math as CesiumMath, Matrix4} from "@cesium/core";
import Controls from "@geoblocks/cesium-input";
import {ObstacleProbe, blockedStep, meshGroundHeight, meshObstacleAhead} from "@geoblocks/cesium-obstacles";

// in seconds: a frame after a backgrounded tab must not walk or fall far
const MAX_DELTA = 0.1;
// the head bob: a dip of DIP meters at each step of STEP_LENGTH meters, twice as deep when sprinting,
// and of LANDING meters when landing from a jump; both settle in about BOB_TIME seconds
const STEP_LENGTH = 0.8;
const DIP = 0.03;
const LANDING = 0.15;
const BOB_TIME = 0.15;
// in meters: nearer its height, the camera stays, so that a walker standing still renders no frame
const SETTLED = 1e-3;
// at a concave corner the slide along one wall heads into the other: a step is checked again along its slide, this
// many times at most, before it is taken
const SLIDE_PASSES = 3;
// in a corner, pushed out of one wall, the body may be in the other: it is pushed again, this many times at most
const CLEAR_PASSES = 3;

// the default bindings: W, A, S, D or the arrows to walk, Shift to sprint and Space to jump; on a gamepad, the
// left stick, at any speed and in any direction, Cross to sprint and Square to jump, as in GTA 5. Keys by
// event.code, so that other keyboard layouts walk with the keys in the same place
/** @satisfies {Record<string, import("@geoblocks/cesium-input").Binding>} */
export const WALK_BINDINGS = {
  move: {type: "vector", keys: {up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"]}, stick: "left"},
  sprint: {type: "button", keys: ["ShiftLeft", "ShiftRight"], buttons: [0]},
  jump: {type: "button", keys: ["Space"], buttons: [2]},
};

/** @typedef {{move: {x: number, y: number}, sprint: boolean, jump: boolean}} WalkIntent */

// the camera controller's settings off while walking: its navigation, and its collision detection, which lifts
// the camera onto the 3D tiles under it, a roof or a coarse tile still loading over the street, whenever the
// camera moves; the walk keeps its own height
const CONTROLLER_SETTINGS = /** @type {const} */ (["enableTranslate", "enableZoom", "enableRotate", "enableTilt", "enableCollisionDetection"]);

const normalScratch = new Cartesian3();
const forwardScratch = new Cartesian3();
const stepScratch = new Cartesian3();
const allowedScratch = new Cartesian3();
const awayScratch = new Cartesian3();
const frameScratch = new Matrix4();
const bodyScratch = new Cartesian3();
const upScratch = new Cartesian3();
const targetScratch = new Cartesian3();
const changeScratch = new Cartesian3();

/**
 * One step of a jump or a fall under gravity.
 * @param {number} offset Height above the walk height, in meters.
 * @param {number} velocity Upward speed, in meters per second.
 * @param {number} dt Seconds.
 * @param {number} gravity In meters per second squared.
 * @return {[number, number]} The next offset and velocity, [0, 0] once landed.
 */
function jumpStep(offset, velocity, dt, gravity) {
  const next = velocity - gravity * dt;
  const height = offset + ((velocity + next) / 2) * dt;
  return height <= 0 && next <= 0 ? [0, 0] : [height, next];
}

/**
 * Whether a jump starts: on a new press only, so that holding the button does not jump again on landing.
 * @param {boolean} pressed
 * @param {boolean} wasPressed
 * @param {boolean} grounded
 * @return {boolean}
 */
function jumpStart(pressed, wasPressed, grounded) {
  return pressed && !wasPressed && grounded;
}

export default class CesiumWalk {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {number} [speed=1.6] Walk speed in meters per second.
   * @param {number} [height=2.0] Height of the camera above the terrain.
   */
  constructor(viewer, speed = 1.6, height = 2.0) {
    /**
     * @type {import('@cesium/engine').CesiumWidget}
     */
    this.viewer = viewer;

    /**
     * @type {number}
     */
    this.speed = speed;

    /**
     * Speed while sprinting, in meters per second.
     * @type {number}
     */
    this.sprintSpeed = 3 * speed;

    /**
     * Upward speed at the start of a jump, in meters per second.
     * @type {number}
     */
    this.jumpSpeed = 4;

    /**
     * The gravity of jumps and falls, in meters per second squared.
     * @type {number}
     */
    this.gravity = 9.81;

    /**
     * How fast the walker reaches its speed, stops and turns, in meters per second squared; at once by
     * default.
     * @type {number}
     */
    this.acceleration = Infinity;

    /**
     * The deepest drop of the ground the walker steps down, in meters: deeper, off a ledge or a roof, it
     * falls. By default it follows the ground whatever the drop.
     * @type {number}
     */
    this.stepHeight = Infinity;

    /**
     * @type {number}
     */
    this.height = height;

    /**
     * @type {boolean}
     */
    this.active_ = false;

    /**
     * @type {number}
     */
    this.lastTick_ = 0;

    /**
     * Where the walker's intent comes from, read on each tick: {move: {x, y}, sprint, jump}, move no longer
     * than 1, x right and y forward. The keyboard and the first gamepad by default, with WALK_BINDINGS; any
     * object with a read() method otherwise: touch controls, an AI, a replay. The walk turns its active on
     * and off with its own: replace it while the walk is not active.
     * @type {{read(): WalkIntent, active?: boolean}}
     */
    this.input = new Controls(WALK_BINDINGS);

    // the walker's velocity, level, on the globe
    this.velocity_ = new Cartesian3();

    // the ground under the walker on the last tick, which it keeps its height above while in the air
    /** @type {number | undefined} */
    this.ground_ = undefined;

    // the jump or the fall: height above the walk height and upward speed; whether the jump input was down
    // last tick
    this.jumpOffset_ = 0;
    this.jumpVelocity_ = 0;
    this.jumpHeld_ = false;

    /**
     * Whether the camera bobs at each step and dips on landing, as in GTA 5's first person.
     * @type {boolean}
     */
    this.headBob = false;

    /**
     * Whether the walker stops at the obstacles in view at eye height: opaque 3D tiles or primitives.
     * @type {boolean}
     */
    this.collision = false;

    this.obstacleProbe_ = new ObstacleProbe(viewer.scene);

    /**
     * The obstacle ahead of the walker in a direction, a point of its plane and its normal toward the walker,
     * if any; asked for each step while collision is on. By default the obstacles in view, read in the depth
     * of the last frame, which waits for the GPU; for a world known on the CPU, a ray cast in every direction.
     * @type {(toward: Cartesian3, key: string) => import('@geoblocks/cesium-obstacles').Obstacle | undefined}
     */
    this.obstacleAhead = (toward, key) => this.obstacleProbe_.ahead(toward, key);

    /**
     * The walker's body: how far from the walls it keeps, in meters, pushed out of any it walks past, sideways
     * or at a corner, where no ray ahead meets it; 0 by default, a walker without a body.
     * @type {number}
     */
    this.radius = 0;

    /**
     * The surface nearest the walker's body, within its radius: a point of it, the surface's normal toward the
     * body, and the point of the body it is nearest, if any; asked after each step while collision is on. None by
     * default, as the obstacles in view tell nothing about what is beside the walker; walkOn gives the mesh's.
     * @type {() => {point: Cartesian3, normal: Cartesian3, origin: Cartesian3} | undefined}
     */
    this.surfaceNear = () => undefined;

    /**
     * The height of the ground under a position, in meters above the ellipsoid, or undefined when unknown
     * yet. The terrain by default, none without a globe; a model's floors otherwise, for a walker on several levels.
     * @type {(position: import('@cesium/core').Cartographic) => number | undefined}
     */
    this.groundHeight = position => viewer.scene.globe?.getHeight(position);

    // whether the walker sprinted on the last tick
    this.sprinting_ = false;

    // the camera controller's settings before walking
    /** @type {Partial<Record<typeof CONTROLLER_SETTINGS[number], boolean>>} */
    this.controllerSettings_ = {};

    // the head bob: how deep, 0 standing to 2 sprinting, along the steps; the landing dip, 0 to 1
    this.bob_ = 0;
    this.stepPhase_ = 0;
    this.landing_ = 0;

    this.handleTickFunction_ = this.handleTick_.bind(this);
  }

  get active() {
    return this.active_;
  }

  /**
   * Whether the walker is sprinting.
   * @return {boolean}
   */
  get sprinting() {
    return this.active_ && this.sprinting_;
  }

  set active(active) {
    if (active === this.active_) {
      return;
    }
    this.active_ = active;
    const controller = this.viewer.scene.screenSpaceCameraController;
    if (this.active_) {
      for (const setting of CONTROLLER_SETTINGS) {
        this.controllerSettings_[setting] = controller[setting];
        controller[setting] = false;
      }
      this.lastTick_ = performance.now();
      this.input.active = true;
      this.viewer.clock.onTick.addEventListener(this.handleTickFunction_);
      this.clampCameraToTerrain_();
    } else {
      this.input.active = false;
      this.viewer.clock.onTick.removeEventListener(this.handleTickFunction_);
      this.jumpOffset_ = 0;
      this.jumpVelocity_ = 0;
      this.ground_ = undefined;
      Cartesian3.clone(Cartesian3.ZERO, this.velocity_);
      this.bob_ = 0;
      this.landing_ = 0;
      Object.assign(controller, this.controllerSettings_);
    }
  }

  handleTick_() {
    const timestamp = performance.now();
    const deltaTime = Math.min((timestamp - this.lastTick_) / 1000, MAX_DELTA);
    this.lastTick_ = timestamp;

    const {move, sprint, jump} = this.input.read();
    let forward = move.y;
    let right = move.x;
    // walking diagonally is not faster
    const magnitude = Math.hypot(forward, right);
    if (magnitude > 1) {
      forward /= magnitude;
      right /= magnitude;
    }

    const grounded = this.jumpOffset_ === 0 && this.jumpVelocity_ === 0;
    if (jumpStart(jump, this.jumpHeld_, grounded)) {
      this.jumpVelocity_ = this.jumpSpeed;
    }
    this.jumpHeld_ = jump;
    const airborne = this.jumpOffset_ > 0 || this.jumpVelocity_ > 0;

    const moving = forward !== 0 || right !== 0;
    // forward, no more sideways than diagonally, as in GTA 5
    this.sprinting_ = sprint && forward > 0 && forward >= Math.abs(right);
    const stopped = Cartesian3.equals(this.velocity_, Cartesian3.ZERO);
    if (!moving && stopped && !airborne && this.bob_ === 0 && this.landing_ === 0) {
      // standing: only the terrain refining under the walker moves it
      this.clampCameraToTerrain_();
      return;
    }

    const camera = this.viewer.camera;
    const speed = this.sprinting_ ? this.sprintSpeed : this.speed;
    // walk along the view direction projected onto the ground plane,
    // so that looking down does not push the camera into the terrain
    const normal = this.surfaceNormal_();
    const along = Cartesian3.subtract(
      camera.direction,
      Cartesian3.projectVector(camera.direction, normal, forwardScratch),
      forwardScratch
    );
    const level = Cartesian3.magnitude(along) > CesiumMath.EPSILON6;
    if (level) {
      Cartesian3.normalize(along, along);
    }
    // the velocity, toward the intended one as fast as the acceleration allows
    const target = Cartesian3.multiplyByScalar(camera.right, right * speed, targetScratch);
    if (level) {
      Cartesian3.add(target, Cartesian3.multiplyByScalar(along, forward * speed, changeScratch), target);
    }
    const change = Cartesian3.subtract(target, this.velocity_, changeScratch);
    const needed = Cartesian3.magnitude(change);
    const allowed = this.acceleration * deltaTime;
    if (needed <= allowed) {
      Cartesian3.clone(target, this.velocity_);
    } else {
      Cartesian3.add(this.velocity_, Cartesian3.multiplyByScalar(change, allowed / needed, change), this.velocity_);
    }
    const forwardSpeed = level ? Cartesian3.dot(this.velocity_, along) : 0;
    const rightSpeed = Cartesian3.dot(this.velocity_, camera.right);
    if (forwardSpeed !== 0) {
      this.step_(along, forwardSpeed * deltaTime, "forward");
    }
    if (rightSpeed !== 0) {
      this.step_(camera.right, rightSpeed * deltaTime, "right");
    }
    if (airborne) {
      [this.jumpOffset_, this.jumpVelocity_] = jumpStep(this.jumpOffset_, this.jumpVelocity_, deltaTime, this.gravity);
      if (this.headBob && this.jumpOffset_ === 0) {
        this.landing_ = 1;
      }
    }
    // the head bob, which settles once turned off
    const ease = 1 - Math.exp(-deltaTime / BOB_TIME);
    const bob = this.headBob && moving && !airborne ? (this.sprinting_ ? 2 : 1) : 0;
    this.bob_ += (bob - this.bob_) * ease;
    this.landing_ -= this.landing_ * ease;
    // the last thousandth in one step, so that the camera stops moving
    if (bob === 0 && this.bob_ < 1e-3) {
      this.bob_ = 0;
    }
    if (this.landing_ < 1e-3) {
      this.landing_ = 0;
    }
    this.stepPhase_ += (Cartesian3.magnitude(this.velocity_) * deltaTime / STEP_LENGTH) * CesiumMath.PI;
    this.clampCameraToTerrain_();
  }

  /**
   * Moves the camera a step, stopping at obstacles or sliding along them; a slide is checked against the obstacles
   * ahead of it in turn, so that at a concave corner it stops at the second wall rather than going through it.
   * @param {Cartesian3} direction The unit direction of the step, level.
   * @param {number} step The length of the step, negative backward, in meters.
   * @param {string} kind Which steps these are, for the obstacle looked for last time.
   */
  step_(direction, step, kind) {
    const camera = this.viewer.camera;
    let toward = Cartesian3.multiplyByScalar(direction, Math.sign(step), stepScratch);
    let length = Math.abs(step);
    for (let pass = 0; pass < SLIDE_PASSES && length > 0; pass++) {
      // a slide's look is its own, not the step's: the probe keeps its last look in each direction by its key
      const obstacle = this.collision ? this.obstacleAhead(toward, `${kind}${Math.sign(step)}${pass ? "slide" : ""}`) : undefined;
      const allowed = blockedStep(toward, length, camera.positionWC, obstacle, allowedScratch);
      const same = Cartesian3.equalsEpsilon(allowed.direction, toward, CesiumMath.EPSILON9);
      length = allowed.length;
      toward = Cartesian3.clone(allowed.direction, stepScratch);
      if (same) {
        break;
      }
    }
    if (length > 0) {
      camera.move(toward, length);
    }
    if (this.collision) {
      this.keepClear_();
    }
  }

  /**
   * Pushes the camera level out of the walls the walker's body is in, each in turn.
   */
  keepClear_() {
    const camera = this.viewer.camera;
    for (let pass = 0; pass < CLEAR_PASSES; pass++) {
      const surface = this.surfaceNear();
      if (!surface) {
        return;
      }
      const up = this.surfaceNormal_();
      // level, from the surface to the body; a surface straight above or below it is left to the walker's ground
      const away = Cartesian3.subtract(surface.origin, surface.point, awayScratch);
      Cartesian3.subtract(away, Cartesian3.projectVector(away, up, stepScratch), away);
      const distance = Cartesian3.magnitude(away);
      if (distance >= this.radius) {
        return;
      }
      if (distance > CesiumMath.EPSILON6) {
        Cartesian3.divideByScalar(away, distance, away);
      } else {
        Cartesian3.subtract(surface.normal, Cartesian3.projectVector(surface.normal, up, stepScratch), away);
        if (Cartesian3.magnitude(away) < CesiumMath.EPSILON6) {
          return;
        }
        Cartesian3.normalize(away, away);
      }
      camera.move(away, this.radius - distance);
    }
  }

  clampCameraToTerrain_() {
    const camera = this.viewer.camera;
    const terrainHeight = this.groundHeight(camera.positionCartographic);
    if (terrainHeight === undefined) {
      // ground not loaded yet at this position
      return;
    }
    if (this.ground_ !== undefined) {
      // in the air, or off a drop deeper than a step, the walker keeps its height and falls the rest
      const drop = this.ground_ - terrainHeight;
      if (this.jumpOffset_ > 0 || this.jumpVelocity_ !== 0 || drop > this.stepHeight) {
        this.jumpOffset_ += drop;
        if (this.jumpOffset_ <= 0) {
          // on the ground again: landed, or lifted by the ground while still going up
          this.jumpOffset_ = 0;
          if (this.jumpVelocity_ <= 0) {
            this.jumpVelocity_ = 0;
            if (this.headBob) {
              this.landing_ = 1;
            }
          }
        }
      }
    }
    this.ground_ = terrainHeight;
    const cameraHeight = camera.positionCartographic.height;

    // move along the surface normal, not the camera up vector, which is
    // tilted when the camera is pitched
    const bob = DIP * this.bob_ * Math.abs(Math.sin(this.stepPhase_)) + LANDING * this.landing_;
    const offset = terrainHeight + this.height + this.jumpOffset_ - bob - cameraHeight;
    if (Math.abs(offset) > SETTLED) {
      camera.move(this.surfaceNormal_(), offset);
    }
  }

  /**
   * @return {import('@cesium/core').Cartesian3} The ellipsoid surface normal at the camera position.
   */
  surfaceNormal_() {
    const scene = this.viewer.scene;
    return scene.ellipsoid.geodeticSurfaceNormal(scene.camera.position, normalScratch);
  }
}

/**
 * The heights above the floor the walls are looked for at: the knees, the waist and the eyes.
 * @param {number} eye
 * @param {number} step
 * @return {number[]} In meters, from the lowest.
 */
export function rayHeights(eye, step) {
  return [step + 0.05, (step + eye) / 2, eye];
}

/**
 * Walks a CesiumWalk on a triangle mesh of cesium-obstacles: it stands on the highest floor below its knees, up
 * the stairs, under the arches, else on what it stood on before (the terrain); the walls ahead stop it, from rays
 * cast at the knees, the waist and the eyes, the floors and stairs left to the ground below, in every direction;
 * with a radius, its body at those heights is kept that far from the walls beside it too, a step's riser under
 * the knees excepted.
 * @param {CesiumWalk} walk
 * @param {import("@geoblocks/cesium-obstacles").TriangleMesh} mesh
 * @param {{eye: number, step: number, reach: number, radius?: number}} options In meters: the eyes above the
 *     floor, the highest step, how far ahead the walls are looked for, the body's radius (none by default).
 */
export function walkOn(walk, mesh, {eye, step, reach, radius = 0}) {
  const camera = walk.viewer.scene.camera;
  const fallback = walk.groundHeight;
  const offsets = rayHeights(eye, step).map(height => new Cartesian3(0, 0, height - eye));
  walk.obstacleAhead = meshObstacleAhead(mesh, () => camera.positionWC, {offsets, reach});
  walk.radius = radius;
  if (radius > 0) {
    walk.surfaceNear = () => {
      const position = camera.positionWC;
      const frame = FixedFrameTransforms.eastNorthUpToFixedFrame(position, Ellipsoid.WGS84, frameScratch);
      const up = Ellipsoid.WGS84.geodeticSurfaceNormal(position, upScratch);
      let nearest;
      for (const [k, offset] of offsets.entries()) {
        const origin = Matrix4.multiplyByPoint(frame, offset, bodyScratch);
        const hit = mesh.nearest(origin, radius, {walls: true});
        // under the knees, a step's riser: climbed, not kept from
        if (!hit || (k === 0 && Cartesian3.dot(Cartesian3.subtract(hit.position, origin, awayScratch), up) < 0)) {
          continue;
        }
        if (!nearest || hit.distance < nearest.distance) {
          nearest = {point: hit.position, normal: hit.normal, origin: Cartesian3.clone(origin), distance: hit.distance};
        }
      }
      return nearest;
    };
  }
  const ground = meshGroundHeight(mesh, {below: eye - step});
  walk.groundHeight = cartographic => ground(cartographic) ?? fallback(cartographic);
}
