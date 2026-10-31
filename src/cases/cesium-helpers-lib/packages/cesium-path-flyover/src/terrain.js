import {Cartesian2, Math as CesiumMath} from "@cesium/core";
import {EllipsoidTerrainProvider} from "@cesium/engine";

const FALLBACK_LEVEL = 14;
const TILES_IN_FLIGHT = 64;
// buckets per side of a quantized-mesh tile's index; about ten triangles per
// bucket on a 4000-triangle tile
const GRID = 32;
const MAX_SHORT = 32767;

const tileScratch = new Cartesian2();

/**
 * A number rather than a string per position; room for levels up to 20.
 * @param {number} x
 * @param {number} y
 * @param {number} level
 * @return {number}
 */
const tileKey = (x, y, level) => (level * 2 ** 20 + x) * 2 ** 20 + y;

/**
 * A quantized-mesh tile's triangles bucketed over its (u, v) square, for height
 * lookups without a scan of every triangle. `QuantizedMeshTerrainData.interpolateHeight`
 * scans them all, a few thousand per tile, and a track load asks for hundreds of
 * heights per tile. Reads the tile's private fields; check them on a Cesium upgrade.
 */
class MeshIndex {
  /**
   * @param {any} data a QuantizedMeshTerrainData
   */
  constructor(data) {
    /** @type {Uint16Array} */
    this.u_ = data._uValues;
    /** @type {Uint16Array} */
    this.v_ = data._vValues;
    /** @type {Uint16Array} */
    this.h_ = data._heightValues;
    /** @type {Uint16Array | Uint32Array} */
    this.indices_ = data._indices;
    this.minimumHeight_ = data._minimumHeight;
    this.maximumHeight_ = data._maximumHeight;
    // every bucket a triangle's bounding box touches lists it: the triangles of
    // bucket b are triangles_[starts_[b] .. starts_[b + 1]), two typed arrays
    // rather than a thousand lists. Two passes over the triangles, the bucket
    // bounds of the first kept for the second
    const {u_: u, v_: v, indices_: indices} = this;
    const count = indices.length / 3;
    const bounds = new Uint8Array(4 * count);
    const counts = new Uint32Array(GRID * GRID + 1);
    for (let t = 0; t < count; t++) {
      const i0 = indices[3 * t];
      const i1 = indices[3 * t + 1];
      const i2 = indices[3 * t + 2];
      const x0 = this.bucket_(Math.min(u[i0], u[i1], u[i2]));
      const x1 = this.bucket_(Math.max(u[i0], u[i1], u[i2]));
      const y0 = this.bucket_(Math.min(v[i0], v[i1], v[i2]));
      const y1 = this.bucket_(Math.max(v[i0], v[i1], v[i2]));
      bounds[4 * t] = x0;
      bounds[4 * t + 1] = x1;
      bounds[4 * t + 2] = y0;
      bounds[4 * t + 3] = y1;
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          counts[x * GRID + y + 1]++;
        }
      }
    }
    for (let b = 1; b < counts.length; b++) {
      counts[b] += counts[b - 1];
    }
    /** @type {Uint32Array} */
    this.starts_ = counts.slice();
    const total = counts[counts.length - 1];
    /** @type {Uint16Array | Uint32Array} */
    this.triangles_ = indices.length <= 65536 ? new Uint16Array(total) : new Uint32Array(total);
    for (let t = 0; t < count; t++) {
      for (let x = bounds[4 * t]; x <= bounds[4 * t + 1]; x++) {
        for (let y = bounds[4 * t + 2]; y <= bounds[4 * t + 3]; y++) {
          this.triangles_[counts[x * GRID + y]++] = 3 * t;
        }
      }
    }
  }

  /**
   * @param {number} q quantized coordinate, 0 to MAX_SHORT
   * @return {number}
   */
  bucket_(q) {
    return Math.min(Math.floor((q * GRID) / (MAX_SHORT + 1)), GRID - 1);
  }

  /**
   * The height at a position, as `interpolateHeight` computes it.
   * @param {import('@cesium/core').Rectangle} rectangle of the tile
   * @param {number} longitude radians
   * @param {number} latitude radians
   * @return {number | undefined} undefined outside every triangle
   */
  heightAt(rectangle, longitude, latitude) {
    const u = CesiumMath.clamp((longitude - rectangle.west) / rectangle.width, 0, 1) * MAX_SHORT;
    const v = CesiumMath.clamp((latitude - rectangle.south) / rectangle.height, 0, 1) * MAX_SHORT;
    const {u_: us, v_: vs, h_: hs, indices_: indices} = this;
    const bucket = this.bucket_(u) * GRID + this.bucket_(v);
    for (let k = this.starts_[bucket]; k < this.starts_[bucket + 1]; k++) {
      const t = this.triangles_[k];
      const i0 = indices[t];
      const i1 = indices[t + 1];
      const i2 = indices[t + 2];
      const u0 = us[i0];
      const v0 = vs[i0];
      const u1 = us[i1];
      const v1 = vs[i1];
      const u2 = us[i2];
      const v2 = vs[i2];
      // barycentric coordinates, as Intersections2D.computeBarycentricCoordinates
      const inverse = 1 / ((v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2));
      const b0 = ((v1 - v2) * (u - u2) + (u2 - u1) * (v - v2)) * inverse;
      const b1 = ((v2 - v0) * (u - u2) + (u0 - u2) * (v - v2)) * inverse;
      const b2 = 1 - b0 - b1;
      if (b0 >= -CesiumMath.EPSILON15 && b1 >= -CesiumMath.EPSILON15 && b2 >= -CesiumMath.EPSILON15) {
        return CesiumMath.lerp(this.minimumHeight_, this.maximumHeight_, (b0 * hs[i0] + b1 * hs[i1] + b2 * hs[i2]) / MAX_SHORT);
      }
    }
    return undefined;
  }
}

