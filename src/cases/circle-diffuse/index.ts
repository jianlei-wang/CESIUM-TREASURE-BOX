import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CircleDiffuseDemo = defineAsyncComponent(() => import('./CircleDiffuseDemo.vue'))

const CircleDiffuseCase: DemoCard = {
  id: 'circle-diffuse',
  title: '三维特效-扩散圆效果',
  category: 'effects',
  icon,
  description: '持续向外扩散的雷达式扩散圆效果，支持颜色、扩散速度、半径、高度等参数实时调节，可点击地图定位',
  tag: '扩散圆',
  component: CircleDiffuseDemo,
  updatedAt: '2026-08-31'
}

export default CircleDiffuseCase
