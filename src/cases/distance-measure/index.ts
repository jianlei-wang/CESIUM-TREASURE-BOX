import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const DistanceMeasureDemo = defineAsyncComponent(() => import('./DistanceMeasureDemo.vue'))
import icon from './icon.webp'

const distanceMeasureCase: DemoCard = {
  id: 'distance-measure',
  title: '空间测量-距离量测',
  category: 'measure',
  description: '空间/地表/投影距离量测，含地形与三维模型，实时鼠标提示',
  tag: '测量',
  component: DistanceMeasureDemo,
  icon,
  updatedAt: '2026-08-24'
}

export default distanceMeasureCase
