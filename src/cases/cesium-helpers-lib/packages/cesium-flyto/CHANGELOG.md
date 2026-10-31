# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.2.1](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-flyto%400.2.0...%40geoblocks%2Fcesium-flyto%400.2.1) (2026-10-27)

**Note:** Version bump only for package @geoblocks/cesium-flyto





# [0.2.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-flyto%400.1.6...%40geoblocks%2Fcesium-flyto%400.2.0) (2026-10-26)

### Build System

* publish built JavaScript and type declarations from dist/ ([#185](https://github.com/geoblocks/cesium-helpers/issues/185)) ([327d71e](https://github.com/geoblocks/cesium-helpers/commit/327d71e5ccf4c1e86477f25d262816db785f419b))

### BREAKING CHANGES

* the published files moved from the package root to dist/, so deep imports such as @geoblocks/cesium-compass/cesium-compass.js no longer resolve, and the exports map only exposes the package entry point (cesium-obstacles also exposes ./triangle-mesh.js, ./triangle-trees.js, ./gltf-mesh.js and ./mesh-builder.js).


## [0.1.6](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-flyto%400.1.5...%40geoblocks%2Fcesium-flyto%400.1.6) (2026-10-25)

**Note:** Version bump only for package @geoblocks/cesium-flyto





## [0.1.5](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-flyto%400.1.4...%40geoblocks%2Fcesium-flyto%400.1.5) (2026-10-25)

**Note:** Version bump only for package @geoblocks/cesium-flyto





## [0.1.4](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-flyto%400.1.3...%40geoblocks%2Fcesium-flyto%400.1.4) (2026-10-23)

**Note:** Version bump only for package @geoblocks/cesium-flyto





## [0.1.3](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-flyto%400.1.2...%40geoblocks%2Fcesium-flyto%400.1.3) (2026-10-15)

**Note:** Version bump only for package @geoblocks/cesium-flyto





## [0.1.2](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-flyto%400.1.1...%40geoblocks%2Fcesium-flyto%400.1.2) (2026-10-15)

**Note:** Version bump only for package @geoblocks/cesium-flyto





## [0.1.1](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-flyto%400.1.0...%40geoblocks%2Fcesium-flyto%400.1.1) (2026-10-14)

**Note:** Version bump only for package @geoblocks/cesium-flyto





# 0.1.0 (2026-10-14)

### Bug Fixes

* read the shaders' textures in high precision ([afcf68d](https://github.com/geoblocks/cesium-helpers/commit/afcf68de6f1bfc7867bdec895d6bc24a44a7074e))

### Features

* add cesium-flyto, fly toward the double-clicked position ([f5c5419](https://github.com/geoblocks/cesium-helpers/commit/f5c5419575443cce67872a38ce18a2aec359978d))
* add cesium-path-flyover, a camera flyover along a GPX or GeoJSON track ([e0e9cd5](https://github.com/geoblocks/cesium-helpers/commit/e0e9cd5ede69fc2bb41034398f3cf57a55109cc8))
* flyto motion blur and depth of field during the flight ([a7ef060](https://github.com/geoblocks/cesium-helpers/commit/a7ef060c47e77b4629a65510308a936b70fda542))
