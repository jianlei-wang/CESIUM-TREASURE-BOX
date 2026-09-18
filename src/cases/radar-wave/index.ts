import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const RadarWaveDemo = defineAsyncComponent(() => import('./RadarWaveDemo.vue'))

const RadarWaveCase: DemoCard = {
  id: 'radar-wave',
  title: '三维特效-波纹雷达效果',
  category: 'effects',
  icon,
  description: '旋转扇形扫描与波浪纹理结合的雷达效果，支持颜色、扫描速度、半径、高度等参数实时调节，可点击地图定位',
  tag: '波纹雷达',
  component: RadarWaveDemo,
  updatedAt: '2026-08-31'
}

export default RadarWaveCase
