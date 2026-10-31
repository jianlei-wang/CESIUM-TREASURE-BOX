# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.3.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-view-cube%400.2.0...%40geoblocks%2Fcesium-view-cube%400.3.0) (2026-10-26)

### Build System

* publish built JavaScript and type declarations from dist/ ([#185](https://github.com/geoblocks/cesium-helpers/issues/185)) ([327d71e](https://github.com/geoblocks/cesium-helpers/commit/327d71e5ccf4c1e86477f25d262816db785f419b))

### BREAKING CHANGES

* the published files moved from the package root to dist/, so deep imports such as @geoblocks/cesium-compass/cesium-compass.js no longer resolve, and the exports map only exposes the package entry point (cesium-obstacles also exposes ./triangle-mesh.js, ./triangle-trees.js, ./gltf-mesh.js and ./mesh-builder.js).


# [0.2.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-view-cube%400.1.4...%40geoblocks%2Fcesium-view-cube%400.2.0) (2026-10-23)

* feat(view-cube)!: draw the cube and ParaView's orientation axes in SVG ([b9d316a](https://github.com/geoblocks/cesium-helpers/commit/b9d316a7e29871147b35bad4ef917f060a68bcda))

### Bug Fixes

* declare @cesium/engine peer dependency in compass-bar and view-cube ([f245f6b](https://github.com/geoblocks/cesium-helpers/commit/f245f6b2f28f21816b71802e8704418c00b32cec))

### Features

* export the CesiumCompass and CesiumViewCube classes ([b573763](https://github.com/geoblocks/cesium-helpers/commit/b5737634de9d92a4234f42e8e6b9d1b212494abf))

### BREAKING CHANGES

* the CSS 3D cube is replaced by an SVG drawing: its DOM, its
  size (now --cesium-view-cube-size, 100px by default) and its custom
  properties change, and the axes are drawn from the center, hidden by
  default, instead of along the edges at the south-west-bottom corner.
