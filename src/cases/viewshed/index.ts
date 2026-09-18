import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const ViewshedDemo = defineAsyncComponent(() => import('./ViewshedDemo.vue'))
const viewshedCase: DemoCard = {
  id: 'viewshed',
  title: '空间分析-可视域分析',
  category: 'analysis',
  description: '采用阴影映射的球面可视域分析，支持近/远截面、水平/垂直夹角、方向旋转与阴影分辨率等参数',
  tag: '空间分析',
  icon,
  component: ViewshedDemo,
  updatedAt: '2026-08-27'
}

export default viewshedCase
