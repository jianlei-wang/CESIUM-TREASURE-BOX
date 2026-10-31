# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.5.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-first-person-mode%400.4.0...%40geoblocks%2Fcesium-first-person-mode%400.5.0) (2026-10-26)

### Build System

* publish built JavaScript and type declarations from dist/ ([#185](https://github.com/geoblocks/cesium-helpers/issues/185)) ([327d71e](https://github.com/geoblocks/cesium-helpers/commit/327d71e5ccf4c1e86477f25d262816db785f419b))

### BREAKING CHANGES

* the published files moved from the package root to dist/, so deep imports such as @geoblocks/cesium-compass/cesium-compass.js no longer resolve, and the exports map only exposes the package entry point (cesium-obstacles also exposes ./triangle-mesh.js, ./triangle-trees.js, ./gltf-mesh.js and ./mesh-builder.js).


# [0.4.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-first-person-mode%400.3.2...%40geoblocks%2Fcesium-first-person-mode%400.4.0) (2026-10-19)

### Features

* **input:** read the actions from sources besides the devices ([12ff24f](https://github.com/geoblocks/cesium-helpers/commit/12ff24ffe72cb34505a56688eecdea846731283b))


## [0.3.2](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-first-person-mode%400.3.1...%40geoblocks%2Fcesium-first-person-mode%400.3.2) (2026-10-15)

### Bug Fixes

* **first-person-mode:** give the controller's inputs back as they were, read the wheel on the canvas ([b20d101](https://github.com/geoblocks/cesium-helpers/commit/b20d101cc518265a45b4292a4483cb8db5bb5abe))


## [0.3.1](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-first-person-mode%400.3.0...%40geoblocks%2Fcesium-first-person-mode%400.3.1) (2026-10-15)

**Note:** Version bump only for package @geoblocks/cesium-first-person-mode
