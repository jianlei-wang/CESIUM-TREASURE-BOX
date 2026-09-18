import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'polygon',
  title: '多边形-逐点圈定区域',
  category: 'draw',
  description: '左键逐点圈定范围、右键闭合生成多边形面；支持颜色与不透明度实时调整。',
  tag: '面绘制',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
