import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
const PointBufferDemo = defineAsyncComponent(() => import('./PointBufferDemo.vue'))
import icon from './icon.webp'

const pointBufferCase: DemoCard = {
  id: 'point-buffer',
  title: '空间分析-点缓冲区分析',
  category: 'analysis',
  description: '地图点击或输入经纬度创建点，按半径(m)生成点缓冲区',
  tag: '缓冲区',
  icon,
  component: PointBufferDemo,
  updatedAt: '2026-08-26'
}

export default pointBufferCase