/**
 * Terrain heights at a fixed level, one tile request per tile for the life of the
 * sampler: positions are grouped by tile, each tile is fetched once and kept, and
 * heights are interpolated from it. `sampleTerrain` refetches every tile on every
 * call, which on a track load meant three to four requests per distinct tile.
 * Tiles the provider lacks at the level (it promises them in its availability data
 * but the server answers 400) are sampled at a coarse level instead, so no position
 * is left without a height. Requests are kept to a bounded number in flight.
 */
export default class TerrainSampler {
  /**
   * @param {import('@cesium/engine').TerrainProvider} terrainProvider
   * @param {number} level
   */
  constructor(terrainProvider, level) {
    this.provider_ = terrainProvider;
    this.level_ = level;
    /** @type {Map<number, Promise<import('@cesium/engine').TerrainData | undefined>>} */
    this.tiles_ = new Map();
    /** @type {Map<number, MeshIndex>} by tile key, built on the first lookup */
    this.indices_ = new Map();
    this.inFlight_ = 0;
    /** @type {(() => void)[]} */
    this.waiting_ = [];
  }

  /**
   * @param {import('@cesium/core').Cartographic[]} cartographics not modified
   * @return {Promise<(number | undefined)[]>} terrain height per position; undefined
   *   where the provider has no terrain (an EllipsoidTerrainProvider) or no tile
   */
  async heightsAt(cartographics) {
    // other providers may list no availability, yet have terrain
    if (this.provider_ instanceof EllipsoidTerrainProvider) {
      return cartographics.map(() => undefined);
    }
    const heights = await this.sampleAt_(cartographics, this.level_);
    const missing = heights.keys().filter((i) => heights[i] === undefined).toArray();
    if (missing.length > 0) {
      const coarse = await this.sampleAt_(missing.map((i) => cartographics[i]), FALLBACK_LEVEL);
      missing.forEach((i, k) => {
        heights[i] = coarse[k];
      });
    }
    return heights;
  }

