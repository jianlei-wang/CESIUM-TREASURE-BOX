import {Math as CesiumMath} from '@cesium/core';
import {PostProcessStage} from '@cesium/engine';
import Effect from './effect.js';
import {acquireFrames, releaseFrames} from './frame-clock.js';
import DigitalVideoShader from './shaders/DigitalVideo.js';
import Hash from './shaders/Hash.js';

// digital FPV video runs at this rate
const FRAME_RATE = 30;
// at full breakup, a breakup starts on average every this many seconds
const MIN_INTERVAL = 2;
// length of a breakup, in seconds, and of its black screen
const DURATION = [0.4, 1.5];
const BLACKOUT = 0.25;

/**
 * A digital FPV video feed: clean, then at times broken by a weak signal
 * into macroblocks, displaced blocks and strips and split colors, sometimes
 * with a short black screen. While active the scene renders at 30 frames per
 * second, also in requestRenderMode.
 */
export default class DigitalVideo extends Effect {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {{breakup?: number}} [options]
   */
  constructor(viewer, options = {}) {
    super(viewer);
    this.breakup_ = options.breakup ?? 0.5;
    // the current breakup: start and length in seconds, and whether it goes black
    /** @type {{start: number, duration: number, blackout: boolean} | undefined} */
    this.episode_ = undefined;
    // when the breakups were last updated, in seconds
    this.updated_ = 0;
    // the uniforms, updated once per frame
    this.severity_ = 0;
    this.blackout_ = 0;
    this.onPreRender_ = () => this.update_();
  }

  /** @override */
  createStage_() {
    return new PostProcessStage({
      fragmentShader: Hash + DigitalVideoShader,
      uniforms: {
        severity: () => this.severity_,
        blackout: () => this.blackout_,
        frame: () => Math.floor((performance.now() / 1000) * FRAME_RATE) % 100000,
      },
    });
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  activated_(scene) {
    this.updated_ = performance.now() / 1000;
    scene.preRender.addEventListener(this.onPreRender_);
    acquireFrames(scene, FRAME_RATE);
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  deactivating_(scene) {
    releaseFrames(scene, FRAME_RATE);
    scene.preRender.removeEventListener(this.onPreRender_);
    this.episode_ = undefined;
  }

  // before each render: end the finished breakup, start one with the chance of the time since the
  // last update, so that breakups start at the same rate whatever the frame rate (at most a second,
  // as a hidden page does not render), then how broken the picture is now: rising and falling over
  // the breakup, black around its middle
  update_() {
    const now = performance.now() / 1000;
    const elapsed = Math.min(now - this.updated_, 1);
    this.updated_ = now;
    if (this.episode_ && now > this.episode_.start + this.episode_.duration) {
      this.episode_ = undefined;
    }
    if (!this.episode_ && Math.random() < 1 - Math.exp((-this.breakup_ / MIN_INTERVAL) * elapsed)) {
      const duration = DURATION[0] + Math.random() * (DURATION[1] - DURATION[0]);
      this.episode_ = {start: now, duration, blackout: Math.random() < 0.5 * this.breakup_};
    }
    const episode = this.episode_;
    if (!episode) {
      this.severity_ = 0;
      this.blackout_ = 0;
      return;
    }
    const t = (now - episode.start) / episode.duration;
    this.severity_ = Math.max(0, Math.sin(CesiumMath.PI * Math.min(t, 1))) ** 0.7 * (0.4 + 0.6 * this.breakup_);
    this.blackout_ = episode.blackout && Math.abs(t - 0.5) * episode.duration < BLACKOUT / 2 ? 1 : 0;
  }

  /**
   * How often and how badly the signal breaks up, 0 to 1.
   */
  get breakup() {
    return this.breakup_;
  }

  set breakup(value) {
    this.breakup_ = value;
  }
}
