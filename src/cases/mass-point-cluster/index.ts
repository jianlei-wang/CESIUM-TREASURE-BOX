import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.webp'

const MassPointClusterDemo = defineAsyncComponent(() => import('./MassPointClusterDemo.vue'))

const massPointClusterCase: DemoCard = {
  id: 'mass-point-cluster',
  title: '数据可视化-海量点实时聚合',
  category: 'data',
  description: 'Web Worker 屏幕空间网格聚合，PointPrimitiveCollection 散点与 BillboardCollection 聚合图标双集合渲染，聚合图标内嵌数量并随聚合点数对数放大，支持 10 万~50 万点实时聚合、点击拾取与双击飞行展开',
  tag: '海量数据',
  icon,
  component: MassPointClusterDemo,
  updatedAt: '2026-09-16'
}

export default massPointClusterCase
