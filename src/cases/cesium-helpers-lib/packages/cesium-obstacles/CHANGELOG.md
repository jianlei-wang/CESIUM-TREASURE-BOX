# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.6.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-obstacles%400.5.0...%40geoblocks%2Fcesium-obstacles%400.6.0) (2026-10-26)

### Build System

* publish built JavaScript and type declarations from dist/ ([#185](https://github.com/geoblocks/cesium-helpers/issues/185)) ([327d71e](https://github.com/geoblocks/cesium-helpers/commit/327d71e5ccf4c1e86477f25d262816db785f419b))

### BREAKING CHANGES

* the published files moved from the package root to dist/, so deep imports such as @geoblocks/cesium-compass/cesium-compass.js no longer resolve, and the exports map only exposes the package entry point (cesium-obstacles also exposes ./triangle-mesh.js, ./triangle-trees.js, ./gltf-mesh.js and ./mesh-builder.js).


# [0.5.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-obstacles%400.4.0...%40geoblocks%2Fcesium-obstacles%400.5.0) (2026-10-20)

### Features

* **obstacles:** build a triangle mesh's trees apart, take them given ([55fa737](https://github.com/geoblocks/cesium-helpers/commit/55fa737aaa9e69beeb1c2282f4053e475a5200e1))


# [0.4.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-obstacles%400.3.0...%40geoblocks%2Fcesium-obstacles%400.4.0) (2026-10-18)

### Features

* **obstacles:** build the triangle mesh on cesium-bvh, add mesh.refit ([f041c1d](https://github.com/geoblocks/cesium-helpers/commit/f041c1d3ca137354bdb7e699574aec925f328a2e))


# [0.3.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-obstacles%400.2.2...%40geoblocks%2Fcesium-obstacles%400.3.0) (2026-10-16)

### Features

* **walk:** give the walker a body, kept clear of the walls beside it ([93d89cb](https://github.com/geoblocks/cesium-helpers/commit/93d89cb1a15539e58a52c4bb271623b41abd250a))


## [0.2.2](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-obstacles%400.2.1...%40geoblocks%2Fcesium-obstacles%400.2.2) (2026-10-15)

**Note:** Version bump only for package @geoblocks/cesium-obstacles





## [0.2.1](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-obstacles%400.2.0...%40geoblocks%2Fcesium-obstacles%400.2.1) (2026-10-15)

**Note:** Version bump only for package @geoblocks/cesium-obstacles





# [0.2.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-obstacles%400.1.1...%40geoblocks%2Fcesium-obstacles%400.2.0) (2026-10-15)

* refactor(obstacles)!: move the triangle mesh from cesium-walk to here ([38b3a6f](https://github.com/geoblocks/cesium-helpers/commit/38b3a6fcf3df2666fb5681bb7c252a300fb3e625))

### BREAKING CHANGES

* @geoblocks/cesium-walk/walk-mesh.js (createWalkMesh,
  toGlb, walkOn, rayHeights) and @geoblocks/cesium-walk/mesh-builder.js
  (Group) are gone: walkOn and rayHeights come from @geoblocks/cesium-walk,
  Group and the mesh from @geoblocks/cesium-obstacles; nothing draws the
  groups any more.


## [0.1.1](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-obstacles%400.1.0...%40geoblocks%2Fcesium-obstacles%400.1.1) (2026-10-14)

### Bug Fixes

* **walk, obstacles:** walk without a globe ([f2ef2b0](https://github.com/geoblocks/cesium-helpers/commit/f2ef2b08f1d51bea4742d4925d4742471262ac94))
