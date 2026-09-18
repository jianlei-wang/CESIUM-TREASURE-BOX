import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const TablePointsDemo = defineAsyncComponent(() => import('./TablePointsDemo.vue'))
import icon from './icon.webp'

const tablePointsCase: DemoCard = {
  id: 'table-points',
  title: '数据图层-表格点位',
  category: 'data',
  description: '读取本地表格并按字段加载随机颜色点图层',
  tag: '本地数据',
  component: TablePointsDemo,
  icon,
  updatedAt: '2026-08-23'
}

export default tablePointsCase
