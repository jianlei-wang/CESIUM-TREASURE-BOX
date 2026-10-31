import {Cartesian3, Ellipsoid, Matrix4, PixelDatatype, Rectangle, Math as CesiumMath} from '@cesium/core';
import {PostProcessStage, PostProcessStageComposite, TextureMagnificationFilter, TextureMinificationFilter} from '@cesium/engine';
// @ts-expect-error the engine exports its 3D textures and samplers, but does not type them
import {Sampler, Texture3D, TextureWrap} from '@cesium/engine';
// @ts-expect-error the engine exports its textures, framebuffers and render states, but does not type them
import {Framebuffer, RenderState, Texture} from '@cesium/engine';
import {acquireCloudCover, releaseCloudCover} from './cloud-cover.js';
import createCloudMap from './cloud-map.js';
import createCloudNoise, {createMapNoise} from './cloud-noise.js';
import {acquireTerrainDepth, releaseTerrainDepth} from './depth-test.js';
import Effect from './effect.js';
import {acquireFrames, releaseFrames} from './frame-clock.js';
import {heightUniforms} from './height.js';
import CloudsBlur from './shaders/CloudsBlur.js';
import CloudsComposite from './shaders/CloudsComposite.js';
import CloudsDensity from './shaders/CloudsDensity.js';
import CloudsDepth from './shaders/CloudsDepth.js';
import CloudsMarch from './shaders/CloudsMarch.js';
import CloudsResolve from './shaders/CloudsResolve.js';
import CloudsShadow from './shaders/CloudsShadow.js';
import CloudsShadowMap from './shaders/CloudsShadowMap.js';
import CloudsSlab from './shaders/CloudsSlab.js';
import EyeFromDepth from './shaders/EyeFromDepth.js';
import Fog from './shaders/Fog.js';
import Height from './shaders/Height.js';
import Phase from './shaders/Phase.js';
import RainHaze from './shaders/RainHaze.js';
import WeatherMapShader from './shaders/WeatherMap.js';
import WeatherMap from './weather-map.js';

// the clouds are kilometers wide and soft: a quarter of the resolution, a 16th of the pixels, is
// enough for their raymarch (CloudsComposite.glsl's CLOUD_SCALE)
const CLOUD_SCALE = 0.25;
// voxels along each side of the noise, CloudsDensity.glsl's NOISE_VOXELS
const NOISE_SIZE = 64;
// the share of the previous frames in each frame's clouds, about 10 frames' worth (Hillaire 2016,
// sec. 5.5.3, blends 0.1 of the current one)
const HISTORY_WEIGHT = 0.9;
// after the camera, the clock or the map changes, the scene renders this long, in milliseconds, at
// this frame rate, for the accumulation to settle, also in requestRenderMode
const SETTLE_TIME = 500;
const SETTLE_RATE = 30;
// with a drift, the clouds move all the time: the scene renders at this frame rate while they are
// active, also in requestRenderMode
const DRIFT_RATE = 30;
// the shadow map: its texels across, over a square centered on the ground point under the camera,
// this many times as wide as the camera is high, between these sides, in meters, so that it covers
// the view from high above; drawn again once that point moves a 40th of it, its side changes by a
// quarter, or the clock or the clouds change, rather than at each frame
const SHADOW_SIZE = 512;
const SHADOW_SPREAD = 4;
const SHADOW_EXTENTS = [80000, 800000];
const SHADOW_MOVE = 1 / 40;
const SHADOW_RESIZE = 0.25;
// and at most once in this many milliseconds, while they keep changing, as during playback: a
// redraw takes as long as a frame of the clouds or longer
const SHADOW_INTERVAL = 250;
// the history is a copy of the resolve's output, drawn rather than copied: Cesium does not copy
// from a framebuffer into a texture of half floats
const COPY = `precision highp sampler2D;
uniform sampler2D source;
in vec2 v_textureCoordinates;
void main() {
  out_FragColor = texture(source, v_textureCoordinates);
}
`;
// the clouds over the lightest rain are this thick, in meters, CloudsDensity.glsl's THIN_DEPTH
const THIN_DEPTH = 1500;
// the wind's offset of the noise wraps at this many meters, a period of its tile, CloudsMarch.glsl's
// NOISE_TILE, and of its larger lookup, the tile over LARGE_SCALE (0.27): single precision would
// lose the offset after days of wind
const WIND_PERIOD = 100 * 16000;

