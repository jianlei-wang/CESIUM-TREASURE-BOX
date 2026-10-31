# compass bar widget for CesiumJS

## Installation

```bash
npm i --save @geoblocks/cesium-compass-bar
```

## Demo

[Demo](https://geoblocks.github.io/cesium-helpers/cesium-compass-bar.html)

## Usage

```html
 <cesium-compass-bar .scene="${viewer.scene}"></cesium-compass-bar>
```

Dragging the bar horizontally rotates the camera heading.

## API

### Properties/Attributes

| Name            | Type             | Default         | Description
| --------------- | ---------------- | --------------- | -----------
| `scene`         | `Cesium.Scene`   |                 | A [Cesium Scene instance](https://cesium.com/docs/cesiumjs-ref-doc/Scene.html)

### CSS Custom Properties

| Name                                       | Default | Description
| ------------------------------------------ | ------- | -----------
| `--cesium-compass-bar-tick-color`          | `rgb(224, 225, 226)` | Ticks and font color
| `--cesium-compass-bar-intercardinal-width` | `100px` | Width in pixels between intercardinal divs

### CSS Shadow Parts

| Part name     | Description
| ------------- | -----------
| `label`       | The compass label
| `label major` | The compass major label (N, S, E, W)
| `label minor` | The compass minor label (NE, SE, SW, NW)
| `tick`        | The compass tick div
| `center-tick` | The compass center tick div
