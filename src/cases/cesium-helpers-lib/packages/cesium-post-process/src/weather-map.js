import {Cartesian4, Math as CesiumMath} from '@cesium/core';
// @ts-expect-error the engine exports its textures, but does not type them
import {Texture} from '@cesium/engine';

const TWO_PI = CesiumMath.TWO_PI;
// the max map's texels are blocks of this many pixels of the map across
const POOL = 4;

/**
 * Where it rains: an image whose red channel is the local intensity, 0 to 1,
 * over a rectangle of longitudes and latitudes, north up, not crossing the
 * antimeridian. Outside the rectangle there is none, so the image should
 * fade to 0 at its edges.
 * @typedef {{image: HTMLCanvasElement | ImageData | {width: number, height: number, data: Uint8ClampedArray}, rectangle: import('@cesium/core').Rectangle}} WeatherMapOptions
 */

/**
 * The pixels of an image, read once.
 * @param {WeatherMapOptions['image']} image
 */
export function imageData(image) {
  return 'data' in image ? image : image.getContext('2d', {willReadFrequently: true})?.getImageData(0, 0, image.width, image.height);
}

/**
 * A texture's source from an image: a canvas or an ImageData as it is, other pixels as an array,
 * which Cesium flips as it flips an image.
 * @param {HTMLCanvasElement | ImageData | {width: number, height: number, data: Uint8ClampedArray}} image
 */
function textureSource(image) {
  if (!('data' in image) || (typeof ImageData !== 'undefined' && image instanceof ImageData)) {
    return image;
  }
  const {width, height, data} = image;
  return {width, height, arrayBufferView: new Uint8Array(data.buffer, data.byteOffset, data.length)};
}

/**
 * The highest value of each channel of an image, 0 to 1.
 * @param {{data: Uint8ClampedArray} | undefined} data
 */
function highest(data) {
  const max = [0, 0, 0, 0];
  const values = data?.data ?? [];
  for (let i = 0; i < values.length; i += 4) {
    for (let channel = 0; channel < 4; channel++) {
      max[channel] = Math.max(max[channel], values[i + channel]);
    }
  }
  return max.map((value) => value / 255);
}

/**
 * The highest value of each channel of images of the same size around each block of POOL x POOL
 * pixels: in the block and its 8 neighbors, as RGBA bytes. A ray sampled less than a block apart
 * then finds every cell of rain it passes, however small.
 * @param {Array<{width: number, height: number, data: Uint8ClampedArray} | undefined>} images
 */
function maxPool(images) {
  const {width, height} = /** @type {{width: number, height: number}} */ (images[0]);
  const w = Math.ceil(width / POOL);
  const h = Math.ceil(height / POOL);
  const pooled = new Uint8Array(w * h * 4);
  for (const image of images) {
    if (!image) {
      continue;
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = 4 * (Math.floor(y / POOL) * w + Math.floor(x / POOL));
        for (let channel = 0; channel < 4; channel++) {
          pooled[i + channel] = Math.max(pooled[i + channel], image.data[4 * (y * width + x) + channel]);
        }
      }
    }
  }
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let channel = 0; channel < 4; channel++) {
        let max = 0;
        for (let dy = Math.max(y - 1, 0); dy <= Math.min(y + 1, h - 1); dy++) {
          for (let dx = Math.max(x - 1, 0); dx <= Math.min(x + 1, w - 1); dx++) {
            max = Math.max(max, pooled[4 * (dy * w + dx) + channel]);
          }
        }
        data[4 * (y * w + x) + channel] = max;
      }
    }
  }
  return {width: w, height: h, data};
}

/**
 * A map of the rain for the shaders, WeatherMap.glsl's uniforms, and its
 * intensity at a point on the CPU, bilinear as the shaders sample it. Without
 * a map, the intensity everywhere is the empty value: 1 for rain everywhere,
 * 0 for none. A next map, over the same rectangle and of the same size, crossfades from the map to
 * it by the blend, as the radar from one hour to the next.
 */
export default class WeatherMap {
  /**
   * @param {number} empty the intensity everywhere without a map
   */
  constructor(empty) {
    this.empty_ = empty;
    /** @type {WeatherMapOptions | undefined} */
    this.map_ = undefined;
    /** @type {{width: number, height: number, data: Uint8ClampedArray} | undefined} */
    this.data_ = undefined;
    /** @type {WeatherMapOptions | undefined} */
    this.nextMap_ = undefined;
    /** @type {{width: number, height: number, data: Uint8ClampedArray} | undefined} */
    this.nextData_ = undefined;
    /**
     * From the map, 0, to the next one, 1.
     */
    this.blend = 0;
    /**
     * The rectangle in the ellipsoid's texture coordinates: its west and
     * south, and one over its width and height; the whole globe without a map.
     */
    this.bounds = new Cartesian4(0, 0, 1, 1);
    /**
     * The highest intensity on the map, 0 to 1: the empty value without a map; and the highest
     * value of each of its channels.
     */
    this.maxIntensity = empty;
    this.maxValues = [empty, empty, empty, empty];
    // made when the shaders first need it: a stage given an image makes its texture a frame after
    // it is set, and draws without one in between
    /** @type {any} */
    this.texture_ = undefined;
    /** @type {any} */
    this.nextTexture_ = undefined;
    /** @type {{width: number, height: number, data: Uint8Array} | undefined} */
    this.maxImage_ = undefined;
    /** @type {any} */
    this.maxTexture_ = undefined;
  }

