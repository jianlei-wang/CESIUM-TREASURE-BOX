// A bounding volume hierarchy over triangles, for rays and for the nearest triangle to a point: the nearest hit along a ray, whether any lies
// within a distance, how many, every one; the closest triangle within a radius. Flat typed arrays (a worker takes them as they are), no dependency,
// no Cesium, no DOM: any scene, in Node and in the browser.
//
// The ideas are the established ones (three-mesh-bvh, flatbush, Aila and Laine): nodes packed depth first in typed arrays, the left child
// right after its parent; a split chosen over binned surface areas (SAH); a ray walks the near child first, by its sign on the split axis,
// and a query that wants any hit stops at the first.

const BINS = 16;
// a node's bins: a quarter of its triangles, from MIN_BINS to BINS
const MIN_BINS = 4;
// the cost of a box test against a triangle's, in the split's estimate
const TRAVERSAL = 0.5;
const STACK = 128;
const stackNode = new Int32Array(STACK);
const stackNear = new Float64Array(STACK);

/**
 * The tree over primitives' boxes: the nodes, and the primitives' order, in leaves.
 * @param {Float64Array} lo Each primitive's lowest corner, three numbers a primitive.
 * @param {Float64Array} hi Its highest.
 * @param {number} leaf The most primitives a leaf holds.
 */
