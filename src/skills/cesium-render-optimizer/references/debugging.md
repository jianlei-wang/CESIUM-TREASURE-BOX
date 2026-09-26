# 性能调试与 Profiling（CesiumJS 1.144）

**规则：一切优化前先建基线，一切优化后重测同一指标。** 本节提供 Cesium 内置工具与浏览器工具两套流程。

## 1. Cesium 内置调试开关（一行一个，全部只用于开发期）

```js
// 帧率与帧间隔（左上角覆盖层）
viewer.scene.debugShowFramesPerSecond = true;

// 每帧渲染统计：draw calls、渲染状态、三角形数、缓存命中
viewer.scene.debugShowStatistics = true;

// 高亮视锥体与剔除范围（判断剔除是否生效）
viewer.scene.debugShowFrustums = true;

// 高亮每帧执行的渲染命令（诊断过度绘制）
viewer.scene.debugShowCommands = true;

// 深度缓冲视锥分段（配合对数深度排查闪烁）
viewer.scene.debugShowDepthFrustum = 1;

// 说明：debugShow* 均为布尔/数值开关，开启后信息显示在画面上；
// 编程读取请用 scene.globe.tileLoadProgressEvent / tileset.statistics 等事件与对象。
```

> 快速实操：把 `assets/debug-inject.js` 粘贴到控制台即可一键开启上述开关并输出基线摘要，无需手写。

**tileset 级调试**：

```js
// 瓦片包围体可视化
tileset.debugShowBoundingVolume = true;
tileset.debugShowContentBoundingVolume = true;
// 瓦片染色（相同颜色=同层级，看 LOD 分布）
tileset.debugColorizeTiles = true;
// 统计（重点字段：visited/selected/loadedTiles/commands/requestedTiles）
console.log(tileset.statistics);
// 加载进度
tileset.tileLoadProgressEvent.addEventListener((loaded, total) => {
  console.log(`${loaded}/${total}`);
});
```

**globe（地形/影像）调试**：

```js
viewer.scene.globe.tileLoadProgressEvent.addEventListener((loaded, total) => {
  console.log("globe", loaded, total);
});
// 查看影像层列表与每层状态
console.log(viewer.scene.imageryLayers);
```

**交互式 Inspector 组件**（开发期可挂 UI）：

```js
const inspector = new Cesium.Cesium3DTilesInspector(
  document.getElementById("tilesInspector"), viewer.scene, tileset
);
```

## 2. 性能监控组件（生产期可选，轻量）

```js
// 简单 FPS/帧时间显示
const perf = new Cesium.PerformanceDisplay({
  container: document.getElementById("perfContainer"),
});
viewer.scene.postRender.addEventListener(() => perf.update());

// 卡顿看门狗（检测低帧率并提示）
const watchdog = new Cesium.PerformanceWatchdog({
  container: document.getElementById("watchdogContainer"),
  scene: viewer.scene,
});
```

## 3. 浏览器 DevTools 流程（Chrome 为标准）

### 3.1 主线程 / 帧率（Performance 面板）
1. 打开 DevTools → Performance → 录制 10~20 秒（包含：静止、旋转、缩放、加载完成四段）。
2. 观察：
   - **FPS 曲线**：哪段掉帧；掉帧时伴随什么操作。
   - **主线程长任务**（红色块）：是 scripting（L1）、rendering 还是 painting。
   - **GPU 相关**：Rendering 面板的 GPU 行高不高。
3. 关键判读：
   - 掉帧时主线程空闲、GPU 行高 → L4 GPU 瓶颈。
   - 掉帧时主线程 scripting 满 → L1。
   - 掉帧发生在瓦片加载密集期 → L2/L3。

### 3.2 网络（Network 面板）
- 过滤 XHR/Fetch，看瓦片请求：TTFB、传输大小、是否重复、是否排队（TTS > TTFB 说明被限流）。
- 看 `RequestScheduler` 排队：大量 pending 且 `maximumRequestsPerServer` 达上限 → 调并发或减数据源。
- 看压缩：响应 `Content-Encoding: gzip/br`，`.ktx2`/`.glb` 传输大小。

