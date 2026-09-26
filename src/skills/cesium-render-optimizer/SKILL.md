---
name: cesium-render-optimizer
description: CesiumJS（1.144 及相近 1.14x 版本）Web 三维地图的渲染效果与性能优化专家。当用户开发 Cesium 地图/三维地球应用并出现以下任一情况时使用：(1) 性能问题——场景卡顿、掉帧、帧率低、加载白屏久、瓦片加载慢/闪烁/转圈、内存或显存占用过高、长时间运行变卡崩溃、WebGL context lost；(2) 数据量问题——Entity 数量过大、海量点/线/面/标注渲染卡、3D Tiles 调度与 LOD 调优、地形/影像加载优化、瓦片缓存抖动；(3) 渲染质量——抗锯齿、阴影、光照、贴地遮挡、色调、HDR、闪烁摩尔纹修复；(4) 技术选型——WebGL2/WebGPU/Web Worker/WebAssembly 定位与配置、渲染后端切换、requestRenderMode 按需渲染；(5) 初始化与调参——Viewer/Scene 初始化配置、性能基线与 Profiling（debugShowFramesPerSecond、debugShowStatistics、Cesium3DTilesInspector、Chrome DevTools）。任何"如何让 Cesium 更流畅/画质更好/内存更小"的诉求均使用本 Skill。
---

# CesiumJS 渲染效果与性能优化

以"分层诊断 → 针对性优化 → 量化验证"的方式提升 CesiumJS 1.144 及相近版本（1.14x 系列）地图场景的渲染效果与性能。不做泛泛建议，按瓶颈层给出可执行参数与代码，并强制先建基线、后改参数。

## 文件结构（先知道有什么）

```
cesium-render-optimizer/
├── SKILL.md                          # 本文件：工作流、速查表、纪律、导航
├── references/
│   ├── perf-model.md                 # 五层瓶颈模型（症状归因）
│   ├── viewer-config.md              # Viewer/Scene 质量向与性能向配置
│   ├── tileset-tuning.md             # 3D Tiles/地形/影像调度与 LOD 调优
│   ├── rendering-backends.md         # WebGL2/WebGPU/Worker/Wasm 技术定位
│   ├── debugging.md                  # 性能基线、调试工具、Profiling、专项排查清单
│   └── entity-batching.md            # Entity/大数据量点线面渲染优化
└── assets/
    ├── perf-config.js                # 三档完整可复制初始化模板（质量/性能/调试）
    └── debug-inject.js               # 一键注入调试开关与基线采集的脚本
```

## 版本基线（必须先对齐）

- 目标版本：**CesiumJS 1.144（2026-08-01 发布）**，兼容 1.140~1.145。
- 渲染后端事实：1.102 起默认 WebGL2 上下文；1.144 以 **WebGL2** 为主，WebGL1 仅回退。**WebGPU 在 CesiumJS 主线仍为实验性/未来规划，1.144 没有可用的正式 WebGPU 渲染后端**——不要向用户推荐"切 WebGPU"作为 1.144 的优化手段。
- 若用户实际版本不是 1.144，先按用户声明的版本处理；给出关键 API 前，按"核实 API"一节确认该版本存在对应参数。

## 核心工作流：诊断 → 定位 → 优化 → 验证

**第 0 步：先量化，再动手。** 任何优化前先建立性能基线，禁止在没有测量依据时批量改参数。

1. **建立基线**：读 `references/debugging.md`，用 Cesium 内置调试工具 + 浏览器 DevTools 采集：FPS、每帧耗时、瓦片加载状态、JS 堆内存、GPU 显存、网络请求瀑布。可直接在控制台执行 `assets/debug-inject.js` 快速采集。
2. **定位瓶颈层**：对照 `references/perf-model.md` 的五层模型（主线程 CPU / 瓦片调度 LOD / 网络与数据 / GPU 渲染 / 内存与 GC），把症状匹配到具体层。多数场景卡顿是瓦片调度与数据问题，而不是渲染后端问题。
3. **分层优化**：按瓶颈层打开对应参考文件实施：
   - 场景初始化与渲染质量配置 → `references/viewer-config.md`
   - 3D Tiles / 地形 / 影像调度 → `references/tileset-tuning.md`
   - Entity / 大数据量点线面 → `references/entity-batching.md`
   - WebGL2 / WebGPU / Worker / Wasm 技术定位 → `references/rendering-backends.md`
   - 性能调试与 Profiling → `references/debugging.md`
   - 需要完整可复制代码 → `assets/perf-config.js`（高质量档 / 高性能档 / 调试档三套模板）
4. **验证回归**：改完后用与第 1 步相同的手段重测，对比优化前后 FPS、瓦片数、内存、加载时间。**每次只改一个变量**，改多个参数后无法归因。

## 快速诊断决策树（从症状到动作，30 秒定位）

```
用户描述症状
├─ 静止画面帧率低 → 先关 MSAA / 降 resolutionScale 二分验证 → L4 GPU（perf-model.md）
├─ 转动/缩放时掉帧、停下恢复 → debugShowFrustums + SSE/预加载 → L2 调度（tileset-tuning.md）
├─ 白屏久 / 瓦片慢慢变糊 → Network 瀑布 + 压缩格式 → L3 网络（tileset-tuning.md §5）
├─ 放大瞬间卡一下 → skipLevelOfDetail + SSE → L2（tileset-tuning.md）
├─ 长时间运行越来越卡 / 崩溃 → JS 堆 + 缓存淘汰 → L5 内存（perf-model.md L5）
├─ 拖动时主线程卡死无响应 → 大 Entity 集合 / 同步解析 → L1（entity-batching.md）
├─ 画质差（锯齿/闪烁/穿地） → 对数深度 + MSAA/FXAA + 贴地测试 → 质量向（viewer-config.md）
└─ 点/线/面/标注数量大 → Entity → 集合类（entity-batching.md）
```

