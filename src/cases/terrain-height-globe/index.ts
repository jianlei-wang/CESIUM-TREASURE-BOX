import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const terrainHeightGlobeCase: DemoCard = {
  id: 'terrain-height-globe',
  title: '空间分析-地形高度场·getHeight同步查询',
  category: 'analysis',
  description: 'globe.getHeight 同步读取已加载瓦片，先瞬移相机并等待 LOD 精化，避免 -17km 无效高度',
  tag: '空间分析',
  icon,
  component: Demo
}

export default terrainHeightGlobeCase
