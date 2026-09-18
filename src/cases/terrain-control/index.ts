import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const TerrainControlDemo = defineAsyncComponent(() => import('./TerrainControlDemo.vue'))
import icon from './icon.webp'

const terrainControlCase: DemoCard = {
  id: 'terrain-control',
  title: '地形效果-显示与夸张',
  category: 'tiles',
  description: '加载真实地形并控制地形显隐与高程夸张',
  tag: '地形控制',
  icon,
  component: TerrainControlDemo
}

export default terrainControlCase
