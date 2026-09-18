# Requirements Document

## Introduction

为 Cesium 案例中心增加一个基于后处理的实时闪电效果案例，用于展示随机闪电路径、云层辉光和场景亮度变化。

## Glossary

- **闪电效果**：叠加在 Cesium 场景上的程序化雷电、辉光与云层明暗变化。
- **闪电频率**：单位时间内触发闪电事件的概率控制值。
- **闪电强度**：闪电主体、高光和场景照明叠加的亮度控制值。

## Requirements

### Requirement 1: 案例入口

**User Story:** 作为案例浏览者，我希望在三维特效分类中打开闪电案例，以便查看实时雷电效果。

#### Acceptance Criteria

1. THE 系统 SHALL 在三维特效分类中显示“天气特效-闪电”案例卡片。
2. WHEN 用户打开闪电案例，THE 系统 SHALL 创建 Cesium Viewer 和闪电后处理阶段。
3. WHEN 用户关闭案例，THE 系统 SHALL 释放 Viewer、后处理阶段和帧更新监听器。

### Requirement 2: 闪电控制

**User Story:** 作为案例浏览者，我希望控制闪电效果，以便观察不同雷暴表现。

#### Acceptance Criteria

1. THE 系统 SHALL 提供闪电效果开启和关闭控制。
2. WHEN 用户调整闪电频率，THE 系统 SHALL 更新随机闪电事件的触发概率。
3. WHEN 用户调整闪电强度，THE 系统 SHALL 更新闪电主体、辉光和场景照明的合成强度。
4. WHEN 用户调整云层强度，THE 系统 SHALL 更新后处理中的程序化云层覆盖程度。

### Requirement 3: 场景亮度

**User Story:** 作为案例浏览者，我希望调整场景亮度，以便在不同底图明暗条件下观察闪电效果。

#### Acceptance Criteria

1. THE 系统 SHALL 提供场景亮度滑杆。
2. WHEN 用户调整场景亮度，THE 系统 SHALL 更新底图颜色和闪电合成结果的整体亮度。

### Requirement 4: 渲染表现

**User Story:** 作为案例浏览者，我希望闪电具有自然的分叉路径和短时辉光，以便获得真实的雷暴视觉表现。

#### Acceptance Criteria

1. WHILE 闪电效果开启，THE 系统 SHALL 以时间驱动随机闪电事件。
2. WHEN 闪电事件触发，THE 系统 SHALL 显示具有分形扰动的闪电路径、主体高光和外围辉光。
3. WHEN 闪电事件结束，THE 系统 SHALL 恢复场景的基础颜色与亮度。
