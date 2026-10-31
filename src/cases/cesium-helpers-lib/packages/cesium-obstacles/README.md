# Obstacles in view for CesiumJS

Collision for camera modes: the obstacles ahead of a mover, read from the depth of the last frame or cast in
triangles known on the CPU, and the step to take toward them, in full, along them, or none. Used by `cesium-walk`
and `cesium-drone`.

## Installation

```bash
npm i --save @geoblocks/cesium-obstacles
```

## Usage

```js
import {ObstacleProbe, blockedStep} from '@geoblocks/cesium-obstacles';

const probe = new ObstacleProbe(viewer.scene);

// each tick, for a step of `length` meters along the unit vector `toward`
const obstacle = probe.ahead(toward, 'forward');
const step = blockedStep(toward, length, viewer.camera.positionWC, obstacle, new Cartesian3());
if (step.length > 0) {
  viewer.camera.move(step.direction, step.length);
}
```

`probe.ahead(toward, key)` reads the depth along the steps, and a little beside and above, for the obstacle's
plane: walls, roofs or overhangs. Reading the depth stalls the frame until the GPU is done, so each kind of
steps, named by `key`, looks again at most every 100 ms, or when it turns by more than 10 degrees.

`blockedStep` keeps the mover 0.4 m from the obstacle: a step that would come nearer slides along it, or
stops when straight at it. A step shorter than asked for means the obstacle was reached.

### Limits

- Only what is in view is seen: a step out of the camera's view, backward or sideways, finds no obstacle.
  Cesium's ways to look there render the scene once more, 50 to 100 ms on an integrated GPU.
- Only opaque surfaces are obstacles, terrain included: primitives of an alpha below 0.995 are not.
- Between two looks, 100 ms apart, a fast mover can miss a thin obstacle.

## In a 3D tileset, without reading the depth

`tilesetObstacle(scene, tileset, eye, toward, reach = 1)` finds the obstacle ahead in a 3D tileset by rays
cast on its loaded tiles on the CPU: in any direction, without waiting for the GPU. A second ray, 10 cm
beside the first, gives the wall's direction; walls are taken as upright, as buildings' are. For a walker:

```js
import {ObstacleProbe, tilesetObstacle} from '@geoblocks/cesium-obstacles';

const probe = new ObstacleProbe(viewer.scene);
// the buildings in any direction, the rest of the scene in view
walkMode.obstacleAhead = (toward, key) =>
  tilesetObstacle(viewer.scene, buildings, viewer.camera.positionWC, toward) ?? probe.ahead(toward, key);
```

Each ray takes a few milliseconds: Cesium reads the geometry of the tiles it tests back from the GPU. Only the
tiles loaded are seen, at their level of detail. It relies on Cesium's private `Cesium3DTileset.pick`, until a
public one ([CesiumGS/cesium#13901](https://github.com/CesiumGS/cesium/issues/13901)).


## In a triangle mesh, known in advance

The depth probe sees whatever is drawn, but only in view, and waits for the GPU each time it looks. Triangles
known on the CPU, a building's floors, stairs and walls, answer at once, in every direction, out of view too,
and give the ground under the mover: a triangle mesh. It is not drawn; draw it as you like, or load the glTF it
was read from.

```js
import {createTriangleMesh, Group} from '@geoblocks/cesium-obstacles';

// groups of triangles, in meters, z up, in the frame of a model matrix
const floor = new Group([0.8, 0.8, 0.8, 1]);
floor.polygon([[0, 0], [10, 0], [10, 6], [0, 6]], [], () => 0);
const walls = new Group([0.9, 0.9, 0.85, 1]);
walls.box(0, 0, 0, 10, 0.2, 2.5);
const mesh = createTriangleMesh([floor.meshGroup, walls.meshGroup], modelMatrix);
```

A group is `{vertices: Float32Array, triangles: Uint32Array}`, `collide: false` leaving it out. The faces flatter
than 60° are floors, the others walls. `Group` builds the groups face by face: `face`, `polygon` (with holes),
`sides`, `box`; its options are passed on to `meshGroup`, for a drawing of them, and `charts: true` records each
face, to lay them out in an atlas. `mesh.floorBelow(x, y, z)` answers in the mesh's frame, `mesh.raycast(origin,
direction, maxDistance, {walls})` and `mesh.nearest(point, radius, {walls})`, the surface nearest a point within a
radius, a mover's body kept clear of what no ray ahead meets, on the globe; `mesh.position` and `mesh.local` go
from one frame to the other. The floors and the walls are each a bounding volume hierarchy
([cesium-bvh](../cesium-bvh)). When the groups' vertices have moved in place (a piece dragged, a door opened), their
triangles the same, `mesh.refit()` reads them again in a few milliseconds, where a new mesh takes a tenth of a second.

For a large mesh the trees can be built in a worker: `triangleTrees(groups)` (from `@geoblocks/cesium-obstacles/triangle-trees.js`, which
imports no Cesium) returns plain typed arrays, `{tris, floorTree, wallTree}`, that a worker transfers; the page then makes the mesh with
`createTriangleMesh(groups, modelMatrix, {trees})`, given the groups that collide, in the same order, and does not wait for them.

From a glTF, drawn by Cesium as usual: the same floors and walls, from the meshes of its default scene, each
node's transform applied, glTF's y up turned z up. Load the model and read the same bytes:

```js
import {Model} from '@cesium/engine';
import {createTriangleMeshFromGltf} from '@geoblocks/cesium-obstacles';

const url = 'building.glb';
viewer.scene.primitives.add(await Model.fromGltfAsync({url, modelMatrix}));
const bytes = await (await fetch(url)).arrayBuffer();
// every primitive an obstacle but the glass
const mesh = createTriangleMeshFromGltf(bytes, modelMatrix, {collide: ({name}) => name !== 'glass'});
```

A model loaded with `forwardAxis: Axis.X`, not turned a quarter round its up axis as by Cesium's default
`Axis.Z`, takes `forwardAxis: Axis.X` too. A glTF's JSON and its buffers go as
`createTriangleMeshFromGltf(json, modelMatrix, {buffers})`. `gltfTriangles` reads the triangles alone,
`{vertices, triangles, name, node, mesh, primitive}` a primitive, in the mesh's frame: lists, strips and fans,
positions in floats or quantized (`KHR_mesh_quantization`), indexed or not. Draco, meshopt,
`EXT_mesh_gpu_instancing` and sparse accessors are not read: they throw.

The mover's obstacle and ground in the mesh:

```js
import {meshGroundHeight, meshObstacleAhead} from '@geoblocks/cesium-obstacles';

// rays from the mover and 1 m under it, the nearest wall within 0.5 m
const obstacleAhead = meshObstacleAhead(mesh, () => viewer.camera.positionWC, {
  offsets: [Cartesian3.ZERO, new Cartesian3(0, 0, -1)],
  reach: 0.5,
});
const step = blockedStep(toward, length, viewer.camera.positionWC, obstacleAhead(toward), new Cartesian3());

// the highest floor under a point 1.2 m under the mover, undefined off the mesh's floors
const groundHeight = meshGroundHeight(mesh, {below: 1.2});
```

`meshObstacleAhead` casts a ray from the mover, or from each offset, in meters east, north and up of it, along
the steps, and returns the nearest surface hit, as `probe.ahead` would; the floors, stairs and ramps are left to
the ground, unless `walls: false`. `walkOn` of `cesium-walk` and `flyOn` of `cesium-drone` put them in their
camera modes.
