import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const LineFlowDemo = defineAsyncComponent(() => import('./LineFlowDemo.vue'))

const LineFlowCase: DemoCard = {
  id: 'line-flow',
  title: '三维特效-流动线效果',
  category: 'effects',
  icon,
  description: '发光段沿路径流动，支持单色与多色（每段一色）两种模式，颜色、速度、段长、渐变、线宽实时调节，可点击地图平移折线',
  tag: '流动线',
  component: LineFlowDemo,
  updatedAt: '2026-09-01'
}

export default LineFlowCase
