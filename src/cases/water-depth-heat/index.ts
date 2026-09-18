import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const WaterDepthHeatDemo = defineAsyncComponent(() => import('./WaterDepthHeatDemo.vue'))
import iconUrl from './icon.webp'

const waterDepthHeatCase: DemoCard = {
  id: 'water-depth-heat',
  title: '数据分析-三维水深热力',
  category: 'water',
  description: '测深点采样与多方法插值的三维水深热力网格',
  tag: '插值分析',
  icon: iconUrl,
  component: WaterDepthHeatDemo,
  updatedAt: '2026-08-26'
}

export default waterDepthHeatCase
