import {Cartesian2, PolygonPipeline} from "@cesium/core";

// Triangles of one color, built face by face, for createTriangleMesh (triangle-mesh.js) and a drawing of them.

/**
 * @typedef {object} Chart A face's place among a group's vertices, for laying it out in an atlas.
 * @property {number} start Its first vertex.
 * @property {number} count Its vertices.
 * @property {number[]} normal Its normal, not of unit length.
 */

/** The normal of a flat ring of corners, by Newell's method, of any length. */
function newell(/** @type {number[][]} */ corners) {
  const n = [0, 0, 0];
  corners.forEach(([x, y, z], i) => {
    const [nx, ny, nz] = corners[(i + 1) % corners.length];
    n[0] += (y - ny) * (z + nz);
    n[1] += (z - nz) * (x + nx);
    n[2] += (x - nx) * (y + ny);
  });
  return n;
}

export class Group {
  /**
   * Triangles of one color, in meters, z up.
   * @param {number[]} color Linear, and its alpha.
   * @param {{charts?: boolean} & Record<string, any>} [options] The group's (collide, and a drawing's own: show,
   *     shadows, emissive, uv, ...), passed on; charts: each face recorded, for an atlas.
   */
  constructor(color, {charts = false, ...options} = {}) {
    this.color = color;
    this.options = options;
    /** @type {number[]} */
    this.positions = [];
    /** @type {number[]} */
    this.indices = [];
    /** @type {Chart[] | undefined} */
    this.charts = charts ? [] : undefined;
  }

  /**
   * A planar convex face, its corners in order.
   * @param {...number[]} corners [x, y, z]
   */
  face(...corners) {
    const first = this.positions.length / 3;
    corners.forEach((corner) => this.positions.push(...corner));
    for (let i = 1; i + 1 < corners.length; i++) {
      this.indices.push(first, first + i, first + i + 1);
    }
    this.charts?.push({start: first, count: corners.length, normal: newell(corners)});
  }

  /**
   * A flat polygon with holes, its height at each corner.
   * @param {number[][]} outline [x, y]
   * @param {number[][][]} holes
   * @param {(x: number, y: number) => number} z
   */
  polygon(outline, holes, z) {
    const points = [outline, ...holes].flat();
    /** @type {number[]} */
    const starts = [];
    let start = outline.length;
    for (const hole of holes) {
      starts.push(start);
      start += hole.length;
    }
    const first = this.positions.length / 3;
    points.forEach(([x, y]) => this.positions.push(x, y, z(x, y)));
    PolygonPipeline.triangulate(points.map(([x, y]) => new Cartesian2(x, y)), starts).forEach((i) => this.indices.push(first + i));
    this.charts?.push({start: first, count: points.length, normal: newell(outline.map(([x, y]) => [x, y, z(x, y)]))});
  }

  /**
   * The faces of a ring between two heights.
   * @param {number[][]} ring [x, y]
   * @param {number} z0
   * @param {number} z1
   */
  sides(ring, z0, z1) {
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      this.face([...a, z0], [...b, z0], [...b, z1], [...a, z1]);
    });
  }

  /**
   * An axis-aligned box.
   * @param {number} x0
   * @param {number} y0
   * @param {number} z0
   * @param {number} x1
   * @param {number} y1
   * @param {number} z1
   */
  box(x0, y0, z0, x1, y1, z1) {
    this.sides([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1);
    this.face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    this.face([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]);
  }

  /** The group for createTriangleMesh: its color, vertices and triangles, its options, its charts if recorded. */
  get meshGroup() {
    return {color: this.color, vertices: new Float32Array(this.positions), triangles: new Uint32Array(this.indices), ...this.options,
      ...(this.charts ? {charts: this.charts} : {})};
  }
}
