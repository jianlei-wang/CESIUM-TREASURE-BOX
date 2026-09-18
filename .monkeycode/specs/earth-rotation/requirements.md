# Requirements Document

## Introduction

为 Cesium 案例中心移植 Arc3DLab-SDK-Pro 参考项目中的「地球自转」案例：加载 CZML 卫星轨道数据，并提供地球自转开关与速度控制，以自转视角浏览场景。

## Glossary

- **地球自转**：基于 ICRF 惯性系矩阵驱动相机围绕地球旋转。
- **CZML**：Cesium 的时序化场景描述格式，用于表达卫星轨道等动态实体。

## Requirements

### Requirement 1: 案例入口

**User Story:** 作为案例浏览者，我希望打开"地球自转"案例，以便浏览卫星轨道与地表。

#### Acceptance Criteria

1. THE 系统 SHALL 在常用工具分类中显示"地球自转"案例卡片。
2. WHEN 用户打开案例，THE 系统 SHALL 创建 Cesium Viewer、Bing 影像并加载 CZML 卫星轨道数据。
3. THE 系统 SHALL 清除加载状态提示。

### Requirement 2: 自转控制

**User Story:** 作为案例浏览者，我希望开启地球自转并调节速度，以便以不同速度观察场景。

#### Acceptance Criteria

1. THE 系统 SHALL 提供自转开关。
2. WHEN 用户开启自转，THE 系统 SHALL 基于 ICRF 矩阵驱动相机旋转。
3. THE 系统 SHALL 提供速度滑杆，速度范围 200 至 5000。
4. WHEN 用户关闭自转，THE 系统 SHALL 移除旋转监听并复位相机变换。
