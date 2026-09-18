import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const PolygonCreateDemo = defineAsyncComponent(() => import('./PolygonCreateDemo.vue'))
import icon from './icon.webp'

const polygonCreateCase: DemoCard = {
  id: 'polygon-create',
  title: '线面绘制-动态多边形面',
  category: 'draw',
  description: '鼠标点击地图动态创建多边形面，支持填充色、透明度、边框、高度等参数',
  tag: '面绘制',
  component: PolygonCreateDemo,
  icon,
  updatedAt: '2026-08-26'
}

export default polygonCreateCase
