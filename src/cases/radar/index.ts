import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const RadarDemo = defineAsyncComponent(() => import('./RadarDemo.vue'))
const radarCase: DemoCard = {
  id: 'radar',
  title: '三维特效-雷达波效果',
  category: 'effects',
  description: '雷达锥体扫描波纹效果，支持方向角、锥体长度、底部半径、波纹厚度与数量、扫描周期、颜色等参数实时调节，可点击地图定位',
  tag: '雷达波',
  icon,
  component: RadarDemo,
  updatedAt: '2026-08-27'
}

export default radarCase
