import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const AffectAreaDemo = defineAsyncComponent(() => import('./AffectAreaDemo.vue'))

const affectAreaCase: DemoCard = {
  id: 'affect-area',
  title: '影响区域-多层扩散光圈',
  category: 'effects',
  description: '多圈带流向箭头的覆盖光圈 + 内圈扩散脉冲，标注影响范围',
  tag: '影响区域',
  icon,
  component: AffectAreaDemo,
  updatedAt: '2026-09-06'
}

export default affectAreaCase
