import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'swallowtail-arrow',
  title: '燕尾箭头-双尾箭头',
  category: 'draw',
  description: '两段拖拽/落点生成带燕尾开叉的战术箭头；颜色可调。',
  tag: '箭头',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
