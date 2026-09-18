# Requirements Document

Feature: barrier-lake-realistic（真实地形堰塞湖演化）
Updated: 2026-09-16

## Introduction

现有案例 `barrier-lake-terrain`（标题「真实地形堰塞湖模拟」）在四个方面未达到预期：

1. 地形表现不真实——采样后的地形粗糙、范围固定，看不出深切峡谷与两岸陡坡；
2. 演化过程不真实——坝体堆积、溃口扩张、洪水下泄全部由八个阶段的参数插值驱动，崩溃过程缺乏说服力；
3. 视觉表现不佳——配色、光照、水面质感、标注样式不足；
4. 无法自定义区域——模拟范围写死在一处经纬度，无法换到用户关心的河谷。

本迭代移除该案例，重新设计并实现一个满足以下定位的新案例：打开即用、以真实水量平衡驱动态演化的溃决过程、基于 Cesium World Terrain 真实高程、支持自定义区域、不需要专属图标。

现状可复用的基础设施：

- `src/lib/cesium-scene.ts` 提供 `createMapScene` / `loadBingImagery` / `loadWorldTerrain` / `destroyScene`；
- `src/cases/water-depth-extraction/terrain-sampler.ts` 提供 `sampleTerrainHeights`，输出 `DepthGrid { cols, rows, pixels, min, max }`；
- `scripts/sync-cases.mjs` 扫描 `src/cases/*/index.ts` 自动生成 `manifest.ts`，icon 字段可缺省。

## Glossary

- **案例中心**：本 Vue 3 + Cesium 单页应用，按目录自动注册案例，打开案例时异步加载对应 chunk。
- **高程栅格**：`sampleTerrainHeights` 采样得到的二维高程数组，含列数、行数、最小/最大高程。
- **库容-水位曲线**：由高程栅格计算的、水位与该水位以下可蓄水体积之间的对应关系。
- **堰塞坝**：滑坡碎屑在河道中堆积形成的天然坝体。
- **溃口**：坝体被漫顶水流冲刷形成的过流通道。
- **水量平衡**：水库蓄量变化等于入库流量与出库流量之差。
- **堰流出流**：水流越过溃口时的下泄流量，与溃口宽度和水头相关。
- **多边形范围**：用户在地图上依次点击顶点圈定的闭合区域，用于限定参与模拟的河谷范围。
- **外接矩形**：多边形在经纬度方向上的最小外包围矩形，作为高程采样的网格范围。
- **白格滑坡**：2018 年 10 月与 11 月发生于西藏江达县金沙江右岸的两次滑坡堵江事件，本案例的默认场景。
- **DemoCard**：案例注册对象，字段为 id / title / category / description / tag / icon / component / updatedAt，icon 为可选。

## Requirements

### Requirement 1：移除旧案例

**User Story:** AS 案例中心维护者, I want 旧的真实地形堰塞湖案例被彻底移除, so that 案例列表中不再出现达不到预期效果的条目。

#### Acceptance Criteria

1. WHEN 本迭代完成后，THE 案例中心 SHALL 不存在目录 `src/cases/barrier-lake-terrain/`。
2. WHEN 执行 `npm run sync` 后，THE 生成的 `src/cases/manifest.ts` SHALL 不包含 id 为 `barrier-lake-terrain` 的条目与加载器。
3. WHEN 执行 `npm run build` 时，THE 构建 SHALL 在无残留引用的情况下成功完成。

### Requirement 2：开箱即用

**User Story:** AS 演示观看者, I want 打开案例后立即看到完整演化, so that 无需先做任何绘制或标定。

#### Acceptance Criteria

1. WHEN 用户打开案例，THE 案例 SHALL 自动加载白格滑坡所在的金沙江河谷区域并开始地形采样。
2. WHEN 地形采样进行中，THE 案例 SHALL 显示加载状态文本。
3. WHEN 地形采样完成，THE 案例 SHALL 自动完成河道识别、坝址判定与库容曲线计算，并进入第一个演化阶段。
4. IF 地形采样失败，THE 案例 SHALL 显示失败提示并提供重新采样操作。

### Requirement 3：自定义多边形区域

**User Story:** AS 演示操作者, I want 在地图上圈定任意河谷范围, so that 可以在自己关心的河段上运行模拟。

#### Acceptance Criteria

