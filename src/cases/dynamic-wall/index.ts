import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const DynamicWallDemo = defineAsyncComponent(() => import('./DynamicWallDemo.vue'))
const dynamicWallCase: DemoCard = {
  id: 'dynamic-wall',
  title: '三维特效-动态围墙',
  category: 'effects',
  description: '沿绘制路径生成带流动纹理的动态围墙，支持颜色、流动速度、纹理重复、墙高与底部高度等参数实时调节',
  tag: '动态墙',
  icon,
  component: DynamicWallDemo,
  updatedAt: '2026-08-27'
}

export default dynamicWallCase
