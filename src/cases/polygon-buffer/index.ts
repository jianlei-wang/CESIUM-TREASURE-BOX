import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const PolygonBufferDemo = defineAsyncComponent(() => import('./PolygonBufferDemo.vue'))
import icon from './icon.webp'

const polygonBufferCase: DemoCard = {
  id: 'polygon-buffer',
  title: '空间分析-面缓冲区分析',
  category: 'analysis',
  description: '动态绘制多边形面，按缓冲值(m)生成缓冲区，支持圆角/方角端点与拐角',
  tag: '缓冲区',
  icon,
  component: PolygonBufferDemo,
  updatedAt: '2026-08-26'
}

export default polygonBufferCase
