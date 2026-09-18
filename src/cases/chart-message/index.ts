import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const component = defineAsyncComponent(() => import('./ChartMessageDemo.vue'))

const chartMessageCase: DemoCard = {
  id: 'chart-message',
  title: '数据可视化-信息发送效果',
  category: 'data',
  description: '在 cesium-chart 的 GLMap 坐标系上，将 ECharts 迁徙流线、涟漪散点与大头针渲染到三维地球，模拟各省份向目标城市发送信息',
  tag: 'cesium-chart',
  icon,
  component,
  updatedAt: '2026-08-30'
}

export default chartMessageCase
