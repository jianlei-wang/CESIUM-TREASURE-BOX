import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const Tiles3DLoadDemo = defineAsyncComponent(() => import('./Tiles3DLoadDemo.vue'))
import icon from './icon.webp'

const tiles3DLoadCase: DemoCard = {
  id: 'tiles-3d-load',
  title: '3DTiles加载',
  category: 'tiles',
  description: '加载远程倾斜摄影 3DTiles 模型并支持定位与阴影',
  tag: '模型加载',
  component: Tiles3DLoadDemo,
  icon,
  updatedAt: '2026-08-26'
}

export default tiles3DLoadCase
