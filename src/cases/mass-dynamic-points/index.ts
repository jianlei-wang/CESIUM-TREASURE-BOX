import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const MassDynamicPointsDemo = defineAsyncComponent(() => import('./MassDynamicPointsDemo.vue'))
import icon from './icon.webp'

const massDynamicPointsCase: DemoCard = {
  id: 'mass-dynamic-points',
  title: '数据可视化-海量动态点',
  category: 'data',
  description: '浮点纹理流式承载十万级随机点数据，位置每 50ms 更新一次并在 GPU 双缓冲插值，以屏幕空间点精灵单次 DrawCall 渲染全部点，支持数量/点大小/更新频率/速度/颜色等参数调整',
  tag: '海量数据',
  component: MassDynamicPointsDemo,
  icon,
  updatedAt: '2026-09-29'
}

export default massDynamicPointsCase
