import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const Tiles3DFlattenDemo = defineAsyncComponent(() => import('./Tiles3DFlattenDemo.vue'))
import icon from './icon.webp'

const tiles3DFlattenCase: DemoCard = {
  id: 'tiles-3d-flatten',
  title: '3DTiles模型压平',
  category: 'tiles',
  description: '自定义着色器实现 3DTiles 倾斜摄影区域压平',
  tag: '模型处理',
  component: Tiles3DFlattenDemo,
  icon,
  updatedAt: '2026-08-26'
}

export default tiles3DFlattenCase
