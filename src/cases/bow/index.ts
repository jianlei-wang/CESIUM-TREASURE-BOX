import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'bow',
  title: '弓形-弓形弧面区域',
  category: 'draw',
  description: '左键确定起始点后拖拽成形、右键结束，生成弓形(弧形)区域；颜色可调。',
  tag: '形状',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
