import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const HelperFirstPersonDemo = defineAsyncComponent(() => import('./HelperFirstPersonDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-first-person',
  title: '第一人称漫游',
  category: 'scene',
  description: '指针锁定式第一人称模式，移动鼠标环视、滚轮调节视场',
  tag: '场景工具',
  icon,
  component: HelperFirstPersonDemo,
  updatedAt: '2026-11-10'
}

export default caseItem
