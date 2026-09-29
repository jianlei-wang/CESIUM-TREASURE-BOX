import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const MassDynamicLinesDemo = defineAsyncComponent(() => import('./MassDynamicLinesDemo.vue'))
import icon from './icon.webp'

const massDynamicLinesCase: DemoCard = {
  id: 'mass-dynamic-lines',
  title: '数据可视化-海量动态线',
  category: 'data',
  description: '浮点纹理流式承载十万级随机线段，两端位置每 50ms 更新一次并在 GPU 双缓冲插值，按屏幕空间展开恒定像素宽度四边形，单次 DrawCall 渲染全部线，支持数量/线宽/线段长度/更新频率/速度/颜色等参数调整',
  tag: '海量数据',
  component: MassDynamicLinesDemo,
  icon,
  updatedAt: '2026-09-29'
}

export default massDynamicLinesCase
