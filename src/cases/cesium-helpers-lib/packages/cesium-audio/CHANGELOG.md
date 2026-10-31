# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# 0.1.0 (2026-10-26)

### Build System

* publish built JavaScript and type declarations from dist/ ([#185](https://github.com/geoblocks/cesium-helpers/issues/185)) ([327d71e](https://github.com/geoblocks/cesium-helpers/commit/327d71e5ccf4c1e86477f25d262816db785f419b))

### Features

* add cesium-audio, spatialized sound located on the globe ([e57177d](https://github.com/geoblocks/cesium-helpers/commit/e57177d1f693c95c9cbe93e2c9918efadd381216))
* **cesium-audio:** take the viewer and accept a position property ([26ec898](https://github.com/geoblocks/cesium-helpers/commit/26ec898251bf4a4aaa5acb2002532397fa4489cb))

### BREAKING CHANGES

* the published files moved from the package root to dist/, so deep imports such as @geoblocks/cesium-compass/cesium-compass.js no longer resolve, and the exports map only exposes the package entry point (cesium-obstacles also exposes ./triangle-mesh.js, ./triangle-trees.js, ./gltf-mesh.js and ./mesh-builder.js).
