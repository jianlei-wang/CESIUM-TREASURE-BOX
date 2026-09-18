import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LineImageTrailDemo = defineAsyncComponent(() => import('./LineImageTrailDemo.vue'))

const LineImageTrailCase: DemoCard = {
  id: 'line-image-trail',
  title: '三维特效-图片轨迹线效果',
  category: 'effects',
  icon,
  description: '箭头图片沿折线路径水平流动形成轨迹，支持颜色、流动速度、重复次数、线宽实时调节，可点击地图平移折线',
  tag: '图片轨迹线',
  component: LineImageTrailDemo,
  updatedAt: '2026-09-01'
}

export default LineImageTrailCase
