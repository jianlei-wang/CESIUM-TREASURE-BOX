import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const RadarLineDemo = defineAsyncComponent(() => import('./RadarLineDemo.vue'))

const RadarLineCase: DemoCard = {
  id: 'radar-line',
  title: '三维特效-雷达线效果',
  category: 'effects',
  icon,
  description: '旋转扫描的雷达扫描线效果，支持颜色、扫描速度、半径、高度等参数实时调节，可点击地图定位',
  tag: '雷达线',
  component: RadarLineDemo,
  updatedAt: '2026-08-31'
}

export default RadarLineCase
