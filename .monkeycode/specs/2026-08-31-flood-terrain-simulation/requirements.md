# Requirements Document

## Introduction

本迭代包含两项需求：(1) 为现有「洪水淹没模拟」案例增加真实地形数据支撑；(2) 新增「深度图提取 + 洪水模拟一体化」案例——用户手动绘制范围生成深度图、选择出水点后执行 GPU 洪水模拟，并支持各类参数设定。

现状基础：

- `flood-inundation`（V6.0）：固定使用 1024×1024 深度图映射到西藏那曲固定四至，GPU 双缓冲流体模拟 + 光线步进水渲染；场景未加载 Cesium World Terrain，深度图与真实地形无关联。
- `rectangle-depth-map`（V5.x）：支持输入四至或框选矩形范围，`sampleTerrainMostDetailed` 采样真实地形高度生成 PNG/TIFF 深度图，可叠加显示。

## Glossary

- **深度图**：将地形高程归一化到 0~255 灰阶后形成的图像，本系统中亦指模拟使用的 heightMap 纹理数据。
- **四至（EXTENT）**：模拟/采样范围 `[west, south, east, north]` 经纬度边界。
- **出水点（水源点）**：洪水持续涌入的归一化 UV 坐标（0~1），通过点击地图拾取。
- **水闸**：用户点击地图两点建立的挡水墙，归一化 UV 线段 + 归一化高度。
- **GPU 双缓冲流体模拟**：4 张 FLOAT 纹理 A~D 存 `(terrainElevation, waterDepth)` 与四方向 OutFlow，两个计算 pass 交替 ping-pong 更新。

---

## Requirements

### 需求 A：洪水淹没模拟案例增加地形数据

**User Story:** 作为 GIS 分析用户，我希望能看到洪水模拟结果与真实 Cesium World Terrain 地形叠加对照，以便判断模拟区域在真实地理空间的相对位置与地形起伏。

#### Acceptance Criteria

1. WHEN 用户打开「洪水淹没模拟」案例，系统 SHALL 与其他案例一致加载 Cesium World Terrain 全球地形与 Bing 影像底图，并将相机飞行至固定模拟四至范围。
2. WHEN 深度图模拟盒体在地图场景中渲染，系统 SHALL 保持盒体四至与真实地形对应区域在空间上重合，形成深度图盒体与真实地形叠加对照视图。
3. IF 地形加载失败（Cesium Ion 服务间歇性故障），系统 SHALL 降级为椭球面继续初始化场景，并继续提供模拟功能。
4. 模拟内核（shader、FluidDemo/CustomPrimitive、固定四至与深度图）SHALL 保持现有实现不变，仅增强场景初始化环节。

### 需求 B：新增「深度图提取 + 洪水模拟」一体化案例

**User Story:** 作为用户，我希望能任意框选或输入一个地理范围，由系统采样真实地形生成深度图，然后直接在原地选择出水点并执行洪水模拟，全程支持参数调节，而不必依赖预先准备的静态深度图文件。

#### Requirement B1：范围输入与深度图生成

1. WHEN 用户打开案例，系统 SHALL 加载 Cesium World Terrain 并支持两种范围输入方式：输入西/东/南/北四至经纬度、或在地图上框选矩形范围。
2. WHEN 范围确定后点击生成，系统 SHALL 按用户选择的分辨率（128/256/512/1024，默认 256）用 `sampleTerrainMostDetailed` 采样范围内真实地形高度。
3. WHEN 采样完成，系统 SHALL 将高程归一化生成深度图（含预览与下载 PNG/TIFF）与纹理数据，供模拟阶段直接使用（按比例适配至模拟纹理分辨率），并在地图上叠加显示采样范围。
4. WHEN 深度图生成成功，系统 SHALL 显示采样统计（分辨率、采样点数、最小/最大高程）。

#### Requirement B2：出水点选择与模拟执行

1. WHEN 深度图生成完成且用户点击地图某处，系统 SHALL 将点击位置归一化为出水点 UV 坐标，并用红色标记显示。
2. WHEN 用户点击「开始模拟」，系统 SHALL 使用刚生成的深度图作为 heightMap，按用户设定的高程区间构建渲染盒体并启动 GPU 双缓冲流体模拟。
3. WHEN 模拟运行中，系统 SHALL 提供停止模拟、重置出水点、以及重新生成深度图的操作入口。

#### Requirement B3：参数设定

1. WHEN 模拟运行或停止时，系统 SHALL 提供以下可调参数：水流增加速率、水源半径、衰减、强度扰动、最小水流、初始水位、光线步进次数、蒸发率、水流透明度、浅/深水色、水闸开关与水闸高度。
2. WHEN 用户调整流体参数，系统 SHALL 在运行中实时生效；WHEN 用户调整初始水位或高程区间，系统 SHALL 提示并重建模拟使其生效。
3. WHEN 用户启用「绘制水闸」并依次点击地图两点，系统 SHALL 建立挡水墙（竖直墙 + 归一化高度），并在模拟 shader 中抬高对应区域地形。

### 需求 C：案例注册与集成

1. WHEN 两个案例完成开发，系统 SHALL 将新增案例注册到 `src/cases/index.ts` 分类列表（新增案例归入 `water` 分类，tag 为「流体模拟」）。
2. WHEN 案例构建，系统 SHALL 通过 `npm run build`（vue-tsc + vite）类型检查与打包，构建退出码为 0。
3. IF 抽取公共模拟内核（shader + FluidDemo/CustomPrimitive 类）供两案例复用，系统 SHALL 保持既有 `flood-inundation` 案例行为不回归。

---

## Test Strategy

- 构建验证：`npm run build` 退出码 0。
- 无头 SwiftShader 验证：首页定位新案例卡片 → 打开 → 面板可见 → 生成深度图（状态读取）→ 开始模拟无 JS/GL 错误（模拟启动状态正确）。
- 既有案例回归：`flood-inundation` 打开、启动模拟、无 JS 错误。
- 性能说明：4 个 1024×1024 RGBA32F compute pass + 光线步进在 SwiftShader 下帧率极低（软件渲染固有极限），动画效果以真实 GPU 浏览器验收。
