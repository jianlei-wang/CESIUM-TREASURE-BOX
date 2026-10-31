import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const HelperIsoDemo = defineAsyncComponent(() => import('./HelperIsoDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-iso',
  title: '等轴测视图',
  category: 'scene',
  description: '游戏式等轴测正交视角，可四分之一转、平移、缩放并配合玩具化后期',
  tag: '场景工具',
  component: HelperIsoDemo,
  updatedAt: '2026-10-30'
}

export default caseItem
