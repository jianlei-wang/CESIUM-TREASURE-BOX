import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const terrainHeightPickCase: DemoCard = {
  id: 'terrain-height-pick',
  title: '空间分析-地形高度场·拾取深度反投影',
  category: 'analysis',
  description: '复用拾取相机深度缓冲，顶视正交渲染后反投影高度，唯一包含建筑与 3D Tiles 的方案',
  tag: '空间分析',
  icon,
  component: Demo
}

export default terrainHeightPickCase
