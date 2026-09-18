import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const AreaMeasureDemo = defineAsyncComponent(() => import('./AreaMeasureDemo.vue'))
import icon from './icon.webp'

const areaMeasureCase: DemoCard = {
  id: 'area-measure',
  title: '空间测量-面积量测',
  category: 'measure',
  description: '空间/地表/投影面积量测，含地形与三维模型，实时显示填充面与重心结果',
  tag: '测量',
  component: AreaMeasureDemo,
  icon,
  updatedAt: '2026-08-24'
}

export default areaMeasureCase
