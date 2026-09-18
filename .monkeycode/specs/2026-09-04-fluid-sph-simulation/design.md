# 技术设计：SPH 地形流体模拟

## 1. 总览

沿用 `flood-sim-lib`（已有 GPU 流体管线）的自定义 primitive + compute 架构，在其基础上移植 SPH（光滑粒子流体动力学）多缓冲模拟，并复用同一渲染体积盒范式。着色器逻辑参考公开的 Cesium 地形流体 SPH 示例。

数据流（每帧）：
`historyTexture → 粒子重积分(integration) → particleTexture → 粒子物理模拟(simulation) → simulationTexture → 表面平滑(smoothing) → surfaceTexture → 体积渲染(volume)`

其中 `simulation` 同时把结果写入 `historyTexture` 供下一帧积分，形成多缓冲 ping-pong。

## 2. 文件结构

- `src/cases/fluid-sph/heightmap.png`：~~区域高程图（红通道编码归一化高程，1024×1024）~~ **已废弃**——原图含来源昵称水印，V6.5.1 起默认区域与手绘区域一律通过 `terrain-sampler.sampleTerrainHeights` 实时采样真实 Cesium 地形生成 1024×1024 高度画布，不再加载任何静态高度图资产。
- `src/cases/fluid-sph/index.ts`：DemoCard 注册。
- `src/cases/fluid-sph/FluidSphDemo.vue`：场景初始化 + 控制面板 + 水源点选 + 实时地形采样重建（默认区域/框选区域共用 `sampleAndStartSimulation`）。
- `src/cases/fluid-sph-lib/sph-shaders.ts`：SPH 公共 GLSL、各 compute/volume 着色器、几何/矩阵辅助函数。
- `src/cases/fluid-sph-lib/fluid-sph-demo.ts`：`FluidSphDemo` 类，创建 FLOAT 纹理、compute 各 stage 与体积渲染 draw，暴露状态与销毁。
- `src/cases/flood-sim-lib/fluid-demo.ts`：将内部 `CustomPrimitive` 类改为导出，供本案例复用（零行为变更）。

## 3. 关键技术点

### 3.1 compute 缓冲

- 纹理：`PixelFormat.RGBA` + `PixelDatatype.FLOAT`，初始 `Float32Array(w*h*4)`。
- stage 经 `Cesium.ComputeCommand`（`persists: true`）实现，注册为 scene primitive。
- 粒子状态 RGBA 编码：`.x` 用 `packSnorm2x16` 打包局部坐标偏移，`.y` 打包速度，`.zw` 保存质量/分布统计。
- 表面平滑输出 `.x`=水密度（质量高度），`.y`=地形高度，`.w`=总高度（水+地形）。

### 3.2 模拟空间

- 模拟网格为 1024×1024 纹理像素空间；高度场由 `heightMap` 红通道采样。
- 地形梯度用于产生「平坦水面」的切向力；边界用 `sdBox`+`bN` 处理，速度限幅防爆。
- 水源：像素坐标相对水源点距离 < `waterSourceRadius` 时持续累加质量（`waterAddRate`）。

### 3.3 体积渲染

- 单位 Box 几何 + `generateModelMatrix(中心, [90,0,0], [宽,厚,高])` 放置于真实区域。
- 顶点着色器输出相机位置/射线（MC 编码），片元对盒体光线步进：
  - 先步进找地形（`getHeight().x`），再找水面（`getHeight().y`）；
  - 有水像素：浅/深色按水深 `smoothstep`，叠加 Fresnel 天空反射、镜面高光、水下颜色衰减，输出 alpha 混合。

### 3.4 场景

- viewer 复用 `createMapScene` + Bing 底图 + `Cesium World Terrain`；
- `depthTestAgainstTerrain = true`，MSAA 4x、HDR；
- 相机飞向区域（Yosemite，约 -119.51~-119.47E / 37.74~37.80N），俯角约 42°。
- 高度图高程范围 1207.8m ~ 3002.2m 用于计算体积盒厚度与中心高程。

### 3.5 交互

