# Bounding volume hierarchy for triangles

Rays and nearest-point queries against a triangle soup: the nearest hit along a ray, whether any lies within a distance, how many, every
one, and the closest triangle to a point; and, over line segments, those near a point or in a box. Flat typed arrays (a worker takes them as they are), no dependency: not Cesium, not three.js, not the
DOM. It serves a CesiumJS scene's picking, collisions and measuring, and anything else that asks questions of triangles.

- nodes packed depth first in typed arrays, the left child right after its parent
- a split chosen over binned surface areas (SAH); a ray walks the near child first, and a query that wants any hit stops at the first
- a ray hits both sides of a face; the least distance from its start, 0.1 mm by default, is yours to set (a negative one, `-Infinity`, counts a hit at the start)
- a hint (the triangle that blocked the last ray) is tried first: the rays of a point toward a sun five minutes on are near each other

## Installation

```bash
npm i --save @geoblocks/cesium-bvh
```

## Usage

```js
import {buildBvh, bvhQueries} from '@geoblocks/cesium-bvh';

// a triangle each, nine numbers: its first corner, then its two edges from it (`trianglesOf(groups)` makes them of groups
// of `{vertices, triangles}`: x, y, z a vertex, three indices a triangle)
const tris = Float64Array.of(-5, -5, 0, 10, 0, 0, 0, 10, 0);
const bvh = buildBvh(tris);                  // a subset of the triangles by number: buildBvh(tris, [0, 2, 5])
const queries = bvhQueries(bvh, {min: 0.01}); // a ray starting on a surface is not to hit it

queries.nearest(0, 0, 3, 0, 0, -1, 100);     // 3, the distance of the nearest hit within 100 m, or Infinity
queries.nearestHit(0, 0, 3, 0, 0, -1, 100);  // {triangle: 0, distance: 3}, the same with its triangle, or undefined
queries.any(0, 0, 3, 0, 0, -1, 100);         // 0, the number of a triangle hit, or -1
queries.count(0, 0, 3, 0, 0, -1, 100, 6);    // 1, the hits, counted to 6
queries.hits(0, 0, 3, 0, 0, -1, 100);        // [3], every hit, nearest first
queries.closest(0, 0, 0.5, 2);               // {triangle: 0, distance: 0.5, point: [0, 0, 0]}, the nearest triangle within 2 m and its nearest point, or undefined
```

Line segments (edges), a tree of their own:

```js
import {buildSegmentBvh, segmentQueries} from '@geoblocks/cesium-bvh';

const segments = Float64Array.of(0, 0, 0, 1, 0, 0,   5, 5, 5, 6, 5, 5);   // a segment each, six numbers: its two ends
const edges = segmentQueries(buildSegmentBvh(segments));

edges.near(5.5, 5, 5.05, 0.1);                       // [1], the segments within 0.1 m of a point
edges.overlapping(-1, -1, -1, 0.5, 1, 1);            // [0], those whose boxes meet a box
```

Triangles that moved (a piece dragged, a door opened), the tree kept: its boxes made again from the leaves up, in place, a few milliseconds for 45,000 triangles (a build takes 130):

```js
refitBvh(bvh, movedTris);   // the same triangles, the same numbers, new places; `queries` made of `bvh` follow
```

The tree is plain arrays (`bounds`, `meta`, `data`, `ids`): send them to a worker, and make the queries there.

## Not here

- A tree that restructures as triangles move: `refitBvh` keeps the shape, so it answers right but slower the farther triangles have gone; rebuild it then.
- Triangles by a box, a sphere or a capsule: the arrays are laid out to walk, as `closest` and the segments' queries do.
