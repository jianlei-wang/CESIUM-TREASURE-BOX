import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'free-line',
  title: '自由线-随手手绘线条',
  category: 'draw',
  description: '左键单击并拖拽即可绘制自由线条（类手绘），右键结束；支持颜色、线宽与不透明度实时调整。',
  tag: '线绘制',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
