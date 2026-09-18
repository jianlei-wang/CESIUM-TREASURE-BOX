import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CircleFadeDemo = defineAsyncComponent(() => import('./CircleFadeDemo.vue'))

const circleFadeCase: DemoCard = {
  id: 'circle-fade',
  title: '三维特效-圆(逐渐消逝)',
  category: 'effects',
  icon,
  description: '从内向外逐渐消逝的圆环效果，支持颜色、消逝速度、半径、高度等参数实时调节，可点击地图定位',
  tag: '逐渐消逝',
  component: CircleFadeDemo,
  updatedAt: '2026-08-31'
}

export default circleFadeCase
