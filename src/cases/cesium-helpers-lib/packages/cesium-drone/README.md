# Cesium Drone

An arcade drone for CesiumJS: it stays level, holds its altitude when the sticks are released, slides
along the terrain when it touches it slowly, stops against slopes steeper than 45 degrees, and crashes
when it runs into the terrain fast: its velocity across the slope ahead of it, its descent on flat
ground, its speed against a wall. It is flown with the keyboard, as the two sticks of a "Mode 2"
radio, or a gamepad, as in most games or as a radio.

| Action | Keyboard | Gamepad, `game` layout (default) | Gamepad, `mode2` layout |
|---|---|---|---|
| Climb / descend | W / S | right / left trigger | left stick up / down |
| Turn left / right | A / D | right stick left / right | left stick left / right |
| Forward / backward | Up / Down | left stick up / down | right stick up / down |
| Sideways left / right | Left / Right | left stick left / right | right stick left / right |
| Boost | Shift | right bumper | right trigger |
| Camera tilt down / up | R / F | right stick down / up | right / left bumper |

The `game` layout is the one of most games: the left stick moves, the right one turns and looks, the
triggers climb and descend. The `mode2` layout is the one of a drone's radio.

The keys are matched by their position, so the same keys work on AZERTY and QWERTZ keyboards. They are
left alone with Ctrl, Alt or Cmd held, and in text fields. The gamepad must be in the browser's
standard layout (`mapping` is `'standard'`, as for Xbox and PlayStation pads in Chrome); others are
ignored, their sticks' axes not being known.

These are the default bindings, `DRONE_BINDINGS.game` and `DRONE_BINDINGS.mode2`, read with
[cesium-input](../cesium-input); `drone.layout` switches between them. The drone reads its intent from
`drone.input` on each tick, `{move: {x, y}, climb, turn, tilt, boost}`, so the controls can be remapped,
or come from anywhere else, touch controls, an AI or a replay, while the drone is not active:

```javascript
import Controls from '@geoblocks/cesium-input';
import CesiumDrone, {DRONE_BINDINGS} from '@geoblocks/cesium-drone';

// the camera tilted with T and G instead of R and F
drone.input = new Controls({...DRONE_BINDINGS.game, tilt: {type: 'axis', keys: {negative: ['KeyT'], positive: ['KeyG']}, stick: 'right', along: 'y'}});
// touch controls besides the keyboard and the gamepad: a source, added up with them
drone.input = new Controls(DRONE_BINDINGS.game, {sources: [{read: () => ({move: touchStick.vector})}]});
```

## Installation

```bash
npm i --save @geoblocks/cesium-drone
```

## Demo

[Demo](https://geoblocks.github.io/cesium-helpers/cesium-drone.html)

## Usage

```javascript
import CesiumDrone from '@geoblocks/cesium-drone';

const drone = new CesiumDrone(viewer, {
  speed: 15,       // horizontal speed at full stick, in m/s
  boostSpeed: 30,  // horizontal speed at full stick with boost, in m/s, twice the speed by default
  climbSpeed: 6,   // vertical speed at full stick, in m/s
  turnRate: 90,    // turn speed at full stick, in degrees per second
  clearance: 2,    // lowest height above the terrain, in meters
  crashSpeed: 8,   // speed into the terrain above which touching it is a crash, in m/s
  cameraTilt: 20,  // the camera's tilt up on the frame at take-off, in degrees: level when cruising nose down
  failsafeDelay: 1.5, // seconds the drone keeps its last command without its control link, before its motors stop
  layout: 'game',  // the gamepad's layout: 'game', or 'mode2' as a drone's radio
  collision: false, // whether the drone crashes into the obstacles in view, 3D Tiles and primitives
});
drone.active = true; // takes the camera from where it is (its position and heading), and the mouse navigation off

drone.crashed.addEventListener((position, impact) => {
  // the drone ignores the controls until it respawns, hovering above where it crashed, or at a position
  setTimeout(() => drone.respawn(), 1000);
});

drone.speedNow;  // current speed, in m/s
drone.heightNow; // height above the ground, the terrain by default, in m, or undefined where it is not loaded
```

### Jamming

`jammingAt` tells how strongly jammers on the ground reach a position, from 0 at their range to 1
near them, much less behind terrain that hides them: enough to drive a video effect, and to cut the
control link. Without it, the drone keeps its last command, then its motors stop and it falls: with
its motors stopped, touching the ground is a crash. Only the terrain loaded in the globe is known, so a
jammer far from the view, on coarser tiles, may be hidden or not depending on where the camera looks.

```javascript
import {jammingAt} from '@geoblocks/cesium-drone';

const jammers = [{longitude: 6.569, latitude: 46.766, range: 2000}];
viewer.clock.onTick.addEventListener(() => {
  const jamming = jammingAt(viewer.scene.globe, viewer.camera.positionWC, jammers);
  analogVideo.interference = jamming;
  drone.rxLoss = jamming >= 0.8;
});
```

### Obstacles

With `collision: true`, the drone also crashes into the obstacles in view, opaque 3D Tiles and
primitives, at any speed, read from the depth of the last frame by
[cesium-obstacles](../cesium-obstacles); the terrain still slides and stops it as above. Only what the
camera sees is an obstacle: flying sideways or backward into a wall goes through it, and so does coming
down onto a roof while the camera looks up.

For a world known on the CPU, set `drone.obstacleAhead` to a function returning the obstacle ahead in a
direction, `{point, normal}` with the normal toward the drone, or `undefined`: a ray cast finds it in every
direction, without waiting for the GPU. Reach as far as a step goes at the drone's top speed. For 3D Tiles,
`tilesetObstacle` of [cesium-obstacles](../cesium-obstacles):

```javascript
import {tilesetObstacle} from '@geoblocks/cesium-obstacles';

// a step at 41 m/s is under 5 m, even on a slow frame
drone.obstacleAhead = toward => tilesetObstacle(viewer.scene, buildings, viewer.camera.positionWC, toward, 5);
```

### Flying among a mesh

`flyOn` flies the drone among a triangle mesh of [cesium-obstacles](../cesium-obstacles), a building's walls,
roofs and floors known on the CPU, from groups of triangles or a glTF:

```javascript
import {createTriangleMeshFromGltf} from '@geoblocks/cesium-obstacles';
import CesiumDrone, {flyOn} from '@geoblocks/cesium-drone';

const mesh = createTriangleMeshFromGltf(await (await fetch('building.glb')).arrayBuffer(), modelMatrix);
const drone = new CesiumDrone(viewer);
// a body 0.25 m about its middle, the walls looked for 5 m ahead
flyOn(drone, mesh, {radius: 0.25, reach: 5});
```

It turns the collision on: the walls stop the drone, crashing, in every direction, from rays cast from its middle
and from around its body, beside, above and below it; climbing, the ceilings too. The roofs and floors are its
ground, `drone.groundHeight`, which it keeps its clearance above as it does the terrain, and the terrain
elsewhere.

The demo adds the drone camera effects of [cesium-post-process](../cesium-post-process): a wide lens,
jello, a display and the video signal.
