import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const PolygonSlopeAspectDemo = defineAsyncComponent(() => import('./PolygonSlopeAspectDemo.vue'))

const polygonSlopeAspectCase: DemoCard = {
  id: 'polygon-slope-aspect',
  title: '空间分析-多边形坡度/坡向',
  category: 'analysis',
  description: '手动绘制多边形，自动采样地形生成坡度图并计算 8 方向坡向箭头，支持坡度图/坡向显示控制与密度/长度/配色/阈值等参数设置',
  tag: '空间分析',
  icon,
  component: PolygonSlopeAspectDemo,
  updatedAt: '2026-09-03'
}

export default polygonSlopeAspectCase
