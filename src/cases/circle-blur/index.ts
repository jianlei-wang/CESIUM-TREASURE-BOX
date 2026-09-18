import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CircleBlurDemo = defineAsyncComponent(() => import('./CircleBlurDemo.vue'))

const CircleBlurCase: DemoCard = {
  id: 'circle-blur',
  title: '三维特效-模糊圆效果',
  category: 'effects',
  icon,
  description: '随时间呼吸缩放并渐隐的模糊圆效果，支持颜色、呼吸速度、半径、高度等参数实时调节，可点击地图定位',
  tag: '模糊圆',
  component: CircleBlurDemo,
  updatedAt: '2026-08-31'
}

export default CircleBlurCase
