# Requirements Document

## Introduction

为 Cesium 案例中心移植 Arc3DLab-SDK-Pro 参考项目中的「3DTiles模型压平」案例：加载远程 3DTiles 服务，并对指定矩形区域进行压平，提供开关恢复原始形态。

## Glossary

- **模型压平**：使用 `CustomShader` 将指定 ECEF 矩形区域内的瓦片顶点高度下压。
- **ECEF**：地心地固坐标系，压平区域顶点使用世界坐标。

## Requirements

### Requirement 1: 案例入口

**User Story:** 作为案例浏览者，我希望打开"3DTiles模型压平"案例，以便查看倾斜摄影模型的压平效果。

#### Acceptance Criteria

1. THE 系统 SHALL 在数据可视化分类中显示"3DTiles模型压平"案例卡片。
2. WHEN 用户打开案例，THE 系统 SHALL 创建 Cesium Viewer、Bing 影像、Cesium World Terrain 并加载远程 3DTiles 服务。
3. WHEN 模型加载完成，THE 系统 SHALL 将相机定位到模型并清除加载状态。

### Requirement 2: 压平控制

**User Story:** 作为案例浏览者，我希望开启压平观察模型下压，并关闭恢复原状。

#### Acceptance Criteria

1. THE 系统 SHALL 提供模型压平开关。
2. WHEN 用户开启压平，THE 系统 SHALL 对模型指定矩形区域下压 50 米。
3. WHEN 用户关闭压平，THE 系统 SHALL 恢复模型原始形态。
