# Requirements Document

## Introduction

新增 1 个「数据分析-三维热力图」案例：根据数据动态生成三维热力网格地形，支持网格（LINES 线框）与面状（TRIANGLES）形式切换、数据动态切换（多场景数据 + 随机重新生成）与各类参数设置（热力半径、模糊度、网格分辨率、高度倍率、基准高度、透明度、色带、固定数据范围）。参考实现为用户上传样例（`b9526954-long-input-20260827-060413.txt`，h337 + 采样构建高度网格）。

## Glossary

- **三维热力图**：用热力强度作为高度、色带作为颜色构建的三维网格地形。
- **网格形式**：以 LINES 线框渲染网格边线；**面状形式**：以 TRIANGLES 渲染连续三角面。
- **热力分辨率**：内部热力 canvas 边长（决定强度/颜色采样精细度）。
- **网格分辨率**：三维网格每边顶点数（决定地形平滑度）。

## Requirements

### Requirement 1: 三维热力图案例卡片

**User Story:** 作为用户，我希望在三维特效分类中看到三维热力图案例入口。

#### Acceptance Criteria

1. THE 系统 SHALL 在三维特效分类中显示"数据分析-三维热力图"案例卡片，tag 为「三维数据」。
2. THE 系统 SHALL 使用用户上传 image-2（`84938388-image-2.webp`）作为卡片 icon。
3. WHEN 用户点击卡片，THE 系统 SHALL 进入完整案例页面并初始化地图。

### Requirement 2: 网格与面状形式切换

**User Story:** 作为用户，我希望切换三维热力图的网格与面状显示形式。

#### Acceptance Criteria

1. THE 系统 SHALL 提供「面状」与「网格」两个形态按钮。
2. WHEN 切换为面状，THE 系统 SHALL 以 TRIANGLES 渲染连续三角面。
3. WHEN 切换为网格，THE 系统 SHALL 以 LINES 渲染行/列网格线框。

### Requirement 3: 数据动态切换

**User Story:** 作为用户，我希望切换不同数据并重新生成随机数据。

#### Acceptance Criteria

1. THE 系统 SHALL 提供数据场景下拉选择（至少 4 套内置场景）。
2. WHEN 场景切换，THE 系统 SHALL 重新构建三维网格并更新相机范围（`camera.flyTo` 飞往新场景中心，保持斜视角）。
3. THE 系统 SHALL 提供"随机生成"按钮，用新随机种子重新生成当前场景数据并重建网格，过程中不得闪现加载遮罩或闪烁帧。
4. THE 系统 SHALL 显示当前场景标签、数据点数与数据范围。

### Requirement 4: 三维渲染参数

**User Story:** 作为用户，我希望调节三维热力图的渲染参数。

#### Acceptance Criteria

1. THE 系统 SHALL 支持调节热力半径（15~120）、模糊度（0.2~1）、网格分辨率（20~120）、热力分辨率（100~400）、高度倍率（200~8000，默认 3000）、基准高度（0~2000）、透明度（0.2~1）。
2. WHEN 任一渲染参数变更，THE 系统 SHALL 重建三维网格。
3. THE 系统 SHALL 支持色带切换（至少 4 套）并显示对应渐变图例。
4. THE 系统 SHALL 支持固定数据范围开关，开启后按用户指定的 min/max 渲染。
5. THE 系统 SHALL 显示网格顶点数（分辨率²）。
6. THE 系统 SHALL 以斜视角（俯角约 42°）呈现三维网格，使高度起伏清晰可见。

### Requirement 5: 三维网格渲染

**User Story:** 作为用户，我希望三维热力网格正确贴合数据区域并凸起显示热度。

#### Acceptance Criteria

1. THE 系统 SHALL 按每顶点热力强度计算高度（`intensity × heightScale + baseElevation`）并着色。
2. THE 系统 SHALL 保持网格透明度（颜色 alpha 乘整体透明度）。
3. WHEN 案例关闭，THE 系统 SHALL 移除网格 Primitive 并释放 Viewer。
