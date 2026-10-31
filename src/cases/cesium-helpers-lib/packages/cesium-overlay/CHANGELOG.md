# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.5.1](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-overlay%400.5.0...%40geoblocks%2Fcesium-overlay%400.5.1) (2026-10-28)

### Performance Improvements

* **cesium-overlay:** contain the layer; keep the paths' shapes in JS ([52c370b](https://github.com/geoblocks/cesium-helpers/commit/52c370b838b85c1911c4968694df5ce8fd4d2efc))
* **cesium-overlay:** project a line's points with one view matrix ([16f79ec](https://github.com/geoblocks/cesium-helpers/commit/16f79ec5d9d054b9407b152513b89613b7bf95c7))
* **cesium-overlay:** read the depth in the browser's idle time ([dae01e0](https://github.com/geoblocks/cesium-helpers/commit/dae01e0520ee5f72533ecdb3b5b4294deaea3300))
* **cesium-overlay:** test a short segment at its ends, a corner once ([a647d3d](https://github.com/geoblocks/cesium-helpers/commit/a647d3d6015ac103a0753eaba4dcf67cf7277d08))


# [0.5.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-overlay%400.4.0...%40geoblocks%2Fcesium-overlay%400.5.0) (2026-10-26)

### Build System

* publish built JavaScript and type declarations from dist/ ([#185](https://github.com/geoblocks/cesium-helpers/issues/185)) ([327d71e](https://github.com/geoblocks/cesium-helpers/commit/327d71e5ccf4c1e86477f25d262816db785f419b))

### BREAKING CHANGES

* the published files moved from the package root to dist/, so deep imports such as @geoblocks/cesium-compass/cesium-compass.js no longer resolve, and the exports map only exposes the package entry point (cesium-obstacles also exposes ./triangle-mesh.js, ./triangle-trees.js, ./gltf-mesh.js and ./mesh-builder.js).


# [0.4.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-overlay%400.3.0...%40geoblocks%2Fcesium-overlay%400.4.0) (2026-10-23)

### Features

* **overlay:** add lines, SVG over the scene, hidden where the scene is nearer ([f472c0d](https://github.com/geoblocks/cesium-helpers/commit/f472c0d1594f3cdc523cf9fcf5425454850e25e4))
* **overlay:** lines of several polylines, joined runs, no needless render ([ad79ae7](https://github.com/geoblocks/cesium-helpers/commit/ad79ae798d6119e0ee92ab6c4500c69a115f49ac))


# [0.3.0](https://github.com/geoblocks/cesium-helpers/compare/%40geoblocks%2Fcesium-overlay%400.2.0...%40geoblocks%2Fcesium-overlay%400.3.0) (2026-10-23)

* feat(overlay)!: keep the overlay's stylesheet in its layer, not in the head ([764bbd7](https://github.com/geoblocks/cesium-helpers/commit/764bbd736bcb9b6ea542f28c439725d61ccae0d7))

### BREAKING CHANGES

* installStyle and @geoblocks/cesium-overlay/install-style.js
  are removed. A package that draws over the overlay puts a <style> in its
  own element in the layer, its rules in [@layer](https://github.com/layer) and [@scope](https://github.com/scope) (README, Custom
  styles).


# 0.2.0 (2026-10-23)

### Features

* **overlay:** add cesium-overlay, an HTML layer and pins over a scene ([1532ae6](https://github.com/geoblocks/cesium-helpers/commit/1532ae667564f218e571b7875066a1a1b6333b38))
