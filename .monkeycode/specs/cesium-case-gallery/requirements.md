# Requirements Document

## Introduction

Cesium酱の百宝箱用于集中展示 Cesium 三维可视化案例，帮助用户按功能分类浏览、搜索并打开案例详情。

## Glossary

- **案例分类**：按三维特效、标记标绘、空间分析等主题划分的案例集合。
- **案例卡片**：展示案例缩略图、名称、说明和类型标签的交互单元。

## Requirements

### Requirement 1: 页面布局

**User Story:** 作为 Cesium 开发者，我希望在统一的工作台中浏览案例，以便快速找到需要的功能示例。

#### Acceptance Criteria

1. THE 系统 SHALL 显示固定高度的深色顶部标题栏，并展示 Logo、系统名称和在线状态。
2. THE 系统 SHALL 在桌面视口显示固定宽度的左侧导航栏和自适应宽度的内容区。
3. THE 系统 SHALL 在移动视口将左侧导航转换为可打开和关闭的抽屉导航。

### Requirement 2: 分类浏览

**User Story:** 作为案例浏览者，我希望切换功能分类，以便查看对应主题的案例。

#### Acceptance Criteria

1. THE 系统 SHALL 显示每个案例分类的名称、图标和数量角标。
2. WHEN 用户选择一个分类，THE 系统 SHALL 更新标题、数量和案例卡片列表。
3. WHILE 分类处于选中状态，THE 系统 SHALL 使用品牌蓝色突出选中项。

### Requirement 3: 案例检索与打开

**User Story:** 作为案例浏览者，我希望搜索和查看案例详情，以便确认案例是否满足使用需求。

#### Acceptance Criteria

1. THE 系统 SHALL 以响应式网格展示案例卡片，并根据视口宽度调整列数。
2. WHEN 用户输入案例名称关键词，THE 系统 SHALL 展示名称包含关键词的当前分类案例。
3. WHEN 用户点击案例卡片，THE 系统 SHALL 打开包含案例预览、说明和进入入口的详情弹窗。
