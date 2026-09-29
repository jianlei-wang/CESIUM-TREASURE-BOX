import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const MassDynamicPolygonsDemo = defineAsyncComponent(() => import('./MassDynamicPolygonsDemo.vue'))
import icon from './icon.webp'

const massDynamicPolygonsCase: DemoCard = {
  id: 'mass-dynamic-polygons',
  title: '数据可视化-海量动态多边形',
  category: 'data',
  description: '浮点纹理流式承载十万级随机面数据，位置每 50ms 更新一次并在 GPU 双缓冲插值，单次 DrawCall 渲染全部多边形，支持数量/形状/更新频率/速度/颜色等参数调整',
  tag: '海量数据',
  component: MassDynamicPolygonsDemo,
  icon,
  updatedAt: '2026-09-29'
}

export default massDynamicPolygonsCase
