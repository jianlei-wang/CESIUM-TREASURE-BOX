# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.2.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-path-flyover%400.1.0...%40geoblocks%2Fcesium-path-flyover%400.2.0) (2026-10-26)

### Build System

* publish built JavaScript and type declarations from dist/ ([#185](https://github.com/geoblocks/cesium-helpers/issues/185)) ([327d71e](https://github.com/geoblocks/cesium-helpers/commit/327d71e5ccf4c1e86477f25d262816db785f419b))

### BREAKING CHANGES

* the published files moved from the package root to dist/, so deep imports such as @geoblocks/cesium-compass/cesium-compass.js no longer resolve, and the exports map only exposes the package entry point (cesium-obstacles also exposes ./triangle-mesh.js, ./triangle-trees.js, ./gltf-mesh.js and ./mesh-builder.js).


# 0.1.0 (2026-10-15)

### Features

* add cesium-path-flyover, a camera flyover along a GPX or GeoJSON track ([e0e9cd5](https://github.com/geoblocks/cesium-helpers/commit/e0e9cd5ede69fc2bb41034398f3cf57a55109cc8))
* **demos:** add the flyover studio, a GPX to video page for end users ([5e43cac](https://github.com/geoblocks/cesium-helpers/commit/5e43cac988d16a9552d01ae98d2895df88429f01))