### 3.3 内存（Memory 面板）
1. 录制堆快照（Heap snapshot）两次，间隔一段操作，对比增长对象。
2. 观察 JS 堆锯齿（GC 频繁）→ L5。
3. GPU 显存：`chrome://gpu` 或 Task Manager（Shift+Esc）看 GPU memory。
4. WebGL 专用：Performance → 勾选 WebGL 相关 track 或使用 WebGL Inspector 扩展。

### 3.4 分层二分定位法（最有用的手法）
以"画面静止"为前提，按开关逐项开/关并记录 FPS：
1. 关阴影（`shadowMap.enabled=false`）→ 若帧率回升，阴影是主因。
2. 关 MSAA（`msaaSamples=0`）→ 若回升，走 FXAA。
3. 降 `resolutionScale=0.5` → 若大幅回升，像素量是主因。
4. 关大气/雾 → 若回升，大气开销主因。
5. 若以上都不影响 → 瓶颈在 CPU/瓦片，转向瓦片参数（tileset-tuning.md）。

## 4. 性能基线的记录模板（每次优化前先填）

| 指标 | 基线值 | 优化后 | 说明 |
|---|---|---|---|
| 静止 FPS | | | 相机不动 5 秒均值 |
| 旋转 FPS | | | 匀速旋转 5 秒最低值 |
| 加载完成时间 | | | 首屏到 `tileLoadProgressEvent` 完成 |
| draw calls（debugShowStatistics） | | | 选中瓦片数×命令数 |
| loadedTiles | | | tileset.statistics.loadedTiles |
| JS 堆峰值 | | | Memory 面板 |
| GPU 显存 | | | chrome://gpu / Task Manager |
| 瓦片请求总数/重复数 | | | Network 面板 |

## 6. 专项排查清单（按症状直接执行）

**A. 首屏白屏久**
1. Network 面板看初始请求：瓦片请求是否大量 pending / 重复 → 是则查 `RequestScheduler.maximumRequestsPerServer` 与并发数据源。
2. 看传输大小与压缩：`.glb` 未压（应 Draco/KTX2）、影像未开 gzip → 数据侧问题（tileset-tuning.md §5）。
3. 看 provider：WMTS/UrlTemplate 直连瓦片优于 WMS；`createWorldImageryAsync` 走 CDN 最快。
4. 看加载进度：`globe.tileLoadProgressEvent` 是否长期不收敛 → 缓存抖动（`cacheBytes`/`maximumMemoryUsage` 过小）。
5. 首屏相机视野过大 → 初始 `camera.setView` 收窄到业务区域。

**B. 转动/缩放掉帧**
1. `debugShowFrustums` 确认剔除生效；`debugShowStatistics` 看 draw calls 是否随视角暴涨。
2. 开 `cullRequestsWhileMoving`、`preloadFlightDestinations`、`skipLevelOfDetail`。
3. 二分法关 MSAA/阴影/大气，定位 GPU 还是 CPU（见 3.4）。
4. 移动端优先查 resolutionScale 与显存。

**C. 长时间运行越来越卡**
1. Memory 面板两次堆快照对比：增长对象是否为 Entity/DataSource/事件监听器 → 检查销毁（`viewer.dataSources.remove()` + `destroy()`，移除 `addEventListener` 回调）。
2. `tileset.statistics.loadedTiles` 是否持续增长 → `maximumMemoryUsage` 淘汰失效。
3. GPU 显存持续攀升 → 纹理未用 KTX2 压缩或瓦片缓存过大。
4. 查 WebGL context lost 事件 → 显存耗尽，`scene.context` 监听 `webglcontextlost`。

## 7. 常见误诊提示

- "FPS 低" 不一定是 GPU：先看主线程是否满（L1 也压 FPS，因为主线程提交帧）。
- "瓦片加载慢" 不一定是网络：先看是否 `maximumMemoryUsage` 太小导致缓存抖动（反复加载同一瓦片）。
- "放大卡" 不一定是数据大：常是 SSE 太低 + 无 `skipLevelOfDetail` 导致瞬间精化爆炸。
- 移动端测试优先，桌面流畅 ≠ 移动端流畅（像素、显存、overdraw 差异最大）。
