import {Cartesian4, Matrix4, PixelDatatype, PixelFormat} from '@cesium/core';
// @ts-expect-error the engine exports its textures and samplers, but does not type them
import {Sampler, Texture, TextureMagnificationFilter, TextureMinificationFilter} from '@cesium/engine';
import {localFromEye} from './local-frame.js';

// the height of a node with nothing over it: far below everything, so whatever lies there is open
const NOTHING = -1e9;
const NO_GRID = new Cartesian4();
// the texture a shader samples without a grid, one a context
const standIns = new WeakMap();

/**
 * What is open to the sky, over the nodes of a grid laid in a frame of the world, such as a site's plan, for `RainRings` and `SnowLine`: at each
 * node the height of the highest surface that stops the rain, its cover, and of the highest of all, its ceiling. The effects lay rings and snow
 * only on what is not under a cover (a deck under a roof, the ground under a tree, if the trees are covers) and not over the ceiling (a cloud,
 * a model left out of the grid). A surface the rain falls through counts only in the ceiling: a translucent water whose floor shows, a tree's
 * crown whose ground should keep its snow and which keeps its own. Outside the grid, everything is open. Each effect samples the four nodes
 * about a pixel and blends between them: a node's step should be a fraction of a meter.
 */
export default class OpenSky {
  /**
   * @param {{covers: Float32Array, ceilings?: Float32Array, columns: number, rows: number, extent: number[], frame: Matrix4}} grid The
   *   covers' and the ceilings' heights at the nodes (the covers' by default), row by row from the extent's lowest y, each from its lowest x,
   *   in the frame's meters (`-Infinity` where nothing lies); the nodes along x and along y; the extent [x0, x1, y0, y1] the first and the last
   *   nodes lie on; the frame in the world, x and y across, z up.
   */
  constructor({covers, ceilings = covers, columns, rows, extent: [x0, x1, y0, y1], frame}) {
    if (covers.length !== columns * rows || ceilings.length !== columns * rows || columns < 2 || rows < 2) {
      throw new Error(`${covers.length} covers and ${ceilings.length} ceilings for ${columns} by ${rows} nodes`);
    }
    // a cover and a ceiling a node, side by side
    this.heights_ = new Float32Array(2 * columns * rows);
    covers.forEach((height, k) => this.heights_[2 * k] = Math.max(height, NOTHING));
    ceilings.forEach((height, k) => this.heights_[2 * k + 1] = Math.max(height, NOTHING));
    this.columns_ = columns;
    this.rows_ = rows;
    this.grid_ = new Cartesian4(x0, y0, (x1 - x0) / (columns - 1), (y1 - y0) / (rows - 1));
    this.frame_ = Matrix4.clone(frame);
    this.scratch_ = new Matrix4();
    /** @type {any} */
    this.texture_ = undefined;
  }

  /**
   * The first node's place and the step between two along x and along y, in the frame's meters: (x0, y0, dx, dy).
   */
  get grid() {
    return this.grid_;
  }

  /**
   * The frame's coordinates from the camera's eye's.
   * @param {import('@cesium/engine').Scene} scene
   */
  fromEye(scene) {
    return localFromEye(this.frame_, scene.camera.viewMatrix, this.scratch_);
  }

  /**
   * The heights as a texture of two floats a node, its cover's and its ceiling's, read node by node, made the first time a shader needs it.
   * @param {any} context the scene's context
   */
  texture(context) {
    this.texture_ ??= new Texture({
      context,
      flipY: false,
      pixelFormat: PixelFormat.RG,
      pixelDatatype: PixelDatatype.FLOAT,
      source: {width: this.columns_, height: this.rows_, arrayBufferView: this.heights_},
      sampler: new Sampler({minificationFilter: TextureMinificationFilter.NEAREST, magnificationFilter: TextureMagnificationFilter.NEAREST}),
    });
    return this.texture_;
  }

  /**
   * Lets the texture go; the effects given it must not draw after.
   */
  destroy() {
    this.texture_ = this.texture_?.destroy();
  }
}

/**
 * The uniforms of OpenSky.glsl, from the open sky an effect has at the moment: with none, everything is open.
 * @param {import('@cesium/engine').Scene} scene
 * @param {() => OpenSky | undefined} sky
 */
export function openSkyUniforms(scene, sky) {
  // @ts-expect-error the scene's context is not typed
  const context = scene.context;
  return {
    openSkyMap: () => sky()?.texture(context) ?? standIn(context),
    skyFromEye: () => sky()?.fromEye(scene) ?? Matrix4.IDENTITY,
    skyGrid: () => sky()?.grid ?? NO_GRID,
    hasSky: () => sky() ? 1 : 0,
  };
}

/**
 * A texture of one node for a shader to sample when there is no grid, kept as long as its context.
 * @param {any} context
 */
function standIn(context) {
  if (!standIns.has(context)) {
    standIns.set(context, new OpenSky({covers: new Float32Array(4), columns: 2, rows: 2, extent: [0, 1, 0, 1], frame: Matrix4.IDENTITY}).texture(context));
  }
  return standIns.get(context);
}
