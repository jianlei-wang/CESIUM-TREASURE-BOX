/** 低空规划系统 DEMO 的“系统说明”与“技术实现说明”。 */

export const ROADMAP_TITLE = '低空规划系统 · 系统说明与技术实现'

export const ROADMAP_INTRO =
  '本案例是完整运行在浏览器端的低空规划系统交互式 DEMO：以 CesiumJS 1.144 为三维底座，Vue3 + TypeScript 组织界面与状态，全部业务数据由前端确定性仿真生成，无需后端即可演示“空域数字化 → 场景网格可视 → 航线智能规划 → 模拟飞行 → 实时监控”的业务闭环。系统按模块划分为场景可视、航线规划、模拟飞行、实时监控、空域管理、数据管理与系统管理七部分，三维场景与各功能面板双向联动。下方为技术实现说明。'

export const ROADMAP_TAGS = [
  'CesiumJS 1.144',
  'Vue3 + TypeScript',
  'Vite',
  'Bing 影像 + World Terrain',
  'Cesium Ion OSM Buildings (3D Tiles)',
  'GeoSOT 网格剖分与编码',
  '栅格 A* + Catmull-Rom 平滑',
  'Primitive / PolylineCollection 批量渲染',
  'Clock 时间轴仿真'
]

export const ROADMAP_PIPELINE = [
  { title: '影像与地形', detail: 'Bing UrlTemplateImageryProvider（手写 quadkey，最高 19 级）+ Cesium World Terrain，采样作业区地表高程' },
  { title: '真实三维实景', detail: 'Ion OSM Buildings 3D Tiles，白色 Cesium3DTileStyle，失败回退规划建筑体块' },
  { title: 'GeoSOT 网格生成', detail: '按基准逐级四叉剖分，生成单元边界、行列号与北斗网格码，并按空域/障碍分类' },
  { title: '矢量图层渲染', detail: 'PolygonGeometry 面填充 + PolylineCollection 唯一边线框 + Point/Label 标注' },
  { title: '航线智能规划', detail: '作业区栅格化 + 八邻域 A* 避障 + Catmull-Rom 样条加密 + 多约束评估打分' },
  { title: '飞行与监控仿真', detail: 'Cesium Clock 时间轴驱动飞行插值；定时器按倍率推进航迹并生成告警' }
]

export const ROADMAP_LAYERS = [
  {
    name: '三维引擎层',
    en: 'Engine',
    desc: 'Cesium Viewer/Scene 的加载与交互基座',
    items: [
      'Viewer / Scene / Camera 与控制器，scene3DOnly 纯三维模式',
      '影像 UrlTemplateImageryProvider 与 World Terrain 地形加载',
      '3D Tilesets 流式加载与 maximumScreenSpaceError 调度',
      'pickEllipsoid 拾取、sampleTerrainMostDetailed 采样地表高程'
    ]
  },
  {
    name: '渲染内核层',
    en: 'Renderer',
    desc: 'SystemRenderer 统一管理全部三维图元',
    items: [
      'Primitive 批量实例化承载网格/空域/障碍体块',
      'PolylineCollection 绘制网格线框、航线、航迹与围栏',
      'PointPrimitiveCollection / LabelCollection 承载点位与标注',
      'setLayers 控制图层显隐，removePrimitive 防资源泄漏；真高经地表高程模型双线性插值统一抬升'
    ]
  },
  {
    name: '算法与仿真层',
    en: 'Algorithms',
    desc: '与渲染解耦的纯函数算法模块',
    items: [
      'geosot：网格四叉剖分、编码与空域/障碍分类',
      'planning：栅格 A* 避障、Catmull-Rom 平滑、风险/能耗/航程评估',
      'flight：时间轴位置与姿态插值、HUD 参数输出',
      'monitor：设备航迹推进与越界/冲突/偏离告警仿真'
    ]
  },
  {
    name: '交互与状态层',
    en: 'Interaction',
    desc: 'Vue3 组合式 API 驱动的界面与场景联动',
    items: [
      'reactive 图层开关与渲染参数，watch 触发图层重建',
      'ScreenSpaceEventHandler 完成拾取、标绘、起终点与取消选中',
      '模块化侧栏与右侧检查器联动显示要素属性',
      '选择、标绘、重置共享同一状态源，保证渲染状态一致'
    ]
  },
  {
    name: '数据与类型层',
    en: 'Data',
    desc: '确定性仿真数据与强类型领域模型',
    items: [
      '种子化 PRNG（mulberry32）生成空域、建筑、设备、计划与告警',
      'types.ts 定义 GridCell / AirspaceZone / RoutePlan / Track 等类型',
      'mock.ts 提供演示数据与作业区边界常量',
      '全链路 TypeScript strict 类型约束'
    ]
  }
]

