# Requirements Document

## Introduction

为 Cesium 案例中心移植 Arc3DLab-SDK-Pro 参考项目中的三个案例：加载 3DTiles、3DTiles 模型压平、地球自转。三个案例复用公共场景初始化（Bing 影像、Cesium World Terrain、Viewer 生命周期管理）。

## Glossary

- **3DTiles 加载**：通过 `Cesium3DTileset.fromUrl` 加载远程三维瓦片服务。
- **模型压平**：使用 `CustomShader` 将指定 ECEF 矩形区域内的瓦片顶点高度下压。
- **地球自转**：基于 ICRF 惯性系矩阵驱动相机围绕地球旋转。

## Requirements

### Requirement 1: 3DTiles 加载案例

**User Story:** 作为案例浏览者，我希望打开"3DTiles加载"案例，以便查看远程倾斜摄影模型。

#### Acceptance Criteria

1. THE 系统 SHALL 在数据可视化分类中显示"3DTiles加载"案例卡片。
2. WHEN 用户打开案例，THE 系统 SHALL 创建 Cesium Viewer、Bing 影像、Cesium World Terrain 并加载远程 3DTiles 服务。
3. THE 系统 SHALL 提供模型显示、阴影光源、监视器三个开关。
4. WHEN 模型加载完成，THE 系统 SHALL 将相机定位到模型并清除加载状态。

### Requirement 2: 3DTiles 模型压平案例

**User Story:** 作为案例浏览者，我希望对 3DTiles 模型的矩形区域进行压平，以便观察压平前后对比。

#### Acceptance Criteria

1. THE 系统 SHALL 在数据可视化分类中显示"3DTiles模型压平"案例卡片。
2. WHEN 用户打开案例，THE 系统 SHALL 加载远程 3DTiles 服务并定位到模型。
3. THE 系统 SHALL 提供压平开关，开启后对模型指定区域下压 50 米。
4. WHEN 用户关闭开关，THE 系统 SHALL 恢复模型原始形态。

### Requirement 3: 地球自转案例

**User Story:** 作为案例浏览者，我希望以地球自转视角浏览场景，以便观察卫星轨道与地表。

#### Acceptance Criteria

1. THE 系统 SHALL 在常用工具分类中显示"地球自转"案例卡片。
2. WHEN 用户打开案例，THE 系统 SHALL 创建 Cesium Viewer、Bing 影像并加载 CZML 卫星轨道数据。
3. THE 系统 SHALL 提供自转开关与速度滑杆。
4. WHEN 用户关闭自转，THE 系统 SHALL 移除旋转监听并复位相机变换。