1. THE 案例 SHALL 支持用户在地图上依次点击顶点绘制一个多边形范围。
2. WHILE 绘制进行中，THE 案例 SHALL 实时显示已绘制的顶点与边线。
3. WHEN 用户结束绘制且顶点数不少于三个，THE 案例 SHALL 接受该多边形作为新的模拟范围。
4. IF 结束绘制时顶点数少于三个，THE 案例 SHALL 放弃该次绘制并保留原范围。
5. WHEN 用户应用多边形范围，THE 案例 SHALL 以多边形的外接矩形采样高程栅格，并重建地形、河道、坝址与库容曲线。
6. WHILE 多边形范围生效，THE 案例 SHALL 仅将多边形内部的地形计入库容与淹没计算。
7. THE 案例 SHALL 支持清除已绘制多边形并恢复默认范围。
8. THE 案例 SHALL 将单次采样格点数限制在可保证交互流畅的上限内。

### Requirement 4：真实地形构建

**User Story:** AS 演示观看者, I want 地形来自真实高程, so that 看到的峡谷形态可信。

#### Acceptance Criteria

1. THE 案例 SHALL 使用 Cesium World Terrain 作为高程来源。
2. WHEN 构建地形曲面时，THE 案例 SHALL 对高程栅格执行双线性插值，使曲面连续。
3. IF 采样点高程缺失，THE 案例 SHALL 使用邻域有效值填补该点。
4. THE 案例 SHALL 按当前范围的地形起伏自动确定垂直显示比例，使峡谷形态在视野内可辨。

### Requirement 5：真实溃决过程

**User Story:** AS 演示观看者, I want 溃决由水量平衡驱动态演化, so that 水位、溃口与洪峰的变化符合物理直觉。

#### Acceptance Criteria

1. THE 案例 SHALL 由高程栅格计算库容-水位曲线。
2. WHILE 演化推进，THE 案例 SHALL 按下式推进水库蓄量：蓄量变化率等于入库流量减出库流量。
3. WHILE 水库蓄量低于溃口底高程，THE 案例 SHALL 令出库流量为零。
4. WHILE 水位高于溃口底高程，THE 案例 SHALL 按堰流关系由溃口宽度与溃口处水头计算出库流量。
5. WHILE 水流漫顶过流，THE 案例 SHALL 按冲刷速率增大溃口宽度与深度。
6. WHEN 用户调整入库流量、坝高、溃口初始尺寸参数，THE 案例 SHALL 在后续演化中采用新参数。
7. THE 案例 SHALL 实时展示水位、蓄量、入库流量、出库流量与溃口尺寸。
8. WHEN 演化达到稳定条件，THE 案例 SHALL 停止推进并给出结果状态。

### Requirement 6：地形表现

**User Story:** AS 演示观看者, I want 地形有真实的质地与明暗, so that 峡谷与坝体的形态容易被识别。

#### Acceptance Criteria

1. THE 案例 SHALL 依据相对高程与坡度将地形分为谷底、缓坡、陡坡、岩壁等类别并分别着色。
2. THE 案例 SHALL 依据地形法线计算漫反射明暗。
3. THE 案例 SHALL 支持叠加真实影像底图，并允许用户关闭。
4. WHILE 坝体与滑坡体存在，THE 案例 SHALL 以区别于原始地形的材质着色。

### Requirement 7：视觉表现

**User Story:** AS 演示观看者, I want 水面与碎屑的变化生动, so that 演化过程有表现力。

#### Acceptance Criteria

1. WHILE 水面存在，THE 案例 SHALL 按水深呈现由浅到深的颜色与透明度渐变。
2. WHILE 水流流动，THE 案例 SHALL 呈现随时间变化的水面波纹。
3. WHILE 滑坡发生，THE 案例 SHALL 呈现下滑的碎屑颗粒。
4. WHILE 溃口过流，THE 案例 SHALL 呈现沿下游河道推进的洪流与浪花。
5. WHILE 触发阶段，THE 案例 SHALL 呈现降雨与地震的表现。
6. WHILE 演化推进，THE 案例 SHALL 以三维标注指示当前阶段的关键地物。

### Requirement 8：控制与播放

**User Story:** AS 演示讲解者, I want 能控制演化进度与显示项, so that 可以配合讲解节奏。

#### Acceptance Criteria

