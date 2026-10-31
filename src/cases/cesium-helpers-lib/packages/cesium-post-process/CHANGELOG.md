# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.6.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-post-process%400.5.0...%40geoblocks%2Fcesium-post-process%400.6.0) (2026-10-27)

### Features

* **post-process:** OpenSky, what SnowLine and RainRings lie on ([be7eac1](https://github.com/geoblocks/cesium-helpers/commit/be7eac15963c323d5ccf77554bd53990c4deebed))


# [0.5.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-post-process%400.4.0...%40geoblocks%2Fcesium-post-process%400.5.0) (2026-10-26)

### Build System

* publish built JavaScript and type declarations from dist/ ([#185](https://github.com/geoblocks/cesium-helpers/issues/185)) ([327d71e](https://github.com/geoblocks/cesium-helpers/commit/327d71e5ccf4c1e86477f25d262816db785f419b))

### BREAKING CHANGES

* the published files moved from the package root to dist/, so deep imports such as @geoblocks/cesium-compass/cesium-compass.js no longer resolve, and the exports map only exposes the package entry point (cesium-obstacles also exposes ./triangle-mesh.js, ./triangle-trees.js, ./gltf-mesh.js and ./mesh-builder.js).


# [0.4.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-post-process%400.3.0...%40geoblocks%2Fcesium-post-process%400.4.0) (2026-10-25)

### Features

* **post-process:** SnowLine's grain, scene light, steep cover and origin; RainRings' clock ([c52ceb5](https://github.com/geoblocks/cesium-helpers/commit/c52ceb5a4321e44820e89411ba62eada7e9d9d73))


# [0.3.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-post-process%400.2.0...%40geoblocks%2Fcesium-post-process%400.3.0) (2026-10-25)

### Bug Fixes

* **post-process:** a cell with a hash of 0 has no drop at no rain ([ceb4696](https://github.com/geoblocks/cesium-helpers/commit/ceb46962c7040a2d2c6614cddd7f2ce5aaa37ca9))

### Features

* **post-process:** RainRings, rings where the rain lands ([9b194d7](https://github.com/geoblocks/cesium-helpers/commit/9b194d73b69c7c7a8da3b2f76f6f202eb0deaf6a))
* **post-process:** SnowLine's patchiness, water level and sun direction ([7410734](https://github.com/geoblocks/cesium-helpers/commit/74107340a34cf5efd0c5b9b7983600b565660b30))


# [0.2.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-post-process%400.1.3...%40geoblocks%2Fcesium-post-process%400.2.0) (2026-10-23)

### Features

* **post-process:** add the Dufour map look ([1061f7a](https://github.com/geoblocks/cesium-helpers/commit/1061f7a885f3d42b4c58913832821cdcdcaa9349))
* **post-process:** export the Height and Normal chunks and heightUniforms ([31f990a](https://github.com/geoblocks/cesium-helpers/commit/31f990a0920d5e30a2ff6eee21d6a36e8bdf7eb5))


## [0.1.3](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-post-process%400.1.2...%40geoblocks%2Fcesium-post-process%400.1.3) (2026-10-15)

### Bug Fixes

* **post-process:** outline a jump against the far side's surface, anti-aliased ([3a1fdae](https://github.com/geoblocks/cesium-helpers/commit/3a1fdaeeaca2193ba6725bfe1a763ea2252cbee2))

### Performance Improvements

* **post-process:** the Toy reads the creases' neighbours only when it lights or shades them ([2a00d7b](https://github.com/geoblocks/cesium-helpers/commit/2a00d7b4227dd339f5e466d98cb9ca32fead984b))


## [0.1.2](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-post-process%400.1.1...%40geoblocks%2Fcesium-post-process%400.1.2) (2026-10-15)

**Note:** Version bump only for package @geoblocks/cesium-post-process





## [0.1.1](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-post-process%400.1.0...%40geoblocks%2Fcesium-post-process%400.1.1) (2026-10-14)

### Bug Fixes

* **post-process:** publish effect.js and the cloud files ([9978341](https://github.com/geoblocks/cesium-helpers/commit/997834112b1e234a06cca994398cf07337cb431c))


# 0.1.0 (2026-10-14)

### Bug Fixes

* **cesium-post-process:** read the depth of an orthographic view ([7301f71](https://github.com/geoblocks/cesium-helpers/commit/7301f71e9dd4be4506398dbe2b00d691e5c37146))
* **post-process:** declare the samplers' precision in each shader chunk ([b788660](https://github.com/geoblocks/cesium-helpers/commit/b78866017436209e3ad33421a8883868cefbcc48)), closes [#247](https://github.com/geoblocks/cesium-helpers/issues/247)
* read the shaders' textures in high precision ([afcf68d](https://github.com/geoblocks/cesium-helpers/commit/afcf68de6f1bfc7867bdec895d6bc24a44a7074e))

### Features

* add cesium-path-flyover, a camera flyover along a GPX or GeoJSON track ([e0e9cd5](https://github.com/geoblocks/cesium-helpers/commit/e0e9cd5ede69fc2bb41034398f3cf57a55109cc8))
* add cesium-post-process, with eight screen-space effects ([accfe11](https://github.com/geoblocks/cesium-helpers/commit/accfe114c5e4d48c81a1f94db3321aeef2a8f3d9))
* **cesium-post-process:** add a precipitation effect, from rain to snow ([8b921cf](https://github.com/geoblocks/cesium-helpers/commit/8b921cfbb2b1bad4a9e595d3a9d16df72295d9f8))
* **cesium-post-process:** add a rain map and volumetric clouds ([56f8a70](https://github.com/geoblocks/cesium-helpers/commit/56f8a701c8229093d17ee97a201cff7360a7dd7a))
* **cesium-post-process:** add a Toy effect, an isometric game's look ([a64a0af](https://github.com/geoblocks/cesium-helpers/commit/a64a0af18750626af03a244713de98314f469782))
* **cesium-post-process:** imitate ArduPilot's HD OSD in DroneDisplay ([d0e0250](https://github.com/geoblocks/cesium-helpers/commit/d0e02507fa16ef116df17959a6cc02935c28cf99))
* **cesium-post-process:** make AnalogVideo degrade like a real FPV feed ([7876640](https://github.com/geoblocks/cesium-helpers/commit/787664044fbecb36533e6571e1c3ce96f66a9b78))
* **cesium-post-process:** more realistic volumetric clouds and rain haze ([318e3d3](https://github.com/geoblocks/cesium-helpers/commit/318e3d3d242b3b08010802b532f95177d27f420a))
* **cesium-post-process:** raymarch the spotlight's beam ([507bdc7](https://github.com/geoblocks/cesium-helpers/commit/507bdc7d76b1f24b817a60053683bd7ead5aa99b))
* **cesium-post-process:** show Betaflight's RXLOSS warning in DroneDisplay ([cb30423](https://github.com/geoblocks/cesium-helpers/commit/cb30423a3277276a74077b653b9a71afa132bbeb))
* **cesium-post-process:** spotlight roll-off, grazing normals, power ([6db0851](https://github.com/geoblocks/cesium-helpers/commit/6db0851d766886b76b84cdbf89cf4511a9f52eb3))
* **cesium-post-process:** strike on heavy rain, glow from above ([30a7198](https://github.com/geoblocks/cesium-helpers/commit/30a71983adc80e0c7967cbb3856bfaf8e129464a))
* **post-process:** add a jump option to Toy, a crease's limit ([d574b88](https://github.com/geoblocks/cesium-helpers/commit/d574b8801e696f0a75fc78da1865f72cda1391fa))
* **post-process:** add WhiteModel, an architect's white model look ([29bfd3b](https://github.com/geoblocks/cesium-helpers/commit/29bfd3b8cca8cbffed24ef6dd52ae7aef913ab56))
* **post-process:** round the toy's edges and outline its silhouettes ([361a54f](https://github.com/geoblocks/cesium-helpers/commit/361a54fcc923151b32844bc726385f811191dfd0))
