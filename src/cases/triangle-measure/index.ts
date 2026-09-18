import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const TriangleMeasureDemo = defineAsyncComponent(() => import('./TriangleMeasureDemo.vue'))
import icon from './icon.webp'

const triangleMeasureCase: DemoCard = {
  id: 'triangle-measure',
  title: '空间测量-三角量测',
  category: 'measure',
  description: '两点直角三角形水平/垂直距离与斜边夹角量测，含地形与三维模型',
  tag: '测量',
  component: TriangleMeasureDemo,
  icon,
  updatedAt: '2026-08-24'
}

export default triangleMeasureCase
