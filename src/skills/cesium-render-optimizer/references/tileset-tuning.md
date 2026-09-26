# 3D Tiles / 地形 / 影像调度与 LOD 调优（CesiumJS 1.144）

瓦片调度是 Cesium 性能的第一战场。本节给出**每个参数的含义、建议起点、代价**，并按场景给出组合方案。

## 1. Cesium3DTileset 核心参数

```js
const tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
  // —— LOD 精化 ——
  maximumScreenSpaceError: 16,        // 默认 16。像素级误差上限
  skipLevelOfDetail: true,            // 允许跳级精化，不必逐级下载
  skipScreenSpaceErrorFactor: 16,     // 跳级时 SSE 倍数余量
  skipLevels: 1,                      // 一次最多跳过的层数
  // —— 内存 ——
  maximumMemoryUsage: 512,            // MB，瓦片 GPU 内存上限（含几何纹理）
  // —— 加载策略 ——
  preloadAncestors: true,             // 先加载祖先瓦片（默认）
  preloadFlightDestinations: true,    // 相机飞行时预加载目的地瓦片
  preloadWhenHidden: false,
  cullRequestsWhileMoving: true,      // 相机移动时暂停非关键请求
  preferLeaves: true,                 // 优先加载叶瓦片（内容更精细）
  tileCacheSize: 100,                 // 显式缓存瓦片数量
  // —— 地平线 ——
  dynamicScreenSpaceError: false,     // 地平线附近降级（大数据集可开）
  dynamicScreenSpaceErrorFactor: 4,
  dynamicScreenSpaceErrorHeightFalloff: 0.25,
});
viewer.scene.primitives.add(tileset);
```

### 参数语义与调法

| 参数 | 调小方向 | 调大方向 | 说明 |
|---|---|---|---|
| `maximumScreenSpaceError` | 越小画质越精细、瓦片越多、内存/请求暴涨 | 越大越省、变糊 | **性能首要旋钮**。4~8 高质量；16 默认均衡；32+ 大范围预览。16 卡顿→先试 32 |
| `skipLevelOfDetail` | 关 → 逐级精化（慢但平滑） | 开 → 跳级精化（快但有瞬间跳变） | 1.144 大数据集强烈建议 true |
| `maximumMemoryUsage` | 越小内存越省、缓存抖动越多 | 越大加载越顺、内存越高 | 与数据集规模匹配；频繁抖动就上调 |
| `cullRequestsWhileMoving` | 关 → 移动时也全量加载 | 开 → 移动时砍请求 | 快速飞行场景开 true 立竿见影 |
| `preferLeaves` | 关 → 按层级优先 | 开 → 优先最细瓦片 | 想看"当前区域高细节"开 true |
| `dynamicScreenSpaceError` | 关 | 开（+factor） | 超大 tileset（城市级）省大量地平线瓦片，注意远处会糊 |

### 运行时动态调整（推荐实践）

```js
// 相机飞行/加载阶段临时放宽 SSE，静止后收紧 —— 兼顾"快速出图"与"最终画质"
tileset.maximumScreenSpaceError = 32;   // 相机移动中（moveStart 回调）
tileset.maximumScreenSpaceError = 8;    // 相机静止后（moveEnd 回调）
```

- 放大看细节时降 SSE（如 8），俯瞰全局时升 SSE（如 64）—— 跟随相机高度做分级：

```js
function adaptSSE() {
  const h = viewer.camera.positionCartographic.height;
  tileset.maximumScreenSpaceError = h > 50000 ? 64 : h > 10000 ? 32 : 8;
}
viewer.camera.moveEnd.addEventListener(adaptSSE);
```

## 2. 地形（Terrain）调优

```js
const terrain = await Cesium.createWorldTerrainAsync({
  requestVertexNormals: true,     // 需要光照/陡坡着色时
  requestWaterMask: false,        // 不需要水面效果时关掉（省流量）
});
viewer.terrainProvider = terrain;
viewer.scene.globe.maximumScreenSpaceError = 2;   // 默认 2，精度高
viewer.scene.globe.tileCacheSize = 100;           // 地形瓦片缓存
viewer.scene.globe.cacheBytes = 536870912;        // 512MB 地形/影像缓存上限
```

- 性能向：`maximumScreenSpaceError = 8~16`、`cacheBytes` 下调。
- 质量向：`maximumScreenSpaceError = 1~2`（近地面细节）；注意与 tileset 的 SSE 配合，地形比模型更细会浪费。
- 高程数据量：大范围高精度地形优先用 Cesium ion quantized-mesh（`CesiumTerrainProvider`），避免 heightmap 大文件。

## 3. 影像（Imagery）调优

