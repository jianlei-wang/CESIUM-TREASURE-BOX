import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const BearingMeasureDemo = defineAsyncComponent(() => import('./BearingMeasureDemo.vue'))
import icon from './icon.webp'

const bearingMeasureCase: DemoCard = {
  id: 'bearing-measure',
  title: '空间测量-方位角量测',
  category: 'measure',
  description: '两点方位角与方向象限量测，带箭头指北/垂直参考线，含地形与三维模型',
  tag: '测量',
  component: BearingMeasureDemo,
  icon,
  updatedAt: '2026-08-24'
}

export default bearingMeasureCase