/**
 * The noise's voxels, made once for all the clouds of the page: about a third of a second.
 * @type {Uint8Array | undefined}
 */
let noise;

/**
 * The noise over the clouds' map, made once for all the clouds of the page.
 * @type {Uint8Array | undefined}
 */
let mapNoise;

// texels along each side of the map's noise
const MAP_NOISE_SIZE = 256;

/**
 * Clouds from a map of the rain: a slab above the cloud base where the map
 * has rain, a flat layer over drizzle and towers up to the cloud top over the
 * heaviest rain, eroded by noise, lit by the sun with a silver lining toward
 * it and by the sky, brighter at their top. Seen from far above they are
 * cloud tops; the camera flies into them as it comes down. Activated before
 * Precipitation, the rain, its shafts and its haze are drawn over them, so
 * from below the cloud base they are seen through the rain. They are
 * raymarched at a quarter of
 * the resolution, accumulated over the frames, and upscaled by the scene's
 * depth. Their noise drifts with the wind by the scene's clock, and with a
 * drift by the real time; after a change, the scene renders for half a second
 * for them to settle, then rests, unless they drift.
 * Without a map, there are no clouds.
 */
export default class Clouds extends Effect {
  /**
   * @param {import('@cesium/engine').CesiumWidget} viewer
   * @param {{map?: import('./weather-map.js').WeatherMapOptions, cloudBase?: number, cloudTop?: number, density?: number, wind?: number, drift?: number}} [options]
   */
  constructor(viewer, options = {}) {
    super(viewer);
    this.cloudBase_ = options.cloudBase ?? 2500;
    this.cloudTop_ = options.cloudTop ?? 9000;
    this.density_ = options.density ?? 1;
    this.wind_ = options.wind ?? 10;
    this.drift_ = options.drift ?? 0;
    // without a map, no clouds
    this.weatherMap_ = new WeatherMap(0);
    // the maps of the rain, from which the clouds' maps are made
    /** @type {import('./weather-map.js').WeatherMapOptions | undefined} */
    this.map_ = options.map;
    /** @type {import('./weather-map.js').WeatherMapOptions | undefined} */
    this.nextMap_ = undefined;
    this.weatherMap_.map = options.map && createCloudMap(options.map);
    // the map's intensity at the camera when it is inside the clouds, read each frame
    this.localDensity_ = 0;
    // made when the clouds are first drawn, as the map's texture
    /** @type {any} */
    this.noiseTexture_ = undefined;
    /** @type {any} */
    this.mapNoiseTexture_ = undefined;
    // the accumulation over the frames: the frames drawn, the previous frames' clouds, their share,
    // the previous frame's view and projection, and what makes the scene render until it settles
    this.frame_ = 0;
    /** @type {any} */
    this.history_ = undefined;
    /** @type {any} */
    this.historyFramebuffer_ = undefined;
    /** @type {any} */
    this.copy_ = undefined;
    /** @type {any} */
    this.copySource_ = undefined;
    this.historyWeight_ = 0;
    this.previousViewProjection_ = new Matrix4();
    this.reprojection_ = new Matrix4();
    this.lastView_ = new Matrix4();
    this.lastTime_ = {dayNumber: 0, secondsOfDay: 0};
    this.changed_ = false;
    this.settling_ = false;
    this.settleUntil_ = 0;
    // the shadow map, its ground point and time, and whether the clouds changed since it was drawn
    /** @type {any} */
    this.shadow_ = undefined;
    /** @type {any} */
    this.shadowFramebuffer_ = undefined;
    /** @type {any} */
    this.shadowCommand_ = undefined;
    this.shadowCenter_ = new Cartesian3();
    this.shadowExtent_ = SHADOW_EXTENTS[0];
    this.shadowTime_ = {dayNumber: 0, secondsOfDay: 0};
    this.shadowDrawnAt_ = -Infinity;
    this.shadowChanged_ = true;
    // for Precipitation, which lights its haze through it
    /** @type {import('./cloud-cover.js').CloudShadow} */
    this.shadowSource_ = {texture: () => this.shadow_, center: this.shadowCenter_, extent: () => this.shadowExtent_, base: () => this.cloudBase_, top: () => this.slabTop_()};
    this.onPreRender_ = () => {
      const {camera} = this.viewer.scene;
      this.drawShadow_(this.viewer.scene);
      const {longitude, latitude, height} = camera.positionCartographic;
      const inside = height >= this.cloudBase_ && height <= this.cloudTop_;
      this.localDensity_ = inside ? this.weatherMap_.intensityAt(longitude, latitude) : 0;
      const time = this.viewer.clock.currentTime;
      if (this.changed_ || !Matrix4.equals(camera.viewMatrix, this.lastView_) || time.dayNumber !== this.lastTime_.dayNumber || time.secondsOfDay !== this.lastTime_.secondsOfDay) {
        this.changed_ = false;
        Matrix4.clone(camera.viewMatrix, this.lastView_);
        this.lastTime_ = {dayNumber: time.dayNumber, secondsOfDay: time.secondsOfDay};
        this.settleUntil_ = Date.now() + SETTLE_TIME;
        if (!this.settling_) {
          this.settling_ = true;
          acquireFrames(this.viewer.scene, SETTLE_RATE);
        }
      }
    };
    this.onPostRender_ = () => {
      const {scene} = this.viewer;
      this.keepHistory_(scene);
      Matrix4.multiply(scene.camera.frustum.projectionMatrix, scene.camera.viewMatrix, this.previousViewProjection_);
      this.frame_ = (this.frame_ + 1) % 1024;
      if (this.settling_ && Date.now() > this.settleUntil_) {
        this.settling_ = false;
        releaseFrames(scene, SETTLE_RATE);
      }
    };
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  createStage_(scene) {
    // the farthest depth of each block of pixels of the march, at its resolution
    const depth = new PostProcessStage({
      fragmentShader: EyeFromDepth + CloudsDepth,
      textureScale: CLOUD_SCALE,
      pixelDatatype: PixelDatatype.FLOAT,
    });
    const march = new PostProcessStage({
      fragmentShader: EyeFromDepth + Height + CloudsSlab + WeatherMapShader + CloudsDensity + Fog + Phase + RainHaze + CloudsMarch,
      uniforms: {
        ...this.slabUniforms_(scene),
        // @ts-expect-error the scene's context is not typed
        ...this.densityUniforms_(scene.context),
        cloudDepth: depth.name,
        // @ts-expect-error the scene's context is not typed
        maxMap: () => this.weatherMap_.maxTexture(scene.context),
        frame: () => this.frame_,
        skyLightIntensity: () => scene.skyAtmosphere?.atmosphereLightIntensity ?? 50,
      },
      textureScale: CLOUD_SCALE,
    });
    // accumulated over the frames
    const resolve = new PostProcessStage({
      fragmentShader: EyeFromDepth + Height + CloudsSlab + CloudsResolve,
      uniforms: {
        ...this.slabUniforms_(scene),
        cloudDepth: depth.name,
        cloudTexture: march.name,
        // @ts-expect-error the scene's context is not typed
        historyTexture: () => this.history_ ?? scene.context.defaultTexture,
        reprojection: () => Matrix4.multiply(this.previousViewProjection_, scene.camera.inverseViewMatrix, this.reprojection_),
        historyWeight: () => (this.history_ ? this.historyWeight_ : 0),
      },
      textureScale: CLOUD_SCALE,
      pixelDatatype: PixelDatatype.HALF_FLOAT,
    });
    // blurred at the same resolution
    const blurred = new PostProcessStage({
      fragmentShader: CloudsBlur,
      uniforms: {cloudTexture: resolve.name, cloudDepth: depth.name},
      textureScale: CLOUD_SCALE,
    });
    return new PostProcessStageComposite({
      stages: [
        depth,
        march,
        resolve,
        blurred,
        new PostProcessStage({
          fragmentShader: EyeFromDepth + CloudsShadow + CloudsComposite,
          uniforms: {
            ...this.shadowUniforms_(scene),
            cloudTexture: blurred.name,
            cloudDepth: depth.name,
          },
        }),
      ],
      // the clouds are drawn over the scene, not over the march
      inputPreviousStageTexture: false,
    });
  }

  /**
   * The top of the tallest cloud the map makes, as CloudsDensity.glsl's cloudDensity makes the
   * clouds of its tallest type, over its heaviest rain: from above, the march starts there rather than at the cloud
   * top, so that its steps are in the clouds rather than in the empty air over them.
   */
  slabTop_() {
    // the clouds' map's tallest type, in blue
    const type = this.weatherMap_.maxValues[2];
    return this.cloudBase_ + THIN_DEPTH + (this.cloudTop_ - this.cloudBase_ - THIN_DEPTH) * type;
  }

  /**
   * The direction the wind blows toward, in world coordinates: the east at the map's center, fixed
   * for the map rather than turning with the camera, which would shift the drifted noise.
   */
  windDirection_() {
    const rectangle = this.weatherMap_.map?.rectangle;
    if (!rectangle) {
      return Cartesian3.ZERO;
    }
    const up = Ellipsoid.WGS84.geodeticSurfaceNormalCartographic(Rectangle.center(rectangle));
    return Cartesian3.normalize(Cartesian3.cross(Cartesian3.UNIT_Z, up, new Cartesian3()), new Cartesian3());
  }

  /**
   * How far the wind has carried the noise by the scene's clock, still while it is paused, and the
   * drift by the real time, in world coordinates, in double precision and wrapped at WIND_PERIOD.
   * @param {number} [seconds] the real time
   */
  windOffset_(seconds = performance.now() / 1000) {
    const {dayNumber, secondsOfDay} = this.viewer.clock.currentTime;
    const distance = this.wind_ * (dayNumber * 86400 + secondsOfDay) + this.drift_ * seconds;
    const offset = Cartesian3.multiplyByScalar(this.windDirection_(), distance, new Cartesian3());
    return new Cartesian3(offset.x % WIND_PERIOD, offset.y % WIND_PERIOD, offset.z % WIND_PERIOD);
  }

  /**
   * The uniforms of CloudsSlab.glsl, with Height.glsl's it needs.
   * @param {import('@cesium/engine').Scene} scene
   */
  slabUniforms_(scene) {
    return {...heightUniforms(scene), cloudBase: () => this.cloudBase_, slabTop: () => this.slabTop_()};
  }

  /**
   * The uniforms of CloudsDensity.glsl, with WeatherMap.glsl's it needs.
   * @param {any} context the scene's context
   */
  densityUniforms_(context) {
    return {
      map: () => this.weatherMap_.texture(context),
      nextMap: () => this.weatherMap_.nextTexture(context),
      mapBlend: () => this.weatherMap_.blend,
      mapBounds: () => this.weatherMap_.bounds,
      cloudNoise: () => this.createNoiseTexture_(context),
      mapNoise: () => this.createMapNoiseTexture_(context),
      cloudTop: () => this.cloudTop_,
      density: () => this.density_,
      windDirection: () => this.windDirection_(),
      windOffset: () => this.windOffset_(),
    };
  }

  /**
   * The uniforms of CloudsShadow.glsl, for the stages that read the shadow map.
   * @param {import('@cesium/engine').Scene} scene
   */
  shadowUniforms_(scene) {
    return {
      // @ts-expect-error the scene's context is not typed
      shadowMap: () => this.shadow_ ?? scene.context.defaultTexture,
      shadowCenter: () => this.shadowCenter_,
      shadowExtent: () => this.shadowExtent_,
      shadowBase: () => this.cloudBase_,
      shadowTop: () => this.slabTop_(),
    };
  }

  /**
   * The shadow map's side, in meters, for a camera this high.
   * @param {number} height meters
   */
  shadowExtentFor_(height) {
    return CesiumMath.clamp(SHADOW_SPREAD * height, SHADOW_EXTENTS[0], SHADOW_EXTENTS[1]);
  }

  /**
   * Whether the shadow map, drawn around a ground point at a time, is to be drawn again.
   * @param {Cartesian3} ground the ground point under the camera, in world coordinates
   * @param {{dayNumber: number, secondsOfDay: number}} time the clock's
   * @param {number} [extent] the side it would have now, in meters
   */
  shadowStale_(ground, time, extent = this.shadowExtent_) {
    return (
      this.shadowChanged_ ||
      time.dayNumber !== this.shadowTime_.dayNumber ||
      time.secondsOfDay !== this.shadowTime_.secondsOfDay ||
      Cartesian3.distance(ground, this.shadowCenter_) > SHADOW_MOVE * this.shadowExtent_ ||
      Math.abs(extent - this.shadowExtent_) > SHADOW_RESIZE * this.shadowExtent_ ||
      // the drifting clouds, at every frame
      this.drift_ > 0
    );
  }

  /**
   * Whether the shadow map is to be drawn again now: stale, and not drawn in the last
   * SHADOW_INTERVAL.
   * @param {Cartesian3} ground
   * @param {{dayNumber: number, secondsOfDay: number}} time
   * @param {number} now milliseconds
   * @param {number} [extent] the side it would have now, in meters
   */
  shadowDue_(ground, time, now, extent) {
    return this.shadowStale_(ground, time, extent) && now - this.shadowDrawnAt_ >= SHADOW_INTERVAL;
  }

  /**
   * @param {Cartesian3} ground
   * @param {{dayNumber: number, secondsOfDay: number}} time
   * @param {number} [now] milliseconds
   * @param {number} [extent] its side, in meters
   */
  shadowDrawn_(ground, time, now = Date.now(), extent = this.shadowExtent_) {
    Cartesian3.clone(ground, this.shadowCenter_);
    this.shadowExtent_ = extent;
    this.shadowTime_ = {dayNumber: time.dayNumber, secondsOfDay: time.secondsOfDay};
    this.shadowDrawnAt_ = now;
    this.shadowChanged_ = false;
  }

  /**
   * Draws the shadow map into its own texture before the stages run, when it is due: the
   * stages' textures are sized after the screen. A redraw put off renders after the change
   * settles, in the frames the accumulation asks for.
   * @param {import('@cesium/engine').Scene} scene
   */
  drawShadow_(scene) {
    const ground = Ellipsoid.WGS84.scaleToGeodeticSurface(scene.camera.positionWC, new Cartesian3());
    const time = this.viewer.clock.currentTime;
    const now = Date.now();
    const extent = this.shadowExtentFor_(scene.camera.positionCartographic.height);
    if (!ground || !this.shadowDue_(ground, time, now, extent)) {
      return;
    }
    this.shadowDrawn_(ground, time, now, extent);
    // @ts-expect-error the scene's context is not typed
    const context = scene.context;
    if (!context) {
      return;
    }
    if (!this.shadow_) {
      this.shadow_ = new Texture({context, width: SHADOW_SIZE, height: SHADOW_SIZE, pixelDatatype: PixelDatatype.HALF_FLOAT});
      this.shadowFramebuffer_ = new Framebuffer({context, colorTextures: [this.shadow_], destroyAttachments: false});
      this.shadowCommand_ = context.createViewportQuadCommand(Height + CloudsSlab + WeatherMapShader + CloudsDensity + CloudsShadow + CloudsShadowMap, {
        framebuffer: this.shadowFramebuffer_,
        renderState: RenderState.fromCache({viewport: {x: 0, y: 0, width: SHADOW_SIZE, height: SHADOW_SIZE}}),
        uniformMap: {
          ...this.slabUniforms_(scene),
          ...this.densityUniforms_(context),
          maxMap: () => this.weatherMap_.maxTexture(context),
          shadowCenter: () => this.shadowCenter_,
          shadowExtent: () => this.shadowExtent_,
        },
      });
    }
    this.shadowCommand_.execute(context);
  }

  destroyShadow_() {
    this.shadowCommand_?.shaderProgram?.destroy();
    this.shadowCommand_ = undefined;
    this.shadowFramebuffer_ = this.shadowFramebuffer_?.destroy();
    this.shadow_ = this.shadow_?.destroy();
    this.shadowChanged_ = true;
  }

  /**
   * Keeps this frame's accumulated clouds for the next one, drawn into the history at the size of
   * the resolve's output, made again when it changes.
   * @param {import('@cesium/engine').Scene} scene
   */
  keepHistory_(scene) {
    // @ts-expect-error the collection's output textures are not typed
    const output = this.stage_ && scene.postProcessStages.getOutputTexture?.(this.stage_.get(2).name);
    if (!output) {
      return;
    }
    // @ts-expect-error the scene's context is not typed
    const context = scene.context;
    if (!this.history_ || this.history_.width !== output.width || this.history_.height !== output.height) {
      this.destroyHistory_();
      this.history_ = new Texture({context, width: output.width, height: output.height, pixelDatatype: PixelDatatype.HALF_FLOAT});
      this.historyFramebuffer_ = new Framebuffer({context, colorTextures: [this.history_], destroyAttachments: false});
      this.historyWeight_ = 0;
    }
    this.copySource_ = output;
    this.copy_ ??= context.createViewportQuadCommand(COPY, {uniformMap: {source: () => this.copySource_}});
    this.copy_.framebuffer = this.historyFramebuffer_;
    this.copy_.renderState = RenderState.fromCache({viewport: {x: 0, y: 0, width: output.width, height: output.height}});
    this.copy_.execute(context);
    this.historyWeight_ = HISTORY_WEIGHT;
  }

  destroyHistory_() {
    this.historyFramebuffer_ = this.historyFramebuffer_?.destroy();
    this.history_ = this.history_?.destroy();
  }

  /**
   * The noise's texture, repeating in every direction, with its mipmaps for the far clouds.
   * @param {any} context the scene's context
   */
  createNoiseTexture_(context) {
    if (!this.noiseTexture_) {
      noise ??= createCloudNoise(NOISE_SIZE);
      this.noiseTexture_ = new Texture3D({
        context,
        flipY: false,
        source: {width: NOISE_SIZE, height: NOISE_SIZE, depth: NOISE_SIZE, arrayBufferView: noise},
        sampler: new Sampler({
          wrapS: TextureWrap.REPEAT,
          wrapT: TextureWrap.REPEAT,
          wrapR: TextureWrap.REPEAT,
          minificationFilter: TextureMinificationFilter.LINEAR_MIPMAP_LINEAR,
          magnificationFilter: TextureMagnificationFilter.LINEAR,
        }),
      });
      this.noiseTexture_.generateMipmap();
    }
    return this.noiseTexture_;
  }

  /**
   * The noise over the clouds' map, repeating.
   * @param {any} context the scene's context
   */
  createMapNoiseTexture_(context) {
    if (!this.mapNoiseTexture_) {
      mapNoise ??= createMapNoise(MAP_NOISE_SIZE);
      this.mapNoiseTexture_ = new Texture({
        context,
        flipY: false,
        source: {width: MAP_NOISE_SIZE, height: MAP_NOISE_SIZE, arrayBufferView: mapNoise},
        sampler: new Sampler({
          wrapS: TextureWrap.REPEAT,
          wrapT: TextureWrap.REPEAT,
          minificationFilter: TextureMinificationFilter.LINEAR,
          magnificationFilter: TextureMagnificationFilter.LINEAR,
        }),
      });
    }
    return this.mapNoiseTexture_;
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  activated_(scene) {
    if (this.drift_ > 0) {
      acquireFrames(scene, DRIFT_RATE);
    }
    scene.preRender.addEventListener(this.onPreRender_);
    scene.postRender.addEventListener(this.onPostRender_);
    acquireTerrainDepth(scene);
    acquireCloudCover(scene, this.shadowSource_);
  }

  /**
   * @override
   * @param {import('@cesium/engine').Scene} scene
   */
  deactivating_(scene) {
    releaseCloudCover(scene, this.shadowSource_);
    releaseTerrainDepth(scene);
    scene.preRender.removeEventListener(this.onPreRender_);
    scene.postRender.removeEventListener(this.onPostRender_);
    if (this.settling_) {
      this.settling_ = false;
      releaseFrames(scene, SETTLE_RATE);
    }
    if (this.drift_ > 0) {
      releaseFrames(scene, DRIFT_RATE);
    }
    this.destroyHistory_();
    this.destroyShadow_();
    this.copy_?.shaderProgram?.destroy();
    this.copy_ = undefined;
    this.weatherMap_.destroy();
    this.noiseTexture_ = this.noiseTexture_?.destroy();
    this.mapNoiseTexture_ = this.mapNoiseTexture_?.destroy();
  }

  /**
   * Where it rains, or undefined for no clouds: an image whose red channel
   * is the local intensity, 0 to 1, over a rectangle of longitudes and
   * latitudes, north up, as Precipitation's map. Set it again after drawing
   * on the image, which is read then.
   */
  get map() {
    return this.map_;
  }

  set map(value) {
    this.map_ = value;
    this.weatherMap_.map = value && createCloudMap(value);
    this.shadowChanged_ = true;
    // the previous map's clouds would linger
    this.historyWeight_ = 0;
    this.changed_ = true;
    this.viewer.scene.requestRender();
  }

  /**
   * The map the clouds crossfade to by the map blend, over the same
   * rectangle, as the radar's next hour, or undefined for none.
   */
  get nextMap() {
    return this.nextMap_;
  }

  set nextMap(value) {
    this.nextMap_ = value;
    this.weatherMap_.nextMap = value && createCloudMap(value);
    this.shadowChanged_ = true;
    this.viewer.scene.requestRender();
  }

  /**
   * From the map, 0, to the next map, 1.
   */
  get mapBlend() {
    return this.weatherMap_.blend;
  }

  set mapBlend(value) {
    this.weatherMap_.blend = value;
    this.shadowChanged_ = true;
    this.viewer.scene.requestRender();
  }

  /**
   * Altitude of the cloud base, in meters above the ellipsoid, as
   * Precipitation's.
   */
  get cloudBase() {
    return this.cloudBase_;
  }

  set cloudBase(value) {
    this.cloudBase_ = value;
    this.shadowChanged_ = true;
    this.viewer.scene.requestRender();
  }

  /**
   * Altitude of the highest cloud tops, over the heaviest rain, in meters
   * above the ellipsoid; over drizzle the clouds are 1500 m thick.
   */
  get cloudTop() {
    return this.cloudTop_;
  }

  set cloudTop(value) {
    this.cloudTop_ = value;
    this.shadowChanged_ = true;
    this.viewer.scene.requestRender();
  }

  /**
   * Scale of the clouds' opacity: 1 for solid clouds over heavy rain.
   */
  get density() {
    return this.density_;
  }

  set density(value) {
    this.density_ = value;
    this.shadowChanged_ = true;
    this.viewer.scene.requestRender();
  }

  /**
   * Speed of the wind that carries the clouds' noise toward the east, in m/s,
   * by the scene's clock: a time-lapse while it runs faster, still while it
   * is paused.
   */
  get wind() {
    return this.wind_;
  }

  set wind(value) {
    this.wind_ = value;
    this.shadowChanged_ = true;
    this.viewer.scene.requestRender();
  }

  /**
   * Speed of the drift of the clouds' noise toward the east, in m/s, by the
   * real time rather than the scene's clock: the clouds move while the clock
   * is paused, and the scene renders all the time while they are active. 0,
   * by default, for none.
   */
  get drift() {
    return this.drift_;
  }

  set drift(value) {
    const drifting = this.drift_ > 0;
    this.drift_ = value;
    if (this.stage_ && drifting !== value > 0) {
      (value > 0 ? acquireFrames : releaseFrames)(this.viewer.scene, DRIFT_RATE);
    }
    this.viewer.scene.requestRender();
  }

  /**
   * The map's intensity at the camera when it is inside the clouds, 0 to 1,
   * read each frame while active; 0 outside them.
   */
  get localDensity() {
    return this.localDensity_;
  }
}
