import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const TemperatureSurfaceDemo = defineAsyncComponent(() => import('./TemperatureSurfaceDemo.vue'))

const temperatureSurfaceCase: DemoCard = {
  id: 'temperature-surface',
  title: '温度曲面可视化',
  category: 'data',
  description: '离散测温点经 IDW 插值生成三维温度曲面，高度与颜色映射温度，支持采样点数、网格、拉伸与透明度调节',
  tag: '插值分析',
  component: TemperatureSurfaceDemo,
  updatedAt: '2026-09-10',
  icon,
}

export default temperatureSurfaceCase
