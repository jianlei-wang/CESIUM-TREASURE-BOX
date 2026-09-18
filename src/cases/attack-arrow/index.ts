import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'attack-arrow',
  title: '进攻箭头-指挥进攻方向',
  category: 'draw',
  description: '多个左键控制点描绘进攻轴线与包夹形态，右键结束生成进攻(战术)箭头；颜色可调。',
  tag: '箭头',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
