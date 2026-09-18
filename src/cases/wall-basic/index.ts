import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const WallBasicDemo = defineAsyncComponent(() => import('./WallBasicDemo.vue'))

const WallBasicCase: DemoCard = {
  id: 'wall-basic',
  title: '三维特效-基础墙体效果',
  category: 'effects',
  icon,
  description: '基础墙体按位置高度竖立显示，支持颜色、透明度、墙宽、墙深、墙高实时调节，可点击地图定位墙体位置',
  tag: '基础墙体',
  component: WallBasicDemo,
  updatedAt: '2026-09-01'
}

export default WallBasicCase
