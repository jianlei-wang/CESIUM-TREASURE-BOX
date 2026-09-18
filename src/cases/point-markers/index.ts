import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const PointMarkersDemo = defineAsyncComponent(() => import('./PointMarkersDemo.vue'))
import icon from './icon.webp'

const pointMarkersCase: DemoCard = {
  id: 'point-markers',
  title: '标记标绘-点位标记与清单',
  category: 'draw',
  description: '输入经纬度或在地图上点击添加点位，地图同步标记点位与经纬度值，支持点位删除、跳转定位以及整体导出 CSV / Excel 清单',
  tag: '点位管理',
  component: PointMarkersDemo,
  icon,
  updatedAt: '2026-08-28'
}

export default pointMarkersCase
