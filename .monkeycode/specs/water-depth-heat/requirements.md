# Requirements Document

## Introduction

新增 1 个三维特效三维水深热力案例：在指定海域范围（上海杭州湾，中心 121.92/30.72）生成模拟测深点，通过四种空间插值方法（IDW / 普通克里金 / 薄板样条 / 自然邻域）插值构建连续水深网格，并以三维热力网格面 + 测深点渲染展示，支持差值对比与多色带映射。参考实现为用户上传样例（`fcba5efe-三维水深热力图-2.html`，Cesium Bathymetry Lab）。

## Glossary

- **测深点（Sounding）**：带经纬度与深度（负值，海平面下）的离散采样点，由合成测深场算法生成。
- **插值**：由离散测深点估计网格单元水深值的空间插值方法（idw / kriging / spline / natural）。
- **普通克里金**：基于变差函数拟合与线性方程组求解的最优无偏插值。
- **薄板样条**：径向基函数（TPS，`r²·ln r` 基函数）插值。
- **自然邻域**：基于 Delaunay 三角网 Voronoi 面积权重的插值。
- **差值图**：以基准方法网格为参照，显示当前方法网格与基准网格逐单元水深差值的渲染模式。
- **色带**：水深数值到颜色的映射表（ocean / thermal / channel / safety）。

## Requirements

### Requirement 1: 三维水深热力案例卡片

**User Story:** 作为用户，我希望在三维特效分类中看到三维水深热力案例入口。

#### Acceptance Criteria

1. THE 系统 SHALL 在三维特效分类中显示"数据分析-三维水深热力"案例卡片，tag 为「插值分析」。
2. THE 系统 SHALL 在案例卡片显示用户提供的截图 icon（`icon.webp`）。
3. WHEN 用户点击卡片，THE 系统 SHALL 进入完整案例页面并初始化地图与三维场景。

### Requirement 2: 测深点生成与默认渲染

**User Story:** 作为用户，我希望进入案例后立即看到模拟测深点与插值热力面。

#### Acceptance Criteria

1. THE 系统 SHALL 使用固定随机种子（`seededRandom(20260531)`）生成默认 2600 个模拟测深点，合成测深场含海沟、浅滩、通航水道、冲刷坑与波纹特征。
2. THE 系统 SHALL 默认使用 IDW 插值构建 38×38 网格，渲染热力网格面与测深点。
3. THE 系统 SHALL 相机默认飞至目标海域上方俯瞰插值区域。
4. THE 系统 SHALL 默认加载 Cesium World Terrain，加载失败时降级为椭球仍可渲染热力面。
5. WHEN 案例关闭，THE 系统 SHALL 释放网格 Primitive、测深点集合与 Viewer。

### Requirement 3: 四种插值方法与参数调节

**User Story:** 作为用户，我希望切换插值方法并调节其参数实时重建水深网格。

#### Acceptance Criteria

1. THE 系统 SHALL 支持四种插值方法：IDW、普通克里金、薄板样条、自然邻域。
2. THE 系统 SHALL 按方法提供参数：IDW 距离幂次/邻近点数；克里金拟合滞后/样本数/块金比例；样条样本数/正则化；自然邻域候选点数/候选扩展。
3. WHEN 插值方法或方法参数变更，THE 系统 SHALL 重建插值网格并更新热力面渲染。
4. THE 系统 SHALL 显示网格统计：测深点数、网格单元数、最浅/最深水深。

### Requirement 4: 差值对比

**User Story:** 作为用户，我希望对比不同插值方法的结果差异。

#### Acceptance Criteria

1. THE 系统 SHALL 支持选择差值图基准方法（默认为 idw）并开启/关闭差值图。
2. WHEN 差值图开启，THE 系统 SHALL 以蓝白红发散色带渲染逐单元水深差，并显示 MAE、RMSE、最大绝对差统计。
3. WHEN 差值图开启，THE 系统 SHALL 隐藏测深点以避免遮挡差值色块。
4. WHEN 当前方法与基准方法相同，THE 系统 SHALL 提示差值为 0。

### Requirement 5: 色带与渲染外观

**User Story:** 作为用户，我希望切换水深色带并调节热力面外观。

#### Acceptance Criteria

1. THE 系统 SHALL 提供四套水深色带（ocean / thermal / channel / safety）与色带反转开关。
2. THE 系统 SHALL 显示与色带一致的渐变图例（深水/浅水标注，差值图时显示 ± 范围）。
3. THE 系统 SHALL 支持调节插值面透明度与下凹倍率（深度放大系数）。
4. THE 系统 SHALL 支持显示/隐藏测深点与插值面。
5. THE 系统 SHALL 支持调节测深点采样数量（800~5200）与网格密度（20~58）并重建。
