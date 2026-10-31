# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.2.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-compass-bar%400.1.0...%40geoblocks%2Fcesium-compass-bar%400.2.0) (2026-10-26)

### Build System

* publish built JavaScript and type declarations from dist/ ([#185](https://github.com/geoblocks/cesium-helpers/issues/185)) ([327d71e](https://github.com/geoblocks/cesium-helpers/commit/327d71e5ccf4c1e86477f25d262816db785f419b))

### BREAKING CHANGES

* the published files moved from the package root to dist/, so deep imports such as @geoblocks/cesium-compass/cesium-compass.js no longer resolve, and the exports map only exposes the package entry point (cesium-obstacles also exposes ./triangle-mesh.js, ./triangle-trees.js, ./gltf-mesh.js and ./mesh-builder.js).


# [0.1.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-compass-bar%400.0.4...%40geoblocks%2Fcesium-compass-bar%400.1.0) (2026-10-15)

### Bug Fixes

* **cesium-compass-bar:** add missing disconnectedCallback; fix parseInt ([7e25ecf](https://github.com/geoblocks/cesium-helpers/commit/7e25ecfb66b465b44f692082a198eb7f91995f5c))
* declare @cesium/engine peer dependency in compass-bar and view-cube ([f245f6b](https://github.com/geoblocks/cesium-helpers/commit/f245f6b2f28f21816b71802e8704418c00b32cec))

### Features

* add major, minor part to ticks ([63933f9](https://github.com/geoblocks/cesium-helpers/commit/63933f9af12736af8c67911636f6bd46338115ee))
* **cesium-compass-bar:** rotate the camera by dragging the bar ([e1f1ea0](https://github.com/geoblocks/cesium-helpers/commit/e1f1ea048f3310707fbdab031cfc708a8ad120d0))
