import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const PolylineCreateDemo = defineAsyncComponent(() => import('./PolylineCreateDemo.vue'))
import icon from './icon.webp'

const polylineCreateCase: DemoCard = {
  id: 'polyline-create',
  title: '线面绘制-动态折线',
  category: 'draw',
  description: '鼠标点击地图动态创建折线，支持线宽、颜色、线型、贴地等参数',
  tag: '线绘制',
  component: PolylineCreateDemo,
  icon,
  updatedAt: '2026-08-26'
}

export default polylineCreateCase
