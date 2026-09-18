# Requirements Document

## Introduction

为 Cesium 案例中心移植 Arc3DLab-SDK-Pro 参考项目中的 glTF/GLB 模型查看器案例。用户可加载远程 URL 或本地文件（含文件夹）的 glTF/GLB 模型，并对模型位置、旋转、缩放、外观、光照、动画与相机进行控制，便于在三维地球上检视任意 glTF 资源。案例复用公共场景初始化（Bing 影像、Viewer 生命周期管理），卡片 icon 使用案例运行截图（image-1），右侧控制面板样式与案例中心其他案例的「深蓝玻璃」控制面板保持一致。

## Glossary

- **glTF**：Khronos 定义的 3D 传输格式（.gltf JSON + 外部缓冲/纹理，或 .glb 二进制容器）。
- **Model.fromGltfAsync**：CesiumJS 1.144 提供的 glTF 异步加载接口，返回 `Model` 图元。
- **包围盒 / 线框 / 轮廓**：模型调试显示（`debugShowBoundingVolume`/`debugWireframe`）与轮廓高亮（`silhouetteColor`/`silhouetteSize`）。

## Requirements

### Requirement 1: 案例卡片

**User Story:** 作为案例浏览者，我希望在案例中心看到并打开 glTF/GLB 模型查看器案例。

#### Acceptance Criteria

1. THE 系统 SHALL 在三维数据加载分类中显示「glTF/GLB 模型查看器」案例卡片，卡片缩略图为案例运行截图（icon.webp，上传的 image-1，1235×647）。
2. WHEN 用户点击卡片，THE 系统 SHALL 打开完整案例页并创建 Cesium Viewer 与 Bing 影像底图。

### Requirement 2: 远程模型加载

**User Story:** 作为用户，我希望通过 URL 加载在线 glTF/GLB 模型。

#### Acceptance Criteria

1. WHEN 用户在地址输入框填入 .glb/.gltf URL 并点击加载，THE 系统 SHALL 调用 `Model.fromGltfAsync` 异步加载模型并添加到场景。
2. WHEN 加载成功，THE 系统 SHALL 更新模型信息面板（文件名/类型/位置/比例）并应用当前外观与位置参数。
3. WHEN 加载失败，THE 系统 SHALL 显示失败原因提示并保持可重试状态。

### Requirement 3: 本地文件与文件夹加载

**User Story:** 作为用户，我希望把本地 glTF/GLB 文件（可能带同目录 .bin/纹理资源）拖入或选择后加载。

#### Acceptance Criteria

1. THE 系统 SHALL 支持点击选择与拖拽上传 .glb/.gltf 文件。
2. THE 系统 SHALL 支持通过 `webkitdirectory` 选择整个模型文件夹，或拖入文件夹并递归遍历其内容。
3. WHEN 加载 .gltf 文本模型，THE 系统 SHALL 将其 JSON 内的 buffer/纹理 uri 重写为对应文件的内容 blob URL 后加载，避免本地 fetch 失败。
4. WHEN 所选文件不含 .glb/.gltf，THE 系统 SHALL 提示选择有效的模型文件。

### Requirement 4: 变换控制

**User Story:** 作为用户，我希望调整模型在地球上的位置与姿态。

#### Acceptance Criteria

1. THE 系统 SHALL 提供经度/纬度/高度输入以更新模型位置（`Transforms.headingPitchRollToFixedFrame`）。
2. THE 系统 SHALL 提供航向/俯仰/翻滚滑杆实时更新模型姿态。
3. THE 系统 SHALL 提供统一缩放滑杆与 X/Y/Z 分轴缩放，并支持锁定统一缩放开关。

### Requirement 5: 外观与渲染控制

**User Story:** 作为用户，我希望切换模型的调试与渲染效果。

#### Acceptance Criteria

1. THE 系统 SHALL 提供包围盒显示、线框模式、轮廓高亮、阴影与透明度/色调滑杆与取色器。
2. WHEN 开启阴影，THE 系统 SHALL 使用固定方向 `DirectionalLight` 与 `shadowMap` 以保证不受时钟影响；关闭后还原 `SunLight`。
3. THE 系统 SHALL 提供日照光照开关（`globe.enableLighting`）。

### Requirement 6: 动画与视角

**User Story:** 作为用户，我希望让模型自动旋转并定位到模型，按需开启地形。

#### Acceptance Criteria

1. THE 系统 SHALL 提供自动旋转开关与转速滑杆，基于 `requestAnimationFrame` 累加航向角并重建模型矩阵（禁止在 `viewer.clock.onTick` 内逐帧改写矩阵，避免破坏当帧视锥剔除状态）。
2. THE 系统 SHALL 提供「定位到模型」按钮，相机飞向模型当前位置。
3. THE 系统 SHALL 提供地形开关（Cesium World Terrain / 椭球表面切换）与参数重置、模型移除按钮。

### Requirement 7: 控制面板样式

**User Story:** 作为用户，我希望案例右侧控制面板与其他案例视觉一致。

#### Acceptance Criteria

1. THE 系统 SHALL 将右侧控制面板呈现为右上角 compact 浮卡（深蓝半透明玻璃质感、圆角、轻投影、内容区纵向滚动）。
2. THE 系统 SHALL 使用与案例中心一致的色彩 token（面板底、文字、分组小标题、主色/输入框/按钮），不含渐变标题栏等特制外观。
3. THE 系统 SHALL 不提供快捷位置（八城市）切换按钮。
