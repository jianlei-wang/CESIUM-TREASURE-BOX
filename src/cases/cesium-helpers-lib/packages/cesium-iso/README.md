# Cesium Iso

An isometric view for CesiumJS, as in a game: an orthographic camera at a fixed pitch, looking from a corner.

- a drag turns the view; a right drag, or Ctrl or Shift with the left, slides it across the ground
- the wheel zooms where it points
- on a touch screen, one finger slides, two pinch to zoom, slide, and twist to turn
- Q and E turn it a quarter, to the next corner; WASD or the arrows slide it while held
- a double click glides to the spot
- let go while moving, it drifts on and slows down

Cesium's own camera inputs are off while it is active.

## Installation

```bash
npm i --save @geoblocks/cesium-iso
```

## Demo

[Demo](https://geoblocks.github.io/cesium-helpers/cesium-iso.html), with `Toy` (lit and shaded edges, warmer colors,
a gradient for the sky), `TiltShift` and `LensDistortion`'s vignette from [cesium-post-process](../cesium-post-process)
for a game's look.

## Usage

```javascript
import CesiumIso from '@geoblocks/cesium-iso';

const iso = new CesiumIso(viewer, {pitch: 30, heading: 45, size: 600, minSize: 20, maxSize: 8000});
iso.active = true;

iso.turn(1);       // a quarter turn, as E (-1 as Q)
iso.turnTo(200);   // to a heading, in degrees, the shorter way
iso.zoom(0.8);     // in, toward the middle of the screen
iso.glideTo(position);
iso.target = position; // at once
iso.heading = 90;      // at once, in degrees, no easing
iso.size = 300;        // at once, in meters across the screen's shorter side, within minSize and maxSize
```

## Options

| Name      | Default | Description
| --------- | ------- | -----------
| `pitch`   | `30`    | Degrees down from the horizon
| `heading` | `45`    | A corner's heading, in degrees, the others a quarter turn apart: square to a place's streets
| `size`    | `400`   | Meters across the screen's shorter side
| `minSize` | `20`    | The closest zoom, in meters
| `maxSize` | `8000`  | The farthest zoom, in meters
| `limit`   |         | A function moving a target back where the view may stand: it stops sliding there
| `orbit`   | `5000`  | Meters from the target to the camera, beyond the scene; closer for small scenes, where faces a fraction of a millimeter apart would fight at 5 km
