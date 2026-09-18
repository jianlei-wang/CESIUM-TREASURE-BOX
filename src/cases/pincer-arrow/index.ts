import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'pincer-arrow',
  title: '钳击箭头-双头钳形箭头',
  category: 'draw',
  description: '多个控制点生成两端带箭头、中间内收的钳击(双箭头)标绘；颜色可调。',
  tag: '箭头',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
