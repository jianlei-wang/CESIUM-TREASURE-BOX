/**
 * 技术路线说明内容：本系统自主设计实现，仅呈现网格渲染的关键技术与实现说明
 * （渲染管线、分层架构、DGGS 选型、能力矩阵、公共渲染内核、工程选型）。
 */

export const ROADMAP_TITLE = '地理网格渲染系统 · 关键技术路线'

export const ROADMAP_INTRO =
  '本系统由本项目自主设计并实现，在同一渲染内核上统一支撑经纬网格、北斗网格、水文网格与 DGGS 四类网格的单元生成、编码、渲染、LOD 与拾取。以下仅说明系统实现所采用的关键技术与设计要点。'

export const ROADMAP_TAGS = ['CesiumJS', 'DGGS / OGC 21-038', 'H3 / h3-js', 'GB/T 39409-2020', 'LOD + Worker']

export const ROADMAP_PIPELINE: Array<{ title: string; detail: string }> = [
  { title: '相机事件', detail: 'camera.changed / moveEnd' },
  { title: 'LOD 决策', detail: '高度→层级表 + 双阈值滞回' },
  { title: '单元计算', detail: '编码 / polygonToCells' },
  { title: '几何提交', detail: 'GeometryBuilder + BatchRenderer' },
  { title: '场景渲染', detail: 'Cesium Primitives' }
]

/** 四层架构：计算层 → 渲染内核层 → 引擎层 → 应用层。 */
export const ROADMAP_LAYERS: Array<{ name: string; en: string; desc: string; items: string[] }> = [
  {
    name: '应用层',
    en: 'Application',
    desc: '统一 API 与样式配置',
    items: ["GridManager.enable(type)", "setStyle(type, cfg)", "on('pick') / refresh()"]
  },
  {
    name: '引擎层',
    en: 'Grid Engines',
    desc: '四类网格各实现一套驱动（统一 GridLayer 接口）',
    items: ['GraticuleEngine', 'BeidouGridEngine', 'HydroGridEngine', 'DggsGridEngine + DggsAdapter']
  },
  {
    name: '渲染内核层',
    en: 'Rendering Kernel',
    desc: '统一几何构建、批量渲染、LOD 与标注',
    items: ['GeometryBuilder', 'BatchRenderer', 'LodScheduler', 'LabelRenderer / PickingService']
  },
  {
    name: '计算层',
    en: 'Compute（可下沉 Web Worker）',
    desc: '编码与单元覆盖的纯计算',
    items: ['经纬度分级', '北斗码 GB/T 39409（二维位置码 + 高度域分层）', 'H3 cellIndex', 'CellCover：视域 → 单元集合']
  }
]

export const DGGS_CANDIDATES: Array<{
  name: string
  cell: string
  aperture: string
  lib: string
  verdict: string
  recommended?: boolean
}> = [
  {
    name: 'H3（Uber）',
    cell: '六边形 · 二十面体近似投影',
    aperture: 'Aperture 7 · 层级 0–15',
    lib: 'h3-js（纯 JS，Node/浏览器均可用）',
    verdict: '首选：生态最完整、无相邻歧义、六边形聚合视觉友好',
    recommended: true
  },
  {
    name: 'S2（Google）',
    cell: '四边形 · 立方体面四叉树',
    aperture: 'Aperture 4 · 层级 0–30',
    lib: 's2-geometry / @stevenpg/cesium-s2',
    verdict: '备选：需要与瓦片对齐 / 四边形表达时切换'
  },
  {
    name: 'rHEALPix',
    cell: '等面积四边形 · 旋转 HEALPix',
    aperture: 'Aperture 9（东经 50° 中心）',
    lib: '无成熟浏览器 JS 库（DGGAL 为 C++）',
    verdict: '不首选：需自研算法或服务端预计算，成本高'
  }
]

export const CAPABILITY_DIMENSIONS = ['等面积性', '层级深度', '编码紧凑', '前端生态', '实现成本(低→高)']

