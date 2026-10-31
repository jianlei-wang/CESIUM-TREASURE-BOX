# Cesium Path Flyover

A camera animation that follows a GPX or GeoJSON track, draped on terrain, with the track and a moving marker drawn in the scene.

## Installation

```bash
npm i --save @geoblocks/cesium-path-flyover
```

## Demo

[Demo](https://geoblocks.github.io/cesium-helpers/cesium-path-flyover.html)

## Usage

```javascript
import {CesiumWidget} from '@cesium/engine';
import CesiumPathFlyover from '@geoblocks/cesium-path-flyover';

const viewer = new CesiumWidget(...);
const flyover = new CesiumPathFlyover(viewer, {
  // the look of the run
  style: 0.5,     // 0 the pilot: low, close, tight, banking into turns; 1 the spectator: high, far, wide in bends, climbing over walls
  motion: 0.5,    // 0 rigid, locked on the path; 1 floating: slow to react, drifting in heading, height and roll
  range: 400,     // override: camera distance to the marker, meters (250 to 900 by style); a baseline, wider in bends above style 0.5
  pitch: -25,     // override: degrees (-15 to -45 by style)
  lookAhead: 400, // override: meters of path ahead whose direction sets the heading (200 to 700 by style)
  speed: 200,     // override: ground speed along the track, meters per second (120 to 350 by style); flyover.duration follows once loaded
  // also overridable: bendZoom (0 to 1), reliefRise (0 to 0.5 by style; 1 climbs to the crests), turnCost (meters of lift per degree of turn, 0.5 to 30 by style),
  // headingTau (seconds, 0.5 to 3 by motion), panRate (degrees per second, 45 to 15 by motion), breathing (0 to 1), bank (degrees of roll into turns, 12 to 0 by style)
  // the mechanics of the run
  clearance: 40,  // minimum camera height above terrain, meters
  maxLift: 250,   // meters the camera may climb to keep the marker in view; beyond it a brief occlusion is accepted (its own clearance is never capped)
  screenSpaceError: false, // globe maximumScreenSpaceError while playing, restored on stop; false leaves it alone
  freeLook: true,      // drag to look around the marker and wheel to zoom while playing
  recenterDelay: 2,    // seconds after the last input before the view returns to the plan; false to keep it
});

await flyover.load('track.gpx'); // or a GeoJSON LineString
await flyover.play();            // resolves at the end of the track
flyover.progress = 0.5;          // scrub: jump to the middle, playing or not
flyover.progressChanged.addEventListener((p) => slider.value = p); // follow playback
flyover.position;                // the marker, for example the focus of an effect
flyover.points;                  // the marker's positions along the track, once loaded
flyover.name;                    // the track's name, when the file has one
flyover.times;                   // the recorded time of each point, when the file has them
flyover.distance;                // the marker's meters along the track
flyover.stop();
flyover.destroy();
```

The two dials derive the camera distance, pitch and look-ahead, how much the camera pulls back in bends and rises toward the ridges around the track, whether it turns or climbs to clear terrain, how fast it reacts and pans, and a slow drift in heading and height. Setting a derived value explicitly overrides only that value. The middle of both dials is the default run.

While a run plays, drag on the globe to look around the marker and use the wheel (or a pinch) to zoom; the camera keeps following the track. The view returns to the planned one `recenterDelay` seconds after the last input (default 2, `false` to keep the viewer's angle) or when `recenter()` is called; `view` reports the current offsets (heading and pitch in radians, zoom as a factor of the range). `freeLook: false` leaves Cesium's camera controller alone. Off the planned camera the terrain planner's guarantees do not hold; the camera is kept above the loaded terrain, but looking through a wall is the viewer's choice.

Heights in the file are ignored; the track is sampled on the scene's terrain provider. Without one (the default `EllipsoidTerrainProvider`), heights are 0.

At load the camera path is planned against the terrain: where the chase position would be inside a slope or lose sight of the marker, the camera turns toward the open side and lifts, whichever is cheaper.

With `screenSpaceError` set, the globe's `maximumScreenSpaceError` is raised to it while playing so terrain and imagery keep up with a fast camera, and restored when playback stops. By default the globe's detail is left alone.
