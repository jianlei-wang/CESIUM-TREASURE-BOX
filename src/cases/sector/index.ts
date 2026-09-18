import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'sector',
  title: '扇形-扇形作用区域',
  category: 'draw',
  description: '左键定位圆心与半径方向并拖拽扫出扇角，右键结束；颜色可调。',
  tag: '形状',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