- 点击地图经 `pickPosition` 取世界坐标 → 转归一化坐标（lon/lat 相对 extent）→ 更新水源与标记。
- 参数实时写入 `params`（uniform map 每帧读取）。
- 暂停时停用 integration/simulation/history stage，保留 surface 冻结画面。

## 4. 图标（REQ-1）

- 复制 `df01b465-image-1.webp` 到 `src/cases/water-depth-extraction/icon.webp`；md5 一致。
- `water-depth-extraction/index.ts`：加 `import icon from './icon.webp'` 与 `icon,` 字段；描述文案去除「基于」引导词（改为「通过真实地形采样…」），避免卡片文案命中来源表述禁用词扫描。

## 5. 验证

- `vue-tsc -b` 通过；`npm run build` 通过。
- headless（Playwright + SwiftShader）：
  - 列表页断言两张卡；水深卡有 icon 且 `naturalWidth>0`；SPH 卡无 icon。
  - 打开 SPH 案例，监听页面与 console 错误；断言无 shader/primitive 编译错误。
  - 截图人工复核水流视觉效果与暂停/恢复按钮状态。

## 6. V6.5 增补设计

### 6.1 区域重绘（REQ-4）

- Vue 内把固定 `extent`/高程常量改为可变状态 `simExtent/simMinElevation/simMaxElevation`（默认 Yosemite），归一化水源坐标 `toNormalized` 与相机飞行均读可变状态。
- 预览实体（场景创建时建一次，全程复用）：
  - 填充 `polygon`：`height:0 + heightReference: CLAMP_TO_GROUND + perPositionHeight:false`（沿用 `flood-depth-simulation` 已验证写法）；
  - 描边用独立 `polyline`（`clampToGround:true`、5 点闭合）——地面多边形 `outline` 渲染不可靠，不用。
- 框选流程：第一角点击锚定 `firstCorner` → `MOUSE_MOVE` 用 `normalizedRectangle` 实时 `setValue` 更新 polygon/polyline；第二角点击完成 → 最小边长校验 → 调 `sampleTerrainHeights`（复用 `water-depth-extraction/terrain-sampler.ts`，`cols=256`、`rows=min(512, aspectRows)`）→ 归一化高程生成 1024 canvas（与静态 PNG 同编码：红=归一化高程，row0=北=顶，`imageSmoothingEnabled` 放大）→ 销毁旧 sim → 用 `[west,south,east,north]`/`grid.min/grid.max`/canvas 重建 `FluidSphDemo` + 相机飞行。
- 右键点击或再次点击「绘制区域」取消；「重置」把状态还原默认并重新用静态高度图构建。

### 6.2 平均速度场与流向箭头（REQ-5）

- `SURFACE_SMOOTHING_GLSL` 在邻域求和时同步累加 `P0.V`（质量权重外速度按 `G(0.75*dx)` 权重平均），输出改为
  `vec4(rho/w, hei/w, velX/w, velY/w)`：原 `.w` 总高度在体积渲染中未被消费，安全替换；`.zw` 即归一化平均速度（`Simulation` 已把单粒子速度限幅到 ≤1）。
- `FLUID_VOLUME_GLSL` 新增 `flowVisible` / `arrowRatio`(=盒高/盒宽，使箭头横纵几何近方形) / `arrowCount`(=48) uniform：
  - 均匀切分水面 uv 为箭头网格；每像素在其所属箭头单元局部坐标内，取单元中心 `.zw` 速度：
    - 无水（`.x` 密度过小）或近乎静止（速度长 <1e-3）→ 该单元不画箭头；
    - 否则画「尾杆(距单元内 −0.30→0.12) + 头部 V 形(翼展 ±0.20，尖点 0.40)」，沿速度方向旋转，`smoothstep` 抗锯齿；
  - 在水面命中、水深>阈值的像素叠加 `tc=mix(tc, 亮色, mask*0.85)`，并提升 alpha。
- `FluidSphDemo` 增加 `flowVisible` 字段与 `setFlowVisible()`；volume stage `uniformMap` 增补上述三个 uniform。渲染阶段仅当 `flowVisible>0.5` 才采样箭头函数，默认关闭不影响原视觉效果。
