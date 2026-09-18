import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'round-rectangle',
  title: '圆角矩形-圆角区域框',
  category: 'draw',
  description: '左键确定一角并拖拽成形、右键结束，生成圆角矩形区域；颜色可调。',
  tag: '形状',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