```js
const imagery = await Cesium.ImageryLayer.fromProviderAsync(
  Cesium.createWorldImageryAsync({ style: Cesium.IonWorldImageryStyle.AERIAL })
);
viewer.scene.imageryLayers.add(imagery);
// 或者 WMTS（比 WMS 适合切片）：
// const provider = await Cesium.WebMapTileServiceImageryProvider.fromUrl(url, {...});
```

| 参数 | 位置 | 建议 |
|---|---|---|
| 切片层级控制 | `ImageryLayer` 无直接 SSE 参数 | 影像分辨率由 provider 切片层级决定，**不要**靠 `globe.maximumScreenSpaceError` 微调影像 |
| `tileCacheSize` | `viewer.scene.globe.tileCacheSize` | 默认 100；内存紧张下调 |
| 请求量 | `RequestScheduler.maximumRequestsPerServer` | 默认 6；影像+地形+tileset 混合场景可提到 12~18 |
| 层数 | `viewer.scene.imageryLayers.length` | 少叠加影像层；每层都乘瓦片请求 |

- 服务端有 WMTS 优先 WMTS（预切片）；WMS 每帧动态出图慢。
- 本地影像用 `UrlTemplateImageryProvider`（`{z}/{x}/{y}`）直连缓存最快，禁用重投影。
- 影像透明叠加（如自定义栅格）会拖慢绘制：确认 `alpha` 与 `show` 状态。

## 4. 请求调度全局（RequestScheduler）

```js
// 每服务器并发请求上限（默认 6）
Cesium.RequestScheduler.maximumRequestsPerServer = 18;
// 全局并发上限（默认：移动 24 / 桌面 48）
Cesium.RequestScheduler.maximumRequests = 60;
```

- 多数据源（影像+地形+tileset+模型）共享调度器，单一来源请求排队会拖慢全部。
- 提高并发要配服务端能力（HTTP/2、CDN、带宽），否则只是把瓶颈从浏览器移到服务器。

## 5. 数据侧建议（发布前做，收益常大于运行时调参）

- **几何压缩**：glTF/3D Tiles 内容用 Draco 压缩（`KHR_draco_mesh_compression`）；1.143+ 支持 `KHR_meshopt_compression`（v1 attribute codec + COLOR filter），解压更快、压缩比接近。
- **纹理压缩**：转 KTX2/Basis Universal（`KHR_texture_basisu`），Cesium 在 Worker 中转码，显存占用大幅下降。
- **批处理**：多个小模型合成一个（合并 draw call）；大量实例用 glTF instancing（`EXT_mesh_gpu_instancing`）。
- **瓦片粒度**：单瓦片三角形数适中（5 万~20 万量级），太碎增加请求数，太粗精化粒度差。
- **量化**：顶点用 `KHR_mesh_quantization` 半浮点/归一化整数，减体积提速解码。
- **3D Tiles 2.0**（`3DTILES_content_gltf` 等）减少请求层级开销；1.144 已支持多项新扩展（见版本基线）。
- 大模型文件：优先 glTF/glb（可流式），避免 obj/fbx 转换后的低效网格。

## 6. 组合方案示例

| 场景 | 推荐组合 |
|---|---|
| 城市级大场景俯瞰 | SSE 32~64、`skipLevelOfDetail`、`dynamicScreenSpaceError`、`cullRequestsWhileMoving`、`maximumMemoryUsage` 1024+、请求并发 18 |
| 局部高细节展示 | SSE 4~8、`preferLeaves`、`preloadFlightDestinations`、地形 SSE 2 |
| 移动端 | 影像/地形 `tileCacheSize` 下调、SSE 上调、关闭动态阴影与大气、resolutionScale 0.75 |
| 飞行漫游 | `preloadFlightDestinations: true`、移动时 SSE 放宽、静止收紧 |

## 7. 验证指标

改完参数后用 `tileset.statistics` 与 `tileLoadProgressEvent` 复核：

```js
console.log(tileset.statistics);            // visited/selected/loadedTiles/commands
tileset.tileLoadProgressEvent.addEventListener((loaded, total) => {
  if (loaded === total) console.log("全部瓦片就绪");
});
viewer.scene.globe.tileLoadProgressEvent.addEventListener((loaded, total) => {
  // 地形/影像加载进度
});
```

优化目标对照：loaded tiles 数量下降、请求瀑布更平、FPS 稳定、无反复"加载-淘汰"振荡。

**缓存抖动（cache thrash）判定**：Network 里同一瓦片 URL 反复出现（加载→淘汰→再加载），或 `tileset.statistics.loadedTiles` 忽高忽低 → 内存上限与数据量不匹配：上调 `maximumMemoryUsage` / `globe.cacheBytes`，或下调 SSE 减少同时需要的瓦片数。
