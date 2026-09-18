# Requirements Document

## Introduction

新增 1 个「数据分析-热力图」案例：根据数据动态生成 Canvas 密度热力图，支持数据动态切换（多场景数据 + 随机重新生成）与各类参数设置（热力半径、透明度、模糊度、分辨率、色带、固定数据范围）。参考实现为用户上传样例（`643cebfc-long-input-20260827-060304.txt`，leaflet.heat/h337 + setCesiumHeatmap）。

## Glossary

- **热力图（Heatmap）**：用径向渐变圆叠加强度 + 按色带映射颜色的密度可视化，数据点密集/值高处以暖色突出。
- **数据场景**：预置的多套模拟数据（北京多中心 / 上海沿江带状 / 广州环形 / 成都核心聚集）。
- **色带**：强度到颜色的映射表（蓝绿黄红 / 热成像 / 黑红黄白 / 紫青黄）。
- **shadow 强度图**：未着色前的灰度强度 canvas，alpha 通道表示热度累积。

## Requirements

### Requirement 1: 热力图案例卡片

**User Story:** 作为用户，我希望在数据可视化分类中看到热力图案例入口。

#### Acceptance Criteria

1. THE 系统 SHALL 在数据可视化分类中显示"数据分析-热力图"案例卡片，tag 为「数据可视化」。
2. THE 系统 SHALL 使用用户上传 image-1（`3365da2a-image-1.webp`）作为卡片 icon。
3. WHEN 用户点击卡片，THE 系统 SHALL 进入完整案例页面并初始化地图。

### Requirement 2: 数据动态切换

**User Story:** 作为用户，我希望切换不同数据并重新生成随机数据。

#### Acceptance Criteria

1. THE 系统 SHALL 提供数据场景下拉选择（至少 4 套内置场景）。
2. WHEN 场景切换，THE 系统 SHALL 重新生成对应区域热力图并更新相机范围（`camera.flyTo` 飞往新场景 bounds 中心）。
3. THE 系统 SHALL 提供"随机生成"按钮，用新随机种子重新生成当前场景数据并重绘热力图，过程中不得闪现加载遮罩或闪烁帧。
4. THE 系统 SHALL 显示当前场景标签与数据点数。

### Requirement 3: 热力图渲染参数

**User Story:** 作为用户，我希望调节热力图渲染参数。

#### Acceptance Criteria

1. THE 系统 SHALL 支持调节热力半径（15~160）、最大透明度（0.2~1）、最小透明度（0~0.5）、模糊度（0.2~1）、画布宽度（400~2000）。
2. WHEN 任一渲染参数变更，THE 系统 SHALL 重绘热力图。
3. THE 系统 SHALL 支持色带切换（至少 4 套）并显示对应渐变图例。
4. THE 系统 SHALL 支持固定数据范围开关，开启后按用户指定的 min/max 渲染（关闭时用数据实际范围）。
5. THE 系统 SHALL 支持相机自适应半径开关：开启后随相机高度线性调整热力半径（默认关闭时保持固定）。

### Requirement 4: 热力图叠加渲染

**User Story:** 作为用户，我希望热力图正确叠加在影像底图上。

#### Acceptance Criteria

1. THE 系统 SHALL 将热力 canvas 以贴图形式叠加在数据区域矩形上，保留 alpha 透明度（`transparent: true`，避免黑底）。
2. WHEN 案例关闭，THE 系统 SHALL 移除热力 entity 并释放 Viewer。
