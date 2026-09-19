import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const RidgeValleyDemo = defineAsyncComponent(() => import('./RidgeValleyDemo.vue'))

const ridgeValleyCase: DemoCard = {
  id: 'ridge-valley-extraction',
  title: '山脊线与山谷线提取',
  category: 'analysis',
  description:
    '基于 Cesium 真实地形的山脊线/山谷线自动提取：在地图上绘制分析区域后按米级间距采样全球地形生成 DEM，焦点统计区分正负地形，山脊沿原始 DEM、山谷沿反地形分别执行填洼、D8 流向与汇流累积，提取零汇流候选后经邻域统计与阈值筛选，最终用 Zhang-Suen 细化与折线矢量化输出结果；支持栅格图层化渲染与图例说明、晕渲与太阳光照调节、线要素样式定制、技术路线说明、耗时统计、分析报告在线预览与 PDF 导出，以及 GeoJSON / PNG 导出',
  tag: 'Cesium, 水文分析, 山脊线, 山谷线, 矢量化',
  icon,
  component: RidgeValleyDemo,
  updatedAt: '2026-09-19'
}

export default ridgeValleyCase