  get map() {
    return this.map_;
  }

  set map(value) {
    this.map_ = value;
    if (!value) {
      this.data_ = undefined;
      Cartesian4.fromElements(0, 0, 1, 1, this.bounds);
      this.maxIntensity = this.empty_;
    } else {
      const {image, rectangle} = value;
      this.data_ = imageData(image);
      Cartesian4.fromElements(
        rectangle.west / TWO_PI + 0.5,
        rectangle.south / CesiumMath.PI + 0.5,
        TWO_PI / (rectangle.east - rectangle.west),
        CesiumMath.PI / (rectangle.north - rectangle.south),
        this.bounds,
      );
    }
    this.updateMaxIntensity_();
    // made again from the new image when the shaders next need it
    this.texture_ = this.texture_?.destroy();
    this.clearMaxImage_();
  }

  get nextMap() {
    return this.nextMap_;
  }

  set nextMap(value) {
    this.nextMap_ = value;
    this.nextData_ = value && imageData(value.image);
    this.updateMaxIntensity_();
    this.nextTexture_ = this.nextTexture_?.destroy();
    this.clearMaxImage_();
  }

  clearMaxImage_() {
    this.maxImage_ = undefined;
    this.maxTexture_ = this.maxTexture_?.destroy();
  }

  /**
   * The highest intensity around each block of the map's pixels, over the map and the next one,
   * made when first needed: undefined without a map.
   */
  maxImage() {
    if (this.map_ && !this.maxImage_) {
      this.maxImage_ = maxPool([this.data_, this.nextData_]);
    }
    return this.maxImage_;
  }

  updateMaxIntensity_() {
    const map = highest(this.data_);
    const next = highest(this.nextMap_ ? this.nextData_ : undefined);
    this.maxValues = this.map_ ? map.map((value, channel) => Math.max(value, next[channel])) : [this.empty_, this.empty_, this.empty_, this.empty_];
    this.maxIntensity = this.maxValues[0];
  }

  /**
   * The intensity at a point, 0 to 1, bilinear as the shaders sample it: the
   * empty value without a map, 0 outside its rectangle.
   * @param {number} longitude radians
   * @param {number} latitude radians
   */
  intensityAt(longitude, latitude) {
    if (!this.map_ || !this.data_) {
      return this.empty_;
    }
    const {west, south, east, north} = this.map_.rectangle;
    const u = (longitude - west) / (east - west);
    const v = (latitude - south) / (north - south);
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return 0;
    }
    const intensity = this.sample_(this.data_, u, v);
    if (!this.nextData_) {
      return intensity;
    }
    return intensity + (this.sample_(this.nextData_, u, v) - intensity) * this.blend;
  }

  /**
   * An image's intensity, bilinear, at a point of its rectangle, 0 to 1 from its west and south.
   * @param {{width: number, height: number, data: Uint8ClampedArray}} image
   * @param {number} u
   * @param {number} v
   */
  sample_(image, u, v) {
    const {width, height, data} = image;
    // the image's rows go down from the north
    const x = CesiumMath.clamp(u * width - 0.5, 0, width - 1);
    const y = CesiumMath.clamp((1 - v) * height - 0.5, 0, height - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    const red = (/** @type {number} */ column, /** @type {number} */ row) => data[4 * (row * width + column)] / 255;
    const upper = red(x0, y0) + (red(x1, y0) - red(x0, y0)) * (x - x0);
    const lower = red(x0, y1) + (red(x1, y1) - red(x0, y1)) * (x - x0);
    return upper + (lower - upper) * (y - y0);
  }

  /**
   * The map's texture, a pixel of the empty value without a map.
   * @param {any} context the scene's context
   */
  texture(context) {
    if (!this.texture_) {
      const value = 255 * this.empty_;
      this.texture_ = new Texture({context, source: textureSource(this.map_?.image ?? new ImageData(new Uint8ClampedArray([value, value, value, 255]), 1, 1))});
    }
    return this.texture_;
  }

  /**
   * The next map's texture, the map's without one.
   * @param {any} context the scene's context
   */
  nextTexture(context) {
    if (!this.nextMap_) {
      return this.texture(context);
    }
    this.nextTexture_ ??= new Texture({context, source: textureSource(this.nextMap_.image)});
    return this.nextTexture_;
  }

  /**
   * The max map's texture, a pixel of the empty value without a map.
   * @param {any} context the scene's context
   */
  maxTexture(context) {
    if (!this.maxTexture_) {
      const value = 255 * this.empty_;
      const {width, height, data} = this.maxImage() ?? {width: 1, height: 1, data: new Uint8Array([value, value, value, 255])};
      this.maxTexture_ = new Texture({context, source: {width, height, arrayBufferView: data}});
    }
    return this.maxTexture_;
  }

  destroy() {
    this.texture_ = this.texture_?.destroy();
    this.nextTexture_ = this.nextTexture_?.destroy();
    this.maxTexture_ = this.maxTexture_?.destroy();
  }
}
