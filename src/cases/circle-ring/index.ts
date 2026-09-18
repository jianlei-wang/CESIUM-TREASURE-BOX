import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CircleRingDemo = defineAsyncComponent(() => import('./CircleRingDemo.vue'))

const circleRingCase: DemoCard = {
  id: 'circle-ring',
  title: '三维特效-动画圆',
  category: 'effects',
  icon,
  description: '动态双环动画圆效果，支持颜色、动画速度、半径、高度等参数实时调节，可点击地图定位',
  tag: '动画圆',
  component: CircleRingDemo,
  updatedAt: '2026-08-31'
}

export default circleRingCase
