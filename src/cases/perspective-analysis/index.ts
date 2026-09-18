import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const PerspectiveAnalysisDemo = defineAsyncComponent(() => import('./PerspectiveAnalysisDemo.vue'))
import icon from './icon.webp'

const perspectiveAnalysisCase: DemoCard = {
  id: 'perspective-analysis',
  title: '空间分析-通视分析',
  category: 'analysis',
  description: '分段比较实际高程与理论高程，判定观测点与被观测点之间是否通视',
  tag: '空间分析',
  icon,
  component: PerspectiveAnalysisDemo
}

export default perspectiveAnalysisCase
