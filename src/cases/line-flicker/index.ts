import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LineFlickerDemo = defineAsyncComponent(() => import('./LineFlickerDemo.vue'))

const LineFlickerCase: DemoCard = {
  id: 'line-flicker',
  title: '三维特效-闪烁线效果',
  category: 'effects',
  icon,
  description: '整条线按频率明暗闪烁，支持颜色、闪烁频率、线宽实时调节，可点击地图平移折线',
  tag: '闪烁线',
  component: LineFlickerDemo,
  updatedAt: '2026-09-01'
}

export default LineFlickerCase
