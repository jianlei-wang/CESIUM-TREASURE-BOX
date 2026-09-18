import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const PointClusterDemo = defineAsyncComponent(() => import('./PointClusterDemo.vue'))
import icon from './icon.webp'

const pointClusterCase: DemoCard = {
  id: 'point-cluster',
  title: '数据可视化-点聚合(基础版)',
  category: 'data',
  description: '采用 Cesium EntityCluster 点聚合，聚合点数量随缩放动态变化',
  tag: '点聚合',
  icon,
  component: PointClusterDemo
}

export default pointClusterCase