  /**
   * @param {import('@cesium/core').Cartographic[]} cartographics
   * @param {number} level
   * @return {Promise<(number | undefined)[]>}
   */
  async sampleAt_(cartographics, level) {
    const scheme = this.provider_.tilingScheme;
    /** @type {Map<number, {x: number, y: number, indices: number[]}>} */
    const groups = new Map();
    cartographics.forEach((cartographic, i) => {
      if (!scheme.positionToTileXY(cartographic, level, tileScratch)) {
        return;
      }
      const key = tileKey(tileScratch.x, tileScratch.y, level);
      let group = groups.get(key);
      if (!group) {
        group = {x: tileScratch.x, y: tileScratch.y, indices: []};
        groups.set(key, group);
      }
      group.indices.push(i);
    });
    /** @type {(number | undefined)[]} */
    const heights = new Array(cartographics.length).fill(undefined);
    await Promise.all(
      groups.entries().map(async ([key, group]) => {
        await this.availability_(group.x, group.y, level);
        const data = await this.tile_(key, group.x, group.y, level);
        if (!data) {
          return;
        }
        const rectangle = scheme.tileXYToRectangle(group.x, group.y, level);
        const index = this.index_(key, data);
        for (const i of group.indices) {
          const height = index
            ? index.heightAt(rectangle, cartographics[i].longitude, cartographics[i].latitude)
            : data.interpolateHeight(rectangle, cartographics[i].longitude, cartographics[i].latitude);
          heights[i] = Number.isFinite(height) ? height : undefined;
        }
      })
    );
    return heights;
  }

  /**
   * Loads the tile that lists which tiles exist in the subtree holding this one, with a
   * provider that spreads its availability over tiles every few levels. Cesium expects
   * a tile's parents to load first, as the globe does: a deep tile fetched on its own
   * counts as the listing tile loaded, and every tile not listed yet around it then
   * reads as missing. Reads the provider's private layer; check it on a Cesium upgrade.
   * @param {number} x
   * @param {number} y
   * @param {number} level
   * @return {Promise<unknown>}
   */
  availability_(x, y, level) {
    const every = /** @type {any} */ (this.provider_)._layers?.[0]?.availabilityLevels;
    if (!every) {
      return Promise.resolve();
    }
    // the level of the listing tile, as Cesium's getAvailabilityTile computes it;
    // the root tiles came with the provider
    const parent = level % every === 0 ? level - every : Math.floor(level / every) * every;
    if (parent <= 0) {
      return Promise.resolve();
    }
    const px = x >> (level - parent);
    const py = y >> (level - parent);
    return this.tile_(tileKey(px, py, parent), px, py, parent);
  }

  /**
   * @param {number} key
   * @param {any} data
   * @return {MeshIndex | undefined} undefined for terrain data that is not a quantized mesh, sampled the Cesium way
   */
  index_(key, data) {
    if (!data._indices || !data._uValues) {
      return undefined;
    }
    let index = this.indices_.get(key);
    if (!index) {
      index = new MeshIndex(data);
      this.indices_.set(key, index);
    }
    return index;
  }

  /**
   * @param {number} key
   * @param {number} x
   * @param {number} y
   * @param {number} level
   * @return {Promise<import('@cesium/engine').TerrainData | undefined>}
   */
  tile_(key, x, y, level) {
    let promise = this.tiles_.get(key);
    if (!promise) {
      promise = this.fetch_(x, y, level);
      this.tiles_.set(key, promise);
    }
    return promise;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} level
   * @return {Promise<import('@cesium/engine').TerrainData | undefined>}
   */
  async fetch_(x, y, level) {
    if (this.provider_.getTileDataAvailable(x, y, level) === false) {
      return undefined;
    }
    await this.slot_();
    try {
      const request = this.provider_.requestTileGeometry(x, y, level);
      return request ? await request : undefined;
    } catch {
      return undefined;
    } finally {
      this.inFlight_--;
      this.waiting_.shift()?.();
    }
  }

  /** @return {Promise<void>} resolves once fewer than TILES_IN_FLIGHT requests are pending */
  slot_() {
    if (this.inFlight_ < TILES_IN_FLIGHT) {
      this.inFlight_++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting_.push(() => {
        this.inFlight_++;
        resolve();
      });
    });
  }
}
