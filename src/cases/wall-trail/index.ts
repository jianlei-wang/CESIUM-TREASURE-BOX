import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const WallTrailDemo = defineAsyncComponent(() => import('./WallTrailDemo.vue'))

const WallTrailCase: DemoCard = {
  id: 'wall-trail',
  title: '三维特效-流动墙体效果',
  category: 'effects',
  icon,
  description: '栅栏纹理墙体向上流动，支持颜色、流动速度、墙宽、墙深、墙高实时调节，可点击地图定位墙体位置',
  tag: '流动墙体',
  component: WallTrailDemo,
  updatedAt: '2026-09-01'
}

export default WallTrailCase
