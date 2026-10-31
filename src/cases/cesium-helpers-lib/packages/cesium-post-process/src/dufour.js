import {Cartesian3, Color, FixedFrameTransforms, Math as CesiumMath, Matrix3, Matrix4} from '@cesium/core';
import {PostProcessStage} from '@cesium/engine';
import {acquireTerrainDepth, releaseTerrainDepth} from './depth-test.js';
import Effect from './effect.js';
import {heightUniforms} from './height.js';
import DepthEdges from './shaders/DepthEdges.js';
import DufourShader from './shaders/Dufour.js';
import EyeFromDepth from './shaders/EyeFromDepth.js';
import Hash from './shaders/Hash.js';
import Height from './shaders/Height.js';
import Normal from './shaders/Normal.js';

// how far the camera moves over the ground, in meters, before the hachures' frame follows it: they jump then
const REBASE = 20000;

const originECScratch = new Cartesian3();
const eastScratch = new Cartesian3();
const northScratch = new Cartesian3();
const surfaceScratch = new Cartesian3();
const frameScratch = new Matrix4();
const paperScratch = new Cartesian3();
const inkScratch = new Cartesian3();

/**
 * The look of the Dufour map, the Swiss topographic map of the 1850s: the slopes drawn in hachures, ink strokes down
 * the steepest slope, straight and broken along their length, thicker where it is steeper and on the slopes away from a light from
 * the north-west, the flat ground left blank, black ink on white paper.
 * The strokes are fixed to the ground: they stay put as the camera moves, a power of two of meters apart, the next
 * power faded in as they grow closer than `spacing` pixels.
 */
export default class Dufour extends Effect {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {{spacing?: number, strokeLength?: number, weight?: number, oblique?: number, flatSlope?: number, outline?: number, jump?: number, paper?: Color, ink?: Color}} [options]
   */
  constructor(viewer, options = {}) {
    super(viewer);
    this.spacing_ = options.spacing ?? 3.5;
    this.strokeLength_ = options.strokeLength ?? 14;
    this.weight_ = options.weight ?? 1;
    this.oblique_ = options.oblique ?? 0.8;
    this.flatSlope_ = options.flatSlope ?? 4;
    this.outline_ = options.outline ?? 0.8;
    this.jump_ = options.jump ?? 20;
    this.paper_ = options.paper ?? Color.fromCssColorString('#f7f3ea');
    this.ink_ = options.ink ?? Color.fromCssColorString('#1d1b19');
    /** @type {Cartesian3 | undefined} */
    this.origin_ = undefined;
    // east, north and up at the origin
    this.frame_ = new Matrix3();
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  createStage_(scene) {
    const toEye = (/** @type {number} */ column, /** @type {Cartesian3} */ result) => {
      this.follow_(scene);
      Matrix3.getColumn(this.frame_, column, result);
      return Matrix4.multiplyByPointAsVector(scene.camera.viewMatrix, result, result);
    };
    return new PostProcessStage({
      fragmentShader: EyeFromDepth + DepthEdges + Height + Normal + Hash + DufourShader,
      uniforms: {
        ...heightUniforms(scene),
        spacing: () => this.spacing_,
        strokeLength: () => this.strokeLength_,
        weight: () => this.weight_,
        oblique: () => this.oblique_,
        flatSlope: () => CesiumMath.toRadians(this.flatSlope_),
        outline: () => this.outline_,
        jump: () => this.jump_,
        paper: () => Cartesian3.fromElements(this.paper_.red, this.paper_.green, this.paper_.blue, paperScratch),
        ink: () => Cartesian3.fromElements(this.ink_.red, this.ink_.green, this.ink_.blue, inkScratch),
        originEC: () => {
          this.follow_(scene);
          return Matrix4.multiplyByPoint(scene.camera.viewMatrix, /** @type {Cartesian3} */ (this.origin_), originECScratch);
        },
        eastEC: () => toEye(0, eastScratch),
        northEC: () => toEye(1, northScratch),
      },
    });
  }

  /**
   * Moves the hachures' frame under the camera once it is REBASE meters away over the ground.
   * @private
   * @param {import('@cesium/engine').Scene} scene
   */
  follow_(scene) {
    const surface = scene.ellipsoid.scaleToGeodeticSurface(scene.camera.positionWC, surfaceScratch);
    if (!surface || (this.origin_ && Cartesian3.distance(surface, this.origin_) < REBASE)) {
      return;
    }
    this.origin_ = Cartesian3.clone(surface, this.origin_);
    Matrix4.getMatrix3(FixedFrameTransforms.eastNorthUpToFixedFrame(this.origin_, scene.ellipsoid, frameScratch), this.frame_);
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  activated_(scene) {
    acquireTerrainDepth(scene);
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  deactivating_(scene) {
    releaseTerrainDepth(scene);
  }

  /**
   * The strokes' spacing on the screen, in pixels: the closest they get before the next power of two of meters
   * takes over.
   */
  get spacing() {
    return this.spacing_;
  }

  set spacing(value) {
    this.spacing_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * A stroke's length between its breaks, in spacings, on average.
   */
  get strokeLength() {
    return this.strokeLength_;
  }

  set strokeLength(value) {
    this.strokeLength_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * The ink's weight: 1 for Lehmann's scale stretched for the Alps, the share of the spacing a stroke covers growing
   * with the slope, all of it at 60 degrees, before the light.
   */
  get weight() {
    return this.weight_;
  }

  set weight(value) {
    this.weight_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * How much thinner the strokes on the slopes facing the north-west light, and thicker away from it, 0 to 1.
   */
  get oblique() {
    return this.oblique_;
  }

  set oblique(value) {
    this.oblique_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * The slope under which the ground is left blank, in degrees.
   */
  get flatSlope() {
    return this.flatSlope_;
  }

  set flatSlope(value) {
    this.flatSlope_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * How dark the outline along the silhouettes, 0 for none.
   */
  get outline() {
    return this.outline_;
  }

  set outline(value) {
    this.outline_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * How far the depth jumps, in pixels' sizes, to be a silhouette, outlined: 20 by default.
   */
  get jump() {
    return this.jump_;
  }

  set jump(value) {
    this.jump_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * The paper's color, and the sky's.
   */
  get paper() {
    return this.paper_;
  }

  set paper(value) {
    this.paper_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * The ink's color.
   */
  get ink() {
    return this.ink_;
  }

  set ink(value) {
    this.ink_ = value;
    this.viewer.scene.requestRender();
  }
}
