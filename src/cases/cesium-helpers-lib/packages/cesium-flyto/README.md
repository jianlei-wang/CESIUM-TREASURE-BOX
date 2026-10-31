# Cesium Fly To

This package provides a camera mode for CesiumJS: on double-click, the camera flies toward the clicked position (terrain or 3D Tiles) along the line of sight, and stops at a given distance from it, with a cinematic motion blur and depth of field during the flight.

## Installation

```bash
npm i --save @geoblocks/cesium-flyto
```

## Demo

[Demo](https://geoblocks.github.io/cesium-helpers/cesium-flyto.html)

## Usage

```javascript
import {Viewer, ScreenSpaceEventType} from '@cesium/engine';
import CesiumFlyTo from '@geoblocks/cesium-flyto';

const viewer = new Viewer(...);
// optional: event type (default: double-click), final distance in meters (default: 300),
// flight duration in seconds (default: half a second per halving of the distance to the target, between 1 and 5 seconds) and easing function (default: EasingFunction.SINUSOIDAL_IN_OUT)
const flyTo = new CesiumFlyTo(viewer, ScreenSpaceEventType.LEFT_DOUBLE_CLICK, 300);
flyTo.active = true;
```

Deactivating the mode restores the previous input action for that event (for example the Viewer's entity tracking on double-click).

During a flight, a camera motion blur and a slight depth of field focused on the target fade in, and fade out when the camera arrives. The motion blur is the `MotionBlur` effect of [@geoblocks/cesium-post-process](../cesium-post-process), with a 1/48 s exposure. They need the terrain's depth, so `globe.depthTestAgainstTerrain` is on during the flight and restored after it: billboards and labels that show through the terrain can be hidden by it while flying.
