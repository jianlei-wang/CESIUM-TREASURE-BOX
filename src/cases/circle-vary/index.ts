import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CircleVaryDemo = defineAsyncComponent(() => import('./CircleVaryDemo.vue'))

const CircleVaryCase: DemoCard = {
  id: 'circle-vary',
  title: '三维特效-多彩圆效果',
  category: 'effects',
  icon,
  description: '多彩渐变动态圆效果，支持颜色、变化速度、半径、高度等参数实时调节，可点击地图定位',
  tag: '多彩圆',
  component: CircleVaryDemo,
  updatedAt: '2026-08-31'
}

export default CircleVaryCase