1. THE 案例 SHALL 提供阶段跳转、上一步、下一步、自动播放、暂停与重置操作。
2. THE 案例 SHALL 提供标注、自动旋转、真实地形、叠加降雨、影像底图的显示开关。
3. THE 案例 SHALL 提供多个预设视角。
4. WHEN 用户执行阶段跳转，THE 案例 SHALL 立即将演化状态切换到该阶段对应的时刻。
5. WHILE 自动播放进行中，THE 案例 SHALL 按当前阶段的持续时间推进到下一阶段。

### Requirement 9：案例注册与图标

**User Story:** AS 案例中心维护者, I want 新案例正确注册且不占用图标资源, so that 首页列表正常展示。

#### Acceptance Criteria

1. THE 案例 SHALL 位于目录 `src/cases/barrier-lake-realistic/`，并包含 `index.ts` 与 Demo 组件。
2. THE 案例的 `index.ts` SHALL 导出 DemoCard，字段包含 id / title / category / description / tag / component / updatedAt，且不声明 icon 字段。
3. WHEN 执行 `npm run sync` 后，THE 生成的 `manifest.ts` SHALL 包含该案例且 `icon` 为空。
4. THE 案例 SHALL 复用 `createMapScene` 与 `destroyScene` 管理 Cesium 生命周期，并在组件卸载时释放全部资源。

### Requirement 10：标注随视距淡出

**User Story:** AS 演示讲解者, I want 远景时自动隐藏标注、拉近后重新显示, so that 远景画面不被文字遮挡，近景仍能读到地名与阶段说明。

#### Acceptance Criteria

1. WHEN 相机高度低于近端阈值，THE 案例 SHALL 完整显示阶段标注。
2. WHEN 相机高度高于远端阈值，THE 案例 SHALL 隐藏全部阶段标注。
3. WHEN 相机高度处于两个阈值之间，THE 案例 SHALL 随高度线性淡出标注的填充与背景透明度。
4. WHEN 用户关闭标注开关，THE 案例 SHALL 隐藏全部阶段标注，与视距无关。

### Requirement 11：研究区点位高程

**User Story:** AS 研究者, I want 点击地图获取每个点位的高程值, so that 可以读取研究区内任意位置的高程信息。

#### Acceptance Criteria

1. THE 案例 SHALL 提供进入与退出点位高程拾取模式的按钮。
2. WHILE 处于拾取模式，WHEN 用户左键点击地形，THE 案例 SHALL 采样该点高程并就地标注高程数值。
3. WHILE 处于拾取模式，THE 案例 SHALL 支持连续多次拾取。
4. THE 案例 SHALL 提供清除全部点位高程的按钮。
5. THE 案例 SHALL 在控制面板列出每个点位的高程值，并汇总最高与最低高程。
6. WHEN 相机高度高于远端阈值，THE 案例 SHALL 淡出高程文字并保留点位圆点。
7. WHEN 用户切换研究区，THE 案例 SHALL 清除旧点位高程。

### Requirement 12：河谷要素自定义绘制

**User Story:** AS 研究者, I want 能绘制河谷、河道、上游、下游与滑坡源区, so that 可以让物理计算贴合实际河谷形态。

#### Acceptance Criteria

1. THE 案例 SHALL 提供河谷、河道、上游、下游、滑坡源区五类要素的绘制入口。
2. THE 河谷、河道、滑坡源区 SHALL 以多边形面绘制；THE 上游、下游 SHALL 以单点绘制。
3. WHEN 绘制河谷面，THE 案例 SHALL 以该面与研究区范围的交集限定水面渲染范围与库容统计范围。
4. WHEN 绘制河道面，THE 案例 SHALL 严格以该面作为河道：河道中心取该面在每行的跨度中点，过水宽度取跨度全宽。
5. WHEN 绘制上游点与下游点，THE 案例 SHALL 以两点的行序确定河道上下游方向。
6. WHEN 绘制滑坡源区面，THE 案例 SHALL 在该面内均匀生成滑坡碎屑颗粒，且碎屑在生成瞬间铺满该面。
7. WHEN 用户清除某一类要素，THE 案例 SHALL 对该要素恢复高程场自动判定。
8. THE 案例 SHALL 提供要素图形的显示开关，并区分已自定义与自动判定的要素。
9. WHEN 用户切换研究区，THE 案例 SHALL 保留已绘制要素并重新应用到新地形。
10. THE 案例 SHALL 以半透明多边形呈现面要素，以圆点加名称呈现点要素。
