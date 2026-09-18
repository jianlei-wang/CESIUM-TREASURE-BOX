import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const MassLinesDemo = defineAsyncComponent(() => import('./MassLinesDemo.vue'))
import icon from './icon.webp'

const massLinesCase: DemoCard = {
  id: 'mass-lines',
  title: '数据可视化-海量不规则线',
  category: 'data',
  description: 'Primitive 批量实例加载十万乃至百万级不规则线，支持数量、随机范围、线宽、透明度与颜色模式等参数调整',
  tag: '海量数据',
  component: MassLinesDemo,
  icon,
  updatedAt: '2026-08-28'
}

export default massLinesCase
