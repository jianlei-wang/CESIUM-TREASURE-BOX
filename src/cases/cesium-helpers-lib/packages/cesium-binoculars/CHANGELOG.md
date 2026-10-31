# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.2.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-binoculars%400.1.0...%40geoblocks%2Fcesium-binoculars%400.2.0) (2026-10-26)

### Build System

* publish built JavaScript and type declarations from dist/ ([#185](https://github.com/geoblocks/cesium-helpers/issues/185)) ([327d71e](https://github.com/geoblocks/cesium-helpers/commit/327d71e5ccf4c1e86477f25d262816db785f419b))

### BREAKING CHANGES

* the published files moved from the package root to dist/, so deep imports such as @geoblocks/cesium-compass/cesium-compass.js no longer resolve, and the exports map only exposes the package entry point (cesium-obstacles also exposes ./triangle-mesh.js, ./triangle-trees.js, ./gltf-mesh.js and ./mesh-builder.js).


# [0.1.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-binoculars%400.0.2...%40geoblocks%2Fcesium-binoculars%400.1.0) (2026-10-14)

### Bug Fixes

* read the shaders' textures in high precision ([afcf68d](https://github.com/geoblocks/cesium-helpers/commit/afcf68de6f1bfc7867bdec895d6bc24a44a7074e))

### Features

* binoculars depth of field, rim vignetting, magnified lens flaws ([d625ba2](https://github.com/geoblocks/cesium-helpers/commit/d625ba2f4810d04cf2fa3991db409601b86122ca))
* binoculars eyepieces modeled on Red Dead Redemption 2 ([03ecef3](https://github.com/geoblocks/cesium-helpers/commit/03ecef37df36bb6b638e738f913ef2e045c3e793))
* binoculars look around in place, with an eyepiece mask and lens effects ([a42818d](https://github.com/geoblocks/cesium-helpers/commit/a42818d7a04e4731cc07ad3b6837acefbb6167b1))
* binoculars rangefinder reticle and distance ([17a4365](https://github.com/geoblocks/cesium-helpers/commit/17a436568785fbe2f8bb1726bfb018b64ffff711))
