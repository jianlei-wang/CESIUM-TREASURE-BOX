import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LineMaterialDemo = defineAsyncComponent(() => import('./LineMaterialDemo.vue'))

const LineMaterialCase: DemoCard = {
  id: 'line-material',
  title: '三维特效-材质线效果',
  category: 'effects',
  icon,
  description: '支持 10 种材质线样例（分段尾迹/流动/栅栏/多箭头/虚线箭头/方向/发光/闪烁等），切换后参数实时联动，可点击地图平移整条折线',
  tag: '材质线',
  component: LineMaterialDemo,
  updatedAt: '2026-09-01'
}

export default LineMaterialCase
