# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.8.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-compass%400.7.0...%40geoblocks%2Fcesium-compass%400.8.0) (2026-10-26)

### Build System

* publish built JavaScript and type declarations from dist/ ([#185](https://github.com/geoblocks/cesium-helpers/issues/185)) ([327d71e](https://github.com/geoblocks/cesium-helpers/commit/327d71e5ccf4c1e86477f25d262816db785f419b))

### BREAKING CHANGES

* the published files moved from the package root to dist/, so deep imports such as @geoblocks/cesium-compass/cesium-compass.js no longer resolve, and the exports map only exposes the package entry point (cesium-obstacles also exposes ./triangle-mesh.js, ./triangle-trees.js, ./gltf-mesh.js and ./mesh-builder.js).


# [0.7.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-compass%400.6.0...%40geoblocks%2Fcesium-compass%400.7.0) (2026-10-15)

### Bug Fixes

* **cesium-compass:** fix three memory/correctness bugs ([2b800f9](https://github.com/geoblocks/cesium-helpers/commit/2b800f93d3242ec85b6f24b0d530e3d5e2ae9b68))

### Features

* **cesium-compass:** restyle the compass and add a top-down reset ([34a2145](https://github.com/geoblocks/cesium-helpers/commit/34a21454ea336ab61888c1908108a53a01edbc0b))
* **cesium-compass:** vary the rotation marker arc length with cursor distance ([39c3e82](https://github.com/geoblocks/cesium-helpers/commit/39c3e822952e6b0d0b81e6cc379847472182904f))
* export the CesiumCompass and CesiumViewCube classes ([b573763](https://github.com/geoblocks/cesium-helpers/commit/b5737634de9d92a4234f42e8e6b9d1b212494abf))
