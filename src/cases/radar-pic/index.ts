import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const RadarPicDemo = defineAsyncComponent(() => import('./RadarPicDemo.vue'))

const radarPicCase: DemoCard = {
  id: 'radar-pic',
  title: '三维特效-雷达图片',
  category: 'effects',
  icon,
  description: '以扫描图片为纹理并持续旋转的雷达效果，支持颜色、旋转速度、半径、高度等参数实时调节，可点击地图定位',
  tag: '雷达图片',
  component: RadarPicDemo,
  updatedAt: '2026-08-31'
}

export default radarPicCase
