import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const PolygonDepthContourDemo = defineAsyncComponent(() => import('./PolygonDepthContourDemo.vue'))

const polygonDepthContourCase: DemoCard = {
  id: 'polygon-depth-contour',
  title: '空间分析-多边形深度图与等高线',
  category: 'analysis',
  description: '手动绘制多边形，自动采样地形提取多边形内深度图并生成等高线，支持显示控制与等高距/线宽/配色/标注等参数设置',
  tag: '空间分析',
  icon,
  component: PolygonDepthContourDemo,
  updatedAt: '2026-09-02'
}

export default polygonDepthContourCase
