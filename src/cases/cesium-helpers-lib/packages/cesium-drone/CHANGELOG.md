# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.4.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-drone%400.3.1...%40geoblocks%2Fcesium-drone%400.4.0) (2026-10-26)

### Build System

* publish built JavaScript and type declarations from dist/ ([#185](https://github.com/geoblocks/cesium-helpers/issues/185)) ([327d71e](https://github.com/geoblocks/cesium-helpers/commit/327d71e5ccf4c1e86477f25d262816db785f419b))

### BREAKING CHANGES

* the published files moved from the package root to dist/, so deep imports such as @geoblocks/cesium-compass/cesium-compass.js no longer resolve, and the exports map only exposes the package entry point (cesium-obstacles also exposes ./triangle-mesh.js, ./triangle-trees.js, ./gltf-mesh.js and ./mesh-builder.js).


## [0.3.1](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-drone%400.3.0...%40geoblocks%2Fcesium-drone%400.3.1) (2026-10-20)

**Note:** Version bump only for package @geoblocks/cesium-drone





# [0.3.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-drone%400.2.4...%40geoblocks%2Fcesium-drone%400.3.0) (2026-10-19)

### Features

* **input:** read the actions from sources besides the devices ([12ff24f](https://github.com/geoblocks/cesium-helpers/commit/12ff24ffe72cb34505a56688eecdea846731283b))


## [0.2.4](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-drone%400.2.3...%40geoblocks%2Fcesium-drone%400.2.4) (2026-10-18)

**Note:** Version bump only for package @geoblocks/cesium-drone





## [0.2.3](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-drone%400.2.2...%40geoblocks%2Fcesium-drone%400.2.3) (2026-10-16)

**Note:** Version bump only for package @geoblocks/cesium-drone





## [0.2.2](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-drone%400.2.1...%40geoblocks%2Fcesium-drone%400.2.2) (2026-10-15)

**Note:** Version bump only for package @geoblocks/cesium-drone





## [0.2.1](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-drone%400.2.0...%40geoblocks%2Fcesium-drone%400.2.1) (2026-10-15)

**Note:** Version bump only for package @geoblocks/cesium-drone





# [0.2.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-drone%400.1.0...%40geoblocks%2Fcesium-drone%400.2.0) (2026-10-15)

### Bug Fixes

* **drone:** no globe, no error from the default ground ([8af26c1](https://github.com/geoblocks/cesium-helpers/commit/8af26c17029796881ed784ff1f7e28787c86a3c7))

### Features

* **drone:** fly among a triangle mesh, flyOn ([82b11dc](https://github.com/geoblocks/cesium-helpers/commit/82b11dc3869969d0e6a98120a98c5c30f70cfcae))


# 0.1.0 (2026-10-14)

### Features

* add cesium-drone, an arcade drone flown with the keyboard or a gamepad ([6f897b1](https://github.com/geoblocks/cesium-helpers/commit/6f897b12bd1d26259b84eee42c78d03e2b010cf3))
* add jamming to the drone simulator ([92f0981](https://github.com/geoblocks/cesium-helpers/commit/92f09816749b6f1b446f23b9110be8d976a58069))
* **cesium-drone:** add a game layout for gamepads, the default ([e2ec4d7](https://github.com/geoblocks/cesium-helpers/commit/e2ec4d7f4db0f45e3a6ecd08ff2ac23a1e6a653c))
* **cesium-drone:** crash into the obstacles in view ([3aba9bf](https://github.com/geoblocks/cesium-helpers/commit/3aba9bf195b739c8b8b6762993e97cd75b5e5240))
* **cesium-drone:** let the obstacles come from a ray cast ([3e911c1](https://github.com/geoblocks/cesium-helpers/commit/3e911c1d96c8c6e8cf427e42439e509b0748a0b7))
