import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const Heatmap3DDemo = defineAsyncComponent(() => import('./Heatmap3DDemo.vue'))
import iconUrl from './icon.webp'

const heatmap3DCase: DemoCard = {
  id: 'heatmap-3d',
  title: '数据分析-三维热力图',
  category: 'data',
  description: '通过数据采样构建的三维热力网格与面状地形',
  tag: '三维数据',
  icon: iconUrl,
  component: Heatmap3DDemo,
  updatedAt: '2026-08-27'
}

export default heatmap3DCase
