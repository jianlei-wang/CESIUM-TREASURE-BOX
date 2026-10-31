import {Cartesian4, Math as CesiumMath} from '@cesium/core';
import {PostProcessStage} from '@cesium/engine';
import Effect from './effect.js';
import {acquireFrames, releaseFrames} from './frame-clock.js';
import JelloShader from './shaders/Jello.js';

// the shake renders at this rate, like a video camera
const FRAME_RATE = 30;
// the shake's sinusoids, as multiples of the frequency, and their share of the amount, so that
// it looks like noise rather than a single wave
const HARMONICS = [1, 1.37, 2.11, 3.07];
const WEIGHTS = [1, 0.6, 0.35, 0.2];
// the most the sinusoids reach together, as multiples of the first one's amplitude
const PEAK = WEIGHTS.reduce((sum, weight) => sum + weight, 0);
// at full amount: shift in picture heights, rotation in radians
const MAX_SHIFT = 0.015;
const MAX_ROTATION = 0.008;
// amplitude of the first sinusoid at full amount, per axis: x, y, rotation
const MAX_AMPLITUDES = [MAX_SHIFT, 0.5 * MAX_SHIFT, MAX_ROTATION];

const TAU = CesiumMath.TWO_PI;
/** @type {('x' | 'y' | 'z' | 'w')[]} one sinusoid per component */
const COMPONENTS = ['x', 'y', 'z', 'w'];

/**
 * The jello of a vibrating camera with a rolling shutter: straight edges
 * wobble as each row of the sensor is read at a different moment of the
 * shake. The camera moves, so while active with an amount the scene renders
 * at 30 frames per second, also in requestRenderMode.
 */
export default class Jello extends Effect {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {{amount?: number, frequency?: number}} [options]
   */
  constructor(viewer, options = {}) {
    super(viewer);
    this.amount_ = options.amount ?? 0.1;
    this.frequency_ = options.frequency ?? 30;
    // a random starting phase for each sinusoid and axis
    this.offsets_ = HARMONICS.map(() => [Math.random(), Math.random(), Math.random()].map((r) => r * TAU));
    // the uniforms, updated when the amount or the frequency change (the shape) and
    // once per frame (the phases)
    this.shakeHz_ = new Cartesian4();
    this.amplitudes_ = [new Cartesian4(), new Cartesian4(), new Cartesian4()];
    this.zoom_ = 1;
    this.phases_ = [new Cartesian4(), new Cartesian4(), new Cartesian4()];
    this.updateShape_();
    // the phases of the sinusoids at the frame's time, reduced in double precision:
    // a float would lose the time's fraction of a second
    this.onPreRender_ = () => {
      const seconds = performance.now() / 1000;
      HARMONICS.forEach((h, i) => {
        const phase = TAU * ((h * this.frequency_ * seconds) % 1);
        this.phases_.forEach((phases, axis) => {
          phases[COMPONENTS[i]] = (phase + this.offsets_[i][axis]) % TAU;
        });
      });
    };
  }

  /** @override */
  createStage_() {
    const stage = new PostProcessStage({
      fragmentShader: JelloShader,
      uniforms: {
        shakeHz: () => this.shakeHz_,
        phaseX: () => this.phases_[0],
        phaseY: () => this.phases_[1],
        phaseRotation: () => this.phases_[2],
        amplitudeX: () => this.amplitudes_[0],
        amplitudeY: () => this.amplitudes_[1],
        amplitudeRotation: () => this.amplitudes_[2],
        zoom: () => this.zoom_,
      },
    });
    // no pass, and no frames, without an amount
    stage.enabled = this.amount_ > 0;
    return stage;
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  activated_(scene) {
    scene.preRender.addEventListener(this.onPreRender_);
    if (this.amount_ > 0) {
      acquireFrames(scene, FRAME_RATE);
    }
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  deactivating_(scene) {
    if (this.amount_ > 0) {
      releaseFrames(scene, FRAME_RATE);
    }
    scene.preRender.removeEventListener(this.onPreRender_);
  }

  updateShape_() {
    HARMONICS.forEach((h, i) => {
      this.shakeHz_[COMPONENTS[i]] = h * this.frequency_;
      this.amplitudes_.forEach((amplitudes, axis) => {
        amplitudes[COMPONENTS[i]] = WEIGHTS[i] * MAX_AMPLITUDES[axis] * this.amount_;
      });
    });
    // enough to hide the edges when all the sinusoids peak together: the shift, and the
    // rotation of the corners, about a picture height from the middle
    this.zoom_ = 1 + 2 * PEAK * this.amount_ * (MAX_SHIFT + MAX_ROTATION);
  }

  /**
   * Strength of the shake, 0 to 1.
   */
  get amount() {
    return this.amount_;
  }

  set amount(value) {
    const shaking = this.amount_ > 0;
    this.amount_ = value;
    this.updateShape_();
    if (this.stage_ && shaking !== value > 0) {
      this.stage_.enabled = value > 0;
      (value > 0 ? acquireFrames : releaseFrames)(this.viewer.scene, FRAME_RATE);
    }
    this.viewer.scene.requestRender();
  }

  /**
   * Frequency of the vibration, in Hz: the rows read over the 20 ms readout
   * see a fifth of a wave at 10 Hz, more than a whole one at 60 Hz.
   */
  get frequency() {
    return this.frequency_;
  }

  set frequency(value) {
    this.frequency_ = value;
    this.updateShape_();
  }
}
