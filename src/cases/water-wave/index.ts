import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const WaterWaveDemo = defineAsyncComponent(() => import('./WaterWaveDemo.vue'))
const waterWaveCase: DemoCard = {
  id: 'water-wave',
  title: '三维特效-水波纹效果',
  category: 'effects',
  description: '点击地图创建动态水波纹，支持颜色、持续时间、波浪数量、渐变曲率、半径、高度等参数实时调节',
  tag: '水波纹',
  icon,
  component: WaterWaveDemo,
  updatedAt: '2026-08-27'
}

export default waterWaveCase
