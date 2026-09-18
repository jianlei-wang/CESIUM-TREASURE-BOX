import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const HeightMeasureDemo = defineAsyncComponent(() => import('./HeightMeasureDemo.vue'))
import icon from './icon.webp'

const heightMeasureCase: DemoCard = {
  id: 'height-measure',
  title: '空间测量-高度量测',
  category: 'measure',
  description: '两点高度与高差量测，含地形与三维模型，实时鼠标提示',
  tag: '测量',
  component: HeightMeasureDemo,
  icon,
  updatedAt: '2026-08-24'
}

export default heightMeasureCase
