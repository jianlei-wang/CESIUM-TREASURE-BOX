import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const HelperIsoDemo = defineAsyncComponent(() => import('./HelperIsoDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-iso',
  title: '等轴测视图',
  category: 'scene',
  description: '游戏式等轴测正交视角，可四分之一转、平移、缩放并配合玩具化后期',
  tag: '场景工具',
  icon,
  component: HelperIsoDemo,
  updatedAt: '2026-11-10'
}

export default caseItem
