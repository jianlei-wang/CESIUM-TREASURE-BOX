import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const HelperFlytoDemo = defineAsyncComponent(() => import('./HelperFlytoDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-flyto',
  title: '双击飞行',
  category: 'scene',
  description: '双击地面沿视线飞向目标点，带运动模糊与景深',
  tag: '场景工具',
  icon,
  component: HelperFlytoDemo,
  updatedAt: '2026-11-10'
}

export default caseItem