export const CAPABILITY_MATRIX: Array<{ name: string; color: string; scores: number[] }> = [
  { name: '经纬网格', color: '#38bdf8', scores: [2, 5, 4, 10, 9] },
  { name: '北斗网格', color: '#2dd4bf', scores: [3, 9, 9, 4, 5] },
  { name: '水文网格', color: '#fbbf24', scores: [2, 2, 3, 7, 8] },
  { name: 'DGGS(H3)', color: '#f472b6', scores: [7, 9, 10, 8, 6] }
]

export const ROADMAP_SECTIONS: Array<{ title: string; summary: string; bullets: string[] }> = [
  {
    title: '公共渲染内核',
    summary: '四个引擎共享同一内核，避免重复实现与性能差异。',
    bullets: [
      '线模式：单 PolylineCollection / GroundPolylinePrimitive，像素线宽，性能高。',
      '面模式：合并顶点 + 索引缓冲 + 逐实例颜色，单 Primitive 提交。',
      '三维网格体：按高度域层级逐层剖分并逐层拉伸，层间以明暗区分，而非单柱整体拉伸。',
      '标注模式：全部并入一个 LabelCollection，distanceDisplayCondition 控制显示距离。',
      'LOD：相机高度 → 目标层级查询表 + 双阈值滞回，重建采用增量 diff。'
    ]
  },
  {
    title: '交互与样式',
    summary: '四种网格共享一套样式 Schema 与拾取协议，保证 API 一致、UI 可统一配置。',
    bullets: [
      '样式字段：strokeColor / strokeWidth / fill / fillOpacity / labelVisible / labelDistance / maxCells。',
      "拾取协议：grid.on('pick') → { gridType, cellId, code, level, extent, center }。",
      'hover 悬浮高亮由坐标面板驱动；grid.highlight(cellId) 支持程序化高亮。'
    ]
  },
  {
    title: '性能优化专项',
    summary: '经纬网格全程流畅；北斗 / DGGS 覆盖任意视域 ≤ 8 万单元 ≥ 30fps。',
    bullets: [
      '计算下沉 Worker：编码、polygonToCells、顶点采样全部放入 Worker 池。',
      '增量重建 + 缓存：单元边界/几何按 (cellId, level) 缓存，进入视域复用、退出 LRU 淘汰。',
      '合并绘制：每网格每帧目标 ≤ 2–3 个 DrawCall 级。',
      '剔除与阈值：视锥 + 相机背向剔除，maxCells 超限自动提高像素阈值降级层级。'
    ]
  },
  {
    title: '风险与对策',
    summary: '单元数量爆炸、编码规则偏差、LOD 抖动与标注遮挡是主要风险。',
    bullets: [
      '单元爆炸：maxCells + 像素阈值降级 + 视域裁剪 + Worker 计算。',
      '北斗编码细节偏差：以 GB/T 39409-2020 原文为准，golden test 全覆盖。',
      'H3 六边形在底图上形变：文档说明 DGGS 投影特性，必要时切 S2 / rHEALPix。',
      'LOD 抖动 / 白屏：双阈值滞回 + 保留上一层级 + 增量 diff。'
    ]
  }
]

export const ENGINEERING: Array<{ item: string; choice: string; note: string }> = [
  { item: '三维引擎', choice: 'CesiumJS（1.10x 及以上，ESM）', note: 'Primitive 级 API、相机事件、GroundPolyline / ClassificationPrimitive' },
  { item: 'DGGS 库', choice: 'h3-js ^4.x（默认）；预留 s2 适配器', note: '纯 JS、浏览器可用、与 C API 全兼容（官方绑定）' },
  { item: '语言 / 构建', choice: 'TypeScript + Vite', note: 'Worker 用 new Worker(new URL(...)) 打包' },
  { item: '测试', choice: 'Vitest + Playwright', note: '编码算法 golden test；E2E 渲染截图回归（每网格、每 LOD 级）' },
  { item: '底图', choice: '天地图 / OSM / ArcGIS 影像', note: '网格作为独立图层叠加，不依赖底图类型' }
]
