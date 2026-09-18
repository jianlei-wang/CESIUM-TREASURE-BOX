# Requirements Document

## Introduction

为 Cesium 案例中心增加地形控制案例，加载 Cesium World Terrain，并提供地形显示隐藏与高程夸张控制。

## Glossary

- **地形显示**：使用 Cesium World Terrain 渲染真实地表高程。
- **高程夸张**：按比例放大或恢复地形高度起伏。

## Requirements

### Requirement 1: 案例入口

**User Story:** 作为案例浏览者，我希望打开地形控制案例，以便观察真实地形。

#### Acceptance Criteria

1. THE 系统 SHALL 在地形影像分类中显示“地形效果-显示与夸张”案例卡片。
2. WHEN 用户打开案例，THE 系统 SHALL 创建 Cesium Viewer、Bing 影像和 Cesium World Terrain。
3. WHEN 用户关闭案例，THE 系统 SHALL 释放 Viewer 和异步地形加载引用。

### Requirement 2: 地形控制

**User Story:** 作为案例浏览者，我希望切换地形显示并调节高程夸张，以便比较不同地形表现。

#### Acceptance Criteria

1. THE 系统 SHALL 提供地形显示开关。
2. WHEN 用户关闭地形显示，THE 系统 SHALL 使用椭球地球保持影像显示。
3. WHEN 用户开启地形显示，THE 系统 SHALL 恢复 Cesium World Terrain。
4. WHEN 用户调整高程夸张，THE 系统 SHALL 更新场景垂直夸张比例。

### Requirement 3: 异常处理

#### Acceptance Criteria

1. WHILE 地形加载，THE 系统 SHALL 显示地形加载状态。
2. IF 地形加载失败，THE 系统 SHALL 显示可读错误信息。
