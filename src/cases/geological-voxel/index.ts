import { defineAsyncComponent } from 'vue'
import type { DemoCard } from '../types'
import icon from './icon.png'

const GeologicalVoxelDemo = defineAsyncComponent(() => import('./GeologicalVoxelDemo.vue'))

const geologicalVoxelCase: DemoCard = {
  id: 'geological-voxel',
  title: '三维地质体-标准层状模型',
  category: 'data',
  description:
    '基于 VoxelPrimitive 构建 24×24×24 体素的标准层状地质体：六层岩性含波浪界面与局部构造侵入体，支持分层显隐、透明度/步长/屏幕误差调节、X/Y/Z 方向剖切与岩性拾取查询',
  tag: '三维地质体',
  icon,
  updatedAt: '2026-09-03',
  component: GeologicalVoxelDemo
}

export default geologicalVoxelCase
