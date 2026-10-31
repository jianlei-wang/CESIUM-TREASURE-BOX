import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const HelperPostProcessDemo = defineAsyncComponent(() => import('./HelperPostProcessDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-post-process',
  title: '屏幕后期特效',
  category: 'effects',
  description: '19 种屏幕空间后期特效：胶片、红外、移轴、雨雪、云雾、无人机图传等',
  tag: '后期特效',
  component: HelperPostProcessDemo,
  updatedAt: '2026-10-30'
}

export default caseItem
