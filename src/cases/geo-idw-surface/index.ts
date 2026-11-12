import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'

const IdwSurfaceDemo = defineAsyncComponent(() => import('./IdwSurfaceDemo.vue'))
import icon from './icon.webp'

const idwSurfaceCase: DemoCard = {
  id: 'geo-idw-surface',
  title: '空间分析-站点数据插值成面',
  category: 'analysis',
  description:
    '把离散站点观测值按下垫面距离权重插值成连续曲面，支持幂指数、邻域站点数、网格分辨率与影响半径调节，同步输出插值方差用于判断可信度，点击地图可读取该处插值结果与最近站点距离。',
  tag: 'IDW, 插值, 站点, 曲面',
  component: IdwSurfaceDemo,
  icon,
  updatedAt: '2026-11-12'
}

export default idwSurfaceCase
