/**
 * CesiumJS 1.144 一键调试注入 + 基线采集脚本
 * ------------------------------------------------------------------
 * 用途：粘贴到浏览器控制台（页面已初始化 Cesium Viewer），
 *       自动开启常用调试开关并输出可复制的基线摘要，用于优化前后对比。
 * 用法：
 *   1. 打开你的 Cesium 页面，进入 DevTools Console；
 *   2. 把本文件内容整体粘贴执行（若全局变量不叫 viewer，先执行
 *      const viewer = 你的viewer变量;）；
 *   3. 脚本自动依次采样：静止 5 秒 → 旋转 5 秒 → 缩放 5 秒；
 *   4. 控制台输出基线 JSON，复制保存，优化后重跑本脚本对比。
 * 全部开关仅开发期使用；生产环境不要引入本脚本。
 */
(function () {
  "use strict";

  // 自动定位 viewer：优先使用传入的，否则在常见全局名中寻找
  const viewer =
    (typeof window !== "undefined" &&
      (window.viewer || window.cesiumViewer || window.CESIUM_VIEWER)) ||
    undefined;

  if (!viewer || !viewer.scene) {
    console.error(
      "[cesium-debug] 未找到 Cesium viewer 对象。请先执行：const viewer = 你的viewer; 再运行本脚本。"
    );
    return;
  }

  const scene = viewer.scene;
  const stats = {
    version: typeof Cesium !== "undefined" ? Cesium.VERSION : "unknown",
    profile: {},
    tiles: {},
    memory: {},
    fps: { static: null, rotate: null, zoom: null },
  };

  /* ---- 1. 开启调试开关（全部只影响开发期） ---- */
  scene.debugShowFramesPerSecond = true;
  scene.debugShowStatistics = true;
  scene.debugShowFrustums = true;
  // scene.debugShowCommands = true;   // 按需：高亮渲染命令
  // scene.debugShowDepthFrustum = 1;  // 按需：深度分割

  /* ---- 2. 采样 FPS：静止 / 旋转 / 缩放（action 每帧执行） ---- */
  function sampleFPS(label, durationMs, action) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      let frames = 0;
      const tick = () => {
        if (action) action();
        frames++;
        if (performance.now() - t0 < durationMs) {
          requestAnimationFrame(tick);
        } else {
          resolve(frames / (durationMs / 1000));
        }
      };
      requestAnimationFrame(tick);
    });
  }

  async function collect() {
    const camera = viewer.camera;
    const startHeading = camera.heading;

    // 静止 5 秒
    stats.fps.static = await sampleFPS("静止", 5000);

    // 匀速旋转 5 秒（每帧 ~0.02 弧度，约 68°/s）
    stats.fps.rotate = await sampleFPS("旋转", 5000, () => {
      camera.heading += 0.02;
    });

    // 缩放 5 秒（在 10km ~ 500km 高度间往返）
    let zoomDir = -1;
    stats.fps.zoom = await sampleFPS("缩放", 5000, () => {
      const h = camera.positionCartographic.height;
      if (h < 10000) zoomDir = 1;
      if (h > 500000) zoomDir = -1;
      camera.zoomIn(zoomDir * Math.max(5000, h * 0.05));
    });

    camera.heading = startHeading;
  }

  /* ---- 3. 读取统计与内存 ---- */
  function readStats() {
    stats.profile = {
      requestRenderMode: scene.requestRenderMode,
      msaaSamples: scene.msaaSamples,
      fxaa: scene.fxaa,
      logarithmicDepthBuffer: scene.logarithmicDepthBuffer,
      resolutionScale: viewer.resolutionScale,
      globeSSE: scene.globe.maximumScreenSpaceError,
      globeCacheBytes: scene.globe.cacheBytes,
      shadows: scene.shadowMap.enabled,
      fog: scene.fog.enabled,
      atmosphere: scene.skyAtmosphere.show,
    };

    // tileset 统计
    stats.tiles = [];
    scene.primitives._primitives.forEach((p) => {
      if (p instanceof Cesium.Cesium3DTileset) {
        stats.tiles.push({
          url: p._url || "(tileset)",
          loadedTiles: p.statistics.loadedTiles,
          visitedTiles: p.statistics.visitedTiles,
          selectedTiles: p.statistics.selectedTiles,
          commands: p.statistics.commands,
          maximumMemoryUsage: p.maximumMemoryUsage,
        });
      }
    });
    if (typeof performance.memory !== "undefined") {
      stats.memory.jsHeapMB = Math.round(
        performance.memory.usedJSHeapSize / 1048576
      );
      stats.memory.totalJSHeapMB = Math.round(
        performance.memory.totalJSHeapSize / 1048576
      );
    }
    if (scene.context && scene.context._gl) {
      const gl = scene.context._gl;
      stats.memory.webglRenderer = gl.getParameter(gl.RENDERER);
    }
  }

  /* ---- 4. 输出 ---- */
  collect()
    .then(() => {
      readStats();
      console.log("[cesium-debug] 基线采集完成：");
      console.log(JSON.stringify(stats, null, 2));
      console.log(
        "[cesium-debug] 提示：保存上述 JSON；优化后重跑本脚本并对比。详细指标采集见 references/debugging.md。"
      );
      console.log(
        "[cesium-debug] 关闭开关：scene.debugShowFramesPerSecond=false; scene.debugShowStatistics=false; scene.debugShowFrustums=false;"
      );
    })
    .catch((e) => {
      console.error("[cesium-debug] 采集失败：", e);
    });
})();
