import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'staging-area',
  title: '集结地-驻训集结区域',
  category: 'draw',
  description: '左键拖拽绘制集结区域边界，右键结束；常用于标注兵力集结地；颜色可调。',
  tag: '形状',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
