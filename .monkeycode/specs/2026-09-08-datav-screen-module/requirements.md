# Requirements Document

Feature: datav-screen-module（可视化大屏模块）
Updated: 2026-09-08

## Introduction

Cesium 案例中心新增「可视化大屏」功能模块，参考 GitHub 仓库 knight-L/sc-datav（React 19 + @react-three/fiber + ECharts 的三维地图可视化大屏工程）。模块代码、数据与素材须独立管理以便后续独立迭代。仓库中 4 个大屏 demo（demo0~demo3）各对应新增一个案例。用户决策：技术路线采用「原生 Three.js 命令式重写为 Vue」，不引入 React 双框架；模块置于独立 `src/datav/` 子树并在 `src/cases/` 下放 4 个桥接壳案例注册；案例不生成专属 icon（留空）；进入大屏后全屏沉浸式呈现。

## Glossary

- **案例中心**：本 Vue 3 + Cesium 项目，按目录自动注册、打开案例时异步加载对应 chunk。
- **可视化大屏模块（datav 模块）**：`src/datav/` 子树，容纳大屏相关全部代码、共享工具、数据与素材，与 Cesium 现有 `src/cases`/`src/lib` 目录解耦。
- **桥接壳案例**：位于 `src/cases/datav-*`，仅承担注册与懒加载桥接，不含大屏实现。
- **参考工程**：knight-L/sc-datav，React 19 + Three.js(@react-three/fiber/drei/postprocessing) + ECharts，含 demo0~demo3 四个大屏。
- **大屏全屏态**：打开案例后占据整个案例舞台区，左上角提供返回列表操作。
- **DemoCard**：案例注册对象（id/title/category/description/tag/icon/component/updatedAt）。
- **sync**：`npm run sync`（scripts/sync-cases.mjs），扫描 `src/cases/` 下含 index.ts 且不以 `-lib` 结尾的目录生成 `src/cases/manifest.ts`。

## Requirements

### Requirement 1：分类导航新增「可视化大屏」

**User Story:** AS 案例中心访问者, I want 功能导航中出现「可视化大屏」分类, so that 能统一进入大屏案例列表。

#### Acceptance Criteria

1. WHEN 案例中心首页加载，功能导航 SHALL 展示 id 为 `datav`、标签为「可视化大屏」的分类项，并带导航图标。
2. WHEN 点击「可视化大屏」分类，案例列表 SHALL 仅展示该分类下的 4 个大屏案例卡片。
3. WHEN 列表处于其他分类再切回该分类，案例展示 SHALL 保持既有分类筛选行为一致。

### Requirement 2：独立模块管理

**User Story:** AS 模块维护者, I want datav 模块代码/数据/素材集中于独立目录, so that 后续迭代不与 Cesium 案例相互干扰。

#### Acceptance Criteria

1. datav 模块的工程代码 SHALL 全部位于 `src/datav/`（含共享引擎、四屏实现、样式）。
2. datav 数据与素材 SHALL 位于 `src/datav/` 之下（四川 GeoJSON、轮廓数据、热力数据、贴图、HDR、GLB 模型等），随模块单独存放。
3. `src/cases/` 下 SHALL 仅存在 4 个轻量桥接壳案例目录，其中 SHALL NOT 包含大屏业务代码（即壳只引用 `src/datav/` 的实现）。
4. 新增大屏屏体或素材 SHALL 不需要改动 `src/lib/` 与既有 Cesium 共享库。

### Requirement 3：参考仓库 demo 到案例的一一对应

**User Story:** AS 案例中心访问者, I want 打开大屏分类后能看到参考工程四个大屏对应的四个案例, so that 每个案例独立进入。

#### Acceptance Criteria

1. 参考工程 demo0 SHALL 对应一个案例（id 前缀 `datav-`，标题含可辨识名，进入后复现 demo0 三维四川地图大屏：轮廓/飞线/扫光/网格/星空与侧边面板图表）。
2. 参考工程 demo1 SHALL 对应一个案例（进入后复现 demo1 大屏：地图城市柱条/热力/云雾/标签/提示与 6 图表面板）。
3. 参考工程 demo2 SHALL 对应一个案例（进入后复现 demo2 大屏：光束/锥体/流光拖尾/镜像/轮廓边界地图与 6 图表面板）。
4. 参考工程 demo3 SHALL 对应一个案例（进入后复现 demo3：风机 GLB 模型 HDR 环境展台 + Bloom 后期 + 无限网格地面 + 自动环绕视角）。
5. 4 个案例的 description/tag 字段 SHALL 提炼各自大屏特征，便于列表识别。

### Requirement 4：案例不生成专属 icon

**User Story:** AS 用户, I want 大屏案例卡片无专属图片, so that 减少素材维护。

#### Acceptance Criteria

1. 4 个大屏案例的 DemoCard SHALL NOT 声明 `icon` 字段。
2. 首页案例列表对无 icon 案例 SHALL 以既有「无图占位」样式展示，SHALL NOT 出现资源 404 或报错。

### Requirement 5：全屏沉浸式大屏

**User Story:** AS 案例中心访问者, I want 点击大屏案例后获得全屏沉浸式 dataV 体验, so that 视觉完整呈现。

#### Acceptance Criteria

1. WHEN 打开任一大屏案例，大屏 SHALL 铺满案例舞台全区域（无页内滚动）。
2. 大屏按 1920×1080 设计稿等比缩放适配实际舞台尺寸（缩放系数随容器尺寸变化实时更新），缩放后中心对齐。
3. 大屏视觉上 SHALL 提供返回列表操作，复用案例中心既有全屏返回机制。
4. 大屏内交互（视角旋转/缩放等）SHALL 与参考工程对齐（对应 demo 的 OrbitControls 参数）。

### Requirement 6：与首页解耦、异步加载

**User Story:** AS 案例中心访问者, I want 大屏资源不拖累首页, so that 首屏体验不受新增模块影响。

#### Acceptance Criteria

1. 首页与案例列表 SHALL 不发起 `src/datav/` 相关代码与资源请求（除无 icon 卡片展示外）。
2. 打开大屏案例时 SHALL 才异步加载对应大屏 chunk、Three.js 依赖与本地素材。
3. 大屏关闭并返回列表后 SHALL 清理 Three.js 场景、canvas、图表实例与动画帧，释放 GPU 与内存。

### Requirement 7：观感与交互对齐参考工程

**User Story:** AS 用户, I want 移植后大屏观感贴近参考工程, so that 效果可验收。

#### Acceptance Criteria

1. 每屏色彩基调、地图形态、动画效果 SHALL 以参考工程对应 demo 为准（可微调色值以适配暗色大屏，不偏离整体视觉）。
2. 图表（ECharts）标题、指标项与主题色 SHALL 对齐参考工程各 panel。
3. 参考工程若含地图自转/扫光/柱条生长/数字滚动等动态，移植版 SHALL 保留同等动态。
4. 数据 SHALL 全部本地内置（不依赖外网 GeoJSON/瓦片/字体/贴图），离线可完整运行。

### Requirement 8：移植正确性与健壮性

**User Story:** AS 维护者, I want 每个大屏可被自动冒烟验证, so that 回归可控。

#### Acceptance Criteria

1. 每个大屏 SHALL 在构建与冒烟中无 console error/pageerror，WebGL canvas 正常渲染（非空像素）。
2. WHEN WebGL 不可用或素材加载失败，大屏 SHALL 展示错误提示而非白屏崩溃。
3. 构建产物中 4 个大屏及其素材 SHALL 以独立异步 chunk 输出，首页入口不包含大屏代码。
