import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'
const Demo = defineAsyncComponent(() => import('./Demo.vue'))

const caseItem: DemoCard = {
  id: 'regular-polygon',
  title: '正多边形-规则多边形面',
  category: 'draw',
  description: '左键定位中心并拖拽决定外接半径，右键结束；边数（3~12）与颜色实时可调。',
  tag: '面绘制',
  icon,
  component: Demo,
  updatedAt: '2026-09-06'
}

export default caseItem