export const ROADMAP_MODULES = [
  { name: '场景网格可视', kind: '核心', desc: 'GeoSOT 网格 + Primitive 批量渲染，支持单值/分级/点云/热力/轨迹五种模式' },
  { name: '空域管理', kind: '核心', desc: '禁/限/适飞区独立图层，圆与多边形空域体块渲染，并参与网格分类与航线约束' },
  { name: '航线智能规划', kind: '核心', desc: '栅格 A* + Catmull-Rom 平滑，输出多候选并按风险/能耗/航程综合评分' },
  { name: '模拟飞行', kind: '核心', desc: 'Cesium Clock 时间轴驱动，位置与姿态插值、相机跟随与 HUD 参数回放' },
  { name: '实时监控告警', kind: '支撑', desc: '定时器按倍率推进设备航迹，越界/冲突/偏离/低电量告警与处置' },
  { name: '数据业务管理', kind: '支撑', desc: '种子化台账数据、飞行计划与统计报表展示' },
  { name: '系统管理', kind: '支撑', desc: '用户、角色、日志与参数配置的前端演示' }
]

export const ROADMAP_MILESTONES = [
  { phase: '网格渲染', title: 'GeoSOT 面与线分离渲染', detail: '面填充与线框分别抬升（+2m / +3.5m），共享边去重，消除 z-fighting 与共面闪烁' },
  { phase: '地形适配', title: '真高与地表基准统一', detail: 'World Terrain 采样作业区中心高程，网格/航线/设备等真高统一叠加地表基准，避免要素沉入地形' },
  { phase: '渲染稳定性', title: '材质与资源生命周期', detail: 'PolylineCollection 的 material 必须为 Material 实例而非 Color；重绘前移除旧 primitive，防止着色器与显存泄漏' },
  { phase: '三维实景', title: 'OSM Buildings 接入', detail: '以 3D Tiles 流式加载并按屏幕空间误差调度，白色样式突出规划要素，失败自动回退体块' },
  { phase: '性能策略', title: '批量与规模控制', detail: '用 Primitive 实例化替代 Entity，网格层级限定 L15–L19，图层切换按需重建' },
  { phase: '交互一致性', title: '统一选中与标绘状态', detail: '拾取、标绘、起终点与空白处取消选中共享同一状态源，保证场景与面板状态同步' }
]

export const ROADMAP_SCHEMA = [
  { table: 'GridCell', fields: 'code(北斗网格码), level, row/col, 经纬四至, state, altMin/altMax, density, value', note: 'GeoSOT 网格单元' },
  { table: 'AirspaceZone', fields: 'id, name, type(禁/限/适飞), shape(圆/多边形), ring/center/radius, altMin/altMax, active', note: '空域与电子围栏' },
  { table: 'RoutePlan', fields: 'id, name, type(航点/面状/环绕), points[], length, duration, energy, risk, score, notes', note: '规划航线与评估' },
  { table: 'Track', fields: 'deviceNo, color, points[{lon,lat,alt,t,speed,heading}]', note: '实时航迹' },
  { table: 'Obstacle', fields: 'id, name, 经纬四至, height, kind(建筑/高塔), limit', note: '建筑障碍' },
  { table: 'Device', fields: 'id, no, model, status, lon/lat/alt, speed, heading, battery, signal, task', note: '无人机设备' }
]
