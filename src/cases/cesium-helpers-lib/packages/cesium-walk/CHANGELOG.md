# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.5.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-walk%400.4.1...%40geoblocks%2Fcesium-walk%400.5.0) (2026-10-26)

### Build System

* publish built JavaScript and type declarations from dist/ ([#185](https://github.com/geoblocks/cesium-helpers/issues/185)) ([327d71e](https://github.com/geoblocks/cesium-helpers/commit/327d71e5ccf4c1e86477f25d262816db785f419b))

### BREAKING CHANGES

* the published files moved from the package root to dist/, so deep imports such as @geoblocks/cesium-compass/cesium-compass.js no longer resolve, and the exports map only exposes the package entry point (cesium-obstacles also exposes ./triangle-mesh.js, ./triangle-trees.js, ./gltf-mesh.js and ./mesh-builder.js).


## [0.4.1](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-walk%400.4.0...%40geoblocks%2Fcesium-walk%400.4.1) (2026-10-20)

**Note:** Version bump only for package @geoblocks/cesium-walk





# [0.4.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-walk%400.3.1...%40geoblocks%2Fcesium-walk%400.4.0) (2026-10-19)

### Features

* **input:** read the actions from sources besides the devices ([12ff24f](https://github.com/geoblocks/cesium-helpers/commit/12ff24ffe72cb34505a56688eecdea846731283b))


## [0.3.1](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-walk%400.3.0...%40geoblocks%2Fcesium-walk%400.3.1) (2026-10-18)

**Note:** Version bump only for package @geoblocks/cesium-walk





# [0.3.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-walk%400.2.2...%40geoblocks%2Fcesium-walk%400.3.0) (2026-10-16)

### Features

* **walk:** give the walker a body, kept clear of the walls beside it ([93d89cb](https://github.com/geoblocks/cesium-helpers/commit/93d89cb1a15539e58a52c4bb271623b41abd250a))


## [0.2.2](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-walk%400.2.1...%40geoblocks%2Fcesium-walk%400.2.2) (2026-10-15)

### Bug Fixes

* **walk:** stop at the second wall of a concave corner instead of sliding through it ([8d1a545](https://github.com/geoblocks/cesium-helpers/commit/8d1a54553a3ba56b040c40cca5fb3b5d3b6000dc))


## [0.2.1](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-walk%400.2.0...%40geoblocks%2Fcesium-walk%400.2.1) (2026-10-15)

**Note:** Version bump only for package @geoblocks/cesium-walk





# [0.2.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-walk%400.1.1...%40geoblocks%2Fcesium-walk%400.2.0) (2026-10-15)

* refactor(obstacles)!: move the triangle mesh from cesium-walk to here ([38b3a6f](https://github.com/geoblocks/cesium-helpers/commit/38b3a6fcf3df2666fb5681bb7c252a300fb3e625))

### Features

* **walk:** read a glTF's triangles in the walker's frame ([4de18cd](https://github.com/geoblocks/cesium-helpers/commit/4de18cdf7ef7b617b34733a4213cb43a7dde0fc3))
* **walk:** walk on a glTF's triangles, createWalkMeshFromGltf ([1623165](https://github.com/geoblocks/cesium-helpers/commit/16231655fdda2280b68decf750843f49227f0128))

### BREAKING CHANGES

* @geoblocks/cesium-walk/walk-mesh.js (createWalkMesh,
  toGlb, walkOn, rayHeights) and @geoblocks/cesium-walk/mesh-builder.js
  (Group) are gone: walkOn and rayHeights come from @geoblocks/cesium-walk,
  Group and the mesh from @geoblocks/cesium-obstacles; nothing draws the
  groups any more.


## [0.1.1](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-walk%400.1.0...%40geoblocks%2Fcesium-walk%400.1.1) (2026-10-14)

### Bug Fixes

* **walk, obstacles:** walk without a globe ([f2ef2b0](https://github.com/geoblocks/cesium-helpers/commit/f2ef2b08f1d51bea4742d4925d4742471262ac94))
* **walk:** write the walk mesh's positions in floats ([1b934cc](https://github.com/geoblocks/cesium-helpers/commit/1b934cc85a760cf3d2ef9fe1919419ac0ccc48a2))
