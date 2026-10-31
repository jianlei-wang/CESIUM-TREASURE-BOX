# view cube and orientation axes for CesiumJS

Which way north and up are, at any angle, drawn in SVG from the camera's view matrix, orthographic, the labels always
upright: a cube turning with the camera, its faces named by the direction they face (N, E, S, W, top, bottom), or,
styled by CSS, ParaView's orientation axes, a triad of three axes from the center, x to the east, y to the north, z up.

## Demo

[Demo](https://geoblocks.github.io/cesium-helpers/cesium-view-cube.html): the cube, and the triad.

## Installation

```bash
npm i --save @geoblocks/cesium-view-cube
```

## Usage

```js
import '@geoblocks/cesium-view-cube';

const cube = document.createElement('cesium-view-cube');
cube.scene = viewer.scene;
document.body.append(cube);
```

Or in a Lit template: `<cesium-view-cube .scene="${viewer.scene}"></cesium-view-cube>`. The drawing follows the camera
after each render of the scene (its `postRender`): in a scene rendering on request, when it renders. It works in 3D,
2D and Columbus view.

The cube, by default. ParaView's orientation axes instead, the faces hidden and the axes (hidden by default) shown:

```css
cesium-view-cube::part(face),
cesium-view-cube::part(face-label) {
  display: none;
}

cesium-view-cube::part(axis),
cesium-view-cube::part(axis-label) {
  display: inline;
}
```

The two are meant as one look or the other. Shown together, the axes pointing away from the camera are drawn behind
the cube, the others in front of it.

## API

### Properties

| Name    | Type           | Description
| ------- | -------------- | -----------
| `scene` | `Cesium.Scene` | A [Cesium Scene instance](https://cesium.com/docs/cesiumjs-ref-doc/Scene.html): the cube turns with its camera, after each render

### CSS Custom Properties

The sizes and distances are shares of the widget's size, bare numbers (`0.6`, not `60%`); the labels' font is the
page's. A change applies at once, without a render of the scene.

| Name                                        | Default               | Description
| ------------------------------------------- | --------------------- | -----------
| `--cesium-view-cube-size`                   | `100px`               | The widget's width and height
| `--cesium-view-cube-cube-size`              | `0.6`                 | The cube's side
| `--cesium-view-cube-face-label-size`        | `0.12`                | The faces' labels' size
| `--cesium-view-cube-face-label-threshold`   | `0.25`                | How much a face turns toward the camera (0 edge on, 1 facing it) before its label shows
| `--cesium-view-cube-axis-length`            | `0.28`                | The axes' length from the center
| `--cesium-view-cube-axis-label-distance`    | `0.39`                | The axes' labels' distance from the center
| `--cesium-view-cube-axis-label-size`        | `0.2`                 | The axes' labels' size
| `--cesium-view-cube-fill-color`             | `rgb(224, 225, 226)`  | The faces' fill
| `--cesium-view-cube-stroke-color`           | `rgba(0, 0, 0, 0.6)`  | The faces' edges
| `--cesium-view-cube-face-stroke-width`      | `1px`                 | The faces' edges' width
| `--cesium-view-cube-label-color`            | `rgba(0, 0, 0, 0.6)`  | The faces' labels
| `--cesium-view-cube-x-color`                | `rgb(230, 50, 40)`    | The x axis (east) and its label
| `--cesium-view-cube-y-color`                | `rgb(230, 200, 30)`   | The y axis (north) and its label
| `--cesium-view-cube-z-color`                | `rgb(40, 180, 60)`    | The z axis (up) and its label
| `--cesium-view-cube-axis-width`             | `2px`                 | The axes' width

### CSS Parts

| Name                                              | Description
| ------------------------------------------------- | -----------
| `face`, `face-top`, `face-n`, ... `face-bottom`   | The faces turned toward the camera (SVG polygons): all, or one
| `face-label`, `face-label-top`, ...               | Their labels (SVG text), shown past the threshold
| `axis`, `axis-x`, `axis-y`, `axis-z`              | The axes (SVG lines), hidden by default
| `axis-label`, `axis-label-x`, ...                 | Their labels (SVG text), hidden by default

The drawing is an image to assistive technologies, labelled "View orientation".