function buildTree(lo, hi, leaf) {
  const n = lo.length / 3;
  const mid = Float64Array.from(lo, (v, i) => (v + hi[i]) / 2);
  // the triangles are permuted with their boxes: `at` says where each is
  const at = Int32Array.from({length: n}, (_, i) => i);
  const bounds = new Float64Array(Math.max(1, 2 * n) * 6);
  const meta = new Int32Array(Math.max(1, 2 * n) * 3);
  let nodes = 0;
  const binCount = new Int32Array(BINS), binLo = new Float64Array(BINS * 3), binHi = new Float64Array(BINS * 3);
  const rightArea = new Float64Array(BINS);
  /**
   * @param {number} x0
   * @param {number} y0
   * @param {number} z0
   * @param {number} x1
   * @param {number} y1
   * @param {number} z1
   */
  const area = (x0, y0, z0, x1, y1, z1) => {
    const [dx, dy, dz] = [x1 - x0, y1 - y0, z1 - z0];
    return dx < 0 ? 0 : 2 * (dx * dy + dy * dz + dz * dx);
  };

  // the node over the triangles [from, to) of `at`; its index
  /**
   * @param {number} from
   * @param {number} to
   */
  const build = (from, to) => {
    const node = nodes++;
    let [x0, y0, z0, x1, y1, z1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    let [cx0, cy0, cz0, cx1, cy1, cz1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let k = from; k < to; k++) {
      const t = at[k] * 3;
      x0 = Math.min(x0, lo[t]); y0 = Math.min(y0, lo[t + 1]); z0 = Math.min(z0, lo[t + 2]);
      x1 = Math.max(x1, hi[t]); y1 = Math.max(y1, hi[t + 1]); z1 = Math.max(z1, hi[t + 2]);
      cx0 = Math.min(cx0, mid[t]); cy0 = Math.min(cy0, mid[t + 1]); cz0 = Math.min(cz0, mid[t + 2]);
      cx1 = Math.max(cx1, mid[t]); cy1 = Math.max(cy1, mid[t + 1]); cz1 = Math.max(cz1, mid[t + 2]);
    }
    bounds.set([x0, y0, z0, x1, y1, z1], node * 6);
    const count = to - from;
    const makeLeaf = () => {
      meta[node * 3] = from;
      meta[node * 3 + 1] = count;
      return node;
    };
    if (count <= leaf) {
      return makeLeaf();
    }
    // the best split over the three axes: the surface areas of the two sides, by their triangles, over BINS bins of the centers
    const [cmin, cmax] = [[cx0, cy0, cz0], [cx1, cy1, cz1]];
    const whole = area(x0, y0, z0, x1, y1, z1);
    // few triangles need few bins: the search over 16 is most of the build's time, in the many small nodes near the leaves
    const bins = Math.max(MIN_BINS, Math.min(BINS, count >> 2));
    let best = {cost: Infinity, axis: -1, bin: 0, bins};
    for (let a = 0; a < 3; a++) {
      const extent = cmax[a] - cmin[a];
      if (!(extent > 1e-12)) {
        continue;
      }
      binCount.fill(0, 0, bins);
      binLo.fill(Infinity, 0, bins * 3);
      binHi.fill(-Infinity, 0, bins * 3);
      const scale = bins / extent;
      for (let k = from; k < to; k++) {
        const t = at[k] * 3;
        const b = Math.min(bins - 1, Math.floor((mid[t + a] - cmin[a]) * scale));
        binCount[b]++;
        for (let c = 0; c < 3; c++) {
          binLo[b * 3 + c] = Math.min(binLo[b * 3 + c], lo[t + c]);
          binHi[b * 3 + c] = Math.max(binHi[b * 3 + c], hi[t + c]);
        }
      }
      // from the right: each split's right area
      let [rx0, ry0, rz0, rx1, ry1, rz1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let b = bins - 1; b > 0; b--) {
        rx0 = Math.min(rx0, binLo[b * 3]); ry0 = Math.min(ry0, binLo[b * 3 + 1]); rz0 = Math.min(rz0, binLo[b * 3 + 2]);
        rx1 = Math.max(rx1, binHi[b * 3]); ry1 = Math.max(ry1, binHi[b * 3 + 1]); rz1 = Math.max(rz1, binHi[b * 3 + 2]);
        rightArea[b] = area(rx0, ry0, rz0, rx1, ry1, rz1);
      }
      let [lx0, ly0, lz0, lx1, ly1, lz1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      let left = 0;
      for (let b = 0; b < bins - 1; b++) {
        lx0 = Math.min(lx0, binLo[b * 3]); ly0 = Math.min(ly0, binLo[b * 3 + 1]); lz0 = Math.min(lz0, binLo[b * 3 + 2]);
        lx1 = Math.max(lx1, binHi[b * 3]); ly1 = Math.max(ly1, binHi[b * 3 + 1]); lz1 = Math.max(lz1, binHi[b * 3 + 2]);
        left += binCount[b];
        if (left === 0 || left === count) {
          continue;
        }
        const cost = TRAVERSAL + (area(lx0, ly0, lz0, lx1, ly1, lz1) * left + rightArea[b + 1] * (count - left)) / (whole || 1);
        if (cost < best.cost) {
          best = {cost, axis: a, bin: b, bins};
        }
      }
    }
    if (best.axis < 0) {
      // no split pays (or all the centers are one point): a leaf, however many, unless it is far over the size
      if (count <= leaf * 4) {
        return makeLeaf();
      }
      const half = from + (count >> 1);
      meta[node * 3 + 2] = 0;
      build(from, half);
      meta[node * 3] = build(half, to);
      return node;
    }
    // partition by the chosen bin
    const scale = best.bins / (cmax[best.axis] - cmin[best.axis]);
    let [i, j] = [from, to - 1];
    while (i <= j) {
      const b = Math.min(best.bins - 1, Math.floor((mid[at[i] * 3 + best.axis] - cmin[best.axis]) * scale));
      if (b <= best.bin) {
        i++;
      } else {
        [at[i], at[j]] = [at[j], at[i]];
        j--;
      }
    }
    // a split that left one side empty (rounding): the middle
    const cut = i === from || i === to ? from + (count >> 1) : i;
    meta[node * 3 + 2] = best.axis;
    build(from, cut);
    meta[node * 3] = build(cut, to);
    return node;
  };
  build(0, n);
  return {bounds: bounds.slice(0, nodes * 6), meta: meta.slice(0, nodes * 3), at, nodes};
}

const EMPTY = {bounds: new Float64Array(0), meta: new Int32Array(0), data: new Float64Array(0), ids: new Int32Array(0), nodes: 0};

/**
 * The tree over some triangles.
 * @param {Float64Array} tris A triangle each, nine numbers: its first corner, then its two edges from it.
 * @param {Int32Array | number[]} [ids] The triangles to take; all by default.
 * @param {{leaf?: number}} [options] `leaf`: the most triangles a leaf holds.
 * @return {{bounds: Float64Array, meta: Int32Array, data: Float64Array, ids: Int32Array, nodes: number}} A node's box (six numbers) and
 *   `meta` (three: a leaf's first triangle and its count, else its right child, 0, its split axis); `data` the triangles in leaf order
 *   (the tris' layout), `ids` their numbers in `tris`.
 */
export function buildBvh(tris, ids = Int32Array.from({length: tris.length / 9}, (_, i) => i), {leaf = 4} = {}) {
  const n = ids.length;
  if (n === 0) {
    return EMPTY;
  }
  const order = Int32Array.from(ids);
  const lo = new Float64Array(n * 3), hi = new Float64Array(n * 3);
  for (let k = 0; k < n; k++) {
    const o = order[k] * 9;
    for (let a = 0; a < 3; a++) {
      const p = tris[o + a], q = p + tris[o + 3 + a], r = p + tris[o + 6 + a];
      lo[k * 3 + a] = Math.min(p, q, r);
      hi[k * 3 + a] = Math.max(p, q, r);
    }
  }
  const {bounds, meta, at, nodes} = buildTree(lo, hi, leaf);
  const data = new Float64Array(n * 9);
  const sorted = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    sorted[k] = order[at[k]];
    data.set(tris.subarray(sorted[k] * 9, sorted[k] * 9 + 9), k * 9);
  }
  return {bounds, meta, data, ids: sorted, nodes};
}

/**
 * The triangles of groups of vertices and indices, as `buildBvh` takes them: nine numbers each, a corner and its two edges from it, the
 * groups' triangles one after the other, so a triangle's number is its place in the groups' order.
 * @param {{vertices: ArrayLike<number>, triangles: ArrayLike<number>}[]} groups x, y, z a vertex; three indices a triangle.
 * @param {Float64Array} [result] Of the right size: filled instead of a new array, for triangles that moved (`refitBvh`).
 * @return {Float64Array}
 */
export function trianglesOf(groups, result) {
  const tris = result ?? new Float64Array(9 * groups.reduce((sum, {triangles}) => sum + triangles.length / 3, 0));
  let n = 0;
  for (const {vertices: v, triangles: t} of groups) {
    for (let k = 0; k < t.length; k += 3, n++) {
      const [a, b, c] = [t[k] * 3, t[k + 1] * 3, t[k + 2] * 3];
      tris[n * 9] = v[a];
      tris[n * 9 + 1] = v[a + 1];
      tris[n * 9 + 2] = v[a + 2];
      tris[n * 9 + 3] = v[b] - v[a];
      tris[n * 9 + 4] = v[b + 1] - v[a + 1];
      tris[n * 9 + 5] = v[b + 2] - v[a + 2];
      tris[n * 9 + 6] = v[c] - v[a];
      tris[n * 9 + 7] = v[c + 1] - v[a + 1];
      tris[n * 9 + 8] = v[c + 2] - v[a + 2];
    }
  }
  return tris;
}

/**
 * The tree kept for triangles that have moved: their new corners and edges taken, and every box made again from the leaves up, the
 * tree's shape as it was. A few milliseconds for 45,000 triangles, where a build takes 130; the tree answers right at once, and
 * the more the triangles have gone from where it was built for them the slower it answers (boxes grown to cover both places): build it
 * again when many have moved far.
 * @param {ReturnType<typeof buildBvh>} bvh A tree made by `buildBvh`, changed in place: the queries made of it follow.
 * @param {Float64Array} tris The triangles the tree was built from, moved: the same layout and numbers.
 * @return {ReturnType<typeof buildBvh>} The same tree.
 */
export function refitBvh(bvh, tris) {
  const {bounds, meta, data, ids, nodes} = bvh;
  if (data.length !== ids.length * 9) {
    throw new Error('refitBvh: not a tree of triangles (nine numbers an element)');
  }
  for (let k = 0; k < ids.length; k++) {
    data.set(tris.subarray(ids[k] * 9, ids[k] * 9 + 9), k * 9);
  }
  // a node comes before its children: from the last, each node's children are done
  for (let node = nodes - 1; node >= 0; node--) {
    const b = node * 6;
    const count = meta[node * 3 + 1];
    if (count > 0) {
      const first = meta[node * 3];
      for (let a = 0; a < 3; a++) {
        let [low, high] = [Infinity, -Infinity];
        for (let k = first; k < first + count; k++) {
          const p = data[k * 9 + a], q = p + data[k * 9 + 3 + a], r = p + data[k * 9 + 6 + a];
          low = Math.min(low, p, q, r);
          high = Math.max(high, p, q, r);
        }
        bounds[b + a] = low;
        bounds[b + 3 + a] = high;
      }
    } else {
      const [left, right] = [(node + 1) * 6, meta[node * 3] * 6];
      for (let a = 0; a < 3; a++) {
        bounds[b + a] = Math.min(bounds[left + a], bounds[right + a]);
        bounds[b + 3 + a] = Math.max(bounds[left + 3 + a], bounds[right + 3 + a]);
      }
    }
  }
  return bvh;
}

/**
 * The tree over some line segments, for `segmentQueries`.
 * @param {Float64Array} segments A segment each, six numbers: its two ends.
 * @param {Int32Array | number[]} [ids] The segments to take; all by default.
 * @param {{leaf?: number}} [options] `leaf`: the most segments a leaf holds.
 * @return {{bounds: Float64Array, meta: Int32Array, data: Float64Array, ids: Int32Array, nodes: number}} As `buildBvh`'s, `data` six numbers a segment.
 */
export function buildSegmentBvh(segments, ids = Int32Array.from({length: segments.length / 6}, (_, i) => i), {leaf = 4} = {}) {
  const n = ids.length;
  if (n === 0) {
    return EMPTY;
  }
  const order = Int32Array.from(ids);
  const lo = new Float64Array(n * 3), hi = new Float64Array(n * 3);
  for (let k = 0; k < n; k++) {
    for (let a = 0; a < 3; a++) {
      const [p, q] = [segments[order[k] * 6 + a], segments[order[k] * 6 + 3 + a]];
      lo[k * 3 + a] = Math.min(p, q);
      hi[k * 3 + a] = Math.max(p, q);
    }
  }
  const {bounds, meta, at, nodes} = buildTree(lo, hi, leaf);
  const data = new Float64Array(n * 6);
  const sorted = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    sorted[k] = order[at[k]];
    data.set(segments.subarray(sorted[k] * 6, sorted[k] * 6 + 6), k * 6);
  }
  return {bounds, meta, data, ids: sorted, nodes};
}

