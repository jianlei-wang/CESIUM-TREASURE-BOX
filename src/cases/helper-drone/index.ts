import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const HelperDroneDemo = defineAsyncComponent(() => import('./HelperDroneDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-drone',
  title: '穿越机模拟',
  category: 'scene',
  description: '街机式穿越机飞行，含碰撞、图传噪点、干扰区与控制失联',
  tag: '场景示例',
  icon,
  component: HelperDroneDemo,
  updatedAt: '2026-11-10'
}

export default caseItem
