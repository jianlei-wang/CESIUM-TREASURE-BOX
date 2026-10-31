# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.1.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-sphere-camera%400.0.2...%40geoblocks%2Fcesium-sphere-camera%400.1.0) (2026-10-26)

### Bug Fixes

* add readme for cesium-sphere-camera ([07ae574](https://github.com/geoblocks/cesium-helpers/commit/07ae57471614898291d47f8f72af4511babae1e0))
* **cesium-sphere-camera:** avoid per-event Cartesian3 allocation ([e17a2d9](https://github.com/geoblocks/cesium-helpers/commit/e17a2d90c8c455cae32f752b7a847b308147b63a))

### Build System

* publish built JavaScript and type declarations from dist/ ([#185](https://github.com/geoblocks/cesium-helpers/issues/185)) ([327d71e](https://github.com/geoblocks/cesium-helpers/commit/327d71e5ccf4c1e86477f25d262816db785f419b))

### BREAKING CHANGES

* the published files moved from the package root to dist/, so deep imports such as @geoblocks/cesium-compass/cesium-compass.js no longer resolve, and the exports map only exposes the package entry point (cesium-obstacles also exposes ./triangle-mesh.js, ./triangle-trees.js, ./gltf-mesh.js and ./mesh-builder.js).
