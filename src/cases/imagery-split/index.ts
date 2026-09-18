import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const ImagerySplitDemo = defineAsyncComponent(() => import('./ImagerySplitDemo.vue'))
import icon from './icon.webp'

const imagerySplitCase: DemoCard = {
  id: 'imagery-split',
  title: '卷帘分析-影像对比',
  category: 'analysis',
  description: '左右加载不同影像地图并通过卷帘滑块进行对比',
  tag: '影像分析',
  icon,
  component: ImagerySplitDemo,
  updatedAt: '2026-08-23'
}

export default imagerySplitCase
