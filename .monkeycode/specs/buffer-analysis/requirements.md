# Requirements Document

## Introduction

新增 3 个空间分析缓冲区案例：点缓冲区分析、线缓冲区分析、面缓冲区分析。支持在地图上点击或输入坐标创建几何数据，按缓冲值（米）基于 GeoJSON（turf.js）生成缓冲区，支持圆角/方角等缓冲参数与显示样式设置。

## Glossary

- **缓冲区**：围绕点/线/面要素按指定距离（米）扩展生成的多边形区域。
- **端点样式（endCapStyle）**：线缓冲区两端帽形状（round 圆角 / flat 平角 / square 方角）。
- **拐角样式（joinStyle）**：线/面缓冲外边界拐角连接方式（round 圆角 / miter 方角 / bevel 斜角）。
- **圆滑度（steps）**：缓冲区弧段采样步数，数值越大弧线越平滑。

## Requirements

### Requirement 1: 点缓冲区分析案例

**User Story:** 作为分析者，我希望创建点要素并按其缓冲半径生成圆形缓冲区，以便进行点邻域范围分析。

#### Acceptance Criteria

1. THE 系统 SHALL 在空间分析分类中显示"空间分析-点缓冲区分析"案例卡片。
2. THE 系统 SHALL 支持通过输入经度/纬度点击"按坐标创建点"按钮创建点要素并生成对应缓冲区。
3. WHILE 用户单击地图，THE 系统 SHALL 在拾取位置创建点要素并生成对应缓冲区。
4. THE 系统 SHALL 支持设置缓冲区半径（米）与圆滑度。
5. THE 系统 SHALL 支持设置缓冲区填充颜色、透明度、边框显示开关、边框颜色与边框宽度，并实时应用至已生成的缓冲区。
6. WHEN 用户点击"清除全部"，THE 系统 SHALL 移除全部点与缓冲区。
7. WHEN 案例关闭，THE 系统 SHALL 释放事件处理器与 Viewer。

### Requirement 2: 线缓冲区分析案例

**User Story:** 作为分析者，我希望绘制线要素并按缓冲值生成其缓冲区，以便分析沿线两侧范围。

#### Acceptance Criteria

1. THE 系统 SHALL 在空间分析分类中显示"空间分析-线缓冲区分析"案例卡片。
2. WHILE 绘制模式下，THE 系统 SHALL 支持单击采集顶点、右键或双击结束绘制并生成折线及其缓冲区。
3. THE 系统 SHALL 支持设置缓冲值（米）、端点样式（圆角/平角/方角）与拐角样式（圆角/方角/斜角）。
4. THE 系统 SHALL 支持设置圆滑度与填充颜色、透明度、边框显示、边框颜色、边框宽度。
5. WHEN 任一缓冲参数或显示参数变更，THE 系统 SHALL 重算并更新所有已绘折线的缓冲区。
6. WHEN 顶点不足 2 个结束绘制，THE 系统 SHALL 提示"点数不足"。
7. WHEN 案例关闭，THE 系统 SHALL 释放事件处理器与 Viewer。

### Requirement 3: 面缓冲区分析案例

**User Story:** 作为分析者，我希望绘制面要素并按缓冲值生成其缓冲区，以便分析面状要素向外扩展范围。

#### Acceptance Criteria

1. THE 系统 SHALL 在空间分析分类中显示"空间分析-面缓冲区分析"案例卡片。
2. WHILE 绘制模式下，THE 系统 SHALL 支持单击采集顶点、右键或双击闭合生成多边形面及其缓冲区。
3. THE 系统 SHALL 支持设置缓冲值（米）、端点样式（圆角/平角/方角）与拐角样式（圆角/方角/斜角）。
4. THE 系统 SHALL 支持设置圆滑度与填充颜色、透明度、边框显示、边框颜色、边框宽度。
5. WHEN 任一缓冲参数或显示参数变更，THE 系统 SHALL 重算并更新所有已绘面的缓冲区。
6. WHEN 顶点不足 3 个闭合绘制，THE 系统 SHALL 提示"点数不足"。
7. WHEN 案例关闭，THE 系统 SHALL 释放事件处理器与 Viewer。

### Requirement 4: 新案例图标约定

**User Story:** 作为平台维护者，我希望新增案例不强制提供截图图标，以降低案例接入成本。

#### Acceptance Criteria

1. THE 系统 SHALL 允许案例卡片省略图标字段。
2. WHEN 案例卡片无图标，THE 系统 SHALL 在缩略图区域显示"暂无截图"占位提示。
