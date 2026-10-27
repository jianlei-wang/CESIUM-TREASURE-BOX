import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const CimHeatSurfaceDemo = defineAsyncComponent(() => import('./CimHeatSurfaceDemo.vue'))

const cimHeatSurfaceCase: DemoCard = {
  id: 'cim-heat-surface',
  title: '热力采样三维曲面',
  category: 'data',
  description: '把离散采样点渲染为热力纹理，并按强度抬升成可旋转的三维曲面',
  tag: '数据可视化',
  icon,
  component: CimHeatSurfaceDemo,
  updatedAt: '2026-10-25'
}

export default cimHeatSurfaceCase
