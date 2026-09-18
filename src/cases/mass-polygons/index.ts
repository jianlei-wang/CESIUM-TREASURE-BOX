import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const MassPolygonsDemo = defineAsyncComponent(() => import('./MassPolygonsDemo.vue'))
import icon from './icon.webp'

const massPolygonsCase: DemoCard = {
  id: 'mass-polygons',
  title: '数据可视化-海量不规则多边形',
  category: 'data',
  description: 'Primitive 批量实例加载十万乃至百万级不规则多边形，支持数量、形状、随机范围、高度、透明度与颜色模式等参数调整',
  tag: '海量数据',
  component: MassPolygonsDemo,
  icon,
  updatedAt: '2026-08-28'
}

export default massPolygonsCase
