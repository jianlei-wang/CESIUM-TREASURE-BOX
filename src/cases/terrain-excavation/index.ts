import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const TerrainExcavationDemo = defineAsyncComponent(() => import('./TerrainExcavationDemo.vue'))
import icon from './icon.webp'

const terrainExcavationCase: DemoCard = {
  id: 'terrain-excavation',
  title: '空间分析-地形开挖(支持凹边形)',
  category: 'analysis',
  description: '采用 Globe ClippingPolygons 裁剪地形，支持凹边形基坑开挖效果',
  tag: '空间分析',
  icon,
  component: TerrainExcavationDemo
}

export default terrainExcavationCase
