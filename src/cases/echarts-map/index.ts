import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const component = defineAsyncComponent(() => import('./EChartsMapDemo.vue'))

export default {
  id: 'echarts-map',
  title: '数据可视化-ECharts图表',
  category: 'data',
  tag: '数据可视化',
  icon,
  description: '使用 ECharts 离屏渲染图表并转为图片，以 Billboard 方式叠加到三维场景',
  component
} as DemoCard
