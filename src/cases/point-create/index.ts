import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const PointCreateDemo = defineAsyncComponent(() => import('./PointCreateDemo.vue'))
import icon from './icon.webp'

const pointCreateCase: DemoCard = {
  id: 'point-create',
  title: '标点创建-动态点标注',
  category: 'draw',
  description: '鼠标点击地图动态创建点标注，支持大小、颜色、高度、贴地等参数',
  tag: '点标记',
  component: PointCreateDemo,
  icon,
  updatedAt: '2026-08-26'
}

export default pointCreateCase
