# Requirements Document

## Introduction

为 Cesium 案例中心增加"常用工具-相机参数"案例。案例实时展示当前场景四至坐标、相机位置与朝向参数，并支持一键复制可回放的相机设置代码片段。

## Glossary

- **四至坐标**：当前视口可见地表范围，由西经、南纬、东经、北纬四个边界构成。
- **相机位置**：相机在地心固定坐标系中的经纬度与海拔高度。
- **相机朝向**：相机航向角（heading）、俯仰角（pitch）、翻滚角（roll）。
- **可回放代码**：可直接通过 `viewer.camera.setView({...})` 恢复当前视角的代码片段。

## Requirements

### Requirement 1: 案例入口

**User Story:** 作为案例浏览者，我希望打开相机参数案例，以便查看当前视角的完整相机状态。

#### Acceptance Criteria

1. THE 系统 SHALL 在常用工具分类中显示"相机参数"案例卡片。
2. WHEN 用户打开案例，THE 系统 SHALL 创建 Cesium Viewer、Bing 影像和默认视角。
3. WHEN 用户关闭案例，THE 系统 SHALL 释放 Viewer、事件监听器和复制工具。

### Requirement 2: 相机与四至信息展示

**User Story:** 作为案例浏览者，我希望看到当前视口的四至坐标和相机位置、朝向参数。

#### Acceptance Criteria

1. WHILE 案例运行，THE 系统 SHALL 展示相机经度、纬度、海拔高度。
2. WHILE 案例运行，THE 系统 SHALL 展示相机航向角、俯仰角、翻滚角。
3. WHILE 案例运行，THE 系统 SHALL 展示当前视口四至坐标（西经、南纬、东经、北纬）。
4. WHEN 相机位置或朝向发生变化，THE 系统 SHALL 更新对应展示数值。

### Requirement 3: 一键复制相机参数

**User Story:** 作为案例浏览者，我希望一键复制相机参数，以便在其他工程中恢复相同视角。

#### Acceptance Criteria

1. THE 系统 SHALL 提供复制按钮。
2. WHEN 用户点击复制按钮，THE 系统 SHALL 生成包含 `destination` 与 `orientation` 的 `viewer.camera.setView({...})` 代码片段并写入剪贴板。
3. IF 剪贴板写入成功，THE 系统 SHALL 显示复制成功反馈。
4. IF 剪贴板写入失败，THE 系统 SHALL 显示复制失败提示。
