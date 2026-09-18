import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'polyline',
  title: '折线-连续节点直线',
  category: 'draw',
  description: '左键逐点落线、右键闭合，绘制由直线段组成的折线；支持颜色、线宽与不透明度实时调整。',
  tag: '线绘制',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
