import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'flag-regular-triangle',
  title: '正三角旗标-正三角旗帜',
  category: 'draw',
  description: '左键定起点拖至终点，右键完成生成正三角旗标；颜色可调。',
  tag: '旗标',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
