# Requirements Document

## Introduction

为 Cesium 案例中心增加动态多边形水面案例。案例根据输入的经纬度多边形边界生成动态水面，并提供波浪参数与边界更新控制。

## Glossary

- **水面边界**：由至少三个经纬度点构成的闭合多边形范围。
- **动态水面**：具有时间驱动波纹、反射、高光和泡沫的多边形材质。
- **波高**：控制材质表面法线与波纹起伏的数值。

## Requirements

### Requirement 1: 案例入口

**User Story:** 作为案例浏览者，我希望打开动态水面案例，以便查看多边形区域上的水面效果。

#### Acceptance Criteria

1. THE 系统 SHALL 在三维特效分类中显示“水面效果-动态多边形”案例卡片。
2. WHEN 用户打开案例，THE 系统 SHALL 创建 Cesium Viewer、天地图影像和默认水面多边形。
3. WHEN 用户关闭案例，THE 系统 SHALL 释放 Viewer、实体和帧更新监听器。

### Requirement 2: 水面表现

**User Story:** 作为案例浏览者，我希望水面具有动态波纹和光照层次，以便识别水域边界与水体运动。

#### Acceptance Criteria

1. WHILE 水面效果开启，THE 系统 SHALL 使用时间驱动水面波纹。
2. WHILE 水面效果开启，THE 系统 SHALL 合成水体颜色、天空反射、高光和泡沫细节。
3. WHEN 用户关闭水面效果，THE 系统 SHALL 隐藏水面多边形。

### Requirement 3: 参数与边界

**User Story:** 作为案例浏览者，我希望调整水面参数并输入边界坐标，以便生成指定范围的水面。

#### Acceptance Criteria

1. THE 系统 SHALL 提供流速、波纹、波高和清澈度控制。
2. WHEN 用户调整水面参数，THE 系统 SHALL 更新材质 uniform。
3. WHEN 用户提交三个或更多有效经纬度坐标，THE 系统 SHALL 更新水面多边形边界。
4. IF 用户提交的坐标少于三个或包含无效数值，THE 系统 SHALL 显示边界格式说明。
