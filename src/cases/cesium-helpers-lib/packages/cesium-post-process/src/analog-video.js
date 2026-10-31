import {Math as CesiumMath} from '@cesium/core';
import {PostProcessStage} from '@cesium/engine';
import Effect from './effect.js';
import {acquireFrames, releaseFrames} from './frame-clock.js';
import AnalogVideoShader from './shaders/AnalogVideo.js';
import Hash from './shaders/Hash.js';

// PAL video runs at 25 frames per second, as in AnalogVideo.glsl
const FRAME_RATE = 25;
// the strength of the signal fades in and out at this rate, in changes per second
const FADE_RATE = 0.4;
// the sync is lost for a frame or two now and then, up to this many times per second when the
// signal is weak
const TEAR_RATE = 1.5;

const fract = (/** @type {number} */ x) => x - Math.floor(x);

/**
 * The shader's hash, in [0, 1), so that the values computed here per frame and
 * those computed there per pixel come from one family.
 * @param {number} x
 * @param {number} y
 * @return {number}
 */
export function hash(x, y) {
  let px = fract(x * 0.1031);
  let py = fract(y * 0.1031);
  let pz = px;
  const dot = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
  px += dot;
  py += dot;
  pz += dot;
  return fract((px + py) * pz);
}

/**
 * How the signal fares at a time, all the picture over: how weak it is, 0 to 1
 * (it wavers around the interference, and is 1 only without a signal); and,
 * in the frames where the receiver loses the sync, where the picture tears, as
 * a fraction of its height from the top, or -1.
 * @param {number} seconds
 * @param {number} interference 0 to 1
 * @return {{weak: number, tear: number}}
 */
export function signalAt(seconds, interference) {
  const fade = seconds * FADE_RATE;
  const t = fract(fade);
  const wander = hash(Math.floor(fade), 5) + (hash(Math.floor(fade) + 1, 5) - hash(Math.floor(fade), 5)) * t * t * (3 - 2 * t);
  const weak = interference >= 1 ? 1 : interference * (0.75 + 0.25 * wander);
  // a tear lasts two frames: decided once for each pair
  const pair = Math.floor((seconds * FRAME_RATE) / 2) % 1000;
  const chance = (2 * TEAR_RATE / FRAME_RATE) * CesiumMath.clamp((interference - 0.3) / 0.5, 0, 1);
  const tear = interference < 1 && hash(pair, 11) < chance ? 0.2 + 0.6 * hash(pair, 13) : -1;
  return {weak, tear};
}

/**
 * An analog FPV video feed: a soft, washed-out PAL picture with its color
 * bleeding sideways, which, as the signal weakens, loses its color, washes
 * out, fills with colored streaks along the video lines and tears when the
 * sync is lost, down to the dark snow of a receiver without a signal. The
 * picture moves, so while active the scene renders at 25 frames per second,
 * also in requestRenderMode.
 */
export default class AnalogVideo extends Effect {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {{noise?: number, interference?: number}} [options]
   */
  constructor(viewer, options = {}) {
    super(viewer);
    this.noise_ = options.noise ?? 0.5;
    this.interference_ = options.interference ?? 0.15;
    // the uniforms updated once per frame
    this.weak_ = 0;
    this.tear_ = -1;
    this.onPreRender_ = () => {
      const signal = signalAt(performance.now() / 1000, this.interference_);
      this.weak_ = signal.weak;
      this.tear_ = signal.tear;
    };
  }

  /** @override */
  createStage_() {
    return new PostProcessStage({
      fragmentShader: Hash + AnalogVideoShader,
      uniforms: {
        time: () => performance.now() / 1000,
        noise: () => this.noise_,
        weak: () => this.weak_,
        tear: () => this.tear_,
      },
    });
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  activated_(scene) {
    scene.preRender.addEventListener(this.onPreRender_);
    // a new picture only with each video frame, not with each frame of the display
    acquireFrames(scene, FRAME_RATE);
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  deactivating_(scene) {
    releaseFrames(scene, FRAME_RATE);
    scene.preRender.removeEventListener(this.onPreRender_);
  }

  /**
   * Grain, 0 to 1.
   */
  get noise() {
    return this.noise_;
  }

  set noise(value) {
    this.noise_ = value;
  }

  /**
   * How weak the signal is, 0 to 1: a few streaks when it is low, the color
   * lost from about 0.4, then a washed-out picture under more and more streaks,
   * torn when the sync is lost; 1 for no signal at all, the receiver's snow.
   */
  get interference() {
    return this.interference_;
  }

  set interference(value) {
    this.interference_ = value;
  }
}