## 症状 → 瓶颈层速查表

| 症状 | 最可能瓶颈层 | 首先做 |
|---|---|---|
| 静止画面帧率低 | GPU 渲染 / 主线程 | 检查 `debugShowStatistics` 中 draw call 与渲染状态数；降像素比、关 MSAA |
| 相机转动时掉帧、转动停止后恢复 | 瓦片调度 / 主线程 | 开 `debugShowFrustums` 看视锥；调 SSE、预加载参数 |
| 瓦片慢慢变糊/白屏慢慢清晰 | 网络与数据 / 瓦片调度 | 看 Network 瀑布与 `tileLoadProgressEvent`；检查压缩、请求调度、CORS |
| 长时间运行越来越卡、崩溃 | 内存与 GC | 看 JS 堆与 GPU 内存曲线；检查缓存淘汰与 Entity 销毁 |
| 放大瞬间卡一下 | 瓦片调度（精化瞬间） | 调 `maximumScreenSpaceError`、`preloadFlightDestinations`、`skipLevelOfDetail` |
| 拖动/缩放时主线程卡死无响应 | 主线程 CPU | 检查大 Entity 集合、同步数据解析；确认 Worker 未被禁用（`entity-batching.md`） |
| 画质差（锯齿/闪烁/阴影错/穿地） | 渲染质量 | 读 `references/viewer-config.md` 质量档；对数深度、MSAA/FXAA、depthTestAgainstTerrain |
| 加载首屏白屏久 | 网络与数据 | 检查初始瓦片数量、影像 provider 选择、压缩格式 |

## 优化优先级（默认顺序，除非诊断另有指向）

1. **瓦片与数据策略**（收益最大）：SSE、缓存、预加载、压缩（Draco/Basis/KTX2）、请求调度。
2. **渲染负载**：像素比、MSAA/FXAA、阴影、frustum 剔除、对数深度缓冲。
3. **主线程**：Entity 数量与集合使用（`entity-batching.md`）、数据加载移到 Worker、避免每帧重建对象。
4. **网络**：CDN/HTTP2、压缩、瓦片服务器并发上限。
5. **内存**：缓存上限、销毁生命周期、纹理压缩。

## 必须遵守的纪律

- **不迷信技术名词**：WebGPU / Wasm / Worker 不是万能优化开关。先按 `references/rendering-backends.md` 核实事实再谈方案；对 1.144，Worker 与 Wasm 是数据解码的既定机制（Draco/Basis 转码），WebGPU 不是可用手段。
- **不改默认值除非有依据**：如 `maximumScreenSpaceError` 默认 16，降低提高质量但增加瓦片与内存压力；所有改动说明收益与代价。
- **不重复造轮子**：Cesium 内置调试工具已覆盖大部分诊断需求，先用内置工具（`debugging.md`）。
- **区分"效果"与"性能"诉求**：用户说"渲染效果"时指视觉质量（抗锯齿、光照、贴地、色调），用户说"性能"时指帧率、加载、内存；先明确诉求再给方案，模板同时提供两档。
- **给出可运行代码**：所有建议附最小可运行代码片段或指向 `assets/perf-config.js` / `assets/debug-inject.js` 的对应模板，不空谈参数名。
- **核实 API 再交付**：本 Skill 代码以 1.144 为基准，但个别参数可能随小版本变动；交付关键 API 前按下方方法确认（参考 `rendering-backends.md` 末尾的核实流程）。
- **验证后才能交付**：每项优化说明预期收益、验证方式（指标）、回退方式。

## 核实 API（避免给出不存在的参数）

1. 查官方 API 文档：`https://cesium.com/learn/cesiumjs/ref-doc/`（按类名检索，如 `Cesium3DTileset.html`、`Globe.html`、`Scene.html`）。
2. 查本地依赖（最快）：项目 `node_modules/@cesium/engine/Source/**/*.js` 中搜索参数名，确认属性存在与默认值。
3. 运行时验证：`console.log(Cesium.VERSION)` 确认版本；对不确定的属性直接打印 `viewer.scene.globe.enableLighting` 看是否为 `undefined`。
4. 版本差异：跨小版本（如 1.140 与 1.144）的参数以"存在性"为准，必要时查 GitHub Releases 的 CHANGES.md。

## 参考文件导航

| 文件 | 何时读取 |
|---|---|
| `references/perf-model.md` | 需要理解五层瓶颈模型、把症状归因到层时 |
| `references/viewer-config.md` | 配置 Viewer/Scene 渲染质量与性能、调初始参数时 |
| `references/tileset-tuning.md` | 调 3D Tiles / 地形 / 影像加载与 LOD 时 |
| `references/entity-batching.md` | Entity 数量过大、海量点线面标注、主线程卡顿时 |
| `references/rendering-backends.md` | 用户问到 WebGL/WebGPU/Worker/Wasm 或渲染后端时 |
| `references/debugging.md` | 建立性能基线、调试工具使用、Profiling、专项排查时 |
| `assets/perf-config.js` | 需要完整可复制的初始化配置模板时 |
| `assets/debug-inject.js` | 需要快速注入调试开关、采集基线指标时 |
