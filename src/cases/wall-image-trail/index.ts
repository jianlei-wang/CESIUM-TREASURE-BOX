import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const WallImageTrailDemo = defineAsyncComponent(() => import('./WallImageTrailDemo.vue'))

const WallImageTrailCase: DemoCard = {
  id: 'wall-image-trail',
  title: '三维特效-流动图片墙体效果',
  category: 'effects',
  icon,
  description: '箭头纹理图片墙体水平流动，支持颜色、流动速度、重复次数、墙宽、墙深、墙高实时调节，可点击地图定位墙体位置',
  tag: '流动图片墙体',
  component: WallImageTrailDemo,
  updatedAt: '2026-09-01'
}

export default WallImageTrailCase
