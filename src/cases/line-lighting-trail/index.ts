import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LineLightingTrailDemo = defineAsyncComponent(() => import('./LineLightingTrailDemo.vue'))

const LineLightingTrailCase: DemoCard = {
  id: 'line-lighting-trail',
  title: '三维特效-发光轨迹线效果',
  category: 'effects',
  icon,
  description: '光照贴图配合中心高亮亮线沿路径流动，支持颜色、流动速度、线宽实时调节，可点击地图平移折线',
  tag: '发光轨迹线',
  component: LineLightingTrailDemo,
  updatedAt: '2026-09-01'
}

export default LineLightingTrailCase
