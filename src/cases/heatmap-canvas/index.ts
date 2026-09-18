import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const HeatmapCanvasDemo = defineAsyncComponent(() => import('./HeatmapCanvasDemo.vue'))
import iconUrl from './icon.webp'

const heatmapCanvasCase: DemoCard = {
  id: 'heatmap-canvas',
  title: '数据分析-热力图',
  category: 'data',
  description: '数据驱动的 Canvas 密度热力图动态渲染',
  tag: '数据可视化',
  icon: iconUrl,
  component: HeatmapCanvasDemo,
  updatedAt: '2026-08-27'
}

export default heatmapCanvasCase
