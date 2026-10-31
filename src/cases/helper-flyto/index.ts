import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const HelperFlytoDemo = defineAsyncComponent(() => import('./HelperFlytoDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-flyto',
  title: '双击飞行',
  category: 'scene',
  description: '双击地面沿视线飞向目标点，带运动模糊与景深',
  tag: '场景工具',
  component: HelperFlytoDemo,
  updatedAt: '2026-10-30'
}

export default caseItem
