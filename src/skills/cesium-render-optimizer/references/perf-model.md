# 五层性能瓶颈模型（CesiumJS 1.144）

Cesium 场景的卡顿/慢/高内存，几乎都能归因到下面五层之一。**先归因、再优化**；跨层误诊是最常见的浪费时间方式（例如把"瓦片太多"误诊为"WebGPU 不够快"）。

## 层次总览

```
┌─────────────────────────────────────────────────────────┐
│ L2 瓦片调度与 LOD（3D Tiles / 地形 / 影像选择与精化）      │ ← 最常见的瓶颈
├─────────────────────────────────────────────────────────┤
│ L1 主线程 CPU（JS 逻辑、Entity 集合、帧循环、数据解析）    │
├─────────────────────────────────────────────────────────┤
│ L3 网络与数据（下载、请求调度、压缩格式、CORS）             │
├─────────────────────────────────────────────────────────┤
│ L4 GPU 渲染（draw call、着色器、分辨率、抗锯齿、剔除）      │
├─────────────────────────────────────────────────────────┤
│ L5 内存与 GC（JS 堆、GPU 显存、缓存淘汰、资源生命周期）     │
└─────────────────────────────────────────────────────────┘
```

## L1 主线程 CPU

**症状**：相机转动/交互时主线程长任务（Chrome Performance 中红色块）；点击、拖拽无响应；CPU 占用高而 GPU 空闲；Entity 动画/大量独立对象时逐帧卡。

**诊断**：DevTools Performance 录制，看主线程 scripting/painting 占比；`debugShowStatistics` 看每帧 JS 计算量；检查是否有每帧 `new` 对象、`Cesium.Cartesian3.fromDegrees` 高频调用、`entity.position` 每帧写入。

**常见成因与手段**（Entity/大数据量细节见 entity-batching.md）：
- 数千个独立 `Entity`（尤其 Billboard/Label/Point）→ 改用 `BillboardCollection` / `PointPrimitiveCollection` / `LabelCollection`（一次性批量更新，GPU instancing）。
- 每帧创建/销毁 Primitive 或修改大量属性 → 改为批量、离散更新；静态内容用 `scene.primitives` 一次性添加。
- 高帧率但主线程饱和 → 用 `requestRenderMode` + `maximumRenderTimeChange` 降低无谓渲染（见 viewer-config.md）。
- 大数据解析在主线程 → 确认使用 Cesium 异步加载 API（`fromUrlAsync` 系列），Draco/Basis 解码天然在 Worker（见 rendering-backends.md）。
- 相机动画/时钟每帧触发大量回调 → 降低 `maximumFrameTime`、限制 clock tick 回调数量。

## L2 瓦片调度与 LOD（最高频瓶颈）

**症状**：飞行/缩放时瓦片一层层出现；转动时停顿；放大瞬间卡顿；远看糊近看突然精化；瓦片永远加载不完（cache thrash）。

**诊断**：`tileset.statistics`（visited/selected/loaded tiles 数）、`tileLoadProgressEvent`、`scene.debugShowFrustums` 看哪些瓦片在视野内却被加载/剔除；`Cesium3DTilesInspector` 的 tileset 面板看 SSE 实际值；Network 看瓦片请求是否重复。

**常见成因与手段**（参数细节见 tileset-tuning.md）：
- SSE 太低导致过度精化（瓦片暴涨）→ 调 `maximumScreenSpaceError`；观察内存与请求数再降值。
- 无 `skipLevelOfDetail`，精化必须逐级下载 → 开启 skip 系列参数加速跳级精化。
- 相机快速移动时旧请求挤占带宽 → `cullRequestsWhileMoving`、`preloadFlightDestinations`、`preferLeaves`。
- 内存上限太小导致缓存抖动（loaded 数忽高忽低）→ `maximumMemoryUsage` / `cacheBytes` 与数据量匹配。
- 地平线附近瓦片浪费 → `dynamicScreenSpaceError` 系列。

## L3 网络与数据

**症状**：加载慢、白屏久；Network 里大量 pending/重复请求；瓦片转圈；移动网络下更严重。

