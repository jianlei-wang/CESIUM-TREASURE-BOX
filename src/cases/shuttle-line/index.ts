import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const ShuttleLineDemo = defineAsyncComponent(() => import('./ShuttleLineDemo.vue'))

const shuttleLineCase: DemoCard = {
  id: 'shuttle-line',
  title: '穿梭流光道路线',
  category: 'effects',
  description: 'GeoJSON 路网加载穿梭流光材质，亮带沿道路方向持续流动',
  tag: '流光线',
  icon,
  component: ShuttleLineDemo,
  updatedAt: '2026-09-06'
}

export default shuttleLineCase
