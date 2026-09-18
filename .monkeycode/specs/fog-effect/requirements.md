# Requirements Document

## Introduction

将 Cesium 雾案例改造为基于深度纹理、相机高度和世界坐标的线性高度雾，用于展示远景雾与近地雾的空间关系。

## Glossary

- **深度雾**：随相机到场景像素距离增加而增强的雾。
- **高度雾**：在设定海拔范围内增强的近地雾。
- **雾浓度**：控制高度雾积分结果的数值。
- **雾高**：控制近地雾积分上限的海拔高度。

## Requirements

### Requirement 1: 案例入口

**User Story:** 作为案例浏览者，我希望在三维特效分类中打开雾效案例，以便观察动态场景雾。

#### Acceptance Criteria

1. THE 系统 SHALL 在三维特效分类中显示“天气特效-深度高度雾”案例卡片。
2. WHEN 用户打开雾效案例，THE 系统 SHALL 创建 Cesium Viewer、Bing 影像和 Cesium World Terrain 地形。
3. WHEN 用户关闭雾效案例，THE 系统 SHALL 释放 Viewer 和后处理阶段。
4. IF Cesium World Terrain 加载失败，THE 系统 SHALL 显示地形加载状态并继续使用基础地球显示雾效案例。

### Requirement 2: 雾效控制

**User Story:** 作为案例浏览者，我希望控制雾的浓度、范围和高度，以便观察不同大气条件。

#### Acceptance Criteria

1. THE 系统 SHALL 提供雾效果开启和关闭控制。
2. WHEN 用户调整雾浓度，THE 系统 SHALL 更新线性高度雾积分强度。
3. WHEN 用户调整雾高度，THE 系统 SHALL 更新近地雾的高度衰减范围。
4. WHEN 用户调整场景亮度，THE 系统 SHALL 更新场景与雾颜色的整体亮度。

### Requirement 3: 渲染表现

**User Story:** 作为案例浏览者，我希望雾效具有远景加深、近地聚集和缓慢变化的雾团，以便获得自然的大气透视效果。

#### Acceptance Criteria

1. WHILE 雾效果开启，THE 系统 SHALL 使用深度纹理恢复场景像素的世界坐标。
2. WHILE 雾效果开启，THE 系统 SHALL 使用相机位置和世界坐标计算像素高程。
3. WHILE 雾效果开启，THE 系统 SHALL 使用相机高度和雾高执行线性高度雾积分。

### Requirement 4: 拖动稳定性

**User Story:** 作为案例浏览者，我希望拖动地图时雾效保持稳定，以便连续观察地形和雾层关系。

#### Acceptance Criteria

1. WHEN 用户拖动或旋转地图，THE 系统 SHALL 持续显示稳定的地形和雾层合成结果。
2. WHEN 地形瓦片发生细节级别切换，THE 系统 SHALL 根据当前深度纹理重新计算雾量。
