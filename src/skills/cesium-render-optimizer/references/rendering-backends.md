# WebGL2 / WebGPU / Worker / Wasm 技术定位（CesiumJS 1.144）

用户提到"WebGPU、Wasm、Worker 是不是 Cesium 性能关键"这类问题时读取本节。**先给事实，再给结论，避免被技术名词带偏优化方向。**

## 事实基线（已核实，截至 1.144）

| 技术 | CesiumJS 1.144 中的状态 | 作用 |
|---|---|---|
| **WebGL2** | 默认渲染后端（1.102 起默认 WebGL2；WebGL1 仅回退） | GPU 绘制、着色、光栅化的唯一正式通道 |
| **WebGPU** | **主线无正式后端**。官方 roadmap（2025-06）列为"长期探索的图形 API 代际升级"；Cesium for Unity Web 通过社区贡献实验性使用 WebGPU；CesiumJS 本体 1.144 不可用 | 未来可能的渲染后端，当前**不是**优化手段 |
| **Web Worker** | 内置 `TaskProcessor` 体系，数据解码/预处理默认在 Worker 中执行 | 防止主线程阻塞；**Cesium 既定机制，无需用户配置** |
| **WebAssembly** | Draco 解码（`KHR_draco_mesh_compression`）、Basis Universal/KTX2 纹理转码等均为 Wasm 实现，在 Worker 内运行；1.143 起新增 `KHR_meshopt_compression` 解码 | CPU 侧高速解码/几何处理 |

## 三者与"渲染性能"的真实关系

- **Worker**：解决"主线程不卡"，不直接提升 GPU 帧率。没有它，瓦片/模型解码会阻塞交互。CesiumJS 内部已默认使用——**用户能做的**是：不要用 CSP/CORS 配置误禁 Worker 与 Wasm，不要关掉 `TaskProcessor`，不要把大数据解析塞回主线程。
- **Wasm**：加速 CPU 解码（Draco/Basis/meshopt），缩短"下载→入 GPU"的管线时间，间接减少白屏与卡顿。用户能做的：**发布数据时启用压缩格式**（见 tileset-tuning.md 数据侧建议），让 Wasm 解码器有活可干。
- **WebGPU**：理论上减少驱动开销、支持计算着色器与更好的资源管理，但 **1.144 没有可用后端**，不要作为优化选项；关注官方 roadmap 与实验分支即可。

## 正确姿势：把技术名词翻译成行动

用户说"想用 WebGPU 优化" → 回应：1.144 主线无 WebGPU 后端，但你的瓶颈十有八九在瓦片调度/数据量/分辨率，按以下路径收益更大：
1. 先诊断（debugging.md），确认瓶颈层。
2. 若是 GPU 瓶颈：调 resolutionScale / MSAA / 阴影 / overdraw（viewer-config.md）。
3. 若是加载/解码瓶颈：启用 Draco/Basis/KTX2 压缩（数据侧），确认 Worker/Wasm 未被禁用（见下）。
4. 若确需 WebGPU：说明官方状态与实验分支风险，不建议生产使用。

用户说"要不要上 Wasm 加速" → 回应：CesiumJS 已内置 Wasm 解码器（Draco/Basis/meshopt），无需自行集成；你要做的是**让数据用上这些压缩格式**。

用户说"Worker 能不能提速" → 回应：Worker 防阻塞而非提帧率；确认浏览器未禁用 Worker（CSP `worker-src`），大数据解析走 Cesium 异步 API 即可。

## 验证 Worker / Wasm 是否正常工作

```js
// 1) 确认 TaskProcessor 数量（应有 worker 运行）
console.log(Cesium.TaskProcessor.maximumActiveTasks);   // 默认 5

// 2) 确认 Draco 解码启用（网络面板搜 draco_wasm / wasm 资源是否加载）
// 3) 确认 Basis/KTX2 转码（网络面板搜 basis_transcoder）
// 4) 检查 CSP 响应头是否允许 wasm-unsafe-eval / blob:
//    Content-Security-Policy: script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:
```

常见踩坑：
- 服务器对 `text/javascript` 的 `.wasm` MIME 配错 → 解码失败回退慢路径。
- CSP 过严禁用 `wasm-unsafe-eval` → Cesium 内置 Wasm 模块加载失败。
- 强跨域（Cross-Origin-Embedder-Policy）配置影响 SharedArrayBuffer —— 1.144 主要用非共享内存，一般无碍，但多线程 Wasm（如 meshopt 多线程）受限时自动降级。
- 自行引入的第三方库在主线程做重计算（如坐标转换循环）→ 移入自定义 Worker。

## 关于 Cesium Native / Cesium for Unity 的澄清

- 官方 roadmap 计划"用 Cesium Native (C++/Wasm) 统一 3D Tiles 遍历算法"，是**未来方向**，1.144 未落地。
- Cesium for Unity Web（实验性）使用 WebGPU 是**另一产品线**，与 CesiumJS 1.144 无关，不要混淆。

## 一句话结论模板

> "对 CesiumJS 1.144：Worker 与 Wasm 是内置的数据解码加速机制（Draco/Basis 压缩格式收益最大）；WebGPU 尚无正式后端，不是可选优化项；真正的性能大头是 3D Tiles 调度、SSE、数据压缩与渲染负载，按 perf-model 分层优化。"

## 版本与 API 核实（避免给出不存在的参数）

- 确认用户版本：`console.log(Cesium.VERSION)`。
- 官方 API 文档：`https://cesium.com/learn/cesiumjs/ref-doc/`（按类名检索，如 `Cesium3DTileset.html`、`Globe.html`、`Scene.html`）。
- 本地依赖最快：在 `node_modules/@cesium/engine/Source/**/*.js` 中搜索参数名，确认属性存在与默认值。
- 跨小版本差异：以"属性存在性"为准，必要时查 GitHub Releases 的 CHANGES.md。
