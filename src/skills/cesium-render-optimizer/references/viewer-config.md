# Viewer / Scene 渲染质量与性能配置（CesiumJS 1.144）

场景初始化的配置决定"画质基线"与"性能基线"。本节按**质量向**与**性能向**两档给出参数，并解释每个参数的代价。完整可复制模板见 `assets/perf-config.js`。

## 基础：Viewer 构造选项

```js
const viewer = new Cesium.Viewer("cesiumContainer", {
  // —— 视觉 ——
  baseLayer: Cesium.ImageryLayer.fromProviderAsync(
    Cesium.createWorldImageryAsync({ style: Cesium.IonWorldImageryStyle.AERIAL })  // 或 AERIAL_WITH_LABELS
  ),
  sceneMode: Cesium.SceneMode.SCENE3D,
  // —— 控件（按需裁剪，控件也耗性能与 UI 杂乱）——
  animation: false, timeline: false, baseLayerPicker: false,
  geocoder: false, homeButton: false, sceneModePicker: false,
  navigationHelpButton: false, fullscreenButton: false, infoBox: false,
  // —— 渲染 ——
  msaaSamples: 4,            // 质量档；性能档改 0 并开 FXAA
  fxaa: false,               // 质量档不开（MSAA 已够）；性能档 true
  requestRenderMode: true,   // 静态场景强烈建议；动态场景 false
  maximumRenderTimeChange: Infinity,
  contextOptions: { webgl: { antialias: true, powerPreference: "high-performance" } },
});
```

关键取舍：
- `baseLayer` 用 `fromProviderAsync`（1.104+ 异步 API），不要用已弃用的 `imageryProvider`/`createWorldImagery`。
- `powerPreference: "high-performance"` 在双显卡设备上避免被分配到集显。
- 控件全部关闭能省掉不必要的 DOM 更新与 picking。

## 质量向参数（提升"渲染效果"）

| 参数 | 建议值 | 效果 / 代价 |
|---|---|---|
| `viewer.scene.logarithmicDepthBuffer` | `true` | 消除远处闪烁、摩尔纹、z-fighting；1.144 多数设备支持，代价为少量 GPU 开销。**精度问题首选** |
| `viewer.scene.globe.depthTestAgainstTerrain` | `true` | 模型/标注正确被地形遮挡，消除"穿地"；代价少量深度测试开销 |
| `msaaSamples` | 4（最高 8） | 几何抗锯齿；代价显著（移动端谨慎） |
| `fxaa` | 与 MSAA 二选一 | 后处理抗锯齿，代价小、效果弱于 MSAA |
| `viewer.scene.highDynamicRange` | `true` | HDR 输出，高光/暗部细节更好；需浏览器与色调映射支持，开启后注意对比 `scene.highDynamicRange` 前后色彩表现 |
| `viewer.scene.fog` / `skyAtmosphere` | 默认 | 大气散射观感；`skyAtmosphere.show` 可关以提速 |
| `viewer.scene.globe.showGroundAtmosphere` | `true` | 大气辉光 |
| `viewer.scene.globe.enableLighting` | `true`（白天） | 地形受光着色（需地形带法线 `requestVertexNormals`）；夜间建议关闭以看影像。**注意是 `enableLighting`，不是 `lighting`** |
| `viewer.scene.globe.terrainExaggeration` | 1~2 | 地形起伏强调，纯观感 |
| `viewer.scene.sun.show` / `moon.show` | 默认 | 光源体显示 |
| `viewer.scene.shadowMap.enabled` | `true`（需要动态阴影时） | 阴影质量好但开销大；`size=1024~2048`、`maximumDistance` 限制范围 |
| `viewer.scene.postProcessStages` | Bloom/AmbientOcclusion | 按需启用（如 `scene.postProcessStages.bloom.enabled = true`）；`AmbientOcclusion` 开销大，移动端禁用 |
| `viewer.scene.screenSpaceCameraController.minimumZoomDistance` | 按业务 | 避免无限拉近产生精度抖动 |

**质量配置的顺序**：先对数深度 + 贴地深度测试（修正最常见的闪烁/穿地），再 MSAA/FXAA，再 HDR/大气/阴影（按 GPU 余量逐步加）。

## 性能向参数（提升流畅度/帧率）

| 参数 | 建议值 | 效果 / 代价 |
|---|---|---|
| `viewer.resolutionScale` | 0.75~1（移动端 0.5~0.75） | 渲染分辨率缩放，**帧率收益最大**；代价为清晰度 |
| `viewer.useBrowserRecommendedResolution` | `true`（高 DPI 屏） | 自动适配 devicePixelRatio；追求帧率时可关掉并手动 `resolutionScale` |
| `msaaSamples` | 0 | 省 GPU 像素带宽 |
| `fxaa` | `true` | 用廉价 AA 替代 MSAA |
| `viewer.scene.requestRenderMode` | `true` | **静态/低交互场景首选**：无变化不重绘，大幅降 CPU/GPU 占用；动态场景（动画/时钟/流数据）保持 false |
| `maximumRenderTimeChange` | `Infinity`（配 requestRenderMode） | 时钟变化不强制重绘 |
| `viewer.scene.shadowMap.enabled` | `false` | 关闭动态阴影 |
| `viewer.scene.fog.enabled` / `skyAtmosphere.show` | `false` | 关闭大气层计算 |
| `viewer.scene.globe.showGroundAtmosphere` | `false` | 同上 |
| `viewer.scene.globe.maximumScreenSpaceError` | 2（默认） | 地形分辨率；**调大到 4~16** 显著减少地形瓦片 |
| `viewer.scene.camera.frustum.near/far` | 按业务收紧 | 例：`camera.frustum.near = 1; camera.frustum.far = 50000;` 小范围场景收紧可视范围，减少深度精度压力与远处无效绘制 |
| `viewer.scene.globe.tileCacheSize` | 默认 100 | 地形/影像缓存瓦片数，降低则省内存（可能回加载） |
| `viewer.scene.screenSpaceCameraController.inertiaSpin` 等 | 按需 | 降低交互惯性可减少连续帧开销（次要） |
| `viewer.clock.shouldAnimate` | 按需 | 无动画需求时 false |

**性能配置的顺序**：先 `requestRenderMode` + `resolutionScale`（收益最大），再关 MSAA/阴影/大气，再调地形与瓦片参数。

## 像素比与分辨率（最容易忽略的大头）

- 高 DPI 屏幕默认按 `devicePixelRatio` 渲染（如 2x），像素量是逻辑分辨率的 4 倍。
- 性能向：`viewer.useBrowserRecommendedResolution = false; viewer.resolutionScale = 0.75;`
- 质量向：保持推荐分辨率，或 `resolutionScale = 1.5` 超采样。
- 改分辨率后必须用 `viewer.scene.requestRender()`（若 requestRenderMode）触发一次重绘验证。

## 常用陷阱

- `requestRenderMode: true` 时忘记在数据更新后调用 `viewer.scene.requestRender()` → 场景"卡住不刷新"。
- 同时开 `msaaSamples>0` 与 `fxaa=true` → 双重 AA 浪费性能，二者取一。
- `logarithmicDepthBuffer` 在部分旧显卡驱动有精度问题 → 出问题时回退 false 并改用近远面收紧。
- 动态阴影 + 大范围场景 → 阴影贴图覆盖不足或开销爆炸，先限定 `maximumDistance`。
- 改 `sceneMode` 到 2D/Columbus 后部分效果参数（大气/阴影）行为不同，注意验证。
