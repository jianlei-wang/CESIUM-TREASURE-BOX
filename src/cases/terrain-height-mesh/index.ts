import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const terrainHeightMeshCase: DemoCard = {
  id: 'terrain-height-mesh',
  title: '空间分析-地形高度场·自请瓦片光栅化',
  category: 'analysis',
  description: '向 TerrainProvider 自请瓦片并构建三角网格，光栅化为规则高度场，不依赖相机与场景',
  tag: '空间分析',
  icon,
  component: Demo
}

export default terrainHeightMeshCase