**诊断**：Network 瀑布看 TTFB、传输大小、是否重复请求；看瓦片响应 Content-Encoding（gzip/br）；`RequestScheduler` 是否有排队（`maximumRequestsPerServer` 默认 6）。

**常见成因与手段**：
- 几何未压缩 → 服务端或发布端启用 Draco（`KHR_draco_mesh_compression`）；1.143 起支持 `KHR_meshopt_compression`。
- 纹理未压缩 → 转 KTX2/Basis Universal（`KHR_texture_basisu`），Cesium 内置 transcoder 在 Worker 中解码。
- 服务器并发上限低 → `RequestScheduler.maximumRequestsPerServer` 调大（如 18），或升级 HTTP/2 + CDN。
- 未启用 gzip/brotli → 静态资源开启压缩；glTF 建议服务端压缩。
- 影像 provider 选择不当 → `WebMapTileServiceImageryProvider`（WMTS）比 WMS 更适合切片缓存；`UrlTemplateImageryProvider` 直连瓦片 URL 最快。
- CORS/混合内容导致请求失败重试 → 检查响应头与 https。

## L4 GPU 渲染

**症状**：静止画面帧率低；GPU 占用高（`chrome://gpu` / Task Manager）；旋转视角变化大时帧率波动；着色器编译卡顿（首次出现某材质时掉帧）。

**诊断**：`debugShowStatistics` 看 draw call 数量（drawCommands）与渲染状态切换；`debugShowCommands` 高亮每帧命令；`debugShowDepthFrustum` 检查深度分割；关闭 MSAA/阴影逐项对比帧率（二分法定位）。

**常见成因与手段**：
- 分辨率过高 → `viewer.resolutionScale` / `useBrowserRecommendedResolution`；移动端降采样收益最大。
- MSAA 开销大 → `msaaSamples = 4 → 0` 配 FXAA（`fxaa = true`）或后处理 TAA 权衡。
- 阴影贴图开销 → 动态阴影调低 `shadowMap.size`、`maximumDistance`，或静态烘焙。
- 半透明对象过多 → 减少 overdraw；避免大面积半透明叠加。
- 高精度深度问题（闪烁/摩尔纹）→ `logarithmicDepthBuffer = true`（1.144 默认在部分情况下可用，检查 `Scene.logarithmicDepthBuffer` 实际状态）。
- 远处细节浪费 → 视野受限应用（小范围场景）用 `camera.frustum.near/far` 收紧可视范围；远处瓦片细节用 `tileset.maximumScreenSpaceError` 与 SSE 控制即可，不要依赖未验证的剔除开关。

**注意**：1.144 是 WebGL2 渲染器；WebGPU 不是可用优化手段（见 rendering-backends.md）。

## L5 内存与 GC

**症状**：长时间运行后越来越卡；频繁 GC 停顿（Performance 里 sawtooth 内存曲线）；崩溃/黑屏（WebGL context lost）；移动端标签页被杀。

**诊断**：Memory 面板记录 JS 堆快照对比；`chrome://gpu` 看 GPU 显存；检查 tileset `loadedTiles` 数量是否持续增长；关闭页面看是否泄漏。

**常见成因与手段**：
- 瓦片缓存无上限或过大 → `tileset.maximumMemoryUsage`（默认 512MB）、`globe.cacheBytes`（地形/影像，默认 536870912）。
- 反复添加/移除数据源未销毁 → `viewer.dataSources.remove(dataSource)` 后调用 `destroy()`；Entity 集合清空。
- 影像层大量切换 → 限制 `imageryProvider` 数量，或 `globe.imageryLayers` 控制层数与 `tileCacheSize`。
- 纹理/几何解压后常驻 → 确认压缩格式（KTX2）减少显存，用后移除。
- 长任务 GC → 减少每帧分配（对象复用、`scratch` 变量模式）。

## 跨层组合判断

- "加载快但转动卡" → 多为 L2 调度 + L1 主线程，不是 L3 网络。
- "一直模糊不清" → L2 SSE 过高或 L3 请求排队。
- "画质好但帧率低" → L4，先降像素比/关 MSAA 验证。
- "玩一会开始卡" → L5，先看缓存与 GC。
- 真机/移动端差异大 → 优先查显存（L5）与分辨率（L4），移动 GPU 对 overdraw 更敏感。
