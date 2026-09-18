import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'right-angle-arrow',
  title: '直角箭头-折线转角箭头',
  category: 'draw',
  description: '左键连续落点形成直角折线走向，右键结束生成直角箭头；颜色可调。',
  tag: '箭头',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
