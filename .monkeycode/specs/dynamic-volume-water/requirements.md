# Requirements Document

## Introduction

新增 1 个三维特效动态体积水案例：指定多边形或矩形构建真实几何起伏的动态水面。水面基于自定义 `Cesium.Primitive` + GLSL 顶点/片元着色器实现（顶点着色器做几何位移，片元着色器做泡沫/菲涅尔/反射/高光），支持地图绘制或坐标文本指定多边形，以及完整的水面参数实时调节。

## Glossary

- **几何位移**：顶点着色器根据分形噪声高度沿法线方向移动顶点，形成真实的波浪体积起伏。
- **动态体积水**：相对于平面贴图水面，几何顶点随波浪位移产生真实起伏的水面效果。
- **范围模式**：水面覆盖区域类型（polygon 多边形 / rectangle 矩形）。
- **指定多边形**：通过地图点击绘制或坐标文本输入的方式确定水面的多边形边界。
- **meshSegments**：网格分段数，控制水面网格顶点密度。

## Requirements

### Requirement 1: 动态体积水案例卡片

**User Story:** 作为用户，我希望在三维特效分类中看到动态体积水案例入口。

#### Acceptance Criteria

1. THE 系统 SHALL 在三维特效分类中显示"水面效果-动态体积水"案例卡片。
2. THE 系统 SHALL 在案例卡片未提供截图时显示"暂无截图"占位。
3. WHEN 用户点击卡片，THE 系统 SHALL 进入完整案例页面并初始化地图。

### Requirement 2: 默认水面渲染

**User Story:** 作为用户，我希望进入案例后立即看到动态体积水效果。

#### Acceptance Criteria

1. WHEN 案例打开，THE 系统 SHALL 默认加载 Cesium World Terrain（`depthTestAgainstTerrain=true`、`maximumScreenSpaceError=2`），并显示「正在加载Cesium World Terrain...」提示，加载失败时降级为椭球仍渲染水面。
2. THE 系统 SHALL 在默认多边形（丽江水域边界，`LIJIANG_WATER_POSITIONS`）区域构建并渲染动态体积水面。
2. THE 系统 SHALL 使用顶点着色器对网格顶点做几何位移，产生真实波浪起伏。
3. THE 系统 SHALL 使用片元着色器渲染泡沫、菲涅尔反射、天空反射、太阳高光与深浅水色渐变。
4. WHEN 波浪动画开关开启，THE 系统 SHALL 随时间更新水面波浪（时间缩放可调）。
5. WHEN 案例关闭，THE 系统 SHALL 释放 Primitive、事件处理器与 Viewer。

### Requirement 3: 指定多边形构建水面

**User Story:** 作为用户，我希望通过地图绘制或坐标输入指定水面多边形范围。

#### Acceptance Criteria

1. THE 系统 SHALL 支持坐标文本输入（`经度,纬度;经度,纬度;...`，≥3 点）并应用为水面多边形。
2. WHILE 地图绘制模式下，THE 系统 SHALL 支持左键采集顶点、右键或双击结束，并绘制顶点与闭合预览线。
3. WHEN 多边形应用成功，THE 系统 SHALL 重建水面网格并飞入视角，显示成功提示。
4. WHEN 顶点不足 3 个，THE 系统 SHALL 提示"多边形顶点不足"。
5. WHEN 坐标格式错误，THE 系统 SHALL 提示格式错误。
6. WHEN 地图绘制结束，THE 系统 SHALL 将采集节点的弧度坐标转换为度数（`×180/π`）后写入坐标文本，确保节点坐标为正确经纬度。
7. THE 系统 SHALL 不在面板中提供「重置默认多边形」「重建水面」「复位视角」按钮（重建通过网格分段/矩形尺寸滑块触发，视角复位随重建/切换自动执行）。

### Requirement 4: 矩形模式与范围参数

**User Story:** 作为用户，我希望以矩形方式构建水面并调整其位置尺寸。

#### Acceptance Criteria

1. THE 系统 SHALL 支持范围模式切换为矩形，并按中心经纬度、宽度、深度、高度构建水面。
2. WHEN 中心经纬度或高度变更，THE 系统 SHALL 仅更新位置（modelMatrix）而不重建几何。
3. WHEN 宽度/深度/网格分段变更，THE 系统 SHALL 重建水面网格并飞入视角。

### Requirement 5: 水面参数实时调节

**User Story:** 作为用户，我希望实时调节水面外观与运动参数。

#### Acceptance Criteria

1. THE 系统 SHALL 提供运动参数：时间缩放、流速、波密度、波高、几何高度、Choppy。
2. THE 系统 SHALL 提供外观参数：泡沫、法线强度、菲涅尔、高光、透明度、深水色、浅水色、泡沫色。
3. WHEN 任一运动/外观参数变更，THE 系统 SHALL 实时更新着色器 uniform。
4. WHEN 动画开关关闭，THE 系统 SHALL 冻结波浪时间。
