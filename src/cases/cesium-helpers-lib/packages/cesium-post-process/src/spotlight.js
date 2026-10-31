import {Cartesian4, PixelDatatype} from '@cesium/core';
import {PostProcessStage, PostProcessStageComposite} from '@cesium/engine';
import {acquireTerrainDepth, releaseTerrainDepth} from './depth-test.js';
import Effect from './effect.js';
import {eyeFocus} from './focus.js';
import {heightUniforms} from './height.js';
import Beam from './shaders/Beam.js';
import EyeFromDepth from './shaders/EyeFromDepth.js';
import Filmic from './shaders/Filmic.js';
import Hash from './shaders/Hash.js';
import Noise from './shaders/Noise.js';
import Normal from './shaders/Normal.js';
import SpotlightShader from './shaders/Spotlight.js';
import SpotlightBeam from './shaders/SpotlightBeam.js';
import SpotlightBeamBlur from './shaders/SpotlightBeamBlur.js';
import SpotlightCone from './shaders/SpotlightCone.js';

const focusScratch = new Cartesian4();

/**
 * A searchlight above the focus, pointing down: it throws a pool of warm
 * light on the scene, shades the relief under it and lights up the haze in
 * its beam, the rest darkens.
 */
export default class Spotlight extends Effect {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {{focus?: import('./focus.js').Focus, power?: number, radius?: number, softness?: number, darkness?: number, beam?: number, beamAnisotropy?: number}} [options]
   */
  constructor(viewer, options = {}) {
    super(viewer);
    this.focus_ = options.focus;
    this.power_ = options.power ?? 1;
    this.radius_ = options.radius ?? 200;
    this.softness_ = options.softness ?? 0.5;
    this.darkness_ = options.darkness ?? 0.8;
    this.beam_ = options.beam ?? 0.25;
    this.beamAnisotropy_ = options.beamAnisotropy ?? 0.4;
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  createStage_(scene) {
    // SpotlightCone's uniforms, for all the passes
    const cone = {
      focus: () => eyeFocus(scene, this.focus_, focusScratch),
      up: heightUniforms(scene).up,
      radius: () => this.radius_,
      softness: () => this.softness_,
    };
    // the beam is raymarched at half the resolution, then blurred at it
    const beam = new PostProcessStage({
      fragmentShader: EyeFromDepth + Hash + Noise + SpotlightCone + Beam + SpotlightBeam,
      uniforms: {
        ...cone,
        beam: () => this.beam_,
        beamAnisotropy: () => this.beamAnisotropy_,
      },
      textureScale: 0.5,
      pixelDatatype: PixelDatatype.HALF_FLOAT,
    });
    const blurredBeam = new PostProcessStage({
      fragmentShader: SpotlightBeamBlur,
      uniforms: {beamTexture: beam.name},
      textureScale: 0.5,
      pixelDatatype: PixelDatatype.HALF_FLOAT,
    });
    return new PostProcessStageComposite({
      stages: [
        beam,
        blurredBeam,
        new PostProcessStage({
          fragmentShader: EyeFromDepth + Normal + Filmic + SpotlightCone + SpotlightShader,
          uniforms: {
            ...cone,
            beamTexture: blurredBeam.name,
            darkness: () => this.darkness_,
            beam: () => this.beam_,
            power: () => this.power_,
          },
        }),
      ],
      // the light is drawn over the scene, not over the beam
      inputPreviousStageTexture: false,
    });
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
   * What to light: a position, a function returning one, or undefined for
   * what is in the middle of the screen.
   */
  get focus() {
    return this.focus_;
  }

  set focus(value) {
    this.focus_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * Brightness of the light, 1 for the searchlight: the pool on the scene
   * and the beam in the air scale with it.
   */
  get power() {
    return this.power_;
  }

  set power(value) {
    this.power_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * Radius of the pool of light on flat ground, in meters. The light hangs
   * twice as high above the focus.
   */
  get radius() {
    return this.radius_;
  }

  set radius(value) {
    this.radius_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * Width of the penumbra, as a fraction of the radius.
   */
  get softness() {
    return this.softness_;
  }

  set softness(value) {
    this.softness_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * Darkening outside the light, 0 to 1.
   */
  get darkness() {
    return this.darkness_;
  }

  set darkness(value) {
    this.darkness_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * Brightness of the beam in the air, 0 to 1.
   */
  get beam() {
    return this.beam_;
  }

  set beam(value) {
    this.beam_ = value;
    this.viewer.scene.requestRender();
  }

  /**
   * Henyey-Greenstein asymmetry of the haze, 0 to 1: it scatters mostly
   * forward, so the beam is brighter when looking toward the light.
   */
  get beamAnisotropy() {
    return this.beamAnisotropy_;
  }

  set beamAnisotropy(value) {
    this.beamAnisotropy_ = value;
    this.viewer.scene.requestRender();
  }
}
