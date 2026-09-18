import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const DiffuseWallDemo = defineAsyncComponent(() => import('./DiffuseWallDemo.vue'))

const DiffuseWallCase: DemoCard = {
  id: 'diffuse-wall',
  title: '三维特效-扩散墙',
  category: 'effects',
  icon,
  description: '扩散墙，环形墙体从中心向外扩散、高度随之变化循环往复，支持半径、墙高与扩散速度调节',
  tag: '扩散墙',
  component: DiffuseWallDemo,
  updatedAt: '2026-09-01'
}

export default DiffuseWallCase
