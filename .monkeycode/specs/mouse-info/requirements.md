# Requirements Document

## Introduction

为 Cesium 案例中心增加"常用工具-鼠标位置"案例。案例实时显示鼠标指向位置的经纬度、海拔高度，以及当前地图缩放层级和比例尺。

## Glossary

- **鼠标位置**：鼠标指针在场景中的像素坐标。
- **地面点**：鼠标拾取射线与地球表面的交点。
- **海拔高度**：地面点相对 WGS84 椭球面的高度。
- **缩放层级**：根据相机高度估算的 Web Mercator 层级编号。
- **比例尺**：屏幕图上 1 厘米对应的实际地面距离。

## Requirements

### Requirement 1: 案例入口

**User Story:** 作为案例浏览者，我希望打开鼠标位置案例，以便实时读取地图坐标与比例信息。

#### Acceptance Criteria

1. THE 系统 SHALL 在常用工具分类中显示"鼠标位置"案例卡片。
2. WHEN 用户打开案例，THE 系统 SHALL 创建 Cesium Viewer、Bing 影像和默认视角。
3. WHEN 用户关闭案例，THE 系统 SHALL 释放 Viewer 和鼠标移动事件监听器。

### Requirement 2: 鼠标经纬度与海拔

**User Story:** 作为案例浏览者，我希望看到鼠标所指位置的经纬度与海拔高度。

#### Acceptance Criteria

1. WHEN 鼠标在场景中移动，THE 系统 SHALL 通过拾取射线计算鼠标位置对应的地面点。
2. WHEN 地面点存在，THE 系统 SHALL 展示该点的经度与纬度。
3. WHEN 地面点存在，THE 系统 SHALL 优先通过场景深度拾取获取海拔高度。
4. IF 深度拾取不可用或未命中地形，THE 系统 SHALL 回退使用椭球面高度。
5. IF 鼠标未命中地表，THE 系统 SHALL 保持最近一次有效读数。

### Requirement 3: 缩放层级与比例尺

**User Story:** 作为案例浏览者，我希望了解当前地图的缩放层级和比例尺。

#### Acceptance Criteria

1. WHILE 案例运行，THE 系统 SHALL 根据相机高度估算当前 Web Mercator 缩放层级。
2. WHILE 案例运行，THE 系统 SHALL 计算屏幕图上 1 厘米对应的实际地面距离。
3. WHEN 相机高度或朝向发生变化，THE 系统 SHALL 更新缩放层级与比例尺数值。
4. THE 系统 SHALL 以米或千米为合适单位格式化比例尺文本。
