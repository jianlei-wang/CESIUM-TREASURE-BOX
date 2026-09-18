import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'free-polygon',
  title: '自由面-拖拽围合区域',
  category: 'draw',
  description: '左键按下拖拽围合不规则区域，右键结束生成自由面；支持颜色与不透明度实时调整。',
  tag: '面绘制',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
