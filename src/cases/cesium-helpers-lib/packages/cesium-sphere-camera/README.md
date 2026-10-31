# Cesium Sphere Camera

This package provides a helper for managing a camera in a CesiumJS application that orbits around a sphere.

## Installation

```bash
npm i --save cesium-sphere-camera
```

## Demo

[Demo](https://geoblocks.github.io/cesium-helpers/cesium-sphere-camera.html)

## Usage

```javascript
import {Viewer} from '@cesium/engine';
import CesiumSphereCamera from 'cesium-sphere-camera';

const viewer = new Viewer(...);
const sphereMode = new CesiumSphereCamera(viewer);

// ...
sphereMode.active = true;
```