/**
 * The queries of a tree built by `buildBvh`: a ray from (px, py, pz) along the unit (dx, dy, dz), the triangles hit within `reach` meters,
 * both sides of a face (a hit nearer than `min` is not one); the triangle nearest a point.
 * @param {ReturnType<typeof buildBvh>} bvh
 * @param {{min?: number}} [options] `min`: the least distance a hit is from the ray's start, 0.1 mm by default: a ray starting on a surface is
 *   not to hit it. A negative one (`-Infinity`) lets a hit at the start count: a mover standing on a floor.
 */
export function bvhQueries({bounds, meta, data, ids, nodes}, {min = 1e-4} = {}) {
  /**
   * @param {number} k
   * @param {number} px
   * @param {number} py
   * @param {number} pz
   * @param {number} dx
   * @param {number} dy
   * @param {number} dz
   */
  const hit = (k, px, py, pz, dx, dy, dz) => {
    const o = k * 9;
    const e1x = data[o + 3], e1y = data[o + 4], e1z = data[o + 5], e2x = data[o + 6], e2y = data[o + 7], e2z = data[o + 8];
    const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
    const a = e1x * hx + e1y * hy + e1z * hz;
    if (a > -1e-12 && a < 1e-12) {
      return -1;
    }
    const f = 1 / a, sx = px - data[o], sy = py - data[o + 1], sz = pz - data[o + 2];
    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) {
      return -1;
    }
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = f * (dx * qx + dy * qy + dz * qz);
    if (v < 0 || u + v > 1) {
      return -1;
    }
    const t = f * (e2x * qx + e2y * qy + e2z * qz);
    return t > min ? t : -1;
  };
  // where a ray enters a node's box, or Infinity: the slab test, over the ray's inverse direction
  /**
   * @param {number} node
   * @param {number} px
   * @param {number} py
   * @param {number} pz
   * @param {number} ix
   * @param {number} iy
   * @param {number} iz
   * @param {number} tmax
   */
  const enter = (node, px, py, pz, ix, iy, iz, tmax) => {
    const b = node * 6;
    let t0 = 0, t1 = tmax;
    let a = (bounds[b] - px) * ix, c = (bounds[b + 3] - px) * ix;
    t0 = Math.max(t0, a < c ? a : c);
    t1 = Math.min(t1, a < c ? c : a);
    a = (bounds[b + 1] - py) * iy;
    c = (bounds[b + 4] - py) * iy;
    t0 = Math.max(t0, a < c ? a : c);
    t1 = Math.min(t1, a < c ? c : a);
    a = (bounds[b + 2] - pz) * iz;
    c = (bounds[b + 5] - pz) * iz;
    t0 = Math.max(t0, a < c ? a : c);
    t1 = Math.min(t1, a < c ? c : a);
    return t0 <= t1 ? t0 : Infinity;
  };

  // a ray's way down the tree. A node's box is tested when the node is reached, with the reach the ray has by then; the child the ray
  // meets first (by its sign on the split axis) is walked, the other left on the stack: a query that stops early never tests it.
  /**
   * @param {number} px
   * @param {number} py
   * @param {number} pz
   * @param {number} dx
   * @param {number} dy
   * @param {number} dz
   * @param {number} reach
   * @param {(k: number, t: number, reach: number) => number} found
   */
  const unit = (px, py, pz, dx, dy, dz, reach, found) => {
    // `found(k, t, reach)` per triangle hit: the reach to go on with, or a negative number to stop; called for each triangle in a leaf reached
    if (nodes === 0) {
      return;
    }
    const [ix, iy, iz] = [1 / dx, 1 / dy, 1 / dz];
    let tmax = reach;
    let top = 0;
    let node = 0;
    for (;;) {
      if (enter(node, px, py, pz, ix, iy, iz, tmax) !== Infinity) {
        const count = meta[node * 3 + 1];
        if (count > 0) {
          const first = meta[node * 3];
          for (let k = first; k < first + count; k++) {
            const t = hit(k, px, py, pz, dx, dy, dz);
            if (t >= 0 && t <= tmax) {
              tmax = found(k, t, tmax);
              if (tmax < 0) {
                return;
              }
            }
          }
        } else {
          const axis = meta[node * 3 + 2];
          const negative = axis === 0 ? dx < 0 : axis === 1 ? dy < 0 : dz < 0;
          const right = meta[node * 3];
          stackNode[top++] = negative ? node + 1 : right;
          node = negative ? right : node + 1;
          continue;
        }
      }
      if (top === 0) {
        return;
      }
      node = stackNode[--top];
    }
  };

  // the squared distance from a point to a node's box
  /**
   * @param {number} node
   * @param {number} px
   * @param {number} py
   * @param {number} pz
   */
  const boxDistance2 = (node, px, py, pz) => {
    const b = node * 6;
    const dx = Math.max(bounds[b] - px, 0, px - bounds[b + 3]);
    const dy = Math.max(bounds[b + 1] - py, 0, py - bounds[b + 4]);
    const dz = Math.max(bounds[b + 2] - pz, 0, pz - bounds[b + 5]);
    return dx * dx + dy * dy + dz * dz;
  };
  // the offset from a triangle's corner to the nearest point of it, as triangleDistance2 last found it
  const offset = new Float64Array(3);
  // the squared distance from a point to a triangle: to the nearest point of it, by the region the point falls in (Ericson's)
  /**
   * @param {number} k
   * @param {number} px
   * @param {number} py
   * @param {number} pz
   */
  const triangleDistance2 = (k, px, py, pz) => {
    const o = k * 9;
    const [abx, aby, abz, acx, acy, acz] = [data[o + 3], data[o + 4], data[o + 5], data[o + 6], data[o + 7], data[o + 8]];
    const [apx, apy, apz] = [px - data[o], py - data[o + 1], pz - data[o + 2]];
    const to = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
      offset[0] = x;
      offset[1] = y;
      offset[2] = z;
      return (apx - x) ** 2 + (apy - y) ** 2 + (apz - z) ** 2;
    };
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) {
      return to(0, 0, 0);
    }
    const [bpx, bpy, bpz] = [apx - abx, apy - aby, apz - abz];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) {
      return to(abx, aby, abz);
    }
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      return to(abx * v, aby * v, abz * v);
    }
    const [cpx, cpy, cpz] = [apx - acx, apy - acy, apz - acz];
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) {
      return to(acx, acy, acz);
    }
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      return to(acx * w, acy * w, acz * w);
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + d5 - d6);
      return to(abx + (acx - abx) * w, aby + (acy - aby) * w, abz + (acz - abz) * w);
    }
    const denominator = 1 / (va + vb + vc);
    const [v, w] = [vb * denominator, vc * denominator];
    return to(abx * v + acx * w, aby * v + acy * w, abz * v + acz * w);
  };

  return {
    /** The distance to the nearest hit within `reach`, or Infinity. */
    nearest(/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ pz, /** @type {number} */ dx, /** @type {number} */ dy, /** @type {number} */ dz, /** @type {number} */ reach) {
      let best = Infinity;
      unit(px, py, pz, dx, dy, dz, reach, (_k, t) => ((best = t), t));
      return best;
    },
    /** The nearest hit within `reach`: its triangle's number (in the `tris` the tree was built from) and its distance; none: undefined. */
    nearestHit(/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ pz, /** @type {number} */ dx, /** @type {number} */ dy, /** @type {number} */ dz, /** @type {number} */ reach) {
      let [best, found] = [Infinity, -1];
      unit(px, py, pz, dx, dy, dz, reach, (k, t) => ((best = t), (found = k), t));
      return found < 0 ? undefined : {triangle: ids[found], distance: best};
    },
    /**
     * A triangle hit within `reach`, its number, or -1 if none is. `hint`, a triangle that blocked a ray before, is tried first: the rays of
     * one point toward a sun five minutes on are near the last, and the same triangle most often stops them.
     */
    any(/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ pz, /** @type {number} */ dx, /** @type {number} */ dy, /** @type {number} */ dz, /** @type {number} */ reach, /** @type {number} */ hint = -1) {
      if (hint >= 0) {
        const t = hit(hint, px, py, pz, dx, dy, dz);
        if (t >= 0 && t <= reach) {
          return hint;
        }
      }
      let found = -1;
      unit(px, py, pz, dx, dy, dz, reach, k => ((found = k), -1));
      return found;
    },
    /** How many triangles are hit within `reach`, to `cap`. */
    count(/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ pz, /** @type {number} */ dx, /** @type {number} */ dy, /** @type {number} */ dz, /** @type {number} */ reach, /** @type {number} */ cap = Infinity) {
      let n = 0;
      unit(px, py, pz, dx, dy, dz, reach, (_k, _t, tmax) => (++n >= cap ? -1 : tmax));
      return n;
    },
    /** The distances of every hit within `reach`, nearest first. */
    hits(/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ pz, /** @type {number} */ dx, /** @type {number} */ dy, /** @type {number} */ dz, /** @type {number} */ reach) {
      /** @type {number[]} */
      const found = [];
      unit(px, py, pz, dx, dy, dz, reach, (_k, t, tmax) => (found.push(t), tmax));
      return found.sort((a, b) => a - b);
    },
    /** The triangle nearest a point within `radius` meters, its number (in the `tris` the tree was built from), its distance and the nearest point of it; none: undefined. */
    closest(/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ pz, /** @type {number} */ radius) {
      if (nodes === 0) {
        return undefined;
      }
      let [best, found, top, node, near] = [radius * radius, -1, 0, 0, boxDistance2(0, px, py, pz)];
      for (;;) {
        if (near <= best) {
          const count = meta[node * 3 + 1];
          if (count > 0) {
            const first = meta[node * 3];
            for (let k = first; k < first + count; k++) {
              const d = triangleDistance2(k, px, py, pz);
              if (d <= best) {
                [best, found] = [d, k];
              }
            }
          } else {
            const [left, right] = [node + 1, meta[node * 3]];
            const [dl, dr] = [boxDistance2(left, px, py, pz), boxDistance2(right, px, py, pz)];
            const [first, second, df, ds] = dl <= dr ? [left, right, dl, dr] : [right, left, dr, dl];
            if (ds <= best) {
              stackNode[top] = second;
              stackNear[top++] = ds;
            }
            [node, near] = [first, df];
            continue;
          }
        }
        do {
          if (top === 0) {
            if (found < 0) {
              return undefined;
            }
            triangleDistance2(found, px, py, pz);
            const o = found * 9;
            const point = [0, 1, 2].map(a => data[o + a] + offset[a]);
            return {triangle: ids[found], distance: Math.sqrt(best), point};
          }
          top--;
          [node, near] = [stackNode[top], stackNear[top]];
        } while (near > best);
      }
    },
  };
}

