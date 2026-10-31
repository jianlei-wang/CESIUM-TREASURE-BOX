import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const HelperWalkDemo = defineAsyncComponent(() => import('./HelperWalkDemo.vue'))

const caseItem: DemoCard = {
  id: 'helper-walk',
  title: '步行漫游',
  category: 'scene',
  description: '键盘步行模式，贴合地形行走并支持碰撞检测',
  tag: '场景工具',
  component: HelperWalkDemo,
  updatedAt: '2026-10-30'
}

export default caseItem
