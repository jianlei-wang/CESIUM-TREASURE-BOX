import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CircleSpiralDemo = defineAsyncComponent(() => import('./CircleSpiralDemo.vue'))

const CircleSpiralCase: DemoCard = {
  id: 'circle-spiral',
  title: '三维特效-螺旋圆效果',
  category: 'effects',
  icon,
  description: '旋转扩散的螺旋线圆效果，支持颜色、旋转速度、半径、高度等参数实时调节，可点击地图定位',
  tag: '螺旋圆',
  component: CircleSpiralDemo,
  updatedAt: '2026-08-31'
}

export default CircleSpiralCase
