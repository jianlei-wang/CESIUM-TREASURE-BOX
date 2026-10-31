# compass widget for CesiumJS

Note: the code is based on the Compass class from [TerriaJS](https://github.com/TerriaJS/terriajs/blob/master/lib/ReactViews/Map/Navigation/Compass.jsx)

## Demo

[Demo](https://geoblocks.github.io/cesium-helpers/cesium-compass.html)

## Installation

```bash
npm i --save @geoblocks/cesium-compass
```

## Usage

```html
 <cesium-compass .scene="${viewer.scene}" .clock="${viewer.clock}"></cesium-compass>
```

## Interactions

- Drag the outer ring to rotate the view around the point at the center of the screen.
- Click the ring to face north. Click it again, when already facing north, to look straight down.
- Drag the center gyro to orbit around the view center; the distance from the center sets the speed.
- Double-click the gyro to look straight down.

## API

### Properties/Attributes

| Name            | Type             | Default         | Description
| --------------- | ---------------- | --------------- | -----------
| `scene`         | `Cesium.Scene`   |                 | A [Cesium Scene instance](https://cesium.com/docs/cesiumjs-ref-doc/Scene.html)
| `clock`         | `Cesium.Clock`   |                 | A [Cesium Clock instance](https://cesium.com/docs/cesiumjs-ref-doc/Clock.html)
| `resetSpeed`    | `number`         | `Math.PI/100`   | The speed of the reset to north animation in radians / milliseconds.

### CSS Custom Properties

| Name                                | Default              | Description
| ----------------------------------- | -------------------- | -----------
| `--cesium-compass-size`             | `70px`               | Width and height of the compass
| `--cesium-compass-fill-color`       | `rgba(0, 0, 0, 0.6)` | Disc background
| `--cesium-compass-stroke-color`     | `rgb(224, 225, 226)` | Ticks, labels and gyro icon color
| `--cesium-compass-north-color`      | `rgb(233, 84, 64)`   | North tip accent color
