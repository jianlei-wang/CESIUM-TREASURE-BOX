# Requirements Document

## Introduction

新增三维风场流线案例，基于 Cesium WebGL2 与 GPU 计算实现粒子风场图层，可加载 3D 风场数据（u/v/w 三分量体数据），并支持在自定义四至范围内构造并生成 WindData3D 风场数据、下载与一键加载。案例参考开源仓库 `lby0101/cesium-wind-layer-3d`（MIT 协议）实现。

## Glossary

- **WindData3D**：三维风场数据契约，包含 `u`、`v`、`w` 三个分量数组、网格维度 `nx/ny/nz`、经纬度四至 `bounds` 与高度层级 `levels`。
- **GPU 计算**：通过 Cesium `ComputeCommand` 将粒子位置以纹理形式在 GPU 上迭代更新。
- **流线渲染**：将相邻帧粒子位置连接为线段，以颜色表与速度值着色并做深度遮挡。

## Requirements

### Requirement 1: 案例入口

**User Story:** 作为案例浏览者，我希望在三维特效分类中打开风场流线案例，以便观察真实三维风场的动态流动。

#### Acceptance Criteria

1. THE 系统 SHALL 在三维特效分类中显示"三维风场-WebGL2&GPU效果"案例卡片。
2. WHEN 用户打开风场案例，THE 系统 SHALL 创建 Cesium Viewer、Bing 影像底图，并加载本地 WindData3D 风场数据。
3. WHEN 用户关闭风场案例，THE 系统 SHALL 释放 Viewer、GPU 纹理、计算命令与事件监听。
4. IF 风场数据加载失败，THE 系统 SHALL 显示加载失败提示并保持案例可重试。

### Requirement 2: 自定义四至生成风场数据

**User Story:** 作为案例浏览者，我希望在任意自定义经纬度四至范围内构造 WindData3D 风场数据，以便观察合成风场。

#### Acceptance Criteria

1. THE 系统 SHALL 提供西、南、东、北四至输入项与网格尺寸、层级数配置。
2. WHEN 用户点击生成，THE 系统 SHALL 在给定四至内构造合成风场并生成符合 WindData3D 契约的数据。
3. WHEN 用户点击下载，THE 系统 SHALL 将生成的 WindData3D 序列化为 JSON 文件供本地保存。
4. WHEN 用户点击加载，THE 系统 SHALL 将生成的 WindData3D 渲染到三维场景。

### Requirement 3: 风场渲染与控制

**User Story:** 作为案例浏览者，我希望控制粒子数量、速度、线长、高度与动态开关，以便观察不同风场参数效果。

#### Acceptance Criteria

1. THE 系统 SHALL 提供粒子纹理尺寸、速度因子、线长上限、高度比例与动态开关控制。
2. WHEN 用户调整控制项，THE 系统 SHALL 实时更新风场渲染参数。
3. WHILE 动态开关开启，THE 系统 SHALL 逐帧更新粒子位置与流线。
4. THE 系统 SHALL 支持一键缩放到风场数据范围。

### Requirement 4: 渲染正确性

**User Story:** 作为案例浏览者，我希望风场流线在地形场景中正确遮挡与着色，以便获得符合空间关系的高质量效果。

#### Acceptance Criteria

1. WHILE 风场渲染，THE 系统 SHALL 使用 3D 风纹理采样风矢量并计算粒子位移。
2. WHILE 风场渲染，THE 系统 SHALL 根据速度值映射颜色表并以流线渐变透明度绘制。
3. WHILE 风场渲染，THE 系统 SHALL 与场景深度纹理比较实现地形遮挡。
4. WHILE 相机移动，THE 系统 SHALL 更新可见范围并在粒子越界时重新播种。
