import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const DemoTri = defineAsyncComponent(() => import('./DemoTri.vue'))

const terrainRuggednessIndexCase: DemoCard = {
  id: 'terrain-ruggedness-index',
  title: '地形崎岖率（TRI）分析',
  category: 'analysis',
  description:
    '基于 Cesium 真实地形采样或导入 DEM，在自绘多边形分析区内计算地形崎岖率 TRI：对每个像元统计与八邻域的高程差异，支持 Riley（平方和开方）与 Wilson（绝对差均值）两种口径，经可选平滑后分位数分级设色，并用 Marching Squares 提取崎岖区等值线；支持真实地形采集/导入 DEM、区域绘制、参数提示、图例与结果说明、技术路线、在线报告与 PDF 导出，以及 GeoTIFF 栅格与 SHP/GeoJSON 矢量输出。',
  tag: 'Cesium, 地形分析, TRI, 崎岖率, 邻域高程差',
  icon,
  component: DemoTri,
  updatedAt: '2026-09-19'
}

export default terrainRuggednessIndexCase
