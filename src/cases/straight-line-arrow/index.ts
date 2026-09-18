import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'straight-line-arrow',
  title: '直线箭头-单段直箭头',
  category: 'draw',
  description: '左键确定起点并拖拽拉伸，右键结束生成直线进攻箭头；线宽与颜色可调。',
  tag: '箭头',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
