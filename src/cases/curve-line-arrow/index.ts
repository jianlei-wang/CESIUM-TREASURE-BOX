import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'curve-line-arrow',
  title: '曲线箭头-贝塞尔曲箭头',
  category: 'draw',
  description: '左键逐点确定曲线路径、右键结束，生成沿曲线前进的箭头；线宽与颜色可调。',
  tag: '箭头',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
