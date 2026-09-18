import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CirclePulseDemo = defineAsyncComponent(() => import('./CirclePulseDemo.vue'))

const CirclePulseCase: DemoCard = {
  id: 'circle-pulse',
  title: '三维特效-脉冲圆效果',
  category: 'effects',
  icon,
  description: '高频闪烁的脉冲圆效果，支持颜色、脉冲频率、半径、高度等参数实时调节，可点击地图定位',
  tag: '脉冲圆',
  component: CirclePulseDemo,
  updatedAt: '2026-08-31'
}

export default CirclePulseCase
