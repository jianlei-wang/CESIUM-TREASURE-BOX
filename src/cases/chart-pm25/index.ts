import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const component = defineAsyncComponent(() => import('./ChartPm25Demo.vue'))

const chartPm25Case: DemoCard = {
  id: 'chart-pm25',
  title: '数据可视化-PM2.5分布',
  category: 'data',
  description: '在 cesium-chart 的 GLMap 坐标系上，用 ECharts 散点图在全国地图上呈现 190 个城市 PM2.5 浓度分布，Top6 城市叠加涟漪特效',
  tag: 'cesium-chart',
  icon,
  component,
  updatedAt: '2026-08-30'
}

export default chartPm25Case
