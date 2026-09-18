import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const WaterPolygonDemo = defineAsyncComponent(() => import('./WaterPolygonDemo.vue'))
import icon from './icon.webp'

const waterPolygonCase: DemoCard = {
  id: 'water-polygon',
  title: '水面效果-动态多边形',
  category: 'water',
  description: '根据多边形边界生成动态波浪水面',
  tag: '材质效果',
  component: WaterPolygonDemo,
  icon,
  updatedAt: '2026-08-23'
}

export default waterPolygonCase