/**
 * The queries of a tree built by `buildSegmentBvh`: the segments within a distance of a point, and those whose boxes meet a box. Each gives the
 * segments' numbers in the array the tree was built from, in no order.
 * @param {ReturnType<typeof buildSegmentBvh>} bvh
 */
export function segmentQueries({bounds, meta, data, ids, nodes}) {
  // walks the nodes whose boxes `reaches` says, and gives the leaves' segments `takes` says
  /**
   * @param {(node: number) => boolean} reaches A node's offset in `bounds`.
   * @param {(segment: number) => boolean} takes A segment's offset in `data`.
   */
  const walk = (reaches, takes) => {
    /** @type {number[]} */
    const found = [];
    if (nodes === 0) {
      return found;
    }
    let [top, node] = [0, 0];
    for (;;) {
      if (reaches(node * 6)) {
        const count = meta[node * 3 + 1];
        if (count > 0) {
          for (let k = meta[node * 3]; k < meta[node * 3] + count; k++) {
            if (takes(k * 6)) {
              found.push(ids[k]);
            }
          }
        } else {
          stackNode[top++] = meta[node * 3];
          node += 1;
          continue;
        }
      }
      if (top === 0) {
        return found;
      }
      node = stackNode[--top];
    }
  };
  return {
    /** The segments within `radius` meters of a point. */
    near(/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ pz, /** @type {number} */ radius) {
      const r2 = radius * radius;
      return walk(b => {
        const dx = Math.max(bounds[b] - px, 0, px - bounds[b + 3]);
        const dy = Math.max(bounds[b + 1] - py, 0, py - bounds[b + 4]);
        const dz = Math.max(bounds[b + 2] - pz, 0, pz - bounds[b + 5]);
        return dx * dx + dy * dy + dz * dz <= r2;
      }, o => {
        const [ax, ay, az] = [data[o], data[o + 1], data[o + 2]];
        const [rx, ry, rz] = [data[o + 3] - ax, data[o + 4] - ay, data[o + 5] - az];
        const length = rx * rx + ry * ry + rz * rz;
        const t = length > 0 ? Math.min(1, Math.max(0, ((px - ax) * rx + (py - ay) * ry + (pz - az) * rz) / length)) : 0;
        const [dx, dy, dz] = [px - ax - t * rx, py - ay - t * ry, pz - az - t * rz];
        return dx * dx + dy * dy + dz * dz <= r2;
      });
    },
    /** The segments whose boxes (an end to the other) meet the box from (x0, y0, z0) to (x1, y1, z1). */
    overlapping(/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ z0, /** @type {number} */ x1, /** @type {number} */ y1, /** @type {number} */ z1) {
      return walk(b => bounds[b] <= x1 && bounds[b + 3] >= x0 && bounds[b + 1] <= y1 && bounds[b + 4] >= y0 && bounds[b + 2] <= z1 && bounds[b + 5] >= z0,
        o => Math.min(data[o], data[o + 3]) <= x1 && Math.max(data[o], data[o + 3]) >= x0 && Math.min(data[o + 1], data[o + 4]) <= y1
          && Math.max(data[o + 1], data[o + 4]) >= y0 && Math.min(data[o + 2], data[o + 5]) <= z1 && Math.max(data[o + 2], data[o + 5]) >= z0);
    },
  };
}
