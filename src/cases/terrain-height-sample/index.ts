import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const terrainHeightSampleCase: DemoCard = {
  id: 'terrain-height-sample',
  title: '空间分析-地形高度场·服务端采样',
  category: 'analysis',
  description: 'sampleTerrainMostDetailed 向地形服务采样规则网格高度场，作为五种方案的精度基准',
  tag: '空间分析',
  icon,
  component: Demo
}

export default terrainHeightSampleCase
