# FirstPerson camera mode for CesiumJS

## Demo

[Demo](https://geoblocks.github.io/cesium-helpers/cesium-first-person-mode.html)

## Installation

```bash
npm i --save @geoblocks/cesium-first-person-mode
```

### Usage

```js
import {Viewer} from '@cesium/engine';
import FirstPersonCameraMode from '@geoblocks/cesium-first-person-mode';

const viewer = new Viewer(...);
const mode = new FirstPersonCameraMode(viewer);

// ...
mode.active = true;
```

### Controls

| Action | Mouse | Gamepad (standard mapping) |
|---|---|---|
| Look | move | right stick |
| Zoom in, held | right button, held | L2 / LT, held |
| Field of view | wheel | - |

Holding the zoom narrows the field of view to `mode.zoomFov` (default 20 degrees), never wider than the
view, and slows the look down by as much, as GTA 5's aim; `mode.zoom` goes from 0 to 1 as it zooms in. `mode.lookRate` is the
turn rate of the look at full deflection, in radians per second (default 120 degrees).
The mode starts with a click or a key press, as the Pointer Lock API requires.

The stick and the zoom are the default bindings, `LOOK_BINDINGS`, read with
[cesium-input](../cesium-input). The mode reads its intent from `mode.input` on each tick,
`{look: {x, y}, zoom}`, `look` the turn rate from -1 to 1, so the controls can be remapped, or come from
anywhere else while the mode is not active: touch controls for instance, besides the stick and the mouse, as a
`sources` option of the `Controls` (`mode.input = new Controls(LOOK_BINDINGS, {sources: [touchLook]})`). The mouse's movement turns the
view as well.

While the mode is active it owns the camera's field of view: `mode.fovOffset` (radians, default 0)
is added to it, for instance to widen the view while sprinting, as in GTA 5.

The module also exports `clampPitch(pitch)`, which keeps a pitch short of 85 degrees up or down, where
Cesium would turn the view around.
