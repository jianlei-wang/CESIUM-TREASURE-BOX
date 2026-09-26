/**
 * CesiumJS 1.144 渲染效果与性能配置模板
 * ------------------------------------------------------------------
 * 提供三档初始化：QUALITY（渲染效果优先）、PERFORMANCE（流畅度优先）、DEBUG（调试诊断）。
 * 按需复制到项目入口；所有参数均可在运行时再调整。
 * 依赖：CesiumJS >= 1.140（以 1.144 为准），Ion token 自行配置。
 * 说明：本文件是 Skill 资产，复制进项目后按需裁剪；不要求原样引入。
 */

/* ============ 档位选择（切换三者之一） ============ */
const PROFILE = "PERFORMANCE"; // "QUALITY" | "PERFORMANCE" | "DEBUG"

/* ============ 1. Viewer 基础构造 ============ */
const viewer = new Cesium.Viewer("cesiumContainer", {
  // 影像底图（异步 API，1.104+ 推荐）
  baseLayer: Cesium.ImageryLayer.fromProviderAsync(
    Cesium.createWorldImageryAsync({
      style: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS,
    })
  ),
  sceneMode: Cesium.SceneMode.SCENE3D,
  // 控件按需裁剪（省 DOM 开销）
  animation: false,
  timeline: false,
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  fullscreenButton: false,
  infoBox: false,
  // 渲染上下文
  contextOptions: {
    webgl: {
      antialias: true,
      powerPreference: "high-performance", // 双显卡设备避免被分配集显
    },
  },
});

/* ============ 2. 场景渲染参数（按档位） ============ */
const scene = viewer.scene;
scene.logarithmicDepthBuffer = true; // 消除远处闪烁/摩尔纹（强烈建议保持 true）

if (PROFILE === "QUALITY") {
  scene.highDynamicRange = true;
  scene.msaaSamples = 4; // 几何抗锯齿
  scene.fxaa = false; // MSAA 与 FXAA 二选一，不要同时开
  scene.globe.depthTestAgainstTerrain = true; // 贴地深度测试，防穿地
  scene.globe.showGroundAtmosphere = true;
  scene.fog.enabled = true;
  scene.skyAtmosphere.show = true;
  scene.shadowMap.enabled = false; // 需要动态阴影时改 true（开销大，先限定 maximumDistance）
  viewer.useBrowserRecommendedResolution = true; // 保持原生分辨率
  scene.globe.maximumScreenSpaceError = 2; // 地形高精度
  scene.globe.enableLighting = true; // 地形光照（需地形带 requestVertexNormals）
} else if (PROFILE === "PERFORMANCE") {
  scene.highDynamicRange = false;
  scene.msaaSamples = 0; // 关闭 MSAA
  scene.fxaa = true; // 廉价抗锯齿
  scene.globe.depthTestAgainstTerrain = false; // 关闭以省深度测试
  scene.globe.showGroundAtmosphere = false;
  scene.fog.enabled = false;
  scene.skyAtmosphere.show = false;
  scene.shadowMap.enabled = false;
  viewer.useBrowserRecommendedResolution = false;
  viewer.resolutionScale = 0.75; // 高 DPI 屏/移动端可降到 0.5
  scene.globe.maximumScreenSpaceError = 8; // 地形降采样
  scene.globe.enableLighting = false;
}

/* ============ 3. 按需渲染（静态/低交互场景首选） ============ */
if (PROFILE === "PERFORMANCE" || PROFILE === "QUALITY") {
  scene.requestRenderMode = true; // 无变化不重绘
  scene.maximumRenderTimeChange = Infinity;
  // 注意：动态数据/动画/时钟场景请保持 requestRenderMode=false，
  // 且数据更新后调用 scene.requestRender() 触发一次重绘。
}

/* ============ 4. 地形 ============ */
async function setupTerrain() {
  try {
    const terrain = await Cesium.createWorldTerrainAsync({
      requestVertexNormals: PROFILE === "QUALITY", // 光照需要法线
      requestWaterMask: false, // 不需要水面效果时关掉
    });
    viewer.terrainProvider = terrain;
  } catch (e) {
    console.warn("地形加载失败，回退默认椭球：", e);
  }
  scene.globe.tileCacheSize = 100;
  scene.globe.cacheBytes = 536870912; // 512MB
}
setupTerrain();

/* ============ 5. 3D Tiles（按需启用，示例参数） ============ */
async function setupTileset(url) {
  const tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
    maximumScreenSpaceError: PROFILE === "QUALITY" ? 8 : 32,
    skipLevelOfDetail: true, // 跳级精化
    skipScreenSpaceErrorFactor: 16,
    skipLevels: 1,
    maximumMemoryUsage: PROFILE === "QUALITY" ? 1024 : 512,
    cullRequestsWhileMoving: true, // 移动时砍非关键请求
    preloadFlightDestinations: true,
    preferLeaves: true,
    dynamicScreenSpaceError: PROFILE === "PERFORMANCE", // 大数据俯瞰
  });
  scene.primitives.add(tileset);

  // 相机高度自适应 SSE：俯瞰放宽、近看收紧
  const adaptSSE = () => {
    const h = viewer.camera.positionCartographic.height;
    tileset.maximumScreenSpaceError = h > 50000 ? 64 : h > 10000 ? 32 : 8;
  };
  viewer.camera.moveEnd.addEventListener(adaptSSE);
  adaptSSE();
  return tileset;
}

/* ============ 6. 请求调度 ============ */
// 混合数据源（影像+地形+tileset）时放宽每服务器并发
Cesium.RequestScheduler.maximumRequestsPerServer = 18;
// Cesium.RequestScheduler.maximumRequests = 60;

/* ============ 7. 调试档（DEBUG） ============ */
if (PROFILE === "DEBUG") {
  scene.requestRenderMode = false; // 调试时保证每帧渲染
  scene.debugShowFramesPerSecond = true;
  scene.debugShowStatistics = true;
  scene.debugShowFrustums = true;
  // scene.debugShowCommands = true;
  // tileset.debugColorizeTiles = true;  // tileset 就绪后开启
  // tileset.debugShowBoundingVolume = true;
  console.log("Cesium 调试模式已开启");
  // 加载进度监听（瓦片就绪判断）
  scene.globe.tileLoadProgressEvent.addEventListener((loaded, total) => {
    if (loaded === total) console.log("globe 瓦片全部就绪");
  });
}

/* ============ 8. 验证指引 ============ */
// 优化前后用同一组指标对比（详见 references/debugging.md 基线模板）：
//  - 静止 FPS / 旋转最低 FPS
//  - debugShowStatistics 的 draw calls
//  - tileset.statistics.loadedTiles
//  - 首屏加载完成时间（tileLoadProgressEvent）
//  - JS 堆峰值 / GPU 显存（DevTools）

export { viewer, scene };
