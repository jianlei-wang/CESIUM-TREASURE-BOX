import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const component = defineAsyncComponent(() => import('./ChartMigrateDemo.vue'))

const chartMigrateCase: DemoCard = {
  id: 'chart-migrate',
  title: '数据可视化-模拟迁徙效果',
  category: 'data',
  description: '在 cesium-chart 的 GLMap 坐标系上，用 ECharts 双层流动线、飞机符号特效与涟漪散点，模拟北京/上海/广州三大枢纽的客流迁徙',
  tag: 'cesium-chart',
  icon,
  component,
  updatedAt: '2026-08-30'
}

export default chartMigrateCase
